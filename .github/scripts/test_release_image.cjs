'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { createRegistry } = require('./package-manifests.cjs');
const { releaseNotes, checkTag, verifyImage, prepareRelease, finishRelease } = require('./release-image.cjs');

const VERSION = '2.0.0';
const COMMIT = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const INDEX = 'application/vnd.oci.image.index.v1+json';
const IMAGE = 'application/vnd.oci.image.manifest.v1+json';
const PLATFORMS = 'linux/amd64,linux/arm/v7,linux/arm64';
const CHANGELOG = '## [Unreleased]\n\n- Future change.\n\n## [2.0.0] - 2026-10-16\n\n### Added\n\n- Release change.\n\n## [1.0.0]\n\n- Old change.\n';
const digest = id => `sha256:${id.toString(16).padStart(64, '0')}`;
const failure = status => Object.assign(new Error(`HTTP ${status}`), { status });

function fixture() {
  const platforms = [
    { os: 'linux', architecture: 'amd64' },
    { os: 'linux', architecture: 'arm', variant: 'v7' },
    { os: 'linux', architecture: 'arm64', variant: 'v8' },
  ];
  const configs = platforms.map(platform => ({ ...platform, config: { Labels: {
    'org.opencontainers.image.version': VERSION, 'org.opencontainers.image.revision': COMMIT,
  } } }));
  const manifests = platforms.map((platform, i) => ({ schemaVersion: 2, mediaType: IMAGE, config: { digest: digest(i + 10) }, layers: [] }));
  const index = { schemaVersion: 2, mediaType: INDEX, manifests: platforms.map((platform, i) => ({ digest: digest(i + 1), platform: { ...platform } })) };
  const state = { tag: null, release: null, found: { digest: DIGEST, manifest: index } };
  const calls = [];
  const github = { async request(route, params) {
    calls.push({ route, params });
    if (route.includes('/git/ref/{ref}')) {
      if (!state.tag) throw failure(404);
      return { data: { object: state.tag } };
    }
    if (route.includes('/git/tags/')) return { data: { object: { type: 'commit', sha: COMMIT } } };
    if (route.includes('/releases/tags/')) {
      if (!state.release) throw failure(404);
      return { data: state.release };
    }
    if (route.startsWith('POST') && route.endsWith('/git/refs')) {
      state.tag = { type: 'commit', sha: params.sha };
      return { data: {} };
    }
    if (route.startsWith('POST') && route.endsWith('/releases')) {
      state.release = { ...params, html_url: 'https://github.com/owner/sogo/releases/tag/v2.0.0' };
      return { data: state.release };
    }
    throw new Error(`Unexpected request: ${route}`);
  } };
  const registry = {
    async tag() { return state.found; },
    async manifest(name) {
      const value = manifests[Number.parseInt(name.slice(7), 16) - 1];
      if (!value) throw failure(404);
      return value;
    },
    async blob(name) { return configs[Number.parseInt(name.slice(7), 16) - 10]; },
  };
  return { state, calls, configs, manifests, index,
    options: { github, registry, repo: { owner: 'owner', repo: 'sogo' }, version: VERSION, commit: COMMIT,
      platforms: PLATFORMS, automatic: true, changelog: CHANGELOG, image: 'ghcr.io/owner/sogo' } };
}
const writes = f => f.calls.filter(call => call.route.startsWith('POST'));

test('release notes include only the requested version and omit reference links', () => {
  assert.equal(releaseNotes(CHANGELOG, VERSION), '### Added\n\n- Release change.');
  assert.equal(releaseNotes('## [2.0.0]\r\n\r\n- Change.\r\n\r\n[2.0.0]: https://example.com\r\n', VERSION), '- Change.');
  assert.throws(() => releaseNotes(CHANGELOG, '9.0.0'), /Prepare/);
  assert.throws(() => releaseNotes('## [2.0.0]\n\n## [1.0.0]', VERSION), /empty/);
});

test('new version builds; matching published version is reused without writes', async () => {
  const f = fixture();
  assert.deepEqual(await prepareRelease(f.options), { build: false, digest: DIGEST });
  f.state.found = null;
  assert.deepEqual(await prepareRelease(f.options), { build: true, digest: '' });
  assert.deepEqual(writes(f), []);
});

test('automatic releases require prepared notes; manual image publishing does not', async () => {
  const f = fixture();
  f.options.changelog = '## [Unreleased]\n- Change';
  await assert.rejects(prepareRelease(f.options), /Prepare/);
  f.options.automatic = false;
  assert.equal((await prepareRelease(f.options)).build, false);
});

test('a removed image from an existing release is not rebuilt with a new digest', async () => {
  const f = fixture();
  f.state.found = null;
  f.state.release = { tag_name: `v${VERSION}`, draft: false, prerelease: false };
  await assert.rejects(prepareRelease(f.options), /image is missing/);
  assert.deepEqual(writes(f), []);
});

test('matching lightweight and annotated tags are accepted', async () => {
  for (const type of ['commit', 'tag']) {
    const f = fixture();
    f.state.tag = { type, sha: type === 'commit' ? COMMIT : 'c'.repeat(40) };
    assert.equal(await checkTag(f.options), true);
  }
});

test('conflicting tags stop before image inspection or writes', async () => {
  const f = fixture();
  f.state.tag = { type: 'commit', sha: 'c'.repeat(40) };
  f.options.registry.tag = () => { throw new Error('Must not inspect'); };
  await assert.rejects(prepareRelease(f.options), /another commit/);
  await assert.rejects(finishRelease({ ...f.options, expectedDigest: DIGEST }), /another commit/);
  assert.deepEqual(writes(f), []);
});

test('GitHub errors other than 404 are not interpreted as missing tags', async () => {
  for (const status of [401, 403, 429, 500]) {
    const f = fixture();
    f.options.github.request = async () => { throw failure(status); };
    await assert.rejects(prepareRelease(f.options), new RegExp(String(status)));
  }
});

test('every platform must carry the matching version and commit labels', async () => {
  for (const label of ['org.opencontainers.image.version', 'org.opencontainers.image.revision']) {
    for (const value of [undefined, 'other']) {
      const f = fixture();
      f.configs[2].config.Labels[label] = value;
      await assert.rejects(prepareRelease(f.options), /never overwritten/);
      await assert.rejects(finishRelease({ ...f.options, expectedDigest: DIGEST }), /never overwritten/);
      assert.deepEqual(writes(f), []);
    }
  }
});

test('missing, extra, duplicate and incorrect platforms are rejected', async () => {
  for (const mutate of [
    f => f.index.manifests.pop(),
    f => f.index.manifests.push(f.index.manifests[0]),
    f => { f.index.manifests[2].platform.architecture = 'arm'; },
    f => { f.configs[1].variant = 'v6'; },
    f => { f.index.manifests[0].platform = undefined; },
    f => { f.options.platforms = 'linux/amd64'; },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(verifyImage(f.options), /platform/i);
  }
});

test('single-platform manual images are verified too', async () => {
  const f = fixture();
  f.state.found.manifest = f.manifests[0];
  f.options.platforms = 'linux/amd64';
  assert.equal(await verifyImage(f.options), DIGEST);
});

test('BuildKit attestations do not count as runtime platforms', async () => {
  const f = fixture();
  const attestation = { digest: digest(99), platform: { os: 'unknown', architecture: 'unknown' }, annotations: {
    'vnd.docker.reference.type': 'attestation-manifest', 'vnd.docker.reference.digest': digest(1),
  } };
  f.index.manifests.push(attestation);
  assert.equal(await verifyImage(f.options), DIGEST);
  attestation.annotations['vnd.docker.reference.digest'] = digest(90);
  await assert.rejects(verifyImage(f.options), /unknown image/);
});

test('invalid manifests and missing children fail closed', async () => {
  for (const mutate of [
    f => { f.index.manifests = []; },
    f => { f.index.schemaVersion = 1; },
    f => { f.manifests[0].config.digest = 'invalid'; },
    f => { f.index.manifests[0].digest = digest(100); },
    f => { f.manifests[0].layers = undefined; },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(verifyImage(f.options));
  }
});

test('release requires the verified digest and detects a missing or replaced image', async () => {
  const f = fixture();
  await assert.rejects(finishRelease(f.options), /digest is required/);
  await assert.rejects(finishRelease({ ...f.options, expectedDigest: digest(77) }), /digest changed/);
  f.state.found = null;
  await assert.rejects(finishRelease({ ...f.options, expectedDigest: DIGEST }), /tag is missing/);
  assert.deepEqual(writes(f), []);
});

test('creates the tag at the built commit and release once with changelog and digest', async () => {
  const f = fixture();
  f.options.expectedDigest = DIGEST;
  const url = await finishRelease(f.options);
  assert.equal(writes(f).length, 2);
  assert.deepEqual(writes(f)[0].params, { owner: 'owner', repo: 'sogo', ref: 'refs/tags/v2.0.0', sha: COMMIT });
  assert.equal(f.state.release.target_commitish, COMMIT);
  assert.equal(f.state.release.prerelease, false);
  assert.match(f.state.release.body, /Release change/);
  assert.ok(f.state.release.body.includes(DIGEST));
  assert.ok(!f.state.release.body.includes('Future change'));
  assert.equal(await finishRelease(f.options), url);
  assert.equal(writes(f).length, 2);
});

test('manually created tags receive a release without replacing the tag', async () => {
  const f = fixture();
  f.state.tag = { type: 'commit', sha: COMMIT };
  await finishRelease({ ...f.options, expectedDigest: DIGEST });
  assert.equal(writes(f).length, 1);
  assert.ok(writes(f)[0].route.endsWith('/releases'));
});

test('a failed release can be retried using the existing image and tag', async () => {
  const f = fixture();
  const request = f.options.github.request;
  f.options.github.request = async (route, params) => {
    if (route.startsWith('POST') && route.endsWith('/releases')) throw failure(500);
    return request(route, params);
  };
  await assert.rejects(finishRelease({ ...f.options, expectedDigest: DIGEST }), /500/);
  assert.equal(f.state.tag.sha, COMMIT);
  assert.equal((await prepareRelease(f.options)).build, false);
  f.options.github.request = request;
  await finishRelease({ ...f.options, expectedDigest: DIGEST });
  assert.equal(writes(f).filter(call => call.route.endsWith('/git/refs')).length, 1);
});

test('draft or dangling releases are not silently changed', async () => {
  for (const hasTag of [true, false]) {
    const f = fixture();
    f.state.release = { tag_name: `v${VERSION}`, draft: hasTag, prerelease: false };
    if (hasTag) f.state.tag = { type: 'commit', sha: COMMIT };
    await assert.rejects(finishRelease({ ...f.options, expectedDigest: DIGEST }), /review it manually/);
    assert.deepEqual(writes(f), []);
  }
});

test('prerelease versions are published as GitHub prereleases', async () => {
  const f = fixture();
  const version = '2.0.0-rc.1';
  f.options.version = version;
  f.options.changelog = `## [${version}]\n\n- Candidate.\n`;
  for (const config of f.configs) config.config.Labels['org.opencontainers.image.version'] = version;
  await finishRelease({ ...f.options, expectedDigest: DIGEST });
  assert.equal(f.state.release.prerelease, true);
});

test('an existing release with a different recorded digest is not accepted', async () => {
  const f = fixture();
  f.state.tag = { type: 'commit', sha: COMMIT };
  f.state.release = { tag_name: `v${VERSION}`, draft: false, prerelease: false, body: `Digest: \`${digest(99)}\`` };
  await assert.rejects(finishRelease({ ...f.options, expectedDigest: DIGEST }), /different image digest/);
  assert.deepEqual(writes(f), []);
});

test('release API conflicts are accepted only for an already matching release', async () => {
  for (const draft of [false, true]) {
    const f = fixture();
    const request = f.options.github.request;
    f.options.github.request = async (route, params) => {
      if (route.startsWith('POST') && route.endsWith('/releases')) {
        f.state.release = { ...params, draft, html_url: 'https://github.com/owner/sogo/releases/tag/v2.0.0' };
        throw failure(422);
      }
      return request(route, params);
    };
    const result = finishRelease({ ...f.options, expectedDigest: DIGEST });
    if (!draft) await result;
    else await assert.rejects(result, /review it manually/);
  }
});

test('racing tag creation is accepted only for the same commit', async () => {
  for (const sha of [COMMIT, 'c'.repeat(40)]) {
    const f = fixture();
    const request = f.options.github.request;
    f.options.github.request = async (route, params) => {
      if (route.startsWith('POST') && route.endsWith('/git/refs')) {
        f.state.tag = { type: 'commit', sha };
        throw failure(422);
      }
      return request(route, params);
    };
    const result = finishRelease({ ...f.options, expectedDigest: DIGEST });
    if (sha === COMMIT) await result;
    else await assert.rejects(result, /another commit/);
  }
});

function registryWith(responses) {
  const calls = [];
  const registry = createRegistry({ owner: 'owner', packageName: 'sogo', username: 'actor', token: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      const response = responses.shift();
      if (!response) throw new Error('Unexpected fetch');
      return response;
    } });
  return { registry, calls };
}
const auth = () => new Response(JSON.stringify({ token: 'pull-token' }));

test('only a manifest 404 permits publishing; auth and server errors abort', async () => {
  const f = registryWith([auth(), new Response('', { status: 404 })]);
  assert.equal(await f.registry.tag(VERSION), null);
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(registryWith([new Response('', { status })]).registry.tag(VERSION), new RegExp(String(status)));
    if (status !== 404) {
      await assert.rejects(registryWith([auth(), new Response('', { status })]).registry.tag(VERSION), new RegExp(String(status)));
    }
  }
});

test('tag inspection computes a digest from the actual manifest bytes', async () => {
  const body = JSON.stringify({ schemaVersion: 2 });
  const expected = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  const f = registryWith([auth(), new Response(body)]);
  assert.deepEqual(await f.registry.tag(VERSION), { digest: expected, manifest: { schemaVersion: 2 } });
});

test('config blobs are verified and storage redirects never receive credentials', async () => {
  const body = JSON.stringify({ architecture: 'amd64' });
  const name = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  const f = registryWith([auth(), new Response(null, { status: 307, headers: { location: 'https://storage.example/config?signature=secret' } }), new Response(body)]);
  assert.deepEqual(await f.registry.blob(name), { architecture: 'amd64' });
  assert.equal(f.calls[1].options.headers.Authorization, 'Bearer pull-token');
  assert.equal(f.calls[2].options.headers.Authorization, undefined);
  assert.equal(f.calls[2].options.redirect, 'error');
  await assert.rejects(registryWith([auth(), new Response(body)]).registry.blob(digest(12)), /digest mismatch/);
});

test('unsafe or missing blob redirects fail without requesting the target', async () => {
  for (const location of [undefined, 'http://storage.example/config', 'https://user:password@storage.example/config']) {
    const f = registryWith([auth(), new Response(null, { status: 307, headers: location ? { location } : {} })]);
    await assert.rejects(f.registry.blob(digest(1)), /redirect/);
    assert.equal(f.calls.length, 2);
  }
});
