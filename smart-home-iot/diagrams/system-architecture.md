# System Architecture

```mermaid
flowchart TB
  subgraph Edge["Edge device: ESP32-S3 (local safety logic runs here, even offline)"]
    PIR[PIR GPIO7] --> MCU
    REED[Reed switch GPIO8] --> MCU
    DHT[DHT11 GPIO4] --> MCU
    LDR[LDR GPIO5] --> MCU
    ENG[Energy input GPIO6\npotentiometer in simulation] --> MCU
    MCU[ESP32-S3 firmware] --> BUZ[Buzzer GPIO10]
    MCU --> REL[Relay GPIO9]
  end

  MCU -- "UPSTREAM: sensor data JSON over Wi-Fi" --> BRK[(MQTT Broker)]
  BRK -- "smart_home/# telemetry" --> BE[Backend: Node.js + Express + MQTT.js]
  BE --> DB[(SQLite)]
  BE -- "REST /api/*" --> DASH[Web dashboard]

  DASH -- "DOWNSTREAM: POST /api/relay" --> BE
  BE -- "publish smart_home/command/relay" --> BRK
  BRK -- "command" --> MCU
```

```
UPSTREAM  (sensor data)
Sensors -> ESP32-S3 -> Wi-Fi -> MQTT Broker -> Backend -> SQLite -> REST API -> Dashboard

DOWNSTREAM (control)
Dashboard -> Backend (POST /api/relay) -> MQTT Broker -> ESP32-S3 -> Relay
                                                           └-> confirms on smart_home/appliance/relay
```
