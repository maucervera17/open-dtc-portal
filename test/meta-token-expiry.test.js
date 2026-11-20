import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenExpiry } from '../lib/dash/token.js';

test('explicit non-expiring token has no warning after the old expiry', () => {
  assert.deepEqual(tokenExpiry({ META_TOKEN_EXPIRES_AT: 'never' }, Date.parse('2027-01-01')), {
    token_expires_at: null, token_warning: false,
  });
});

test('dated tokens warn near expiry and unspecified tokens never warn', () => {
  assert.equal(tokenExpiry({}, Date.parse('2026-11-18')).token_warning, false);
  assert.equal(tokenExpiry({ META_TOKEN_EXPIRES_AT: '2027-02-01' }, Date.parse('2027-01-01')).token_warning, false);
  assert.equal(tokenExpiry({ META_TOKEN_EXPIRES_AT: '2027-02-01' }, Date.parse('2027-02-02')).token_warning, true);
});
