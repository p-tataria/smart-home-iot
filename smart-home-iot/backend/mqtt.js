'use strict';
const mqttLib = require('mqtt');
const config = require('./config');
const db = require('./database');

const T = config.topics;

// ---- In-memory "latest known state" (what the dashboard reads) ----
const state = {
  mqttConnected: false,
  lastUpdate: null,
  device: { id: config.deviceId, online: false, ip: null, rssi: null, uptimeMs: null, dhtOk: null,
            overloadLockout: false, firmware: null, lastSeen: null },
  security: { alert: false, door: null, motion: null, buzzer: false, reason: 'NONE', updatedAt: null },
  environment: { temperature: null, humidity: null, light: null, lightPercent: null, dhtValid: null, updatedAt: null },
  energy: { value: null, unit: null, label: 'Simulated Energy/Current Value', simulated: true,
            percent: null, status: null, updatedAt: null },
  relay: { state: null, source: null, updatedAt: null, pendingCommand: null }
};

let client = null;
let prevAlert = null;
let snapshotTimer = null;

function parse(buf) {
  try { const o = JSON.parse(buf.toString()); return (o && typeof o === 'object') ? o : null; }
  catch { return null; }
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

function touch() {
  const now = Date.now();
  state.lastUpdate = now;
  state.device.lastSeen = now;
  return now;
}

function isDeviceOnline() {
  return state.device.online && state.device.lastSeen !== null &&
         (Date.now() - state.device.lastSeen) < config.deviceStaleMs;
}

// ---- Topic handlers ----
const handlers = {
  [T.door](p) {
    const now = touch();
    if (p.door) state.security.door = String(p.door).toUpperCase();
    state.security.updatedAt = now;
  },
  [T.motion](p) {
    const now = touch();
    if (typeof p.motion === 'boolean') state.security.motion = p.motion;
    state.security.updatedAt = now;
  },
  [T.alert](p) {
    const now = touch();
    const s = state.security;
    if (p.door) s.door = String(p.door).toUpperCase();
    if (typeof p.motion === 'boolean') s.motion = p.motion;
    if (typeof p.buzzer === 'boolean') s.buzzer = p.buzzer;
    s.reason = p.reason || 'NONE';
    const alert = p.alert === true;
    s.alert = alert;
    s.updatedAt = now;

    if (alert && !prevAlert) {
      db.insertSecurityEvent({ timestamp: now, event_type: s.reason === 'NONE' ? 'ALERT' : s.reason,
                               door_status: s.door, motion_status: s.motion });
      console.log(`[SECURITY] ALERT (${s.reason})`);
    } else if (!alert && prevAlert === true) {
      db.insertSecurityEvent({ timestamp: now, event_type: 'ALERT_CLEARED',
                               door_status: s.door, motion_status: s.motion });
      console.log('[SECURITY] cleared');
    }
    prevAlert = alert;
  },
  [T.temperature](p) {
    const now = touch();
    state.environment.temperature = num(p.value);
    if (typeof p.valid === 'boolean') state.environment.dhtValid = p.valid;
    state.environment.updatedAt = now;
  },
  [T.humidity](p) {
    const now = touch();
    state.environment.humidity = num(p.value);
    state.environment.updatedAt = now;
  },
  [T.light](p) {
    const now = touch();
    state.environment.light = num(p.value);
    state.environment.lightPercent = num(p.percent);
    state.environment.updatedAt = now;
  },
  [T.energy](p) {
    const now = touch();
    const e = state.energy;
    e.value = num(p.value);
    e.unit = p.unit || e.unit;
    e.label = p.label || e.label;
    e.simulated = p.simulated !== false;
    e.percent = num(p.percent);
    e.status = p.status || e.status;
    e.updatedAt = now;
  },
  [T.relay](p) {
    const now = touch();
    const st = String(p.state || '').toUpperCase();
    if (st !== 'ON' && st !== 'OFF') return;
    const r = state.relay;
    const changed = r.state !== null && r.state !== st;
    r.state = st;
    r.source = p.source || null;
    r.updatedAt = now;
    if (r.pendingCommand === st) r.pendingCommand = null;
    if (changed) {
      db.insertRelayEvent({ timestamp: now, state: st, source: r.source || 'DEVICE' });
      console.log(`[RELAY] ${st} (${r.source})`);
    }
  },
  [T.status](p) {
    const d = state.device;
    d.online = p.online === true;
    if (p.device) d.id = p.device;
    if (p.ip) d.ip = p.ip;
    if (typeof p.rssi === 'number') d.rssi = p.rssi;
    if (typeof p.uptime_ms === 'number') d.uptimeMs = p.uptime_ms;
    if (typeof p.dht_ok === 'boolean') d.dhtOk = p.dht_ok;
    if (typeof p.overload_lockout === 'boolean') d.overloadLockout = p.overload_lockout;
    if (p.firmware) d.firmware = p.firmware;
    state.lastUpdate = Date.now();
    d.lastSeen = Date.now();
    console.log(`[DEVICE] ${d.id} is ${d.online ? 'ONLINE' : 'OFFLINE'}`);
  }
};

function takeSnapshot() {
  const e = state.environment;
  if (!isDeviceOnline() || e.updatedAt === null) return;
  db.insertReading({
    timestamp: Date.now(),
    temperature: e.temperature,
    humidity: e.humidity,
    light: e.light,
    energy: state.energy.value,
    door: state.security.door,
    motion: state.security.motion,
    relay_state: state.relay.state
  });
}

function start() {
  console.log(`[MQTT] connecting to ${config.mqtt.url} (topic root: ${config.mqtt.root})`);
  client = mqttLib.connect(config.mqtt.url, {
    clientId: `smart-home-backend-${Math.random().toString(16).slice(2, 8)}`,
    username: config.mqtt.username,
    password: config.mqtt.password,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true
  });

  client.on('connect', () => {
    state.mqttConnected = true;
    console.log('[MQTT] connected');
    const subs = [T.door, T.motion, T.alert, T.temperature, T.humidity, T.light, T.energy, T.relay, T.status];
    client.subscribe(subs, { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] subscribe error:', err.message);
      else console.log(`[MQTT] subscribed to ${subs.length} topics`);
    });
  });
  client.on('close', () => { state.mqttConnected = false; console.log('[MQTT] connection closed, retrying...'); });
  client.on('error', (err) => console.error('[MQTT] error:', err.message));

  client.on('message', (topic, payload) => {
    const h = handlers[topic];
    if (!h) return;
    const p = parse(payload);
    if (!p) { console.warn(`[MQTT] ignored invalid JSON on ${topic}`); return; }
    try { h(p); } catch (e) { console.error(`[MQTT] handler error on ${topic}:`, e.message); }
  });

  snapshotTimer = setInterval(takeSnapshot, config.snapshotIntervalMs);
}

function publishRelayCommand(newState) {
  return new Promise((resolve, reject) => {
    if (!client || !state.mqttConnected) return reject(new Error('MQTT broker not connected'));
    const payload = JSON.stringify({ state: newState, source: 'dashboard', timestamp: Date.now() });
    client.publish(T.commandRelay, payload, { qos: 1, retain: false }, (err) => {
      if (err) return reject(err);
      state.relay.pendingCommand = newState;
      db.insertRelayEvent({ timestamp: Date.now(), state: newState, source: 'DASHBOARD_COMMAND' });
      console.log(`[RELAY] command published: ${newState}`);
      resolve();
    });
  });
}

function stop() {
  if (snapshotTimer) clearInterval(snapshotTimer);
  if (client) client.end(true);
}

module.exports = { start, stop, state, isDeviceOnline, publishRelayCommand };
