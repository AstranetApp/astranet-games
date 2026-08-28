// Keeps version, official URL, and checksum configuration pinned in fast CI.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UPSTREAM } from '../scripts/upstream.mjs';
import { verifyManifest } from '../scripts/verify-upstream.mjs';

test('pinned upstream acquisition manifest is valid', () => {
  assert.equal(verifyManifest(), true);
  assert.equal(UPSTREAM.version, '1.4.6');
  assert.equal(UPSTREAM.archiveSha256, 'a6b742b6db2dd835f8cf199b4fa4e6a213eb09e68e50e89dd55a5254a39298af');
});
