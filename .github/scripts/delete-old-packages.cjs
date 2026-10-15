'use strict';

const { createRegistry, loadGraph, reachable, checkDigest } = require('./package-manifests.cjs');

const FULL_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const MAX_DELETIONS = 100;

function tagsOf(version) {
  const tags = version.metadata?.container?.tags;
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) {
    throw new Error(`Missing or invalid container tags for version ${version.id}`);
  }
  return tags;
}

function validateVersions(versions) {
  const ids = new Set();
  const digests = new Set();
  for (const version of versions) {
    tagsOf(version);
    checkDigest(version.name);
    if (!Number.isSafeInteger(version.id) || ids.has(version.id) || digests.has(version.name)) {
      throw new Error('Invalid or duplicate package version');
    }
    ids.add(version.id);
    digests.add(version.name);
    for (const field of ['created_at', 'updated_at']) {
      if (!Number.isFinite(Date.parse(version[field]))) throw new Error(`Invalid ${field} for version ${version.id}`);
    }
  }
}

function snapshot(versions) {
  validateVersions(versions);
  return JSON.stringify(versions.map(version => [
    version.id, version.name, version.created_at, version.updated_at, [...tagsOf(version)].sort(),
  ]).sort((a, b) => a[0] - b[0]));
}

function validateOptions(keepVersions, minAgeHours) {
  if (!Number.isSafeInteger(keepVersions) || keepVersions < 1) {
    throw new Error('keep_versions must be an integer of at least 1');
  }
  if (!Number.isSafeInteger(minAgeHours) || minAgeHours < 24 || minAgeHours > 87600) {
    throw new Error('min_age_hours must be an integer between 24 and 87600');
  }
}

function planDeletion(versions, keepVersions, graph, { minAgeHours = 168, now = Date.now() } = {}) {
  validateOptions(keepVersions, minAgeHours);
  validateVersions(versions);
  if (!Number.isFinite(now)) throw new Error('Invalid current time');
  const cutoff = now - minAgeHours * 3600000;
  const recent = version => Math.max(Date.parse(version.created_at), Date.parse(version.updated_at)) > cutoff;
  const oldestFirst = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id;
  const tagged = versions.filter(version => tagsOf(version).length);
  const releases = tagged.filter(version => tagsOf(version).every(tag => FULL_VERSION.test(tag)))
    .sort((a, b) => -oldestFirst(a, b));
  const roots = versions.filter(version => tagsOf(version).length || recent(version));
  const live = reachable(roots.map(version => version.name), graph.reachableEdges);
  for (const digest of graph.missing) {
    if (live.has(digest) && graph.indexed.has(digest)) {
      const owners = roots.filter(root => reachable([root.name], graph.reachableEdges).has(digest))
        .map(root => tagsOf(root).join(', ') || `recent version ${root.id}`);
      throw new Error(`Protected image (${owners.join('; ')}) references a missing manifest: ${digest}`);
    }
  }

  // Do not delete a release digest used by another tagged image or recent upload.
  // Children of deleted releases become orphan candidates on a subsequent run.
  const oldReleases = releases.slice(keepVersions).filter(version => !recent(version) && !graph.indexed.has(version.name) &&
    !reachable(roots.filter(root => root.id !== version.id).map(root => root.name), graph.reachableEdges)
      .has(version.name)).sort(oldestFirst);
  const orphans = versions.filter(version => !tagsOf(version).length && !live.has(version.name));
  const candidates = oldReleases.slice(0, MAX_DELETIONS).map(version => ({ version, kind: 'release' }));

  // Delete referencing manifests before their dependencies, even across batches.
  // Cycles or references from otherwise retained entries are conservatively kept.
  const remaining = new Map(orphans.map(version => [version.name, version]));
  const incoming = new Map();
  for (const children of graph.dependencies.values()) {
    for (const child of children) incoming.set(child, (incoming.get(child) || 0) + 1);
  }
  while (candidates.length < MAX_DELETIONS) {
    const next = [...remaining.values()].filter(version => !incoming.get(version.name)).sort(oldestFirst)[0];
    if (!next) break;
    candidates.push({ version: next, kind: 'orphan' });
    remaining.delete(next.name);
    for (const child of graph.dependencies.get(next.name) || []) incoming.set(child, incoming.get(child) - 1);
  }
  return {
    candidates,
    retained: Math.min(keepVersions, releases.length),
    protected: versions.length - oldReleases.length - orphans.length,
    protectedUntagged: versions.filter(version => !tagsOf(version).length && live.has(version.name)).length,
    recent: versions.filter(recent).length,
    deferred: oldReleases.length + orphans.length - candidates.length,
  };
}

async function cleanupPackages({ github, context, core, env, registry, now = Date.now() }) {
  const packageName = (env.PACKAGE_NAME || '').trim();
  if (!/^[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*(\/[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*)*$/.test(packageName)) {
    throw new Error('package_name must be a lowercase container package name');
  }
  if (!['true', 'false'].includes(env.DRY_RUN)) throw new Error('dry_run must be true or false');
  const keepVersions = Number(env.KEEP_VERSIONS);
  const minAgeHours = Number(env.MIN_AGE_HOURS);
  validateOptions(keepVersions, minAgeHours);
  const dryRun = env.DRY_RUN === 'true';
  const scope = context.payload.repository.owner.type === 'Organization' ? 'orgs' : 'users';
  const route = `/${scope}/{owner}/packages/{package_type}/{package_name}/versions`;
  const params = { owner: context.repo.owner, package_type: 'container', package_name: packageName };
  const list = () => github.paginate(`GET ${route}`, { ...params, per_page: 100 });
  let expected = await list();
  const initialSnapshot = snapshot(expected);
  const reader = registry || createRegistry({
    owner: context.repo.owner, packageName, username: context.actor, token: env.GH_TOKEN,
    mask: value => core.setSecret(value),
  });
  const graph = await loadGraph(expected, reader);
  const plan = planDeletion(expected, keepVersions, graph, { minAgeHours, now });
  if (snapshot(await list()) !== initialSnapshot) throw new Error('Package changed during manifest inspection; retry later');
  const rows = [['Version ID', 'Tags', 'Kind', 'Result']];
  let deleted = 0;

  try {
    for (const { version, kind } of plan.candidates) {
      let result = 'Would delete';
      if (!dryRun) {
        // Recheck the entire inventory: a newly tagged parent could reference an
        // otherwise unchanged orphan. The shared workflow lock excludes CI pushes.
        if (snapshot(await list()) !== snapshot(expected)) throw new Error('Package changed during cleanup; retry later');
        const versionParams = { ...params, package_version_id: version.id };
        const { data: current } = await github.request(`GET ${route}/{package_version_id}`, versionParams);
        if (snapshot([current]) !== snapshot([version])) throw new Error(`Package version ${version.id} changed; retry later`);
        await github.request(`DELETE ${route}/{package_version_id}`, versionParams);
        expected = expected.filter(item => item.id !== version.id);
        deleted += 1;
        result = 'Deleted';
      }
      core.info(`${result} ${kind}: ${version.id} (${tagsOf(version).join(', ') || version.name})`);
      rows.push([String(version.id), tagsOf(version).join(', '), kind, result]);
    }
  } catch (error) {
    rows.push(['', '', '', 'Stopped on error; see logs. Remaining candidates were not deleted.']);
    throw error;
  } finally {
    await core.summary
      .addHeading(`Package cleanup: ${packageName}`)
      .addRaw(`${dryRun ? 'Preview' : 'Deletion'}: ${plan.candidates.length} candidates, ${deleted} deleted.\n\n`)
      .addRaw(`${plan.retained} newest release-only versions retained; ${plan.protected} versions protected (including ${plan.protectedUntagged} untagged). ${plan.recent} versions are within the ${minAgeHours}-hour grace period. ${plan.deferred} candidates deferred by the limit or remaining references.\n\n`)
      .addTable(rows)
      .write();
  }
  return { ...plan, deleted };
}

module.exports = { planDeletion, cleanupPackages };
