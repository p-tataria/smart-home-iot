# Project context for the coding agent

Read this whole file first, then do the tasks in section 9. The project folder is the one containing this file.

## 1. What this is
B.Tech final-year project: **IoT-Based Smart Home Security and Energy Management System** (2 students).
ESP32 firmware (Arduino) -> MQTT broker -> Node.js backend (Express + MQTT.js + SQLite) -> web dashboard.
Dashboard can also send relay ON/OFF back down to the ESP32 over MQTT.

The owner develops on **Windows** (paths like `C:\smart-home\smart-home-iot`). Commands below are given for Windows `cmd`; adapt if your shell differs.

## 2. Current status (be honest about what is verified)
| Area | Status |
|---|---|
| Backend (Express, MQTT, SQLite, REST) | Tested end to end against a local MQTT broker with the simulator. Works. |
| Dashboard (`dashboard/`) | Working in the owner's browser (screenshot confirmed live data, charts, relay card). A duplicate-ID bug (`id="energy"`) was already fixed: the value span is `energyValue`. |
| Simulator (`backend/tools/simulator.js`) | Works. Fake ESP32 publishing the same topics/payloads as the firmware. |
| Firmware (`firmware/smart_home.ino`) | **Written but never compiled or flashed.** Compiling it is task #1 for you. |
| Hardware wiring | Owner is building it on a breadboard now. You cannot do this. |

## 3. Hardware facts (IMPORTANT)
The owner's board is a **classic ESP32 DevKit (ESP-WROOM-32, 30-pin)**, NOT an ESP32-S3.
The firmware supports both through `#define BOARD_TARGET` (1 = classic ESP32, 0 = ESP32-S3). It is set to **1**.

Classic ESP32 pin map (BOARD_TARGET 1):
| Function | GPIO | Notes |
|---|---|---|
| DHT11 DATA | 4 | |
| LDR divider (analog) | 34 | ADC1, input-only |
| Energy input (potentiometer; future current sensor) | 35 | ADC1, input-only |
| PIR OUT | 27 | PIR VCC on VIN (5 V) |
| Door reed switch | 26 | `INPUT_PULLUP`; other leg to GND |
| Relay IN | 25 | relay VCC on VIN (5 V) |
| Buzzer (+) | 33 | active buzzer |

Rules behind the map: GPIO 6-11 are flash pins on classic ESP32 (never use); analog reads must be ADC1 (GPIO 32-39) because ADC2 breaks with Wi-Fi; GPIO 34-39 have no internal pull-up; avoid strapping pins 0, 2, 12, 15.
(S3 map, BOARD_TARGET 0: DHT 4, LDR 5, energy 6, PIR 7, door 8, relay 9, buzzer 10.)

Arduino build target: classic = FQBN `esp32:esp32:esp32` ("ESP32 Dev Module"); S3 = `esp32:esp32:esp32s3`.

## 4. Hard constraints (do not violate)
- **No LEDs of any kind.** The only indicator is the buzzer.
- **Never involve mains AC.** Relay switches a low-voltage test load only. Do not write mains wiring instructions.
- The energy value from the potentiometer is **not** real power. Always label it "Simulated Energy/Current Value". Do not compute watts, kWh or cost from it.
- Relay and buzzer must be **OFF at boot**. Security logic (PIR HIGH **or** door open => alert + buzzer) must run locally on the ESP32 even with no Wi-Fi/MQTT.
- Never commit or hard-code real Wi-Fi/MQTT credentials. `.env` is git-ignored. Do not ask the owner to paste passwords into chat logs or files you create.
- Topic names must stay identical across firmware, backend (`backend/config.js`) and dashboard (the dashboard only uses REST). REST paths must match between backend and dashboard.
- Keep the stack simple (student project): Node.js, Express, MQTT.js, SQLite, plain HTML/CSS/JS dashboard.

## 5. Repository layout
```
smart-home-iot/
├── firmware/smart_home.ino        Arduino sketch (see Arduino note below)
├── backend/
│   ├── package.json               deps: express, mqtt, cors, dotenv  (scripts: start, simulate)
│   ├── server.js                  Express app, serves ../dashboard statically
│   ├── config.js                  loads ../.env, defines topic names
│   ├── database.js                node:sqlite tables + queries
│   ├── mqtt.js                    subscriber/publisher + in-memory latest state
│   ├── routes/api.js              REST endpoints
│   └── tools/simulator.js         fake ESP32 (stdin commands: d, m, e <n>, l <n>, t <C>, q)
├── dashboard/ (index.html, style.css, app.js)   polls REST; Chart.js 4.4.1 from jsDelivr
├── diagrams/ (circuit-diagram.md, system-architecture.md)
├── README.md   .env.example   .gitignore
```
**Arduino note:** Arduino requires the sketch folder name to equal the sketch file name. Either compile from a copy at `.../smart_home/smart_home.ino`, or restructure to `firmware/smart_home/smart_home.ino` (then update README/docs paths).

## 6. Configuration
`.env` lives at the **project root** (copy from `.env.example`). Key values:
```
MQTT_BROKER=broker.hivemq.com   MQTT_PORT=1883   MQTT_PROTOCOL=mqtt
MQTT_USERNAME=  MQTT_PASSWORD=
MQTT_TOPIC_ROOT=smart_home_palp1_demo     # owner uses a unique root because the broker is public
PORT=3000   DEVICE_ID=esp32s3-home-01   DB_PATH=./data/smart_home.db
```
The firmware's `#define TOPIC_ROOT` must equal `MQTT_TOPIC_ROOT`. Firmware user config (Wi-Fi SSID/password, broker, etc.) is the "USER CONFIGURATION" block at the top of `smart_home.ino`; leave placeholders in the repo.

Runtime: **Node.js >= 22.13** (uses built-in `node:sqlite`; an ExperimentalWarning is normal). Dependencies install with `npm install` inside `backend/`. (Do not run `npm install` on network/FUSE-mounted drives: it can fail with EIO.)

## 7. MQTT contract (root = MQTT_TOPIC_ROOT)
| Topic | Dir | Payload |
|---|---|---|
| `<root>/security/door` | ESP->broker | `{"door":"OPEN\|CLOSED","timestamp","epoch"}` |
| `<root>/security/motion` | ESP->broker | `{"motion":true\|false,...}` |
| `<root>/security/alert` | ESP->broker | `{"door","motion","alert","buzzer","reason":"NONE\|DOOR_OPEN\|MOTION_DETECTED\|DOOR_AND_MOTION",...}` |
| `<root>/environment/temperature` | ESP->broker | `{"value":27.5\|null,"unit":"C","valid":true,...}` |
| `<root>/environment/humidity` | ESP->broker | `{"value":60\|null,"unit":"%","valid":true,...}` |
| `<root>/environment/light` | ESP->broker | `{"value":1800,"percent":44.0,"unit":"ADC raw (0-4095)",...}` |
| `<root>/energy/current` | ESP->broker | `{"value","unit","label":"Simulated Energy/Current Value","simulated":true,"percent","status":"NORMAL\|HIGH\|OVERLOAD",...}` |
| `<root>/appliance/relay` (retained) | ESP->broker | `{"state":"ON\|OFF","source":"MQTT\|OVERLOAD_PROTECTION\|OVERLOAD_LOCKOUT\|INVALID_COMMAND_IGNORED\|BOOT",...}` |
| `<root>/status` (retained, LWT) | ESP->broker | `{"device","online","ip","rssi","uptime_ms","dht_ok","overload_lockout","firmware"}` |
| `<root>/command/relay` | backend->ESP | `{"state":"ON\|OFF"}` (plain `ON`/`OFF` also accepted) |

REST (backend, port 3000): `GET /api/status`, `GET /api/sensors/latest`, `GET /api/sensors/history?minutes=&limit=`, `GET /api/energy/history?minutes=`, `GET /api/security/events?limit=`, `GET /api/relay/events?limit=`, `POST /api/relay` (body `{"state":"ON"|"OFF"}`), `POST /api/relay/on`, `POST /api/relay/off`.
DB tables: `sensor_readings`, `security_events`, `relay_events`.

## 8. Firmware behaviour to preserve
- Alert = PIR HIGH or door open (door OPEN level = `DOOR_OPEN_LEVEL`, default LOW). 50 ms door debounce, 30 s PIR warm-up, alert held 3 s after the trigger clears.
- Energy: 16-sample average, NORMAL/HIGH/OVERLOAD thresholds (2800 / 3600 of 4095 in simulation). OVERLOAD forces relay OFF and blocks remote ON until value < 90 % of threshold.
- DHT11: invalid/NaN readings keep the last valid value; `valid:false` after 3 failures.
- Non-blocking Wi-Fi (10 s retry) and MQTT (5 s retry) reconnect with `millis()`; LWT on `<root>/status`.
- `RELAY_ACTIVE_HIGH`, `BUZZER_ACTIVE_HIGH`, `DOOR_OPEN_LEVEL`, `ENERGY_SENSOR_MODE` (0 = potentiometer simulation, 1 = real analog current sensor with calibration constants) are the hardware-dependent switches.

## 9. Your tasks (in order)
1. **Backend run check.** `cd backend && npm install && npm start`. Confirm `[HTTP] dashboard + API on http://localhost:3000`. For an offline test, either run a local broker (e.g. a dev-only `aedes` or Mosquitto on port 1884 and set `MQTT_BROKER=127.0.0.1 MQTT_PORT=1884` via environment variables, without changing the committed `.env.example`) or use the public broker with a unique topic root.
2. **Simulator check.** In a second terminal `npm run simulate`; verify `GET /api/sensors/latest` shows `device_online: true`; trigger events (stdin `d`, `m`, `e 3700`) and confirm `/api/security/events` and relay behaviour (`POST /api/relay/on`; overload lockout).
3. **Dashboard check.** Open http://localhost:3000 in a browser and confirm: no console errors, bottom-left shows "Backend connected", all five sections render, charts draw, relay buttons work. Fix any bug you find (note: this class of bug was missed once because only the API was tested, so actually load the page).
4. **Compile the firmware** with `arduino-cli`:
   ```
   arduino-cli core update-index
   arduino-cli core install esp32:esp32
   arduino-cli lib install "PubSubClient" "DHT sensor library" "Adafruit Unified Sensor"
   arduino-cli compile --fqbn esp32:esp32:esp32 <path-to-smart_home-sketch-folder>
   ```
   Then set `BOARD_TARGET 0` temporarily and compile with `--fqbn esp32:esp32:esp32s3` to confirm both targets build (restore to 1 afterwards). Fix any compile errors/warnings that matter, keeping the behaviour in section 8 and the constraints in section 4.
5. **Report back** with: what you ran, what passed, what you changed (file + reason), and anything still unverified.

## 10. Things you must NOT do without asking the owner
- Flash the board (needs the owner's COM port, Wi-Fi credentials and a connected board). If asked to flash, give the exact `arduino-cli upload` command and let the owner enter credentials locally.
- Change pin assignments, topic names, REST paths or DB column names (they are cross-referenced in several files).
- Add LEDs, extra components, or mains-related instructions.
- Replace SQLite/Express/MQTT.js with other stacks.

## 11. Acceptance checklist
- [ ] `npm start` runs; `/api/status` returns JSON.
- [ ] Simulator drives the dashboard: ONLINE, live values, door/motion alerts, overload cut-off, relay ON/OFF round trip.
- [ ] Dashboard loads with no console errors; no duplicate element IDs.
- [ ] Firmware compiles for `esp32:esp32:esp32` (BOARD_TARGET 1) and for `esp32:esp32:esp32s3` (BOARD_TARGET 0).
- [ ] No secrets committed; topic names consistent across firmware/backend.

## 12. Known gotchas
- Windows PowerShell `Set-Content` can re-encode files; the owner once saw `ΓÇö` for an em dash in console output. Keep files UTF-8 and use the editor, not shell rewrites, for edits.
- If the real ESP32 and the simulator run at the same time they publish to the same topics and mix data: run only one.
- Public MQTT brokers are readable by everyone: keep a unique topic root.
- If the owner's reed switch is a plain normally-open type, `DOOR_OPEN_LEVEL` must be `HIGH` (magnet near = closed contact = LOW = door closed).
