'use strict';

const FULL_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const MAX_DELETIONS = 100;

function tagsOf(version) {
  const tags = version.metadata?.container?.tags;
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) {
    throw new Error(`Missing or invalid container tags for version ${version.id}`);
  }
  return tags;
}

function planDeletion(versions, keepVersions) {
  if (!Number.isSafeInteger(keepVersions) || keepVersions < 1) {
    throw new Error('keep_versions must be an integer of at least 1');
  }
  // Untagged versions can be architecture manifests or attestations of live
  // images. Alias-tagged versions are also outside this release-only policy.
  const releases = versions.filter(version => {
    const tags = tagsOf(version);
    return tags.length > 0 && tags.every(tag => FULL_VERSION.test(tag));
  });
  for (const version of releases) {
    if (!Number.isFinite(Date.parse(version.created_at))) {
      throw new Error(`Invalid creation date for version ${version.id}`);
    }
  }
  releases.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  const obsolete = releases.slice(keepVersions).reverse();
  return {
    candidates: obsolete.slice(0, MAX_DELETIONS),
    retained: Math.min(keepVersions, releases.length),
    protected: versions.length - releases.length,
    deferred: Math.max(0, obsolete.length - MAX_DELETIONS),
  };
}

function unchanged(original, current) {
  return original.name === current.name &&
    original.updated_at === current.updated_at &&
    JSON.stringify([...tagsOf(original)].sort()) === JSON.stringify([...tagsOf(current)].sort());
}

async function cleanupPackages({ github, context, core, env }) {
  const packageName = (env.PACKAGE_NAME || '').trim();
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(packageName)) {
    throw new Error('package_name must be a lowercase container package name');
  }
  if (!['true', 'false'].includes(env.DRY_RUN)) {
    throw new Error('dry_run must be true or false');
  }
  const keepVersions = Number(env.KEEP_VERSIONS);
  // Validate inputs before calling GitHub.
  planDeletion([], keepVersions);
  const dryRun = env.DRY_RUN === 'true';
  const scope = context.payload.repository.owner.type === 'Organization' ? 'orgs' : 'users';
  const route = `/${scope}/{owner}/packages/{package_type}/{package_name}/versions`;
  const params = { owner: context.repo.owner, package_type: 'container', package_name: packageName };
  const versions = await github.paginate(`GET ${route}`, { ...params, per_page: 100 });
  const plan = planDeletion(versions, keepVersions);
  const rows = [['Version ID', 'Tags', 'Result']];
  let deleted = 0;

  for (const version of plan.candidates) {
    let result = 'Would delete';
    if (!dryRun) {
      const versionParams = { ...params, package_version_id: version.id };
      const { data: current } = await github.request(`GET ${route}/{package_version_id}`, versionParams);
      // Do not delete a digest that was retagged after the plan was created.
      if (!unchanged(version, current)) {
        result = 'Skipped: version changed';
        core.warning(`Skipping changed package version ${version.id}`);
      } else {
        await github.request(`DELETE ${route}/{package_version_id}`, versionParams);
        deleted += 1;
        result = 'Deleted';
      }
    }
    core.info(`${result}: ${version.id} (${tagsOf(version).join(', ')})`);
    rows.push([String(version.id), tagsOf(version).join(', '), result]);
  }

  await core.summary
    .addHeading(`Package cleanup: ${packageName}`)
    .addRaw(`${dryRun ? 'Preview' : 'Deletion'}: ${plan.candidates.length} candidates, ${deleted} deleted.\n\n`)
    .addRaw(`${plan.retained} newest release-only versions retained; ${plan.protected} untagged or alias-tagged versions protected; ${plan.deferred} older versions deferred to another run.\n\n`)
    .addTable(rows)
    .write();
  return { ...plan, deleted };
}

module.exports = { planDeletion, cleanupPackages };
