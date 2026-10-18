'use strict';

const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createRegistry, checkDigest } = require('./package-manifests.cjs');

const INDEX_TYPES = new Set([
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
]);
const IMAGE_TYPES = new Set([
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
]);

function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(line => line === `## [${version}]` || line.startsWith(`## [${version}] - `));
  if (start < 0) throw new Error(`Prepare a CHANGELOG.md section for ${version} before releasing.`);
  let end = start + 1;
  while (end < lines.length && !/^## |^\[[^\]]+\]:/.test(lines[end])) end++;
  const notes = lines.slice(start + 1, end).join('\n').trim();
  if (!notes) throw new Error(`The changelog section for ${version} is empty.`);
  return notes;
}

async function optionalRequest(github, route, params) {
  try {
    return (await github.request(route, params)).data;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function tagCommit({ github, repo, version }) {
  const tag = `v${version}`;
  const ref = await optionalRequest(github, 'GET /repos/{owner}/{repo}/git/ref/{ref}', { ...repo, ref: `tags/${tag}` });
  if (!ref) return null;
  let object = ref.object;
  // Peel annotated tags as well as lightweight tags; bound malformed chains.
  for (let depth = 0; object?.type === 'tag' && depth < 10; depth++) {
    object = (await github.request('GET /repos/{owner}/{repo}/git/tags/{tag_sha}', { ...repo, tag_sha: object.sha })).data.object;
  }
  if (object?.type !== 'commit') throw new Error(`Invalid release tag: ${tag}`);
  return object.sha;
}

async function checkTag(options) {
  const sha = await tagCommit(options);
  if (!sha) return false;
  if (sha !== options.commit) {
    const tag = `v${options.version}`;
    throw new Error(`${tag} already points to another commit. Increase VERSION in .env; tags are never moved.`);
  }
  return true;
}

async function promoteLatest(options, publish = (image, digest) => {
  execFileSync('docker', ['buildx', 'imagetools', 'create', '--prefer-index=false',
    '--tag', `${image}:latest`, `${image}@${digest}`], { stdio: 'inherit' });
}) {
  const { registry, version, image } = options;
  if (version.includes('-')) return 'Prerelease: latest unchanged.';
  const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  if (!stableVersion.test(version)) throw new Error('Invalid stable version for latest.');
  if (options.latestOnly) {
    const release = await optionalRequest(options.github, 'GET /repos/{owner}/{repo}/releases/tags/{tag}', {
      ...options.repo, tag: `v${version}`,
    });
    const commit = await tagCommit(options);
    const expectedDigest = release?.body?.match(/Digest: `([^`]+)`/)?.[1];
    if (!commit || !release || release.tag_name !== `v${version}` || release.draft || release.prerelease || !expectedDigest) {
      throw new Error('Updating latest requires an existing stable release, Git tag and recorded image digest.');
    }
    options = { ...options, commit, expectedDigest: checkDigest(expectedDigest) };
  }
  if (!options.expectedDigest) throw new Error('A verified image digest is required for latest.');
  const hasTag = await checkTag(options);
  if (options.latestOnly && !hasTag) throw new Error('The release tag disappeared before updating latest.');
  const digest = await verifyImage(options);
  const current = await registry.tag('latest');
  if (current?.digest === digest) return `latest already points to ${version} (${digest}).`;
  if (current) {
    let manifest = current.manifest;
    if (INDEX_TYPES.has(manifest?.mediaType)) {
      const descriptor = manifest.manifests?.find(entry => entry.platform?.os !== 'unknown');
      if (!descriptor) throw new Error('Cannot determine the current latest version.');
      manifest = await registry.manifest(checkDigest(descriptor.digest));
    }
    const config = await registry.blob(checkDigest(manifest.config?.digest));
    const previous = config.config?.Labels?.['org.opencontainers.image.version'];
    // The legacy latest image predates version labels. Only explicit repair may replace it.
    if (previous != null || !options.latestOnly) {
      if (!stableVersion.test(previous)) throw new Error('Cannot determine the current stable latest version; use latest_only for an unlabeled legacy image.');
      const oldParts = previous.split('.').map(BigInt);
      const newParts = version.split('.').map(BigInt);
      const difference = newParts.map((part, i) => part - oldParts[i]).find(part => part !== 0n);
      if (difference < 0n) return `latest remains on newer version ${previous}.`;
      if (difference === undefined) throw new Error('latest has the same version but a different digest; review it manually.');
    }
  }
  await publish(image, digest);
  if ((await registry.tag('latest'))?.digest !== digest) throw new Error('latest does not match the verified image digest.');
  return `latest now points to ${version} (${digest}).`;
}

function platformName({ os, architecture, variant }) {
  if (!os || !architecture) throw new Error('Missing image platform');
  // OCI descriptors can spell ARM64 as arm64 or arm64/v8.
  return `${os}/${architecture}${variant && !(architecture === 'arm64' && variant === 'v8') ? `/${variant}` : ''}`;
}

async function verifyImage({ registry, version, commit, platforms, expectedDigest, expectedDescription }) {
  const found = await registry.tag(version);
  if (!found) {
    if (expectedDigest) throw new Error('The published image tag is missing.');
    return null;
  }
  checkDigest(found.digest);
  if (expectedDigest && found.digest !== expectedDigest) throw new Error('The image digest changed after publishing.');
  if (expectedDescription !== undefined) {
    if (typeof expectedDescription !== 'string' || !expectedDescription.trim() || [...expectedDescription].length > 512) {
      throw new Error('Image description must contain 1 to 512 characters.');
    }
    if (found.manifest?.annotations?.['org.opencontainers.image.description'] !== expectedDescription) {
      throw new Error('Image index description is missing or differs from IMAGE_DESCRIPTION.');
    }
  }
  const actual = [];
  async function inspect(manifest, platform) {
    if (manifest?.schemaVersion !== 2 || !IMAGE_TYPES.has(manifest.mediaType) || !Array.isArray(manifest.layers)) {
      throw new Error('Unsupported image manifest');
    }
    const config = await registry.blob(checkDigest(manifest.config?.digest));
    const labels = config.config?.Labels;
    if (labels?.['org.opencontainers.image.version'] !== version || labels?.['org.opencontainers.image.revision'] !== commit) {
      throw new Error('Existing image version/revision does not match this commit. Increase VERSION; images are never overwritten.');
    }
    if (platform && (platform.os !== config.os || platform.architecture !== config.architecture ||
        (config.variant && platformName(platform) !== platformName(config)))) {
      throw new Error('Image config does not match its platform descriptor.');
    }
    actual.push(platformName(platform || config));
  }
  if (found.manifest?.schemaVersion === 2 && INDEX_TYPES.has(found.manifest.mediaType)) {
    const descriptors = found.manifest.manifests;
    if (!Array.isArray(descriptors) || !descriptors.length) throw new Error('Empty or invalid image index');
    const attestations = [];
    const images = new Set();
    for (const descriptor of descriptors) {
      checkDigest(descriptor.digest);
      if (descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest' &&
          descriptor.platform?.os === 'unknown' && descriptor.platform?.architecture === 'unknown') {
        attestations.push(descriptor.annotations['vnd.docker.reference.digest']);
        continue;
      }
      if (!descriptor.platform) throw new Error('Missing image platform descriptor');
      images.add(descriptor.digest);
      await inspect(await registry.manifest(descriptor.digest), descriptor.platform);
    }
    if (attestations.some(digest => !images.has(digest))) throw new Error('Attestation refers to an unknown image');
  } else {
    await inspect(found.manifest);
  }
  const expected = platforms.split(',').map(value => value.trim()).sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected)) {
    throw new Error(`Image platforms do not match: expected ${expected.join(',')}, found ${actual.join(',')}.`);
  }
  return found.digest;
}

async function prepareRelease(options) {
  await checkTag(options);
  if (options.automatic) releaseNotes(options.changelog, options.version);
  const digest = await verifyImage(options);
  if (!digest) {
    const release = await optionalRequest(options.github, 'GET /repos/{owner}/{repo}/releases/tags/{tag}', {
      ...options.repo, tag: `v${options.version}`,
    });
    if (release) throw new Error('The release already exists but its image is missing. Use a new version instead of rebuilding a released version.');
  }
  return { build: !digest, digest: digest || '' };
}

async function finishRelease(options) {
  const { github, repo, version, commit, expectedDigest, changelog, image } = options;
  if (!expectedDigest) throw new Error('A verified image digest is required for a release.');
  const notes = releaseNotes(changelog, version);
  let hasTag = await checkTag(options);
  await verifyImage(options);
  const tag = `v${version}`;
  const params = { ...repo, tag };
  const existing = await optionalRequest(github, 'GET /repos/{owner}/{repo}/releases/tags/{tag}', params);
  function validateRelease(release) {
    if (!hasTag || release.tag_name !== tag || release.draft || release.prerelease !== version.includes('-')) {
      throw new Error('Existing release does not match the expected published release; review it manually.');
    }
    const recordedDigest = release.body?.match(/Digest: `([^`]+)`/);
    if (recordedDigest && recordedDigest[1] !== expectedDigest) {
      throw new Error('Existing release records a different image digest; review it manually.');
    }
    return release.html_url;
  }
  if (existing) return validateRelease(existing);
  if (!hasTag) {
    try {
      await github.request('POST /repos/{owner}/{repo}/git/refs', { ...repo, ref: `refs/tags/${tag}`, sha: commit });
    } catch (error) {
      // A concurrent manual tag is acceptable only if it points to this commit.
      if (error.status !== 422 || !await checkTag(options)) throw error;
    }
    hasTag = true;
  }
  if (!await checkTag(options)) throw new Error('The release tag disappeared before release creation.');
  try {
    const result = await github.request('POST /repos/{owner}/{repo}/releases', {
      ...repo, tag_name: tag, target_commitish: commit, name: tag,
      body: `${notes}\n\nContainer image: \`${image}:${version}\`\n\nDigest: \`${expectedDigest}\`\n`,
      draft: false, prerelease: version.includes('-'),
    });
    return result.data.html_url;
  } catch (error) {
    if (error.status !== 422) throw error;
    const release = await optionalRequest(github, 'GET /repos/{owner}/{repo}/releases/tags/{tag}', params);
    if (!release) throw error;
    if (!await checkTag(options)) throw new Error('The release tag disappeared during release creation.');
    return validateRelease(release);
  }
}

async function run({ github, context, core, env, mode }) {
  const repo = context.repo;
  const options = {
    github, repo, version: env.RELEASE_VERSION, commit: env.RELEASE_COMMIT,
    platforms: env.BUILD_PLATFORMS, expectedDigest: env.EXPECTED_DIGEST || undefined,
    expectedDescription: env.IMAGE_DESCRIPTION,
    latestOnly: env.LATEST_ONLY === 'true',
    automatic: context.eventName === 'push',
    changelog: readFileSync('CHANGELOG.md', 'utf8'),
    image: `ghcr.io/${repo.owner}/${repo.repo}`.toLowerCase(),
    registry: createRegistry({ owner: repo.owner, packageName: repo.repo, username: context.actor,
      token: env.GH_TOKEN, mask: value => core.setSecret(value) }),
  };
  if (mode === 'prepare') {
    const result = await prepareRelease(options);
    core.setOutput('build', result.build);
    core.setOutput('digest', result.digest);
    core.info(result.build ? 'Version is available for publishing.' : `Reusing verified image ${result.digest}.`);
  } else if (mode === 'verify') {
    if (!options.expectedDigest) throw new Error('Missing build digest');
    core.setOutput('digest', await verifyImage(options));
  } else if (mode === 'latest') {
    core.info(await promoteLatest(options));
  } else if (mode === 'release') {
    const url = await finishRelease(options);
    await core.summary.addHeading('Release').addLink(`v${options.version}`, url)
      .addRaw(`\n\nImage: ${options.image}:${options.version}\n\nDigest: ${options.expectedDigest}\n`).write();
  } else {
    throw new Error('Unknown release operation');
  }
}

module.exports = { releaseNotes, checkTag, verifyImage, prepareRelease, finishRelease, promoteLatest, run };
