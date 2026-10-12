import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildState, orderFiles, shouldFail } from './gate.mjs';

test('diff first, skips lockfiles and binaries, omits what does not fit', () => {
  const files = { 'a.js': 'aaa', 'package-lock.json': 'x', 'img.png': null, 'big.js': 'b'.repeat(500) };
  const state = buildState('DIFF', Object.keys(files), (f) => files[f], 200);
  assert.ok(state.startsWith('## Pull request diff\nDIFF'));
  assert.match(state, /### a\.js\naaa/);
  assert.doesNotMatch(state, /package-lock|img\.png|### big\.js/);
  assert.match(state, /\[1 files omitted for size\]/);
});

test('oversized diff is truncated to budget', () => {
  const state = buildState('d'.repeat(1000), [], () => '', 100);
  assert.ok(state.length <= 100 + '\n[diff truncated]\n'.length);
});

test('changed files first, docs and tests last', () => {
  const all = ['README.md', 'app/page.tsx', 'docs/plan.md', 'lib/db.ts', 'lib/db.test.ts', 'tests/x.ts'];
  assert.deepEqual(orderFiles(['tests/x.ts'], all), ['tests/x.ts', 'app/page.tsx', 'lib/db.ts', 'README.md', 'docs/plan.md', 'lib/db.test.ts']);
});

test('repo rules go before the diff', () => {
  const state = buildState('DIFF', [], () => '', 1000, 'prisma/ is risky');
  assert.ok(state.startsWith('## Review rules for this repository\nprisma/ is risky'));
  assert.ok(state.indexOf('prisma/ is risky') < state.indexOf('DIFF'));
  assert.doesNotMatch(buildState('DIFF', [], () => '', 1000, null), /Review rules/);
});

test('fail-on thresholds', () => {
  assert.equal(shouldFail('unsure', 'needs_review'), false);
  assert.equal(shouldFail('risky', 'risky'), true);
  assert.equal(shouldFail('needs_review', 'risky'), false);
  assert.equal(shouldFail('needs_review', 'needs_review'), true);
  assert.equal(shouldFail('risky', 'never'), false);
  assert.throws(() => shouldFail('ship', 'yolo'));
});
