# IoT-Based Smart Home Security and Energy Management System

ESP32-S3 + MQTT + Node.js/Express + SQLite + web dashboard. B.Tech final-year project.

> **Honest status.** The backend, REST API, database, dashboard files and the simulator were run and tested together against a local MQTT broker.
> The firmware was written to the spec but **has not been compiled or run on a board by me**: compile it and watch the Serial Monitor first.
> I could not test the Cirkit Designer simulation either (see section O).

---
## A. Project overview
* **Security:** PIR + door switch -> local alert + buzzer + MQTT alert + dashboard alert list.
* **Environment:** DHT11 temperature/humidity, LDR light level.
* **Energy:** analog input on GPIO 6. In simulation it is a potentiometer, labelled **"Simulated Energy/Current Value"**. No power (W) or cost is calculated from it.
* **Appliance:** relay controlled locally (overload cut-off) and remotely (MQTT ON/OFF from the dashboard). Relay starts OFF.

## B. Architecture
See `diagrams/system-architecture.md` (Mermaid; renders on GitHub/VS Code).
```
UPSTREAM : Sensors -> ESP32-S3 -> Wi-Fi -> MQTT Broker -> Backend -> SQLite -> REST -> Dashboard
DOWNSTREAM: Dashboard -> Backend -> MQTT Broker -> ESP32-S3 -> Relay
```

## C. Components
| Component | Purpose |
|---|---|
| ESP32-S3 Dev Module | Reads sensors, makes local safety decisions, talks MQTT |
| PIR (HC-SR501) | Motion (HIGH = motion) |
| Reed switch | Door/window (OPEN = LOW) |
| DHT11 | Temperature / humidity |
| LDR + 10 kΩ | Light level (voltage divider) |
| Potentiometer (simulation only) | Variable analog value standing in for the energy sensor |
| Real current sensor (hardware version) | ACS712 / INA219 (DC low-voltage) or isolated AC sensor |
| Relay module | Switches a **low-voltage** test load |
| Active buzzer | Only audible indicator. **No LEDs** |
| Breadboard, jumpers, resistors | Wiring |

## D. GPIO table  (verify against your exact board before wiring)
| GPIO | Function | Mode |
|---|---|---|
| 4 | DHT11 DATA | digital |
| 5 | LDR divider | ADC1 |
| 6 | Energy input (potentiometer wiper / current sensor) | ADC1 |
| 7 | PIR OUT | INPUT |
| 8 | Door/reed switch | INPUT_PULLUP, OPEN = LOW |
| 9 | Relay IN | OUTPUT, default OFF |
| 10 | Buzzer | OUTPUT, default OFF |

## E. Circuit diagram
Full wiring tables, ASCII schematic, simulation-vs-real energy sensor and door-polarity notes: **`diagrams/circuit-diagram.md`**.
Safety: **never connect mains AC to the ESP32.** Use a low-voltage load (e.g. a 5-12 V lamp/fan on its own supply) through the relay contacts.

## F. MQTT architecture
Broker is a plain config value (`MQTT_BROKER/PORT/USERNAME/PASSWORD`): nothing is HiveMQ-specific. ESP32 and backend both connect as clients.
* ESP32 publishes telemetry; backend subscribes and stores it.
* Dashboard never talks MQTT. It uses the backend REST API.
* ESP32 sets a retained **Last Will** on `status` (`online:false`) so the dashboard knows when it drops off.
* `status` and `appliance/relay` are retained, so a freshly started backend learns the current state.
* Public brokers are readable by everyone: change `TOPIC_ROOT` / `MQTT_TOPIC_ROOT` to something unique (same value in both).

## G. MQTT topics
Root = `smart_home` (configurable).

| Topic | Direction | Payload example |
|---|---|---|
| `smart_home/security/door` | ESP32 -> | `{"door":"OPEN","timestamp":123456,"epoch":1790000000}` |
| `smart_home/security/motion` | ESP32 -> | `{"motion":true,"timestamp":...}` |
| `smart_home/security/alert` | ESP32 -> | `{"door":"OPEN","motion":true,"alert":true,"buzzer":true,"reason":"DOOR_AND_MOTION","timestamp":...}` |
| `smart_home/environment/temperature` | ESP32 -> | `{"value":27.5,"unit":"C","valid":true,"timestamp":...}` |
| `smart_home/environment/humidity` | ESP32 -> | `{"value":60,"unit":"%","valid":true,"timestamp":...}` |
| `smart_home/environment/light` | ESP32 -> | `{"value":1800,"percent":44.0,"unit":"ADC raw (0-4095)","timestamp":...}` |
| `smart_home/energy/current` | ESP32 -> | `{"value":1450,"unit":"ADC raw (0-4095)","label":"Simulated Energy/Current Value","simulated":true,"percent":35.4,"status":"NORMAL","timestamp":...}` |
| `smart_home/appliance/relay` (retained) | ESP32 -> | `{"state":"ON","source":"MQTT","timestamp":...}` |
| `smart_home/status` (retained, LWT) | ESP32 -> | `{"device":"esp32s3-home-01","online":true,"ip":"...","rssi":-55,"uptime_ms":..., "dht_ok":true}` |
| `smart_home/command/relay` | -> ESP32 | `{"state":"ON"}`. Plain `ON` / `OFF` also accepted |

`timestamp` = ESP32 uptime in ms. `epoch` = Unix seconds once NTP syncs (0 before). The backend stores its own receive time.
`reason` values: `DOOR_OPEN`, `MOTION_DETECTED`, `DOOR_AND_MOTION`, `NONE`.
Relay `source` values: `MQTT`, `OVERLOAD_PROTECTION`, `OVERLOAD_LOCKOUT`, `INVALID_COMMAND_IGNORED`, `BOOT`.

### REST API (backend)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/status` | Backend / MQTT / ESP32 health |
| GET | `/api/sensors/latest` | Latest security, environment, energy, relay |
| GET | `/api/sensors/history?minutes=60&limit=1000` | Stored readings |
| GET | `/api/energy/history?minutes=60` | Energy series + unit/label |
| GET | `/api/security/events?limit=20` | Alert log |
| GET | `/api/relay/events?limit=20` | Relay log |
| POST | `/api/relay` body `{"state":"ON"}` | Relay command |
| POST | `/api/relay/on`, `/api/relay/off` | Shortcuts |

## H. Folder structure
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
**Database tables:** `sensor_readings(id, timestamp, temperature, humidity, light, energy, door, motion, relay_state)`,
`security_events(id, timestamp, event_type, door_status, motion_status)`, `relay_events(id, timestamp, state, source)`.

## I-L. Code
* Firmware: `firmware/smart_home.ino`
* Backend: `backend/server.js`, `config.js`, `mqtt.js`, `routes/api.js`
* Database: `backend/database.js`
* Dashboard: `dashboard/index.html`, `style.css`, `app.js`

## M. Installation
Requirements: **Node.js 22.13 or newer** (24 LTS recommended; SQLite is built in, no compiler needed), Arduino IDE 2.x.
```bash
cd smart-home-iot
cp .env.example .env            # Windows: copy .env.example .env
cd backend
npm install
npm start
```
Open **http://localhost:3000**. You will see an `ExperimentalWarning: SQLite`. That is normal.

**Arduino IDE**
1. Boards Manager -> install **esp32 by Espressif Systems** (3.x recommended).
2. Library Manager -> install **PubSubClient** (Nick O'Leary), **DHT sensor library** (Adafruit), **Adafruit Unified Sensor**.
3. Tools: Board = **ESP32S3 Dev Module**. If Serial Monitor is blank and you use the native USB port, set **USB CDC On Boot = Enabled**. Keep Serial Monitor at 115200 baud.

## N. Configuration
| Where | What |
|---|---|
| `firmware/smart_home.ino`, section "USER CONFIGURATION" | `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_BROKER`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_USE_TLS`, `DEVICE_ID`, `TOPIC_ROOT`, `RELAY_ACTIVE_HIGH`, `BUZZER_ACTIVE_HIGH`, `DOOR_OPEN_LEVEL`, `ENERGY_SENSOR_MODE` |
| `.env` (project root) | `MQTT_BROKER`, `MQTT_PORT`, `MQTT_PROTOCOL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPIC_ROOT`, `PORT`, `DEVICE_ID`, `DB_PATH`, retention/interval settings |

Never commit real Wi-Fi/MQTT passwords. Add `.env` to `.gitignore`.
`MQTT_USE_TLS=true` uses `setInsecure()` (encrypted but not verifying the server): for production add the broker CA with `setCACert()`.

## O. Testing without hardware
1. Start the backend (`npm start`) and open the dashboard.
2. In a second terminal: `cd backend && npm run simulate`. It behaves like the ESP32 (same topics and payloads).
3. Type in the simulator terminal: `d` toggle door, `m` toggle motion, `e 3700` energy overload, `e 1000` normal, `l 300` light, `t 31` temperature, `q` quit.
4. Click **Turn ON / Turn OFF** on the dashboard: the simulator prints `relay -> ON`.
5. Raw MQTT test with any client (MQTTX, `mosquitto_pub`):
```bash
mosquitto_pub -h broker.hivemq.com -t smart_home/command/relay -m '{"state":"ON"}'
mosquitto_pub -h broker.hivemq.com -t smart_home/security/alert -m '{"door":"OPEN","motion":false,"alert":true,"buzzer":true,"reason":"DOOR_OPEN"}'
```
6. REST test: `curl http://localhost:3000/api/sensors/latest` and `curl -X POST http://localhost:3000/api/relay/on`.

**Cirkit Designer.** Wire exactly as in sections D/E (use a slide switch/button to GND for the reed switch, a potentiometer for GPIO 6),
paste `smart_home.ino` and run. Check in your Cirkit version whether it supports Wi-Fi/MQTT for ESP32-S3. If it does not, it can still verify
the sensor logic, buzzer, relay and Serial output; use the simulator above for the MQTT/dashboard part.

## P. Testing with hardware
1. Wire on a breadboard per `diagrams/circuit-diagram.md` (USB-powered, low-voltage load only).
2. Fill in Wi-Fi and broker settings, select **ESP32S3 Dev Module**, upload, open Serial Monitor (115200).
3. Expected: `SMART HOME SYSTEM STARTED` -> `Connecting to WiFi...` -> `WiFi connected` + IP -> `MQTT: CONNECTED` -> report every 2 s.
4. Wait 30 s for the PIR warm-up (PIR is ignored until then; the door sensor works immediately).
5. Start the backend with the same broker and topic root. The dashboard should show ESP32 **ONLINE**.

### Moving from simulation to real hardware
1. Keep the same GPIOs (after verifying them on your board).
2. Replace the potentiometer with the real sensor (see circuit doc), set `ENERGY_SENSOR_MODE 1`, set divider/zero/sensitivity/threshold constants, and **calibrate against a multimeter**.
3. Use a normally-closed reed switch or flip `DOOR_OPEN_LEVEL`.
4. Match `RELAY_ACTIVE_HIGH` to the relay module (many are active LOW).
5. Move to your own private broker (username/password, TLS) and a unique topic root.
6. Power the PIR from 5 V; make sure all grounds are common.

## Q. Troubleshooting
| Symptom | Fix |
|---|---|
| No Serial output | Set USB CDC On Boot = Enabled (native USB port) or use the UART port; baud 115200 |
| Compile error `DHT.h` / `PubSubClient.h` not found | Install the three libraries (section M) |
| Stuck on "Connecting to WiFi..." | Wrong SSID/password; ESP32 supports 2.4 GHz only |
| `MQTT: connect failed, rc=-2` | Broker unreachable (host/port/firewall). `rc=5` = wrong username/password |
| Dashboard shows ESP32 OFFLINE | Topic root differs between firmware and `.env`; or different broker |
| Dashboard says "Backend unreachable" | Backend not running, or open the page via `http://localhost:3000` |
| `node:sqlite` error | Upgrade to Node 22.13+ |
| Temperature shows `—` / "sensor error" | Check DHT wiring/pull-up. Firmware keeps the last valid reading and sets `valid:false` |
| Alert triggers constantly | Door polarity wrong (section "Door switch polarity") or PIR still warming up / near a heat source |
| Relay inverted | Toggle `RELAY_ACTIVE_HIGH` |
| Relay ON command ignored, source `OVERLOAD_LOCKOUT` | Energy value above overload threshold. Lower it (turn potentiometer down) |
| Random ADC values | Common ground missing; keep analog wires short |

## R. B.Tech demo flow
1. Show architecture diagram and wiring (2 min).
2. Power on: show Serial Monitor connecting to Wi-Fi and MQTT; dashboard turns ESP32 **ONLINE**, status **SAFE**.
3. **Environment:** warm the DHT11 with your hand (temperature rises); cover the LDR (light drops). Show the live chart.
4. **Security:** open the door switch -> buzzer sounds, red banner, event appears in "Recent security alerts". Close it -> SAFE after ~3 s. Wave a hand at PIR -> motion alert.
5. **Appliance:** press **Turn ON** on the dashboard -> relay clicks, load runs. Press **Turn OFF**.
6. **Energy:** turn the potentiometer up: value and bar rise; status HIGH, then OVERLOAD -> relay is cut automatically and a remote ON is refused.
7. **Resilience:** stop the broker/disconnect Wi-Fi: buzzer/relay logic keeps working locally; reconnect and show automatic recovery.
8. Show the database/history (`/api/sensors/history`) and the MQTT topic table.

## Explanations
**Data flow.** Each sensor is sampled locally; the ESP32 turns readings into JSON and publishes them to the broker. The backend is subscribed, keeps the latest state in memory,
stores one snapshot row every 5 s, logs alert/relay transitions as events, and serves it all over REST. The dashboard polls REST every 2 s (live), 5 s (events), 15 s (charts).
A relay click becomes `POST /api/relay` -> backend publishes `command/relay` -> ESP32 switches the relay and publishes the confirmed state -> dashboard updates.

**Security logic.** `alert = (PIR == HIGH) OR (door == OPEN/LOW)`. Evaluated on every loop pass in the firmware, so it works with no Wi-Fi or MQTT.
On alert: buzzer ON immediately, alert/door/motion published, serial message printed. When both inputs clear, the alert stays for 3 s (`ALERT_HOLD_MS`) so a short PIR pulse is noticeable, then buzzer OFF and status SAFE.
The door is debounced (50 ms); the PIR is ignored during its 30 s warm-up.

**Energy management logic.** GPIO 6 is averaged over 16 samples and classified `NORMAL` / `HIGH` / `OVERLOAD` using thresholds (demo values 2800 and 3600 of 4095).
On OVERLOAD the firmware switches the relay OFF itself and refuses remote ON until the value falls below 90 % of the threshold (hysteresis). In simulation the value is raw ADC counts and **not** amps, watts or money.
In real mode (`ENERGY_SENSOR_MODE 1`) the value is amps computed from a calibrated sensor; power/cost would additionally need a voltage measurement and are intentionally not computed.

**Error handling.** Wi-Fi: retried every 10 s without blocking. MQTT: retried every 5 s, publishing skipped while offline. DHT11: NaN/out-of-range readings are discarded, last valid value kept,
`valid:false` after 3 failures. Invalid relay commands are ignored and reported. Relay and buzzer are forced OFF at boot, before anything else runs.

## S. Future improvements
Authentication on REST endpoints, HTTPS and a private TLS broker with CA verification, WebSocket/SSE instead of polling, push/email/Telegram alerts,
real power and cost estimation (voltage sensor + RMS), scheduled appliance control, OTA firmware updates, multiple devices, and CSV export.
