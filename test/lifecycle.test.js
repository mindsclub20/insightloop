import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, assertTransition, IllegalTransitionError, TRANSITIONS } from '../src/lib/lifecycle.js';

test('LIFECYCLE: allows every transition in the legal graph', () => {
  for (const [from, tos] of Object.entries(TRANSITIONS)) {
    for (const to of tos) {
      assert.equal(canTransition(from, to), true, `${from} -> ${to} should be legal`);
      assert.doesNotThrow(() => assertTransition(from, to));
    }
  }
});

test('LIFECYCLE: rejects skipping a required step (SUBMITTED -> ACTIVE directly)', () => {
  assert.equal(canTransition('SUBMITTED', 'ACTIVE'), false);
  assert.throws(() => assertTransition('SUBMITTED', 'ACTIVE'), IllegalTransitionError);
});

test('LIFECYCLE: rejects a business self-activating without going through APPROVED', () => {
  assert.equal(canTransition('DRAFT', 'ACTIVE'), false);
});

test('LIFECYCLE: rejects moving out of a terminal state', () => {
  for (const terminal of ['ARCHIVED', 'REJECTED', 'CANCELLED']) {
    assert.deepEqual(TRANSITIONS[terminal], [], `${terminal} should have no outgoing transitions`);
    assert.equal(canTransition(terminal, 'ACTIVE'), false);
  }
});

test('LIFECYCLE: rejects reverse transitions (ACTIVE -> APPROVED)', () => {
  assert.equal(canTransition('ACTIVE', 'APPROVED'), false);
});

test('LIFECYCLE: PAUSED can only go to ACTIVE or CANCELLED', () => {
  assert.deepEqual(TRANSITIONS.PAUSED.sort(), ['ACTIVE', 'CANCELLED'].sort());
});

test('LIFECYCLE: REPORT_READY only reachable from COMPLETED, only exits to ARCHIVED', () => {
  const reachesReportReady = Object.entries(TRANSITIONS).filter(([, tos]) => tos.includes('REPORT_READY'));
  assert.deepEqual(reachesReportReady.map(([from]) => from), ['COMPLETED']);
  assert.deepEqual(TRANSITIONS.REPORT_READY, ['ARCHIVED']);
});

test('LIFECYCLE: error carries the attempted from/to and a 400 status', () => {
  try {
    assertTransition('COMPLETED', 'DRAFT');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof IllegalTransitionError);
    assert.equal(e.status, 400);
    assert.equal(e.from, 'COMPLETED');
    assert.equal(e.to, 'DRAFT');
  }
});
