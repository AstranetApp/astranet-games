// Authentication contract tests: strict bearer formats and irreversible IDs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlayerHeader } from '../server/auth.js';

const SALT = 'test-salt';

test('accepts exact Astranet and guest formats without exposing bearer values', () => {
  const astra = parsePlayerHeader('astra devAstranetToken123456', SALT);
  const guest = parsePlayerHeader('guest 123e4567-e89b-42d3-a456-426614174000', SALT);
  assert.equal(astra.kind, 'astra');
  assert.match(astra.id, /^[a-f0-9]{64}$/);
  assert.equal(guest.kind, 'guest');
  assert.notEqual(astra.id, guest.id);
  assert.equal(JSON.stringify(astra).includes('devAstranetToken123456'), false);
});

test('rejects malformed player headers', () => {
  const invalid = [
    undefined,
    '',
    'astra short',
    'astra devAstranetToken123456 extra',
    'guest not-a-uuid',
    'admin 123e4567-e89b-42d3-a456-426614174000',
  ];
  for (const value of invalid) assert.equal(parsePlayerHeader(value, SALT), null);
});
