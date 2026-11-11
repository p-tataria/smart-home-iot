'use strict';
// Uses Node's built-in SQLite (node:sqlite): no native build step. Needs Node >= 22.13.
const fs = require('fs');
const path = require('path');
const config = require('./config');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('node:sqlite is not available. Install Node.js 22.13+ (24 LTS recommended). Current:', process.version);
  process.exit(1);
}

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS sensor_readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp    INTEGER NOT NULL,          -- epoch ms (server time)
  temperature  REAL,                      -- deg C
  humidity     REAL,                      -- %
  light        INTEGER,                   -- LDR raw ADC 0..4095
  energy       REAL,                      -- energy/current value (simulated unless real sensor)
  door         TEXT,                      -- OPEN | CLOSED
  motion       INTEGER,                   -- 1 | 0
  relay_state  TEXT                       -- ON | OFF
);
CREATE INDEX IF NOT EXISTS idx_readings_ts ON sensor_readings(timestamp);

CREATE TABLE IF NOT EXISTS security_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     INTEGER NOT NULL,
  event_type    TEXT NOT NULL,            -- DOOR_OPEN | MOTION_DETECTED | DOOR_AND_MOTION | ALERT_CLEARED
  door_status   TEXT,
  motion_status INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON security_events(timestamp);

CREATE TABLE IF NOT EXISTS relay_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  INTEGER NOT NULL,
  state      TEXT NOT NULL,               -- ON | OFF
  source     TEXT                         -- DASHBOARD_COMMAND | MQTT | OVERLOAD_PROTECTION | ...
);
CREATE INDEX IF NOT EXISTS idx_relay_ts ON relay_events(timestamp);
`);

// node:sqlite cannot bind undefined/boolean: normalise.
const n = (v) => (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) ? null : v;
const b = (v) => (v === undefined || v === null) ? null : (v ? 1 : 0);

const stmts = {
  insReading: db.prepare(`INSERT INTO sensor_readings
    (timestamp, temperature, humidity, light, energy, door, motion, relay_state) VALUES (?,?,?,?,?,?,?,?)`),
  insEvent: db.prepare(`INSERT INTO security_events
    (timestamp, event_type, door_status, motion_status) VALUES (?,?,?,?)`),
  insRelay: db.prepare(`INSERT INTO relay_events (timestamp, state, source) VALUES (?,?,?)`),
  readings: db.prepare(`SELECT * FROM (
      SELECT * FROM sensor_readings WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?
    ) ORDER BY timestamp ASC`),
  events: db.prepare(`SELECT * FROM security_events ORDER BY timestamp DESC LIMIT ?`),
  relayEvents: db.prepare(`SELECT * FROM relay_events ORDER BY timestamp DESC LIMIT ?`),
  purgeR: db.prepare(`DELETE FROM sensor_readings WHERE timestamp < ?`),
  purgeE: db.prepare(`DELETE FROM security_events WHERE timestamp < ?`),
  purgeL: db.prepare(`DELETE FROM relay_events WHERE timestamp < ?`)
};

module.exports = {
  insertReading(r) {
    stmts.insReading.run(r.timestamp, n(r.temperature), n(r.humidity), n(r.light), n(r.energy),
      n(r.door), b(r.motion), n(r.relay_state));
  },
  insertSecurityEvent(e) {
    stmts.insEvent.run(e.timestamp, e.event_type, n(e.door_status), b(e.motion_status));
  },
  insertRelayEvent(e) {
    stmts.insRelay.run(e.timestamp, e.state, n(e.source));
  },
  getReadings(sinceMs, limit) {
    return stmts.readings.all(sinceMs, limit).map((r) => ({ ...r, motion: r.motion === null ? null : !!r.motion }));
  },
  getSecurityEvents(limit) {
    return stmts.events.all(limit).map((r) => ({ ...r, motion_status: r.motion_status === null ? null : !!r.motion_status }));
  },
  getRelayEvents(limit) {
    return stmts.relayEvents.all(limit).map((r) => ({ ...r }));
  },
  purgeOld(retentionDays) {
    const cutoff = Date.now() - retentionDays * 86400000;
    stmts.purgeR.run(cutoff); stmts.purgeE.run(cutoff); stmts.purgeL.run(cutoff);
  },
  close() { db.close(); }
};
