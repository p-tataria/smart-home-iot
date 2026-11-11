/*
 * ============================================================================
 *  IoT-Based Smart Home Security and Energy Management System
 *  File    : smart_home.ino        Version : 1.0.0
 *  Board   : ESP32 Dev Module (classic ESP32 DevKit) or ESP32S3 Dev Module (see BOARD_TARGET)
 *
 *  Libraries to install (Library Manager):
 *    - PubSubClient            by Nick O'Leary
 *    - DHT sensor library      by Adafruit
 *    - Adafruit Unified Sensor by Adafruit   (required by the DHT library)
 *  WiFi / WiFiClientSecure / time.h come with the ESP32 Arduino core.
 *
 *  Arduino IDE settings: see README section P.
 *    (Tools > USB CDC On Boot > Enabled if you use the native USB port for Serial)
 *
 *  !! VERIFY GPIO 4-10 AGAINST YOUR EXACT ESP32-S3 BOARD'S PINOUT BEFORE WIRING !!
 *  !! NEVER CONNECT MAINS AC TO THE ESP32. Relay drives a LOW-VOLTAGE test load. !!
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <time.h>

// ============================================================================
//  USER CONFIGURATION  (EDIT THIS SECTION)
// ============================================================================
static const char*    WIFI_SSID      = "YOUR_WIFI_NAME";       // <-- CHANGE
static const char*    WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";   // <-- CHANGE

static const char*    MQTT_BROKER    = "broker.hivemq.com";    // any broker (test or private)
static const uint16_t MQTT_PORT      = 1883;                   // 1883 plain, 8883 TLS
static const char*    MQTT_USERNAME  = "";                     // leave "" if broker has no auth
static const char*    MQTT_PASSWORD  = "";
static const bool     MQTT_USE_TLS   = false;                  // true for port 8883 (see note below)

static const char*    DEVICE_ID      = "esp32s3-home-01";

// Topic root. MUST match MQTT_TOPIC_ROOT in the backend .env.
// On a PUBLIC broker anyone can read/write your topics: use a unique root,
// e.g. "smart_home_btech_ab12".
#define TOPIC_ROOT "smart_home"

// Hardware polarity
static const bool RELAY_ACTIVE_HIGH  = true;   // false for "active LOW" relay modules
static const bool BUZZER_ACTIVE_HIGH = true;   // active buzzer, HIGH = sound
static const int  DOOR_OPEN_LEVEL    = LOW;    // spec: door OPEN == LOW (INPUT_PULLUP)

// Energy sensor mode
//   0 = SIMULATION: potentiometer on GPIO6 (NOT a real energy sensor)
//   1 = REAL analog current sensor on GPIO6 (set the calibration values below)
#define ENERGY_SENSOR_MODE 0

// ============================================================================
//  GPIO MAP  (selected by BOARD_TARGET below)
// ============================================================================
// BOARD_TARGET: 1 = classic ESP32 DevKit (ESP-WROOM-32, 30-pin)  <-- your board
//               0 = ESP32-S3 Dev Module
#define BOARD_TARGET 1

#if BOARD_TARGET == 1
  // Classic ESP32 DevKit. GPIO 6-11 are flash pins and must NOT be used.
  // Analog inputs use ADC1 only (GPIO 32-39): ADC2 does not work while Wi-Fi is on.
  // GPIO 34/35 are input-only (fine for LDR / potentiometer).
  static const uint8_t PIN_DHT    = 4;
  static const uint8_t PIN_LDR    = 34;
  static const uint8_t PIN_ENERGY = 35;
  static const uint8_t PIN_PIR    = 27;
  static const uint8_t PIN_DOOR   = 26;   // needs INPUT_PULLUP, so not GPIO 34-39
  static const uint8_t PIN_RELAY  = 25;
  static const uint8_t PIN_BUZZER = 33;
#else
  static const uint8_t PIN_DHT    = 4;
  static const uint8_t PIN_LDR    = 5;
  static const uint8_t PIN_ENERGY = 6;
  static const uint8_t PIN_PIR    = 7;
  static const uint8_t PIN_DOOR   = 8;
  static const uint8_t PIN_RELAY  = 9;
  static const uint8_t PIN_BUZZER = 10;
#endif

// ============================================================================
//  TOPICS  (identical names are used in backend/config.js)
// ============================================================================
#define TOPIC_DOOR        TOPIC_ROOT "/security/door"
#define TOPIC_MOTION      TOPIC_ROOT "/security/motion"
#define TOPIC_ALERT       TOPIC_ROOT "/security/alert"
#define TOPIC_TEMP        TOPIC_ROOT "/environment/temperature"
#define TOPIC_HUM         TOPIC_ROOT "/environment/humidity"
#define TOPIC_LIGHT       TOPIC_ROOT "/environment/light"
#define TOPIC_ENERGY      TOPIC_ROOT "/energy/current"
#define TOPIC_RELAY       TOPIC_ROOT "/appliance/relay"
#define TOPIC_STATUS      TOPIC_ROOT "/status"
#define TOPIC_CMD_RELAY   TOPIC_ROOT "/command/relay"

// ============================================================================
//  ENERGY SENSOR CONFIG
// ============================================================================
#if ENERGY_SENSOR_MODE == 0
  // Simulation: value is the raw 12-bit ADC reading (0..4095). Demo thresholds only.
  static const char* ENERGY_UNIT               = "ADC raw (0-4095)";
  static const char* ENERGY_LABEL              = "Simulated Energy/Current Value";
  static const bool  ENERGY_IS_SIMULATED       = true;
  static const float ENERGY_FULL_SCALE         = 4095.0f;
  static const float ENERGY_HIGH_THRESHOLD     = 2800.0f;
  static const float ENERGY_OVERLOAD_THRESHOLD = 3600.0f;
#else
  // Real analog current sensor (e.g. ACS712 module on a LOW-VOLTAGE DC load).
  // The ESP32 ADC input must NEVER exceed 3.3 V: scale 5 V sensors with a divider
  // and enter that divider's ratio below. CALIBRATE with a multimeter.
  // For AC loads a proper RMS routine and an isolated sensor (e.g. ZMCT103C/SCT-013
  // with burden + bias circuit) are required: choose the sensor for your load.
  static const char* ENERGY_UNIT               = "A";
  static const char* ENERGY_LABEL              = "Measured Current";
  static const bool  ENERGY_IS_SIMULATED       = false;
  static const float SENSOR_DIVIDER_RATIO      = 1.5f;     // (R1+R2)/R2, e.g. 10k+20k/20k
  static const float SENSOR_ZERO_MV            = 2500.0f;  // sensor output at 0 A (before divider)
  static const float SENSOR_MV_PER_AMP         = 185.0f;   // ACS712-05B = 185 mV/A
  static const float ENERGY_FULL_SCALE         = 5.0f;     // amps shown as 100 % on the bar
  static const float ENERGY_HIGH_THRESHOLD     = 1.5f;     // amps
  static const float ENERGY_OVERLOAD_THRESHOLD = 2.0f;     // amps: relay is cut above this
#endif

// ============================================================================
//  TIMING / BEHAVIOUR
// ============================================================================
static const uint32_t PIR_WARMUP_MS      = 30000;  // PIR needs ~30-60 s to settle after power-up
static const uint32_t DOOR_DEBOUNCE_MS   = 50;
static const uint32_t ALERT_HOLD_MS      = 3000;   // alert/buzzer stays on this long after trigger ends
static const uint32_t SENSOR_READ_MS     = 500;    // LDR + energy sampling
static const uint32_t DHT_READ_MS        = 3000;   // DHT11 minimum is ~1 s
static const uint32_t PUBLISH_MS         = 3000;   // periodic telemetry
static const uint32_t STATUS_MS          = 15000;  // device heartbeat
static const uint32_t SERIAL_PRINT_MS    = 2000;
static const uint32_t WIFI_RETRY_MS      = 10000;
static const uint32_t MQTT_RETRY_MS      = 5000;

static const char* FIRMWARE_VERSION = "1.0.0";

// ============================================================================
//  GLOBALS
// ============================================================================
WiFiClient       plainClient;
WiFiClientSecure secureClient;
PubSubClient     mqtt;
DHT              dht(PIN_DHT, DHT11);

// security
int      doorRaw = HIGH, doorStable = HIGH;
uint32_t doorLastChange = 0;
bool     pirActive = false, doorOpen = false, alertActive = false, buzzerOn = false;
const char* alertReason = "NONE";
uint32_t lastTriggerMs = 0;
bool     securityDirty = true;

// environment
float temperatureC = NAN, humidityPct = NAN;
bool  haveDht = false, dhtOk = false;
uint8_t dhtFails = 0;
int   ldrRaw = 0;
float ldrPercent = 0;

// energy
float energyValue = 0, energyPercent = 0;
bool  energyOverload = false;
const char* energyStatus = "NORMAL";

// relay
bool relayOn = false;
const char* relaySource = "BOOT";

// connectivity
bool wifiWasConnected = false, mqttWasConnected = false;
bool wifiFirstAttempt = true, mqttFirstAttempt = true;
uint32_t lastWifiAttempt = 0, lastMqttAttempt = 0;

// timers
uint32_t tSensor = 0, tDht = 0, tPublish = 0, tStatus = 0, tSerial = 0;

// ============================================================================
//  HELPERS
// ============================================================================
uint32_t epochNow() {
  time_t t = time(nullptr);
  return (t > 1700000000) ? (uint32_t)t : 0;   // 0 = clock not synced yet
}

void fmtFloatOrNull(char* out, size_t n, float v, int decimals) {
  if (isnan(v)) snprintf(out, n, "null");
  else          snprintf(out, n, "%.*f", decimals, v);
}

int readAveraged(uint8_t pin, int samples) {
  uint32_t sum = 0;
  for (int i = 0; i < samples; i++) sum += analogRead(pin);
  return (int)(sum / samples);
}

void publishJson(const char* topic, const char* json, bool retain = false) {
  if (!mqtt.connected()) return;               // local logic never depends on MQTT
  if (!mqtt.publish(topic, json, retain)) {
    Serial.printf("MQTT publish failed: %s\n", topic);
  }
}

// ============================================================================
//  OUTPUTS
// ============================================================================
void setBuzzer(bool on) {
  buzzerOn = on;
  digitalWrite(PIN_BUZZER, (on == BUZZER_ACTIVE_HIGH) ? HIGH : LOW);
}

void publishRelay() {
  char buf[160];
  snprintf(buf, sizeof(buf),
           "{\"state\":\"%s\",\"source\":\"%s\",\"timestamp\":%lu,\"epoch\":%lu}",
           relayOn ? "ON" : "OFF", relaySource,
           (unsigned long)millis(), (unsigned long)epochNow());
  publishJson(TOPIC_RELAY, buf, true);         // retained: dashboard sees last state
}

void setRelay(bool on, const char* source) {
  relayOn = on;
  relaySource = source;
  digitalWrite(PIN_RELAY, (on == RELAY_ACTIVE_HIGH) ? HIGH : LOW);
  Serial.printf("RELAY: %s (source: %s)\n", on ? "ON" : "OFF", source);
  publishRelay();
}

// ============================================================================
//  RELAY COMMAND PARSER   accepts:  ON | OFF | "ON" | {"state":"ON"}  (case-insens.)
// ============================================================================
bool parseRelayCommand(const char* s, bool& on) {
  char tok[16] = {0};
  const char* p = s;
  while (*p == ' ' || *p == '\r' || *p == '\n' || *p == '\t') p++;

  if (*p == '{') {
    const char* k = strstr(p, "\"state\"");
    if (!k) return false;
    k = strchr(k + 7, ':');
    if (!k) return false;
    k = strchr(k, '"');
    if (!k) return false;
    k++;
    const char* e = strchr(k, '"');
    if (!e || (size_t)(e - k) >= sizeof(tok)) return false;
    memcpy(tok, k, e - k);
  } else {
    size_t i = 0;
    while (*p && i < sizeof(tok) - 1 && *p != ' ' && *p != '\r' && *p != '\n' && *p != '"') tok[i++] = *p++;
  }
  if (strcasecmp(tok, "ON") == 0)  { on = true;  return true; }
  if (strcasecmp(tok, "OFF") == 0) { on = false; return true; }
  return false;
}

void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  if (strcmp(topic, TOPIC_CMD_RELAY) != 0) return;
  char buf[128];
  unsigned int n = (len < sizeof(buf) - 1) ? len : sizeof(buf) - 1;
  memcpy(buf, payload, n);
  buf[n] = 0;
  Serial.printf("MQTT command received: %s\n", buf);

  bool on;
  if (!parseRelayCommand(buf, on)) {
    Serial.println("Relay command REJECTED (not ON/OFF)");
    relaySource = "INVALID_COMMAND_IGNORED";
    publishRelay();
    return;
  }
  if (on && energyOverload) {
    Serial.println("Relay ON REJECTED: energy overload lockout active");
    setRelay(false, "OVERLOAD_LOCKOUT");
    return;
  }
  setRelay(on, "MQTT");
}

// ============================================================================
//  PUBLISHERS
// ============================================================================
void publishSecurity() {
  char buf[256];
  unsigned long ms = millis(), ep = epochNow();

  snprintf(buf, sizeof(buf), "{\"door\":\"%s\",\"timestamp\":%lu,\"epoch\":%lu}",
           doorOpen ? "OPEN" : "CLOSED", ms, ep);
  publishJson(TOPIC_DOOR, buf);

  snprintf(buf, sizeof(buf), "{\"motion\":%s,\"timestamp\":%lu,\"epoch\":%lu}",
           pirActive ? "true" : "false", ms, ep);
  publishJson(TOPIC_MOTION, buf);

  snprintf(buf, sizeof(buf),
           "{\"door\":\"%s\",\"motion\":%s,\"alert\":%s,\"buzzer\":%s,\"reason\":\"%s\","
           "\"timestamp\":%lu,\"epoch\":%lu}",
           doorOpen ? "OPEN" : "CLOSED", pirActive ? "true" : "false",
           alertActive ? "true" : "false", buzzerOn ? "true" : "false",
           alertReason, ms, ep);
  publishJson(TOPIC_ALERT, buf);
  securityDirty = false;
}

void publishEnvironment() {
  char buf[200], v[16];
  unsigned long ms = millis(), ep = epochNow();

  fmtFloatOrNull(v, sizeof(v), temperatureC, 1);
  snprintf(buf, sizeof(buf),
           "{\"value\":%s,\"unit\":\"C\",\"valid\":%s,\"timestamp\":%lu,\"epoch\":%lu}",
           v, dhtOk ? "true" : "false", ms, ep);
  publishJson(TOPIC_TEMP, buf);

  fmtFloatOrNull(v, sizeof(v), humidityPct, 0);
  snprintf(buf, sizeof(buf),
           "{\"value\":%s,\"unit\":\"%%\",\"valid\":%s,\"timestamp\":%lu,\"epoch\":%lu}",
           v, dhtOk ? "true" : "false", ms, ep);
  publishJson(TOPIC_HUM, buf);

  snprintf(buf, sizeof(buf),
           "{\"value\":%d,\"percent\":%.1f,\"unit\":\"ADC raw (0-4095)\",\"timestamp\":%lu,\"epoch\":%lu}",
           ldrRaw, ldrPercent, ms, ep);
  publishJson(TOPIC_LIGHT, buf);
}

void publishEnergy() {
  char buf[320];
  snprintf(buf, sizeof(buf),
           "{\"value\":%.2f,\"unit\":\"%s\",\"label\":\"%s\",\"simulated\":%s,\"percent\":%.1f,"
           "\"status\":\"%s\",\"timestamp\":%lu,\"epoch\":%lu}",
           energyValue, ENERGY_UNIT, ENERGY_LABEL, ENERGY_IS_SIMULATED ? "true" : "false",
           energyPercent, energyStatus, (unsigned long)millis(), (unsigned long)epochNow());
  publishJson(TOPIC_ENERGY, buf);
}

void publishStatus(bool online) {
  char buf[320];
  snprintf(buf, sizeof(buf),
           "{\"device\":\"%s\",\"online\":%s,\"ip\":\"%s\",\"rssi\":%d,\"uptime_ms\":%lu,"
           "\"dht_ok\":%s,\"overload_lockout\":%s,\"firmware\":\"%s\"}",
           DEVICE_ID, online ? "true" : "false", WiFi.localIP().toString().c_str(),
           WiFi.RSSI(), (unsigned long)millis(), dhtOk ? "true" : "false",
           energyOverload ? "true" : "false", FIRMWARE_VERSION);
  publishJson(TOPIC_STATUS, buf, true);
}

void publishAll() {
  publishStatus(true);
  publishSecurity();
  publishEnvironment();
  publishEnergy();
  publishRelay();
}

// ============================================================================
//  SENSOR LOGIC
// ============================================================================
void evaluateSecurity(uint32_t now) {
  // PIR (ignored during warm-up)
  bool newPir = (digitalRead(PIN_PIR) == HIGH) && (now >= PIR_WARMUP_MS);

  // Door with debounce
  int raw = digitalRead(PIN_DOOR);
  if (raw != doorRaw) { doorRaw = raw; doorLastChange = now; }
  if (now - doorLastChange >= DOOR_DEBOUNCE_MS) doorStable = doorRaw;
  bool newDoorOpen = (doorStable == DOOR_OPEN_LEVEL);

  if (newPir != pirActive || newDoorOpen != doorOpen) {
    pirActive = newPir;
    doorOpen = newDoorOpen;
    securityDirty = true;
  }

  bool trigger = pirActive || doorOpen;           // ALERT = PIR HIGH OR DOOR LOW
  if (trigger) {
    lastTriggerMs = now;
    const char* reason = (doorOpen && pirActive) ? "DOOR_AND_MOTION"
                       : doorOpen ? "DOOR_OPEN" : "MOTION_DETECTED";
    if (strcmp(reason, alertReason) != 0) securityDirty = true;
    alertReason = reason;
    if (!alertActive) {
      alertActive = true;
      securityDirty = true;
      setBuzzer(true);
      Serial.println(">>> SECURITY ALERT <<<");
      Serial.println(doorOpen ? "DOOR OPEN" : "DOOR CLOSED");
      if (pirActive) Serial.println("MOTION DETECTED");
      Serial.println("BUZZER: ON");
    }
  } else if (alertActive && (now - lastTriggerMs >= ALERT_HOLD_MS)) {
    alertActive = false;
    alertReason = "NONE";
    setBuzzer(false);
    securityDirty = true;
    Serial.println("SECURITY: SAFE  |  BUZZER: OFF");
  }
}

void readDht() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  bool valid = !isnan(t) && !isnan(h) && t > -5 && t < 60 && h >= 0 && h <= 100;
  if (valid) {
    temperatureC = t; humidityPct = h;
    haveDht = true; dhtOk = true; dhtFails = 0;
  } else {
    if (dhtFails < 255) dhtFails++;
    if (dhtFails >= 3) dhtOk = false;             // keep last valid values, flag the error
    Serial.println("DHT11: read failed (keeping previous valid reading)");
  }
}

float readEnergyValue() {
#if ENERGY_SENSOR_MODE == 0
  return (float)readAveraged(PIN_ENERGY, 16);     // simulation: potentiometer
#else
  uint32_t sum = 0;
  const int N = 32;
  for (int i = 0; i < N; i++) sum += analogReadMilliVolts(PIN_ENERGY);
  float mv = ((float)sum / N) * SENSOR_DIVIDER_RATIO;
  return fabsf(mv - SENSOR_ZERO_MV) / SENSOR_MV_PER_AMP;
#endif
}

void updateEnergy() {
  energyValue = readEnergyValue();
  energyPercent = fminf(100.0f, fmaxf(0.0f, energyValue / ENERGY_FULL_SCALE * 100.0f));

  bool was = energyOverload;
  if (!energyOverload && energyValue >= ENERGY_OVERLOAD_THRESHOLD) energyOverload = true;
  else if (energyOverload && energyValue < ENERGY_OVERLOAD_THRESHOLD * 0.9f) energyOverload = false;  // hysteresis

  energyStatus = energyOverload ? "OVERLOAD" : (energyValue >= ENERGY_HIGH_THRESHOLD ? "HIGH" : "NORMAL");

  if (energyOverload && !was) {
    Serial.println("ENERGY OVERLOAD: cutting relay");
    if (relayOn) setRelay(false, "OVERLOAD_PROTECTION");
    publishEnergy();
  }
}

void readLdr() {
  ldrRaw = readAveraged(PIN_LDR, 16);
  ldrPercent = ldrRaw / 4095.0f * 100.0f;
}

// ============================================================================
//  CONNECTIVITY (non-blocking)
// ============================================================================
void maintainWiFi(uint32_t now) {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      Serial.println("WiFi connected");
      Serial.print("IP address: ");
      Serial.println(WiFi.localIP());
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");   // optional real timestamps
    }
    return;
  }
  if (wifiWasConnected) {
    wifiWasConnected = false;
    Serial.println("WiFi: DISCONNECTED");
  }
  if (wifiFirstAttempt || now - lastWifiAttempt >= WIFI_RETRY_MS) {
    wifiFirstAttempt = false;
    lastWifiAttempt = now;
    Serial.println("Connecting to WiFi...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

void maintainMqtt(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqtt.connected()) { mqttWasConnected = true; return; }

  if (mqttWasConnected) {
    mqttWasConnected = false;
    Serial.println("MQTT: DISCONNECTED");
  }
  if (!mqttFirstAttempt && now - lastMqttAttempt < MQTT_RETRY_MS) return;
  mqttFirstAttempt = false;
  lastMqttAttempt = now;

  String clientId = String(DEVICE_ID) + "-" + String((uint32_t)(ESP.getEfuseMac() & 0xFFFFFF), HEX);
  char will[96];
  snprintf(will, sizeof(will), "{\"device\":\"%s\",\"online\":false}", DEVICE_ID);

  Serial.printf("Connecting to MQTT %s:%u ...\n", MQTT_BROKER, MQTT_PORT);
  bool ok = mqtt.connect(clientId.c_str(),
                         strlen(MQTT_USERNAME) ? MQTT_USERNAME : NULL,
                         strlen(MQTT_USERNAME) ? MQTT_PASSWORD : NULL,
                         TOPIC_STATUS, 1, true, will, true);
  if (ok) {
    mqttWasConnected = true;
    Serial.println("MQTT: CONNECTED");
    mqtt.subscribe(TOPIC_CMD_RELAY, 1);
    publishAll();
    tPublish = tStatus = now;
  } else {
    Serial.printf("MQTT: connect failed, rc=%d (retry in %lu s)\n", mqtt.state(), MQTT_RETRY_MS / 1000);
  }
}

// ============================================================================
//  SERIAL REPORT
// ============================================================================
void printReport() {
  Serial.println();
  Serial.printf("WiFi: %s\n", WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DISCONNECTED");
  Serial.printf("MQTT: %s\n", mqtt.connected() ? "CONNECTED" : "DISCONNECTED");
  Serial.printf("PIR: %d\n", pirActive ? 1 : 0);
  Serial.printf("DOOR: %s\n", doorOpen ? "OPEN" : "CLOSED");
  if (haveDht) {
    Serial.printf("TEMPERATURE: %.1f C%s\n", temperatureC, dhtOk ? "" : "  (SENSOR ERROR, last valid)");
    Serial.printf("HUMIDITY: %.0f %%\n", humidityPct);
  } else {
    Serial.println("TEMPERATURE: -- (no valid DHT11 reading yet)");
    Serial.println("HUMIDITY: --");
  }
  Serial.printf("LIGHT: %d\n", ldrRaw);
  Serial.printf("ENERGY: %.1f %s [%s] (%s)\n", energyValue, ENERGY_UNIT, energyStatus, ENERGY_LABEL);
  Serial.printf("RELAY: %s\n", relayOn ? "ON" : "OFF");
  Serial.printf("SECURITY: %s\n", alertActive ? "ALERT" : "SAFE");
}

// ============================================================================
//  SETUP / LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(300);

  // Outputs first, in a SAFE state: relay OFF, buzzer OFF
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, RELAY_ACTIVE_HIGH ? LOW : HIGH);
  relayOn = false;
  pinMode(PIN_BUZZER, OUTPUT);
  setBuzzer(false);

  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_DOOR, INPUT_PULLUP);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);                 // ~0..3.1 V input range
  dht.begin();

  doorRaw = doorStable = digitalRead(PIN_DOOR);
  doorLastChange = millis();

  Serial.println();
  Serial.println("SMART HOME SYSTEM STARTED");
  Serial.printf("Device: %s  |  Firmware: %s  |  Energy mode: %s\n", DEVICE_ID, FIRMWARE_VERSION,
                ENERGY_IS_SIMULATED ? "SIMULATION (potentiometer)" : "REAL sensor");
  Serial.printf("PIR warm-up: %lu s (door sensor active immediately)\n", PIR_WARMUP_MS / 1000);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  if (MQTT_USE_TLS) {
    secureClient.setInsecure();                   // DEV ONLY: use setCACert(...) in production
    mqtt.setClient(secureClient);
  } else {
    mqtt.setClient(plainClient);
  }
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(4);

  readLdr();
  updateEnergy();
  readDht();
}

void loop() {
  uint32_t now = millis();

  maintainWiFi(now);
  maintainMqtt(now);
  if (mqtt.connected()) mqtt.loop();

  // Local safety logic: runs every pass, independent of Wi-Fi/MQTT
  evaluateSecurity(now);

  if (now - tSensor >= SENSOR_READ_MS) { tSensor = now; readLdr(); updateEnergy(); }
  if (now - tDht >= DHT_READ_MS)       { tDht = now;    readDht(); }

  if (securityDirty) publishSecurity();           // immediate on any change

  if (now - tPublish >= PUBLISH_MS) {
    tPublish = now;
    publishSecurity();
    publishEnvironment();
    publishEnergy();
    publishRelay();
  }
  if (now - tStatus >= STATUS_MS) { tStatus = now; publishStatus(true); }
  if (now - tSerial >= SERIAL_PRINT_MS) { tSerial = now; printReport(); }
}
