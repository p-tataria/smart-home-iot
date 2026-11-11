'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const root = process.env.MQTT_TOPIC_ROOT || 'smart_home';
const broker = process.env.MQTT_BROKER || 'broker.hivemq.com';
const port = parseInt(process.env.MQTT_PORT || '1883', 10);
const protocol = process.env.MQTT_PROTOCOL || 'mqtt';

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  deviceId: process.env.DEVICE_ID || 'esp32s3-home-01',
  dbPath: path.resolve(__dirname, process.env.DB_PATH || './data/smart_home.db'),
  snapshotIntervalMs: parseInt(process.env.SNAPSHOT_INTERVAL_MS || '5000', 10),
  deviceStaleMs: parseInt(process.env.DEVICE_STALE_MS || '30000', 10),
  retentionDays: parseInt(process.env.RETENTION_DAYS || '30', 10),
  mqtt: {
    broker, port, protocol,
    url: `${protocol}://${broker}:${port}`,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    root
  },
  // IDENTICAL to the topic names in firmware/smart_home.ino
  topics: {
    door:         `${root}/security/door`,
    motion:       `${root}/security/motion`,
    alert:        `${root}/security/alert`,
    temperature:  `${root}/environment/temperature`,
    humidity:     `${root}/environment/humidity`,
    light:        `${root}/environment/light`,
    energy:       `${root}/energy/current`,
    relay:        `${root}/appliance/relay`,
    status:       `${root}/status`,
    commandRelay: `${root}/command/relay`
  }
};
