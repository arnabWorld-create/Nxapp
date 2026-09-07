import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCommittedAt } from '../src/lib/import/commit-display';

test('formats a valid committed timestamp in the local date-time format', () => {
  const timestamp = '2026-09-04T11:21:13.170Z';

  assert.equal(formatCommittedAt(timestamp), new Date(timestamp).toLocaleString());
  assert.notEqual(formatCommittedAt(timestamp), 'Invalid Date');
});

test('does not render Invalid Date for missing or invalid timestamps', () => {
  assert.equal(formatCommittedAt(null), '—');
  assert.equal(formatCommittedAt(undefined), '—');
  assert.equal(formatCommittedAt('not-a-date'), '—');
});