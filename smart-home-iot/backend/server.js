'use strict';
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./database');
const mqtt = require('./mqtt');
const api = require('./routes/api');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10kb' }));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint' }));

// Serve the dashboard from the same server: http://localhost:3000
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

app.use((err, req, res, next) => {            // JSON parse errors etc.
  console.error('[HTTP]', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

mqtt.start();
db.purgeOld(config.retentionDays);
const purgeTimer = setInterval(() => db.purgeOld(config.retentionDays), 6 * 3600 * 1000);

const server = app.listen(config.port, () => {
  console.log(`[HTTP] dashboard + API on http://localhost:${config.port}`);
});

function shutdown() {
  console.log('\nShutting down...');
  clearInterval(purgeTimer);
  mqtt.stop();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
