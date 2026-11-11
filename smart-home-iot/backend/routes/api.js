'use strict';
const express = require('express');
const config = require('../config');
const db = require('../database');
const mqtt = require('../mqtt');

const router = express.Router();
const startedAt = Date.now();
const clamp = (v, lo, hi, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// GET /api/status : system health
router.get('/status', (req, res) => {
  const s = mqtt.state;
  res.json({
    backend: { status: 'ok', uptime_s: Math.round((Date.now() - startedAt) / 1000) },
    mqtt: { connected: s.mqttConnected, broker: config.mqtt.broker, port: config.mqtt.port, topic_root: config.mqtt.root },
    device: {
      id: s.device.id, online: mqtt.isDeviceOnline(), ip: s.device.ip, rssi: s.device.rssi,
      uptime_ms: s.device.uptimeMs, dht_ok: s.device.dhtOk, overload_lockout: s.device.overloadLockout,
      firmware: s.device.firmware, last_seen: s.device.lastSeen
    },
    last_update: s.lastUpdate,
    server_time: Date.now()
  });
});

// GET /api/sensors/latest : everything the dashboard shows live
router.get('/sensors/latest', (req, res) => {
  const s = mqtt.state;
  res.json({
    timestamp: Date.now(),
    last_update: s.lastUpdate,
    device_online: mqtt.isDeviceOnline(),
    mqtt_connected: s.mqttConnected,
    security: s.security,
    environment: s.environment,
    energy: s.energy,
    relay: s.relay
  });
});

// GET /api/sensors/history?minutes=60&limit=1000
router.get('/sensors/history', (req, res) => {
  const minutes = clamp(req.query.minutes, 1, 10080, 60);
  const limit = clamp(req.query.limit, 1, 5000, 1000);
  const rows = db.getReadings(Date.now() - minutes * 60000, limit);
  res.json({ minutes, count: rows.length, readings: rows });
});

// GET /api/energy/history?minutes=60
router.get('/energy/history', (req, res) => {
  const minutes = clamp(req.query.minutes, 1, 10080, 60);
  const limit = clamp(req.query.limit, 1, 5000, 1000);
  const rows = db.getReadings(Date.now() - minutes * 60000, limit)
    .filter((r) => r.energy !== null)
    .map((r) => ({ timestamp: r.timestamp, value: r.energy }));
  res.json({
    minutes, count: rows.length,
    unit: mqtt.state.energy.unit, label: mqtt.state.energy.label, simulated: mqtt.state.energy.simulated,
    readings: rows
  });
});

// GET /api/security/events?limit=20
router.get('/security/events', (req, res) => {
  const events = db.getSecurityEvents(clamp(req.query.limit, 1, 500, 20));
  res.json({ count: events.length, events });
});

// GET /api/relay/events?limit=20
router.get('/relay/events', (req, res) => {
  const events = db.getRelayEvents(clamp(req.query.limit, 1, 500, 20));
  res.json({ count: events.length, events });
});

async function sendRelay(req, res, wanted) {
  const stateStr = String(wanted || '').trim().toUpperCase();
  if (stateStr !== 'ON' && stateStr !== 'OFF') {
    return res.status(400).json({ ok: false, error: 'state must be "ON" or "OFF"' });
  }
  try {
    await mqtt.publishRelayCommand(stateStr);
    res.status(202).json({
      ok: true, requested: stateStr, device_online: mqtt.isDeviceOnline(),
      message: mqtt.isDeviceOnline()
        ? 'Command sent. Waiting for ESP32 confirmation.'
        : 'Command sent, but the ESP32 appears offline.'
    });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
}

// POST /api/relay  body: {"state":"ON"|"OFF"}
router.post('/relay', (req, res) => sendRelay(req, res, req.body && req.body.state));
router.post('/relay/on', (req, res) => sendRelay(req, res, 'ON'));
router.post('/relay/off', (req, res) => sendRelay(req, res, 'OFF'));

module.exports = router;
