'use strict';
// API base: same origin when served by the backend; falls back to localhost:3000 if opened as a file.
// Override with  ?api=http://<backend-ip>:3000
const params = new URLSearchParams(location.search);
const API = params.get('api') || (location.protocol === 'file:' ? 'http://localhost:3000' : '');

const $ = (id) => document.getElementById(id);
let envChart = null, energyChart = null;

async function getJSON(path) {
  const r = await fetch(API + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

function setPill(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = 'pill ' + (kind || 'muted-pill');
}
const fmtTime = (ms) => ms ? new Date(ms).toLocaleTimeString() : '—';
const fmtDateTime = (ms) => ms ? new Date(ms).toLocaleString() : '—';
const show = (v, d = 1) => (v === null || v === undefined) ? '—' : Number(v).toFixed(d);

const EVENT_NAMES = { DOOR_OPEN: 'Door opened', MOTION_DETECTED: 'Motion detected', DOOR_AND_MOTION: 'Door opened and motion detected',
                      ALERT_CLEARED: 'Alert cleared', ALERT: 'Alert' };

// ---------- live data ----------
function render(d) {
  const sec = d.security, env = d.environment, en = d.energy, rl = d.relay;

  // Security
  const alert = sec.alert === true;
  setPill('secStatus', alert ? 'ALERT' : (sec.updatedAt ? 'SAFE' : '—'), alert ? 'danger' : (sec.updatedAt ? 'ok' : ''));
  setPill('door', sec.door === 'OPEN' ? 'OPEN' : sec.door === 'CLOSED' ? 'CLOSED' : '—', sec.door === 'OPEN' ? 'danger' : sec.door ? 'ok' : '');
  setPill('motion', sec.motion === true ? 'DETECTED' : sec.motion === false ? 'CLEAR' : '—', sec.motion ? 'danger' : sec.motion === false ? 'ok' : '');
  setPill('buzzer', sec.buzzer ? 'ON' : sec.updatedAt ? 'OFF' : '—', sec.buzzer ? 'danger' : sec.updatedAt ? 'ok' : '');
  $('alertBanner').hidden = !alert;
  $('alertText').textContent = alert ? (EVENT_NAMES[sec.reason] || sec.reason) + '. Buzzer is sounding.' : '';

  // Environment
  $('temp').textContent = show(env.temperature, 1);
  $('hum').textContent = show(env.humidity, 0);
  $('light').textContent = env.light === null ? '—' : env.light;
  $('lightPct').textContent = env.lightPercent === null ? '' : ` (${env.lightPercent.toFixed(0)} %)`;
  $('dhtWarn').hidden = env.dhtValid !== false;

  // Energy
  $('energyLabel').textContent = en.label || 'Energy/Current Value';
  $('energyValue').textContent = show(en.value, en.unit === 'A' ? 2 : 0);
  $('energyUnit').textContent = en.unit ? ' ' + en.unit : '';
  const ek = en.status === 'OVERLOAD' ? 'danger' : en.status === 'HIGH' ? 'warn' : en.status ? 'ok' : '';
  setPill('energyStatus', en.status || '—', ek);
  const bar = $('energyBar');
  bar.style.width = (en.percent || 0) + '%';
  bar.className = 'bar-fill ' + (ek === 'ok' ? '' : ek);
  $('energyPct').textContent = en.percent === null ? '—' : en.percent.toFixed(0) + ' % of full scale';
  $('simNote').hidden = en.simulated === false;

  // Relay
  setPill('relayState', rl.state || '—', rl.state === 'ON' ? 'ok' : '');
  const srcText = rl.source ? 'Changed by: ' + rl.source.replace(/_/g, ' ').toLowerCase() : '';
  $('relaySource').textContent = srcText + (rl.pendingCommand ? ` (waiting for ${rl.pendingCommand})` : '');

  // System
  setPill('sysEsp', d.device_online ? 'ONLINE' : 'OFFLINE', d.device_online ? 'ok' : 'danger');
  setPill('sysMqtt', d.mqtt_connected ? 'CONNECTED' : 'DISCONNECTED', d.mqtt_connected ? 'ok' : 'danger');
  $('lastUpdate').textContent = fmtDateTime(d.last_update);
  $('sysLast').textContent = fmtDateTime(d.last_update);
}

async function refreshLive() {
  try {
    render(await getJSON('/api/sensors/latest'));
    setPill('sysBackend', 'OK', 'ok');
    $('connDot').className = 'dot on'; $('connText').textContent = 'Backend connected';
  } catch (e) {
    setPill('sysBackend', 'UNREACHABLE', 'danger');
    $('connDot').className = 'dot off'; $('connText').textContent = 'Backend unreachable';
  }
}

async function refreshStatus() {
  try {
    const s = await getJSON('/api/status');
    const d = s.device;
    const parts = [];
    if (d.id) parts.push('Device ' + d.id);
    if (d.ip) parts.push('IP ' + d.ip);
    if (d.rssi !== null) parts.push('Wi-Fi ' + d.rssi + ' dBm');
    if (d.uptime_ms !== null) parts.push('Uptime ' + Math.round(d.uptime_ms / 60000) + ' min');
    parts.push('Broker ' + s.mqtt.broker + ':' + s.mqtt.port);
    parts.push('Topic root ' + s.mqtt.topic_root);
    $('sysDetail').textContent = parts.join('  |  ');
  } catch (e) { /* shown by refreshLive */ }
}

async function refreshEvents() {
  try {
    const { events } = await getJSON('/api/security/events?limit=10');
    const body = $('eventsBody');
    if (!events.length) { body.innerHTML = '<tr><td colspan="4" class="muted">No events recorded yet.</td></tr>'; return; }
    body.innerHTML = '';
    for (const ev of events) {
      const tr = document.createElement('tr');
      const cells = [fmtDateTime(ev.timestamp), EVENT_NAMES[ev.event_type] || ev.event_type,
                     ev.door_status || '—', ev.motion_status === null ? '—' : (ev.motion_status ? 'Detected' : 'Clear')];
      for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
      body.appendChild(tr);
    }
  } catch (e) { /* ignore */ }
}

// ---------- charts ----------
function makeChart(canvasId, datasets, yTitle, y2Title) {
  const scales = { x: { ticks: { maxTicksLimit: 8 } }, y: { title: { display: !!yTitle, text: yTitle } } };
  if (y2Title) scales.y1 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: y2Title } };
  return new Chart($(canvasId), {
    type: 'line', data: { labels: [], datasets },
    options: { responsive: true, maintainAspectRatio: false, animation: false, spanGaps: true,
               interaction: { mode: 'index', intersect: false }, elements: { point: { radius: 0 }, line: { borderWidth: 2 } },
               scales }
  });
}

async function refreshCharts() {
  if (typeof Chart === 'undefined') return;
  const minutes = $('range').value;
  try {
    const [h, e] = await Promise.all([
      getJSON(`/api/sensors/history?minutes=${minutes}&limit=1000`),
      getJSON(`/api/energy/history?minutes=${minutes}&limit=1000`)
    ]);
    if (!envChart) {
      envChart = makeChart('envChart', [
        { label: 'Temperature (°C)', data: [], borderColor: '#d9534f', yAxisID: 'y' },
        { label: 'Humidity (%)', data: [], borderColor: '#1f77b4', yAxisID: 'y1' }
      ], 'Temperature (°C)', 'Humidity (%)');
    }
    envChart.data.labels = h.readings.map((r) => fmtTime(r.timestamp));
    envChart.data.datasets[0].data = h.readings.map((r) => r.temperature);
    envChart.data.datasets[1].data = h.readings.map((r) => r.humidity);
    envChart.update();

    if (!energyChart) {
      energyChart = makeChart('energyChart', [{ label: 'Energy/current value', data: [], borderColor: '#e08a00',
                                                backgroundColor: 'rgba(224,138,0,.12)', fill: true }], '');
    }
    energyChart.options.scales.y.title = { display: true, text: e.unit || 'value' };
    energyChart.data.datasets[0].label = e.label || 'Energy/current value';
    energyChart.data.labels = e.readings.map((r) => fmtTime(r.timestamp));
    energyChart.data.datasets[0].data = e.readings.map((r) => r.value);
    energyChart.update();
  } catch (err) { /* backend unreachable: shown elsewhere */ }
}

// ---------- relay control ----------
async function sendRelay(stateStr) {
  const on = $('btnOn'), off = $('btnOff'), msg = $('relayMsg');
  on.disabled = off.disabled = true;
  msg.textContent = 'Sending command…';
  try {
    const r = await fetch(API + '/api/relay', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                 body: JSON.stringify({ state: stateStr }) });
    const j = await r.json();
    msg.textContent = r.ok ? j.message : 'Command failed: ' + (j.error || r.status);
  } catch (e) {
    msg.textContent = 'Command failed: backend unreachable.';
  } finally {
    setTimeout(() => { on.disabled = off.disabled = false; }, 600);
    setTimeout(refreshLive, 700);
  }
}

$('btnOn').addEventListener('click', () => sendRelay('ON'));
$('btnOff').addEventListener('click', () => sendRelay('OFF'));
$('range').addEventListener('change', refreshCharts);

window.addEventListener('load', () => {
  refreshLive(); refreshStatus(); refreshEvents(); refreshCharts();
  setInterval(refreshLive, 2000);
  setInterval(refreshStatus, 10000);
  setInterval(refreshEvents, 5000);
  setInterval(refreshCharts, 15000);
});
