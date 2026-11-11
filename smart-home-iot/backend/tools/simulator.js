'use strict';
// Fake ESP32: publishes the SAME topics/payloads as firmware/smart_home.ino so you can
// test backend + dashboard with no hardware. Type commands in this terminal:
//   d = toggle door | m = toggle motion | e <0-4095> = energy | l <0-4095> = light | t <C> = temperature | q = quit
const mqtt = require('mqtt');
const readline = require('readline');
const config = require('../config');
const T = config.topics;

const sim = { door: 'CLOSED', motion: false, temp: 27.5, hum: 55, light: 1800, energy: 1450,
              relay: 'OFF', relaySource: 'BOOT', alert: false, reason: 'NONE', holdUntil: 0 };
const OVERLOAD = 3600;
const t0 = Date.now();

const client = mqtt.connect(config.mqtt.url, {
  clientId: `sim-${config.deviceId}-${Math.random().toString(16).slice(2, 6)}`,
  username: config.mqtt.username, password: config.mqtt.password, reconnectPeriod: 3000,
  will: { topic: T.status, payload: JSON.stringify({ device: config.deviceId, online: false }), qos: 1, retain: true }
});

const pub = (topic, obj, retain = false) =>
  client.publish(topic, JSON.stringify({ ...obj, timestamp: Date.now() - t0, epoch: Math.floor(Date.now() / 1000) }), { qos: 0, retain });

function evaluate() {
  const trigger = sim.door === 'OPEN' || sim.motion;
  if (trigger) {
    sim.holdUntil = Date.now() + 3000;
    sim.reason = sim.door === 'OPEN' && sim.motion ? 'DOOR_AND_MOTION' : sim.door === 'OPEN' ? 'DOOR_OPEN' : 'MOTION_DETECTED';
    sim.alert = true;
  } else if (sim.alert && Date.now() > sim.holdUntil) { sim.alert = false; sim.reason = 'NONE'; }
  if (sim.energy >= OVERLOAD && sim.relay === 'ON') { sim.relay = 'OFF'; sim.relaySource = 'OVERLOAD_PROTECTION'; }
}

function pubSecurity() {
  pub(T.door, { door: sim.door });
  pub(T.motion, { motion: sim.motion });
  pub(T.alert, { door: sim.door, motion: sim.motion, alert: sim.alert, buzzer: sim.alert, reason: sim.reason });
}
function pubEnv() {
  pub(T.temperature, { value: +sim.temp.toFixed(1), unit: 'C', valid: true });
  pub(T.humidity, { value: Math.round(sim.hum), unit: '%', valid: true });
  pub(T.light, { value: sim.light, percent: +(sim.light / 40.95).toFixed(1), unit: 'ADC raw (0-4095)' });
}
function pubEnergy() {
  const status = sim.energy >= OVERLOAD ? 'OVERLOAD' : sim.energy >= 2800 ? 'HIGH' : 'NORMAL';
  pub(T.energy, { value: sim.energy, unit: 'ADC raw (0-4095)', label: 'Simulated Energy/Current Value',
                  simulated: true, percent: +(sim.energy / 40.95).toFixed(1), status });
}
const pubRelay = () => pub(T.relay, { state: sim.relay, source: sim.relaySource }, true);
const pubStatus = () => pub(T.status, { device: config.deviceId, online: true, ip: '192.168.1.99', rssi: -55,
  uptime_ms: Date.now() - t0, dht_ok: true, overload_lockout: sim.energy >= OVERLOAD, firmware: 'SIMULATOR' }, true);

client.on('connect', () => {
  console.log(`[SIM] connected to ${config.mqtt.url}, root "${config.mqtt.root}"`);
  client.subscribe(T.commandRelay, { qos: 1 });
  pubStatus(); pubSecurity(); pubEnv(); pubEnergy(); pubRelay();
});
client.on('error', (e) => console.error('[SIM] error:', e.message));

client.on('message', (topic, buf) => {
  if (topic !== T.commandRelay) return;
  let want = '';
  try { want = String(JSON.parse(buf.toString()).state).toUpperCase(); } catch { want = buf.toString().trim().toUpperCase(); }
  if (want !== 'ON' && want !== 'OFF') { console.log('[SIM] invalid relay command ignored:', buf.toString()); return; }
  if (want === 'ON' && sim.energy >= OVERLOAD) { sim.relay = 'OFF'; sim.relaySource = 'OVERLOAD_LOCKOUT'; }
  else { sim.relay = want; sim.relaySource = 'MQTT'; }
  console.log(`[SIM] relay -> ${sim.relay} (${sim.relaySource})`);
  pubRelay();
});

let last = '';
setInterval(() => {
  sim.temp += (Math.random() - 0.5) * 0.2;
  sim.hum += (Math.random() - 0.5) * 0.6;
  evaluate();
  pubEnv(); pubEnergy(); pubSecurity(); pubRelay();
  const now = `${sim.alert}|${sim.reason}`;
  if (now !== last) { console.log(sim.alert ? `[SIM] >>> SECURITY ALERT: ${sim.reason}` : '[SIM] SAFE'); last = now; }
}, 3000);
setInterval(pubStatus, 15000);

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [c, v] = line.trim().split(/\s+/);
  const val = parseFloat(v);
  if (c === 'd') sim.door = sim.door === 'OPEN' ? 'CLOSED' : 'OPEN';
  else if (c === 'm') sim.motion = !sim.motion;
  else if (c === 'e' && !isNaN(val)) sim.energy = Math.max(0, Math.min(4095, val));
  else if (c === 'l' && !isNaN(val)) sim.light = Math.max(0, Math.min(4095, val));
  else if (c === 't' && !isNaN(val)) sim.temp = val;
  else if (c === 'q') { client.end(true, () => process.exit(0)); return; }
  else { console.log('commands: d | m | e <0-4095> | l <0-4095> | t <C> | q'); return; }
  evaluate(); pubSecurity(); pubEnv(); pubEnergy(); pubRelay();
  console.log(`[SIM] door=${sim.door} motion=${sim.motion} energy=${sim.energy} light=${sim.light} temp=${sim.temp.toFixed(1)}`);
});
