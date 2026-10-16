'use strict';

const { createHash } = require('node:crypto');

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const INDEX_TYPES = new Set([
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
]);
const IMAGE_TYPES = new Set([
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
]);
const ACCEPT = [...INDEX_TYPES, ...IMAGE_TYPES].join(', ');

function checkDigest(digest) {
  if (!DIGEST.test(digest)) throw new Error(`Unsupported manifest digest: ${digest}`);
  return digest;
}

function createRegistry({ owner, packageName, username, token, fetchImpl = fetch, mask = () => {} }) {
  if (!token || !username) throw new Error('Registry credentials are required');
  const repository = `${owner}/${packageName}`.toLowerCase();
  if (!/^[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*(\/[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*)*$/.test(repository)) {
    throw new Error('Invalid GHCR repository name');
  }
  let bearer;
  async function request(url, authorization, allowRedirect = false) {
    const response = await fetchImpl(url, {
      headers: { ...(authorization ? { Authorization: authorization } : {}), Accept: ACCEPT },
      redirect: allowRedirect ? 'manual' : 'error',
      signal: AbortSignal.timeout(30000),
    });
    // GHCR can serve blobs from signed storage URLs. Never forward credentials.
    if (allowRedirect && [301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get('location');
      if (!target) throw new Error('Missing GHCR blob redirect location');
      const location = new URL(target, url);
      if (location.protocol !== 'https:' || location.username || location.password) {
        throw new Error('Invalid GHCR blob redirect');
      }
      return request(location.href, undefined);
    }
    // Do not include response bodies, signed URLs or credentials in errors.
    if (!response.ok) {
      const error = new Error(`GHCR request failed (HTTP ${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response;
  }
  async function authenticate() {
    if (!bearer) {
      const url = new URL('https://ghcr.io/token');
      url.searchParams.set('service', 'ghcr.io');
      url.searchParams.set('scope', `repository:${repository}:pull`);
      const basic = Buffer.from(`${username}:${token}`).toString('base64');
      mask(basic);
      const response = await request(url, `Basic ${basic}`);
      const auth = await response.json();
      bearer = auth.token || auth.access_token;
      if (typeof bearer !== 'string' || !bearer) throw new Error('Missing GHCR pull token');
      mask(bearer);
    }
  }
  async function readJson(response, expectedDigest) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (expectedDigest && digest !== expectedDigest) {
      throw new Error(`Manifest digest mismatch: ${expectedDigest}`);
    }
    return { digest, manifest: JSON.parse(bytes.toString('utf8')) };
  }
  return {
    async manifest(digest) {
      checkDigest(digest);
      await authenticate();
      const response = await request(`https://ghcr.io/v2/${repository}/manifests/${digest}`, `Bearer ${bearer}`);
      return (await readJson(response, digest)).manifest;
    },
    async tag(tag) {
      if (!/^[\w][\w.-]{0,127}$/.test(tag)) throw new Error('Invalid image tag');
      await authenticate();
      let response;
      try {
        response = await request(`https://ghcr.io/v2/${repository}/manifests/${tag}`, `Bearer ${bearer}`);
      } catch (error) {
        // Only a missing tag permits a build, never an authentication failure.
        if (error.status === 404) return null;
        throw error;
      }
      return readJson(response);
    },
    async blob(digest) {
      checkDigest(digest);
      await authenticate();
      const response = await request(`https://ghcr.io/v2/${repository}/blobs/${digest}`, `Bearer ${bearer}`, true);
      return (await readJson(response, digest)).manifest;
    },
  };
}

async function loadGraph(versions, registry) {
  const dependencies = new Map();
  const subjects = new Map();
  const indexed = new Set();
  const inventory = new Set(versions.map(version => checkDigest(version.name)));
  const missing = new Set();
  const pending = [...inventory].map(digest => ({ digest, optional: false }));
  while (pending.length) {
    const { digest, optional } = pending.pop();
    if (dependencies.has(digest)) continue;
    if (optional && missing.has(digest)) continue;
    let manifest;
    try {
      manifest = await registry.manifest(digest);
    } catch (error) {
      // Previously pruned orphan indexes/artifacts can reference missing data.
      // A missing inventory entry is never tolerated; missing index children
      // outside the inventory are checked against protected roots by the planner.
      if (!optional || error.status !== 404) throw error;
      missing.add(digest);
      continue;
    }
    if (manifest?.schemaVersion !== 2 ||
        (!INDEX_TYPES.has(manifest.mediaType) && !IMAGE_TYPES.has(manifest.mediaType))) {
      throw new Error(`Unsupported manifest format: ${digest}`);
    }
    const children = new Set();
    if (INDEX_TYPES.has(manifest.mediaType)) {
      if (!Array.isArray(manifest.manifests)) throw new Error(`Invalid image index: ${digest}`);
      for (const descriptor of manifest.manifests) {
        children.add(checkDigest(descriptor?.digest));
        indexed.add(descriptor.digest);
        pending.push({ digest: descriptor.digest, optional: !inventory.has(descriptor.digest) });
      }
    } else if (!manifest.config || !Array.isArray(manifest.layers)) {
      throw new Error(`Invalid image manifest: ${digest}`);
    } else {
      checkDigest(manifest.config.digest);
      for (const layer of manifest.layers) checkDigest(layer?.digest);
    }
    // Enumerating every package version discovers OCI referrers without relying
    // on registry support for the optional /referrers endpoint.
    const subject = manifest.subject?.digest || manifest.annotations?.['vnd.docker.reference.digest'];
    if (manifest.subject && !manifest.subject.digest) throw new Error(`Invalid subject: ${digest}`);
    if (subject) {
      children.add(checkDigest(subject));
      subjects.set(digest, subject);
      pending.push({ digest: subject, optional: !inventory.has(subject) });
    }
    dependencies.set(digest, children);
  }
  const reachableEdges = new Map([...dependencies].map(([digest, children]) => [digest, new Set(children)]));
  for (const [artifact, subject] of subjects) {
    if (!reachableEdges.has(subject)) reachableEdges.set(subject, new Set());
    reachableEdges.get(subject).add(artifact);
  }
  return { dependencies, reachableEdges, indexed, missing };
}

function reachable(roots, edges) {
  const visited = new Set();
  const pending = [...roots];
  while (pending.length) {
    const digest = pending.pop();
    if (visited.has(digest)) continue;
    visited.add(digest);
    pending.push(...(edges.get(digest) || []));
  }
  return visited;
}

module.exports = { createRegistry, loadGraph, reachable, checkDigest };
