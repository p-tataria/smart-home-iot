# IoT-Based Smart Home Security and Energy Management System

**B.Tech Final Year Project Report**  
ESP32-S3 + MQTT + Node.js/Express + SQLite + Web Dashboard

---

## 1. Abstract

This project presents an IoT-based smart home security and energy management system built around the ESP32-S3 microcontroller. The system monitors security (PIR motion and reed door switch), environment (DHT11 temperature/humidity and LDR light), and energy consumption (analog input). Data is published over MQTT to a broker, consumed by a Node.js/Express backend, stored in SQLite, and presented on a web dashboard. The backend exposes a REST API that the dashboard polls, and accepts relay ON/OFF commands that are forwarded to the ESP32 over MQTT. Local safety logic runs on the ESP32 so the buzzer and relay overload cut-off continue to work without Wi-Fi or MQTT connectivity.

---

## 2. Introduction

Home automation and energy monitoring are increasingly important for safety, convenience, and power savings. Existing commercial solutions are often closed, cloud-dependent, and expensive. This project delivers an open, local, and extensible smart home prototype that:

- Detects intrusion (door open / motion) and raises a local audible alert plus dashboard notification.
- Monitors temperature, humidity, and ambient light.
- Tracks energy/current via an analog input and enforces an automatic overload cut-off on a relay-controlled appliance.
- Allows remote appliance control from a web dashboard via MQTT-backed REST commands.
- Stores telemetry and event history in SQLite for analysis and demonstration.

---

## 3. System Overview

### Upstream data flow
Sensors -> ESP32-S3 -> Wi-Fi -> MQTT Broker -> Backend -> SQLite -> REST -> Dashboard

### Downstream command flow
Dashboard -> Backend (REST POST) -> MQTT Broker -> ESP32-S3 -> Relay

### Key design principles
- The dashboard never talks MQTT directly; it uses the backend REST API only.
- The ESP32 sets a retained Last Will on `status` (`online: false`) so the dashboard knows when the device drops off.
- `status` and `appliance/relay` are retained so a freshly started backend learns current state.
- Local alert and overload logic runs independently of network connectivity.

---

## 4. System Architecture

See `diagrams/system-architecture.md` (Mermaid; renders on GitHub/VS Code).

- **ESP32-S3 Dev Module**: reads sensors, makes local safety decisions, talks MQTT.
- **MQTT Broker**: plain config value; nothing is broker-specific.
- **Backend (Node.js/Express)**: subscribes to telemetry topics, stores readings/events in SQLite, keeps latest state in memory, exposes REST API, serves static dashboard.
- **SQLite**: stores one snapshot row every 5 s, logs alert and relay transitions.
- **Dashboard**: polls REST every 2 s (live), 5 s (events), 15 s (charts).

---

## 5. Hardware Components

| Component | Purpose |
|-----------|---------|
| ESP32-S3 Dev Module | Reads sensors, local safety decisions, MQTT |
| PIR (HC-SR501) | Motion (HIGH = motion) |
| Reed switch | Door/window (OPEN = LOW) |
| DHT11 | Temperature / humidity |
| LDR + 10 kΩ | Light level (voltage divider) |
| Potentiometer (simulation only) | Variable analog value standing in for energy sensor |
| Real current sensor (hardware version) | ACS712 / INA219 (DC low-voltage) or isolated AC sensor |
| Relay module | Switches a low-voltage test load |
| Active buzzer | Only audible indicator. No LEDs |
| Breadboard, jumpers, resistors | Wiring |

### GPIO table (verify against your exact board before wiring)

| GPIO | Function | Mode |
|------|----------|------|
| 4 | DHT11 DATA | digital |
| 5 | LDR divider | ADC1 |
| 6 | Energy input (potentiometer wiper / current sensor) | ADC1 |
| 7 | PIR OUT | INPUT |
| 8 | Door/reed switch | INPUT_PULLUP, OPEN = LOW |
| 9 | Relay IN | OUTPUT, default OFF |
| 10 | Buzzer | OUTPUT, default OFF |

### Circuit / safety notes
- Never connect mains AC to the ESP32. Use a low-voltage load (e.g., a 5–12 V lamp/fan on its own supply) through the relay contacts.
- Full wiring tables, ASCII schematic, simulation-vs-real energy sensor and door-polarity notes are in `diagrams/circuit-diagram.md`.
- Power the PIR from 5 V; keep all grounds common.
- Match `RELAY_ACTIVE_HIGH` to the relay module (many are active LOW).

---

## 6. MQTT Architecture

Broker is a plain config value (`MQTT_BROKER`/`PORT`/`USERNAME`/`PASSWORD`); nothing is HiveMQ-specific. ESP32 and backend both connect as clients. Public brokers are readable by everyone: change `TOPIC_ROOT` / `MQTT_TOPIC_ROOT` to something unique (same value in both).

### MQTT topics

Root = `smart_home` (configurable).

| Topic | Direction | Payload example |
|-------|-----------|-----------------|
| `smart_home/security/door` | ESP32 -> | `{"door":"OPEN","timestamp":123456,"epoch":1790000000}` |
| `smart_home/security/motion` | ESP32 -> | `{"motion":true,"timestamp":...}` |
| `smart_home/security/alert` | ESP32 -> | `{"door":"OPEN","motion":true,"alert":true,"buzzer":true,"reason":"DOOR_AND_MOTION","timestamp":...}` |
| `smart_home/environment/temperature` | ESP32 -> | `{"value":27.5,"unit":"C","valid":true,"timestamp":...}` |
| `smart_home/environment/humidity` | ESP32 -> | `{"value":60,"unit":"%","valid":true,"timestamp":...}` |
| `smart_home/environment/light` | ESP32 -> | `{"value":1800,"percent":44.0,"unit":"ADC raw (0-4095)","timestamp":...}` |
| `smart_home/energy/current` | ESP32 -> | `{"value":1450,"unit":"ADC raw (0-4095)","label":"Simulated Energy/Current Value","simulated":true,"percent":35.4,"status":"NORMAL","timestamp":...}` |
| `smart_home/appliance/relay` (retained) | ESP32 -> | `{"state":"ON","source":"MQTT","timestamp":...}` |
| `smart_home/status` (retained, LWT) | ESP32 -> | `{"device":"esp32s3-home-01","online":true,"ip":"...","rssi":-55,"uptime_ms":..., "dht_ok":true}` |
| `smart_home/command/relay` | -> ESP32 | `{"state":"ON"}`. Plain ON / OFF also accepted |

`timestamp` = ESP32 uptime in ms. `epoch` = Unix seconds once NTP syncs (0 before). The backend stores its own receive time.

`reason` values: `DOOR_OPEN`, `MOTION_DETECTED`, `DOOR_AND_MOTION`, `NONE`.

Relay `source` values: `MQTT`, `OVERLOAD_PROTECTION`, `OVERLOAD_LOCKOUT`, `INVALID_COMMAND_IGNORED`, `BOOT`.

---

## 7. Software Design

### 7.1 Backend (Node.js/Express + SQLite)
Files: `backend/server.js`, `config.js`, `database.js`, `mqtt.js`, `routes/api.js`, `tools/simulator.js`.

- Express app serving the static dashboard and REST API.
- SQLite database (built into Node 22.13+; no compiler needed).
- MQTT client subscribes to telemetry topics, keeps latest state in memory, publishes relay commands.
- One snapshot row stored every 5 s; alert and relay transitions logged as events.

### 7.2 Firmware (ESP32-S3 + Arduino)
File: `firmware/smart_home.ino`.

Libraries: PubSubClient (Nick O'Leary), DHT sensor library (Adafruit), Adafruit Unified Sensor.

Boards: ESP32S3 Dev Module. USB CDC On Boot = Enabled if using native USB port. Baud 115200.

User configuration section covers: Wi-Fi credentials, MQTT broker/port/user/pass/TLS, device ID, topic root, relay/buzzer/door active levels, energy sensor mode.

Local logic runs every loop pass:
- Security alert = PIR HIGH OR door OPEN (LOW). Buzzer ON immediately on alert.
- Door debounced 50 ms; PIR ignored during 30 s warm-up.
- Alert holds 3 s (ALERT_HOLD_MS) after inputs clear, then SAFE.
- Energy (GPIO 6) averaged over 16 samples, classified NORMAL / HIGH / OVERLOAD (demo thresholds 2800 / 3600 of 4095).
- On OVERLOAD: relay forced OFF, remote ON refused until value falls below 90% of threshold (hysteresis).
- DHT11 NaN/out-of-range discarded; last valid kept; `valid:false` after 3 failures.
- Wi-Fi retried every 10 s non-blocking; MQTT retried every 5 s; publishing skipped while offline.
- Relay and buzzer forced OFF at boot before anything else runs.

### 7.3 Dashboard (HTML/CSS/JS)
Files: `dashboard/index.html`, `style.css`, `app.js`.

- Live view of sensors, security status, relay state, energy bar/status.
- Recent security alerts and relay event logs.
- Turn ON / Turn OFF relay buttons.
- Polls REST every 2 s (live), 5 s (events), 15 s (charts).

---

## 8. REST API (Backend)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Backend / MQTT / ESP32 health |
| GET | `/api/sensors/latest` | Latest security, environment, energy, relay |
| GET | `/api/sensors/history?minutes=60&limit=1000` | Stored readings |
| GET | `/api/energy/history?minutes=60` | Energy series + unit/label |
| GET | `/api/security/events?limit=20` | Alert log |
| GET | `/api/relay/events?limit=20` | Relay log |
| POST | `/api/relay` body `{"state":"ON"}` | Relay command |
| POST | `/api/relay/on` | Shortcut |
| POST | `/api/relay/off` | Shortcut |

---

## 9. Database Schema (SQLite)

- `sensor_readings(id, timestamp, temperature, humidity, light, energy, door, motion, relay_state)`
- `security_events(id, timestamp, event_type, door_status, motion_status)`
- `relay_events(id, timestamp, state, source)`

---

## 10. Configuration & Installation

### Backend
```bash
cd smart-home-iot
cp .env.example .env          # Windows: copy .env.example .env
cd backend
npm install
npm start
```
Open `http://localhost:3000`. An `ExperimentalWarning: SQLite` is normal.

`.env` (project root): `MQTT_BROKER`, `MQTT_PORT`, `MQTT_PROTOCOL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPIC_ROOT`, `PORT`, `DEVICE_ID`, `DB_PATH`, retention/interval settings.

Never commit real Wi-Fi/MQTT passwords. Add `.env` to `.gitignore`.

`MQTT_USE_TLS=true` uses `setInsecure()` (encrypted but not verifying the server). For production, add the broker CA with `setCACert()`.

### Firmware (Arduino IDE)
1. Boards Manager -> install esp32 by Espressif Systems (3.x recommended).
2. Library Manager -> install PubSubClient, DHT sensor library (Adafruit), Adafruit Unified Sensor.
3. Tools: Board = ESP32S3 Dev Module.
4. Fill `USER CONFIGURATION` in `smart_home.ino` (Wi-Fi, MQTT, topics, GPIO active levels, energy mode).
5. Upload, open Serial Monitor at 115200 baud.

---

## 11. Testing & Validation

### Backend + simulator (tested together)
The backend, REST API, database, dashboard files, and simulator were run and tested together against a local MQTT broker.

Start backend (`npm start`) and open dashboard. In a second terminal: `cd backend && npm run simulate`. The simulator behaves like the ESP32 on the same topics/payloads.

Simulator terminal commands:
- `d` toggle door
- `m` toggle motion
- `e 3700` energy overload, `e 1000` normal
- `l 300` light
- `t 31` temperature
- `q` quit

Click Turn ON / Turn OFF on the dashboard: the simulator prints `relay -> ON`.

### Raw MQTT test
```bash
mosquitto_pub -h broker.hivemq.com -t smart_home/command/relay -m '{"state":"ON"}'
mosquitto_pub -h broker.hivudq.com -t smart_home/security/alert -m '{"door":"OPEN","motion":false,"alert":true,"buzzer":true,"reason":"DOOR_OPEN"}'
```

### REST test
```bash
curl http://localhost:3000/api/sensors/latest
curl -X POST http://localhost:3000/api/relay/on
```

### Cirkit Designer (not tested by author)
Wire exactly as in sections D/E (slide switch/button to GND for reed switch, potentiometer for GPIO 6), paste `smart_home.ino` and run. Check whether your Cirkit version supports Wi-Fi/MQTT for ESP32-S3. If not, it can still verify sensor logic, buzzer, relay, and Serial output; use the simulator above for MQTT/dashboard.

### Hardware testing (not yet compiled/run on board)
**Status: firmware written to spec but not compiled or run on a board by the author. Compile it and watch the Serial Monitor first.**

Expected Serial output:
```
SMART HOME SYSTEM STARTED
Connecting to WiFi...
WiFi connected + IP
MQTT: CONNECTED
report every 2 s
```
Wait 30 s for PIR warm-up (PIR ignored until then; door works immediately). Start backend with the same broker and topic root; dashboard should show ESP32 ONLINE.

### Moving simulation -> real hardware
- Keep same GPIOs (verify on your board).
- Replace potentiometer with real sensor; set `ENERGY_SENSOR_MODE 1`; set divider/zero/sensitivity/threshold constants; calibrate against multimeter.
- Use normally-closed reed switch or flip `DOOR_OPEN_LEVEL`.
- Match `RELAY_ACTIVE_HIGH` to relay module.
- Move to private broker (username/password, TLS) and unique topic root.

---

## 12. Troubleshooting

| Symptom | Fix |
|---------|-----|
| No Serial output | Set USB CDC On Boot = Enabled (native USB) or use UART port; baud 115200 |
| Compile error `DHT.h` / `PubSubClient.h` not found | Install the three libraries |
| Stuck on "Connecting to WiFi..." | Wrong SSID/password; ESP32 supports 2.4 GHz only |
| MQTT connect failed rc=-2 | Broker unreachable (host/port/firewall). rc=5 = wrong username/password |
| Dashboard shows ESP32 OFFLINE | Topic root differs between firmware and `.env`, or different broker |
| Dashboard says "Backend unreachable" | Backend not running, or open via `http://localhost:3000` |
| `node:sqlite` error | Upgrade to Node 22.13+ |
| Temperature shows — / "sensor error" | Check DHT wiring/pull-up. Firmware keeps last valid reading, sets `valid:false` |
| Alert triggers constantly | Door polarity wrong, or PIR still warming up / near heat source |
| Relay inverted | Toggle `RELAY_ACTIVE_HIGH` |
| Relay ON ignored, source `OVERLOAD_LOCKOUT` | Energy above overload threshold. Lower potentiometer |
| Random ADC values | Common ground missing; keep analog wires short |

---

## 13. Demo Flow

1. **Architecture & wiring** (2 min): show diagram and breadboard.
2. **Power on**: Serial Monitor connecting to Wi-Fi and MQTT; dashboard turns ESP32 ONLINE, status SAFE.
3. **Environment**: warm DHT11 with hand (temperature rises); cover LDR (light drops). Show live chart.
4. **Security**: open door switch -> buzzer sounds, red banner, event in "Recent security alerts". Close door -> SAFE after ~3 s. Wave hand at PIR -> motion alert.
5. **Appliance**: press Turn ON on dashboard -> relay clicks, load runs. Press Turn OFF.
6. **Energy**: turn potentiometer up: value and bar rise; status HIGH, then OVERLOAD -> relay cut automatically, remote ON refused.
7. **Resilience**: stop broker/disconnect Wi-Fi: buzzer/relay logic keeps working locally; reconnect and show automatic recovery.
8. **Database/history**: show `/api/sensors/history` and MQTT topic table.

---

## 14. Future Improvements

- Authentication on REST endpoints, HTTPS, private TLS broker with CA verification.
- WebSocket/SSE instead of polling.
- Push/email/Telegram alerts.
- Real power and cost estimation (voltage sensor + RMS).
- Scheduled appliance control, OTA firmware updates, multiple devices, CSV export.

---

## 15. Conclusion

The IoT-Based Smart Home Security and Energy Management System demonstrates a complete, layered IoT prototype: edge sensing and local safety decisions on the ESP32-S3, MQTT transport, a Node.js/Express backend with SQLite persistence, and a browser-based dashboard. Security, environment, energy, and appliance control are all integrated, with local fallback behavior ensuring the buzzer and overload protection remain functional during network outages. The firmware was written to specification; hardware compilation and Serial Monitor verification remain as the immediate next step before physical deployment.

---

## Appendix A: Folder Structure

```
smart-home-iot/
├── firmware/smart_home.ino
├── backend/
│   ├── package.json
│   ├── server.js        Express app + static dashboard
│   ├── config.js        .env + topic names
│   ├── database.js      SQLite tables + queries
│   ├── mqtt.js          MQTT subscriber/publisher + latest state
│   ├── routes/api.js    REST endpoints
│   └── tools/simulator.js   Fake ESP32 for testing without hardware
├── dashboard/ (index.html, style.css, app.js)
├── diagrams/ (circuit-diagram.md, system-architecture.md)
├── README.md
└── .env.example
```
