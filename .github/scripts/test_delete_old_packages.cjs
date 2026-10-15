'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { planDeletion, cleanupPackages } = require('./delete-old-packages.cjs');
const { createRegistry, loadGraph } = require('./package-manifests.cjs');

const NOW = Date.parse('2026-10-15T12:00:00Z');
const IMAGE = 'application/vnd.oci.image.manifest.v1+json';
const INDEX = 'application/vnd.oci.image.index.v1+json';
const digest = id => `sha256:${id.toString(16).padStart(64, '0')}`;
const image = extra => ({ schemaVersion: 2, mediaType: IMAGE, config: { digest: digest(9999) }, layers: [], ...extra });
const index = ids => ({ schemaVersion: 2, mediaType: INDEX, manifests: ids.map(id => ({ digest: digest(id) })) });
function version(id, tags = [`1.0.${id}`], extra = {}) {
  return {
    id, name: digest(id), created_at: new Date(id * 1000).toISOString(),
    updated_at: new Date(id * 1000).toISOString(), metadata: { container: { tags } }, ...extra,
  };
}
function registryFor(manifests = {}) {
  return { async manifest(name) { return manifests[name] || image(); } };
}
async function plan(versions, manifests = {}, keep = 2, options = {}) {
  const graph = await loadGraph(versions, registryFor(manifests));
  return planDeletion(versions, keep, graph, { now: NOW, ...options });
}
const selected = result => result.candidates.map(item => item.version.id);

function harness(versions, options = {}) {
  const calls = [];
  const rows = [];
  let inventory = structuredClone(versions);
  let lists = 0;
  let summaries = 0;
  const summary = {
    addHeading() { return this; }, addRaw() { return this; },
    addTable(table) { rows.push(...table); return this; }, async write() { summaries++; },
  };
  return {
    calls, rows, summaries: () => summaries,
    args: {
      github: {
        async paginate(route, params) {
          calls.push({ route, params });
          lists++;
          if (options.onList) inventory = options.onList(lists, inventory);
          return structuredClone(inventory);
        },
        async request(route, params) {
          calls.push({ route, params });
          const current = inventory.find(item => item.id === params.package_version_id);
          if (route.startsWith('DELETE')) {
            if (options.failDelete) throw new Error('Forbidden');
            inventory = inventory.filter(item => item.id !== params.package_version_id);
          }
          return { data: options.current ? options.current(current) : structuredClone(current) };
        },
      },
      registry: options.registry || registryFor(options.manifests),
      context: { actor: 'owner', repo: { owner: 'owner' }, payload: { repository: { owner: { type: options.ownerType || 'User' } } } },
      core: { info() {}, summary }, now: NOW,
      env: { PACKAGE_NAME: 'sogo', KEEP_VERSIONS: '2', DRY_RUN: 'true', MIN_AGE_HOURS: '168', ...options.env },
    },
  };
}

test('retains two newest releases and does not mutate the inventory', async () => {
  const versions = [version(3), version(1), version(2)];
  const original = structuredClone(versions);
  assert.deepEqual(selected(await plan(versions)), [1]);
  assert.deepEqual(versions, original);
});

test('protects aliases and treats multiple tags on a digest as one release', async () => {
  const versions = [version(1, ['1.0.1', 'latest']), version(2, ['main']), version(3, ['1.0']),
    version(4, ['1']), version(5, ['1.0.5-rc.1']), version(6, ['1.0.6', '1.0.7']), version(8)];
  assert.deepEqual(selected(await plan(versions)), [5]);
});

test('keeps platform manifests, nested indexes and attestations reachable from tags', async () => {
  const versions = [version(1, ['latest']), ...[2, 3, 4, 5, 6].map(id => version(id, []))];
  const result = await plan(versions, { [digest(1)]: index([2, 4]), [digest(2)]: index([3]),
    [digest(5)]: image({ subject: { digest: digest(3) } }) });
  assert.deepEqual(selected(result), [6]);
  assert.equal(result.protectedUntagged, 4);
});

test('protects subjects of tagged artifacts and legacy attestation references', async () => {
  assert.deepEqual(selected(await plan([version(1, ['signature']), version(2, []), version(3, [])], {
    [digest(1)]: image({ subject: { digest: digest(2) } }),
    [digest(3)]: image({ annotations: { 'vnd.docker.reference.digest': digest(2) } }),
  })), []);
});

test('resolves children absent from the package inventory instead of assuming they are unused', async () => {
  assert.deepEqual(selected(await plan([version(1, ['latest']), version(3, [])], {
    [digest(1)]: index([2]), [digest(2)]: index([3]),
  })), []);
});

test('protects recent uploads and their old dependencies, using both timestamps', async () => {
  for (const field of ['created_at', 'updated_at']) {
    const versions = [version(1, [], { [field]: new Date(NOW - 3600000).toISOString() }), version(2, []), version(3, [])];
    assert.deepEqual(selected(await plan(versions, { [digest(1)]: index([2]) })), [3]);
  }
});

test('honors grace-period boundary and protects recent release tags', async () => {
  const updated_at = new Date(NOW - 168 * 3600000).toISOString();
  assert.deepEqual(selected(await plan([version(1, [], { updated_at })])), [1]);
  assert.deepEqual(selected(await plan([version(1, ['1.0.1'], { updated_at: new Date(NOW).toISOString() }), version(2), version(3)])), []);
});

test('protects old release digests referenced by another image', async () => {
  assert.deepEqual(selected(await plan([version(1), version(2), version(3)], { [digest(3)]: index([1]) })), []);
});

test('does not delete a tagged release before its orphaned parent index', async () => {
  assert.deepEqual(selected(await plan([version(1), version(2), version(3), version(4, [])], {
    [digest(4)]: index([1]),
  })), [4]);
});

test('children of obsolete releases are collected on a later run', async () => {
  const manifests = { [digest(1)]: index([4]) };
  assert.deepEqual(selected(await plan([version(1), version(2), version(3), version(4, [])], manifests)), [1]);
  assert.deepEqual(selected(await plan([version(2), version(3), version(4, [])], manifests)), [4]);
});

test('deletes orphaned parents before children and referrers before subjects', async () => {
  assert.deepEqual(selected(await plan([1, 2, 3, 4].map(id => version(id, [])), {
    [digest(4)]: index([3]), [digest(3)]: index([1]), [digest(2)]: image({ subject: { digest: digest(1) } }),
  })), [2, 4, 3, 1]);
});

test('can delete an orphaned artifact whose subject was already removed', async () => {
  const fixture = harness([version(1, [])], { registry: { async manifest(name) {
    if (name === digest(2)) throw Object.assign(new Error('Not found'), { status: 404 });
    return image({ subject: { digest: digest(2) } });
  } } });
  assert.deepEqual(selected(await cleanupPackages(fixture.args)), [1]);
});

test('resolves absent-inventory subjects before deciding whether their children are orphaned', async () => {
  assert.deepEqual(selected(await plan([version(1, ['attestation']), version(3, [])], {
    [digest(1)]: image({ subject: { digest: digest(2) } }), [digest(2)]: index([3]),
  })), []);
});

test('missing inventory manifests or protected index children abort', async () => {
  for (const versions of [[version(1), version(2, [])], [version(1)]]) {
    const fixture = harness(versions, { registry: { async manifest(name) {
      if (name === digest(2)) throw Object.assign(new Error('Not found'), { status: 404 });
      return index([2]);
    } } });
    await assert.rejects(cleanupPackages(fixture.args), /Not found|missing manifest/);
  }
  const fixture = harness([version(1, [])], { registry: { async manifest(name) {
    if (name === digest(2)) throw Object.assign(new Error('Forbidden'), { status: 403 });
    return image({ subject: { digest: digest(2) } });
  } } });
  await assert.rejects(cleanupPackages(fixture.args), /Forbidden/);
});

test('orphan indexes with already deleted children can be removed', async () => {
  const fixture = harness([version(1, []), version(3, [])], { registry: { async manifest(name) {
    if (name === digest(2)) throw Object.assign(new Error('Not found'), { status: 404 });
    return name === digest(1) ? index([2, 3]) : image();
  } } });
  assert.deepEqual(selected(await cleanupPackages(fixture.args)), [1, 3]);
});

test('retains cyclic orphan references instead of making an unsafe deletion order', async () => {
  const result = await plan([version(1, []), version(2, [])], { [digest(1)]: index([2]), [digest(2)]: index([1]) });
  assert.deepEqual(selected(result), []);
  assert.equal(result.deferred, 2);
});

test('caps combined deletions at 100 and keeps the remaining dependency graph valid', async () => {
  const versions = Array.from({ length: 105 }, (_, i) => version(i + 1, []));
  const manifests = Object.fromEntries(versions.slice(1).map(v => [v.name, index([v.id - 1])]));
  const result = await plan(versions, manifests);
  assert.equal(result.candidates.length, 100);
  assert.equal(result.deferred, 5);
  assert.deepEqual(selected(result), Array.from({ length: 100 }, (_, i) => 105 - i));
  assert.deepEqual(selected(await plan(versions.slice(0, 5), manifests)), [5, 4, 3, 2, 1]);
});

test('shares the deletion budget between old releases and orphans', async () => {
  const releases = Array.from({ length: 101 }, (_, i) => version(i + 1));
  const result = await plan([...releases, version(102, []), version(103, [])]);
  assert.equal(result.candidates.filter(item => item.kind === 'release').length, 99);
  assert.equal(result.candidates.filter(item => item.kind === 'orphan').length, 1);
  assert.equal(result.deferred, 1);
});

test('empty packages and retained-only packages have no candidates', async () => {
  for (const versions of [[], [version(1)], [version(1), version(2)]]) assert.deepEqual(selected(await plan(versions)), []);
});

test('preview inspects manifests and inventory but never mutates packages', async () => {
  const fixture = harness([version(1), version(2), version(3), version(4, [])]);
  const result = await cleanupPackages(fixture.args);
  assert.equal(result.deleted, 0);
  assert.equal(fixture.calls.length, 2);
  assert.ok(fixture.calls.every(call => call.route.startsWith('GET') && call.params.per_page === 100));
  assert.deepEqual(fixture.rows.slice(1).map(row => row.slice(2)), [['release', 'Would delete'], ['orphan', 'Would delete']]);
});

test('real deletion paginates inventories, rechecks candidates, and supports user and organization routes', async () => {
  for (const [ownerType, scope] of [['User', 'users'], ['Organization', 'orgs']]) {
    const fixture = harness([version(1), version(2), version(3), version(4, [])], { ownerType, env: { DRY_RUN: 'false' } });
    const result = await cleanupPackages(fixture.args);
    assert.equal(result.deleted, 2);
    assert.ok(fixture.calls.every(call => call.route.includes(`/${scope}/{owner}/`)));
    const deletes = fixture.calls.filter(call => call.route.startsWith('DELETE'));
    assert.deepEqual(deletes.map(call => call.params.package_version_id), [1, 4]);
    assert.ok(deletes.every(call => call.params.per_page === undefined));
    assert.equal(fixture.calls.filter(call => call.params.per_page === 100).length, 4);
  }
});

test('inventory changes during inspection or before deletion abort without mutations', async () => {
  for (const changedAt of [2, 3]) {
    const fixture = harness([version(1, [])], { env: { DRY_RUN: 'false' },
      onList: (count, inventory) => count === changedAt ? [...inventory, version(2, ['new'])] : inventory });
    await assert.rejects(cleanupPackages(fixture.args), /Package changed/);
    assert.ok(fixture.calls.every(call => !call.route.startsWith('DELETE')));
  }
});

test('retagging an otherwise unchanged orphan aborts deletion', async () => {
  const fixture = harness([version(1, [])], { env: { DRY_RUN: 'false' }, current: v => version(v.id, ['latest']) });
  await assert.rejects(cleanupPackages(fixture.args), /changed/);
  assert.ok(fixture.calls.every(call => !call.route.startsWith('DELETE')));
});

test('a change after the first deletion stops subsequent deletions and writes a partial summary', async () => {
  const fixture = harness([version(1, []), version(2, [])], { env: { DRY_RUN: 'false' },
    onList: (count, inventory) => count === 4 ? [...inventory, version(3, ['new'])] : inventory });
  await assert.rejects(cleanupPackages(fixture.args), /Package changed/);
  assert.equal(fixture.calls.filter(call => call.route.startsWith('DELETE')).length, 1);
  assert.equal(fixture.summaries(), 1);
  assert.match(fixture.rows.at(-1)[3], /Stopped on error/);
});

test('invalid options fail before accessing GitHub', async () => {
  for (const env of [{ KEEP_VERSIONS: '0' }, { KEEP_VERSIONS: '1.5' }, { MIN_AGE_HOURS: '0' },
    { MIN_AGE_HOURS: '23' }, { MIN_AGE_HOURS: '87601' }, { MIN_AGE_HOURS: 'NaN' },
    { MIN_AGE_HOURS: '1.5' }, { DRY_RUN: '' }, { PACKAGE_NAME: '../sogo' }, { PACKAGE_NAME: '' }]) {
    const fixture = harness([], { env });
    await assert.rejects(cleanupPackages(fixture.args));
    assert.deepEqual(fixture.calls, []);
  }
});

test('malformed metadata, duplicate listings and unsupported manifests fail closed', async () => {
  for (const versions of [[{ id: 1 }], [version(1), version(1)], [version(1, [], { updated_at: 'bad' })]]) {
    const fixture = harness(versions, { env: { DRY_RUN: 'false' } });
    await assert.rejects(cleanupPackages(fixture.args));
    assert.ok(fixture.calls.every(call => !call.route.startsWith('DELETE')));
  }
  for (const manifest of [{ schemaVersion: 1 }, { schemaVersion: 2, mediaType: INDEX },
    { schemaVersion: 2, mediaType: IMAGE }, image({ subject: {} }), index(['invalid'])]) {
    const fixture = harness([version(1, [])], { env: { DRY_RUN: 'false' }, manifests: { [digest(1)]: manifest } });
    await assert.rejects(cleanupPackages(fixture.args));
    assert.ok(fixture.calls.every(call => !call.route.startsWith('DELETE')));
  }
});

test('registry inspection failures stop before any deletion', async () => {
  const fixture = harness([version(1, [])], { env: { DRY_RUN: 'false' },
    registry: { async manifest() { throw new Error('HTTP 404'); } } });
  await assert.rejects(cleanupPackages(fixture.args), /404/);
  assert.ok(fixture.calls.every(call => !call.route.startsWith('DELETE')));
});

test('a deletion API failure stops the run and preserves the failure', async () => {
  const fixture = harness([version(1, []), version(2, [])], { failDelete: true, env: { DRY_RUN: 'false' } });
  await assert.rejects(cleanupPackages(fixture.args), /Forbidden/);
  assert.equal(fixture.calls.filter(call => call.route.startsWith('DELETE')).length, 1);
  assert.equal(fixture.summaries(), 1);
});

test('GHCR reader authenticates for pull only, verifies digests, and refuses redirects', async () => {
  const body = JSON.stringify(image());
  const name = 'sha256:' + createHash('sha256').update(body).digest('hex');
  const calls = [];
  const masked = [];
  const reader = createRegistry({ owner: 'Owner', packageName: 'nested/sogo', username: 'actor', token: 'test-secret',
    mask: value => masked.push(value), fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1 ? new Response(JSON.stringify({ token: 'pull-token' })) : new Response(body);
    } });
  assert.deepEqual(await reader.manifest(name), image());
  await reader.manifest(name);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[0].url).searchParams.get('scope'), 'repository:owner/nested/sogo:pull');
  assert.ok(calls[1].url.startsWith('https://ghcr.io/v2/owner/nested/sogo/manifests/sha256:'));
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  assert.equal(calls[1].options.headers.Authorization, 'Bearer pull-token');
  assert.ok(masked.includes('pull-token'));
});

test('GHCR reader fails on HTTP errors and content substitution without leaking bodies', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const reader = createRegistry({ owner: 'owner', packageName: 'sogo', username: 'actor', token: 'secret',
      fetchImpl: async () => new Response('sensitive body', { status }) });
    await assert.rejects(reader.manifest(digest(1)), error => error.message.includes(String(status)) && !error.message.includes('sensitive'));
  }
  let call = 0;
  const reader = createRegistry({ owner: 'owner', packageName: 'sogo', username: 'actor', token: 'secret',
    fetchImpl: async () => ++call === 1 ? new Response(JSON.stringify({ token: 'pull-token' })) : new Response(JSON.stringify(image())) });
  await assert.rejects(reader.manifest(digest(1)), /digest mismatch/);
});
