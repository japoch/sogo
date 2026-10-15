'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { planDeletion, cleanupPackages } = require('./delete-old-packages.cjs');

function version(id, tags = [`1.0.${id}`]) {
  return {
    id,
    name: `sha256:${id}`,
    created_at: new Date(id * 1000).toISOString(),
    updated_at: new Date(id * 1000).toISOString(),
    metadata: { container: { tags } },
  };
}

function harness(versions, options = {}) {
  const calls = [];
  const rows = [];
  const summary = {
    addHeading() { return this; },
    addRaw() { return this; },
    addTable(table) { rows.push(...table); return this; },
    async write() {},
  };
  return {
    calls,
    rows,
    args: {
      github: {
        async paginate(route, params) {
          calls.push({ route, params });
          return versions;
        },
        async request(route, params) {
          calls.push({ route, params });
          if (options.failDelete && route.startsWith('DELETE')) throw new Error('Forbidden');
          const current = versions.find(item => item.id === params.package_version_id);
          return { data: options.current ? options.current(current) : current };
        },
      },
      context: { repo: { owner: 'owner' }, payload: { repository: { owner: { type: options.ownerType || 'User' } } } },
      core: { info() {}, warning() {}, summary },
      env: { PACKAGE_NAME: 'sogo', KEEP_VERSIONS: '2', DRY_RUN: 'true', ...options.env },
    },
  };
}

test('retains two newest releases while protecting untagged architecture and attestation entries', () => {
  const versions = [version(4, []), version(1), version(5, []), version(3), version(2)];
  const original = structuredClone(versions);
  const plan = planDeletion(versions, 2);
  assert.deepEqual(plan.candidates.map(item => item.id), [1]);
  assert.equal(plan.retained, 2);
  assert.equal(plan.protected, 2);
  assert.deepEqual(versions, original);
});

test('protects aliases even when a full-version tag shares the same digest', () => {
  const plan = planDeletion([
    version(1, ['1.0.1', 'latest']), version(2, ['main']), version(3, ['1.0']),
    version(4, ['1']), version(5, ['1.0.5-rc.1']), version(6), version(7),
  ], 2);
  assert.equal(plan.protected, 4);
  assert.deepEqual(plan.candidates.map(item => item.id), [5]);
});

test('multiple version tags on one digest count as one image version', () => {
  assert.deepEqual(planDeletion([
    version(1), version(2, ['1.0.2', '1.0.3']), version(4),
  ], 2).candidates.map(item => item.id), [1]);
});

test('no deletions for empty packages or fewer releases than the retention count', () => {
  for (const versions of [[], [version(1)], [version(1), version(2)], [version(1, [])]]) {
    assert.deepEqual(planDeletion(versions, 2).candidates, []);
  }
});

test('deletes oldest first, caps each run at 100, and reports the remainder', () => {
  const plan = planDeletion(Array.from({ length: 105 }, (_, index) => version(index + 1)), 2);
  assert.deepEqual(plan.candidates.map(item => item.id), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(plan.deferred, 3);
  assert.equal(plan.retained, 2);
});

test('retention count must be a positive integer', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, '2']) {
    assert.throws(() => planDeletion([], value), /keep_versions/);
  }
});

test('malformed API metadata fails before any deletion', () => {
  assert.throws(() => planDeletion([{ id: 1 }], 2), /container tags/);
  assert.throws(() => planDeletion([{ ...version(1), created_at: 'invalid' }], 2), /creation date/);
});

test('preview lists candidates without calling a mutation endpoint', async () => {
  const fixture = harness([version(1), version(2), version(3)]);
  const result = await cleanupPackages(fixture.args);
  assert.equal(result.deleted, 0);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].params.per_page, 100);
  assert.deepEqual(fixture.rows[1], ['1', '1.0.1', 'Would delete']);
});

test('real deletions use the correct user and organization routes and recheck each candidate', async () => {
  for (const [ownerType, scope] of [['User', 'users'], ['Organization', 'orgs']]) {
    const fixture = harness([version(3), version(1), version(2)], { ownerType, env: { DRY_RUN: 'false' } });
    const result = await cleanupPackages(fixture.args);
    assert.equal(result.deleted, 1);
    assert.deepEqual(fixture.calls.map(call => call.route.split(' ')[0]), ['GET', 'GET', 'DELETE']);
    assert.ok(fixture.calls.every(call => call.route.includes(`/${scope}/{owner}/`)));
    assert.equal(fixture.calls[2].params.package_version_id, 1);
    assert.equal(fixture.calls[2].params.per_page, undefined);
  }
});

test('skips candidates retagged or updated while cleanup is running', async () => {
  for (const current of [
    item => version(item.id, ['latest']),
    item => ({ ...item, updated_at: '2026-10-15T12:00:00Z' }),
  ]) {
    const fixture = harness([version(1), version(2), version(3)], { current, env: { DRY_RUN: 'false' } });
    const result = await cleanupPackages(fixture.args);
    assert.equal(result.deleted, 0);
    assert.ok(fixture.calls.every(call => !call.route.startsWith('DELETE')));
    assert.equal(fixture.rows[1][2], 'Skipped: version changed');
  }
});

test('rejects invalid inputs before accessing GitHub', async () => {
  for (const env of [{ KEEP_VERSIONS: '0' }, { DRY_RUN: '' }, { PACKAGE_NAME: '' }]) {
    const fixture = harness([], { env });
    await assert.rejects(cleanupPackages(fixture.args));
    assert.deepEqual(fixture.calls, []);
  }
});

test('an API deletion failure stops the cleanup rather than reporting success', async () => {
  const fixture = harness([version(1), version(2), version(3), version(4)], {
    failDelete: true, env: { DRY_RUN: 'false' },
  });
  await assert.rejects(cleanupPackages(fixture.args), /Forbidden/);
  assert.equal(fixture.calls.filter(call => call.route.startsWith('DELETE')).length, 1);
});
