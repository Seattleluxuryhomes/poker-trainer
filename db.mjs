/* SQLite storage for accounts — node:sqlite (Node ≥22.5), zero npm dependencies,
 * following the founder's BidVoice precedent. The schema is the maybe.love user
 * model (backend/server.py signup doc, L1860-1881) with the storage layer
 * translated per doctrine: same fields, same defaults, dating-specific fields
 * dropped, poker stats added. DB_PATH defaults under ./data (a Railway volume
 * mounts at /data in production).
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/poker.db";

let db = null;

export function openDb(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      age INTEGER NOT NULL,
      age_confirmed INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL DEFAULT 'user',
      avatar TEXT NOT NULL DEFAULT '🂠',
      leaderboard_ok INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      suspended INTEGER NOT NULL DEFAULT 0,
      password_changed_at TEXT,
      profile_updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS stats (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      bankroll INTEGER NOT NULL DEFAULT 200,
      table_stack INTEGER NOT NULL DEFAULT 5000,
      table_hands INTEGER NOT NULL DEFAULT 0,
      table_wins INTEGER NOT NULL DEFAULT 0,
      biggest_pot INTEGER NOT NULL DEFAULT 0,
      trainer_hands INTEGER NOT NULL DEFAULT 0,
      trainer_optimal INTEGER NOT NULL DEFAULT 0,
      trainer_ev_lost REAL NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS trainer_history (
      user_id TEXT NOT NULL REFERENCES users(id),
      day TEXT NOT NULL,
      hands INTEGER NOT NULL DEFAULT 0,
      optimal INTEGER NOT NULL DEFAULT 0,
      ev_lost REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      name TEXT NOT NULL,
      payload TEXT,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      charity_name TEXT NOT NULL,
      charity_url TEXT,
      winner_name TEXT NOT NULL,
      total_pledged INTEGER NOT NULL DEFAULT 0,
      players TEXT
    );
    CREATE TABLE IF NOT EXISTS signup_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS signin_attempts (ip TEXT NOT NULL, email TEXT, success INTEGER NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_signup_ip ON signup_attempts (ip, at);
    CREATE INDEX IF NOT EXISTS idx_signin_ip ON signin_attempts (ip, at);
    CREATE INDEX IF NOT EXISTS idx_signin_email ON signin_attempts (email, at);
    CREATE INDEX IF NOT EXISTS idx_users_lb ON users (leaderboard_ok, deleted);
  `);
  // additive migration: charity-night tally on stats
  try { db.exec("ALTER TABLE stats ADD COLUMN raised INTEGER NOT NULL DEFAULT 0"); } catch { /* exists */ }
  return db;
}

export const getDb = () => db;
export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);

/* The Mongo TTL indexes translated: ledgers are purged opportunistically. */
export function purgeLedgers(now = Date.now()) {
  run("DELETE FROM signup_attempts WHERE at < ?", now - 2 * 3600 * 1000);
  run("DELETE FROM signin_attempts WHERE at < ?", now - 2 * 3600 * 1000);
}

/* maybe.love's log_event: metadata only, never content. No-op when the DB is
 * closed (rooms run fine with accounts disabled). */
export function logEvent(userId, name, payload = {}) {
  if (!db) return;
  run("INSERT INTO events (user_id, name, payload, at) VALUES (?, ?, ?, ?)",
    userId, name, JSON.stringify(payload), new Date().toISOString());
}
