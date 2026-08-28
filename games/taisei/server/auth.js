// Parses Astranet/guest bearer identifiers and maps them to salted opaque IDs.
// Raw bearer values never leave this module and are never written to SQLite.

import { createHash, randomBytes } from 'node:crypto';

const ASTRA_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const GUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getOrCreateSalt(db) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('identity_salt');
  if (row) return row.value;
  const salt = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('identity_salt', salt);
  return salt;
}

export function parsePlayerHeader(header, salt) {
  if (typeof header !== 'string' || header.length > 80) return null;
  const separator = header.indexOf(' ');
  if (separator < 1 || header.indexOf(' ', separator + 1) !== -1) return null;
  const kind = header.slice(0, separator);
  const bearer = header.slice(separator + 1);
  if (kind === 'astra' ? !ASTRA_TOKEN.test(bearer) : kind === 'guest' ? !GUEST_UUID.test(bearer) : true) {
    return null;
  }
  const id = createHash('sha256').update(`${salt}|${kind}:${bearer}`).digest('hex');
  return { id, kind };
}

export function touchPlayer(db, player) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO players (id, kind, created_at, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen
  `).run(player.id, player.kind, now, now);
}
