# Circuit / Wiring Diagram Specification

> **Verify GPIO 4-10 against your exact ESP32-S3 board's pinout before wiring.**
> **Never connect mains AC to the ESP32 or breadboard. The relay switches a LOW-VOLTAGE test load only.**
> No LEDs are used. The only indicator is the buzzer.

## Power rails
| Rail | Source | Used by |
|---|---|---|
| 3V3 | ESP32-S3 3V3 pin | DHT11, reed switch pull-up (internal), LDR divider, potentiometer |
| 5V (VBUS/5V pin) | ESP32-S3 5V pin (USB powered) | PIR (HC-SR501 needs 5 V), relay module VCC (if 5 V coil type) |
| GND | ESP32-S3 GND | ALL parts. Common ground is mandatory |

## Wiring table
| # | From (component pin) | To (ESP32-S3) | Notes |
|---|---|---|---|
| 1 | PIR VCC | 5V | HC-SR501 works from 5 V |
| 2 | PIR OUT | GPIO 7 | HC-SR501 OUT is 3.3 V logic: safe |
| 3 | PIR GND | GND | |
| 4 | Reed switch pin A | GPIO 8 | Firmware uses INPUT_PULLUP |
| 5 | Reed switch pin B | GND | Door OPEN must read LOW (see below) |
| 6 | DHT11 VCC (+) | 3V3 | |
| 7 | DHT11 DATA (S/OUT) | GPIO 4 | 4.7-10 kΩ pull-up DATA to 3V3 if you use a bare 4-pin DHT11 (3-pin modules include it) |
| 8 | DHT11 GND (-) | GND | |
| 9 | LDR leg 1 | 3V3 | |
| 10 | LDR leg 2 + 10 kΩ resistor leg 1 | GPIO 5 | Voltage-divider midpoint |
| 11 | 10 kΩ resistor leg 2 | GND | Brighter light = higher reading |
| 12 | Relay module VCC | 5V (or 3V3 if 3.3 V module) | Match the module's rating |
| 13 | Relay module GND | GND | |
| 14 | Relay module IN | GPIO 9 | Use a 3.3 V-compatible (opto-isolated) module; set RELAY_ACTIVE_HIGH to match |
| 15 | Buzzer + (active buzzer) | GPIO 10 | Small active buzzer only (< ~20 mA). Larger buzzers need a transistor |
| 16 | Buzzer - | GND | |

### SIMULATION version (energy input, GPIO 6)
| Potentiometer pin | To |
|---|---|
| Outer pin 1 | 3V3 |
| Wiper (middle) | **GPIO 6** |
| Outer pin 2 | GND |

The potentiometer is **not** an energy sensor. It only generates a variable analog value
(labelled "Simulated Energy/Current Value").

### REAL HARDWARE version (energy input)
Set `#define ENERGY_SENSOR_MODE 1` and calibrate. Choose the sensor for your load:

* **Low-voltage DC test load (recommended for this project):** ACS712 module (5 V) or an INA219 (I2C).
  ACS712 output swings up to ~4.5 V: add a divider (e.g. 10 kΩ + 20 kΩ) so GPIO 6 never exceeds 3.3 V,
  and enter the ratio in `SENSOR_DIVIDER_RATIO`. INA219 uses I2C on other GPIOs (e.g. 1/2): it needs its own read routine.
* **AC load:** only with an isolated sensor (ZMCT103C module or SCT-013 with burden resistor + 1.65 V bias) and
  an RMS routine, installed by someone qualified. Not covered by the default firmware.

```
ACS712 VCC ── 5V        ACS712 OUT ──[10k]──┬──[20k]── GND
ACS712 GND ── GND                           └── GPIO 6
LOAD supply (+) ── ACS712 IP+ / IP- ── RELAY COM/NO ── LOAD ── LOAD supply (-)
```

## ASCII schematic (simulation version)
```
                         ┌──────────────────────────┐
   PIR (HC-SR501)        │                          │
   VCC ────────────────► │ 5V                       │
   OUT ────────────────► │ GPIO7                    │
   GND ────────────────► │ GND                      │
                         │                          │
   Reed switch           │                          │
   A ──────────────────► │ GPIO8  (INPUT_PULLUP)    │
   B ──────────────────► │ GND                      │
                         │        ESP32-S3          │
   DHT11                 │        Dev Module        │
   VCC ────────────────► │ 3V3                      │
   DATA ───────────────► │ GPIO4                    │
   GND ────────────────► │ GND                      │
                         │                          │
   3V3 ──[LDR]──┬─────── │ GPIO5                    │
                └─[10k]─ GND                        │
                         │                          │
   Potentiometer (SIM)   │                          │
   3V3 ── pin1           │                          │
   wiper ──────────────► │ GPIO6                    │
   GND ── pin3           │                          │
                         │                          │
   Relay module          │                          │
   VCC ────────────────► │ 5V                       │
   IN  ◄──────────────── │ GPIO9                    │
   GND ────────────────► │ GND                      │
   COM/NO ── low-voltage load + its own supply      │
                         │                          │
   Active buzzer         │                          │
   (+) ◄──────────────── │ GPIO10                   │
   (-) ────────────────► │ GND                      │
                         └──────────────────────────┘
        COMMON GROUND: every GND above joins the ESP32 GND rail
```

## Door switch polarity
The spec requires **door OPEN = LOW** with `INPUT_PULLUP`.
A normally-open (NO) reed switch closes (LOW) when the magnet is *near* (door closed), the opposite.
So use one of:
1. a **normally-closed (NC) / change-over reed switch** wired to GND: magnet near = open circuit = HIGH (closed door), magnet away = LOW (door open); or
2. keep a NO switch and set `DOOR_OPEN_LEVEL = HIGH` in the firmware.
In simulation a slide switch or push-button wired to GND mimics the reed switch.

## Board-specific cautions (ESP32-S3)
* GPIO 4-10 are normal I/O and ADC1 channels (ADC1 keeps working while Wi-Fi is on), but pin availability and
  labels differ between S3 boards (e.g. DevKitC-1, clones). Check your board's silkscreen/datasheet.
* Avoid strapping/special pins for these functions: GPIO 0, 3, 45, 46, USB pins 19/20, and GPIO 26-37 on modules with
  flash/PSRAM (octal PSRAM boards also reserve 35-37).

---
## ESP32 DevKit (ESP-WROOM-32, 30-pin) pin map  (set `#define BOARD_TARGET 1`)
GPIO 6-11 are flash pins on this chip, so the S3 mapping above does not apply.

| Function | GPIO | Header side | Notes |
|---|---|---|---|
| DHT11 DATA | 4 | right (D4) | |
| LDR divider | 34 | left (D34) | ADC1, input-only |
| Energy / potentiometer | 35 | left (D35) | ADC1, input-only |
| PIR OUT | 27 | left (D27) | PIR VCC to VIN (5 V) |
| Door / reed switch | 26 | left (D26) | INPUT_PULLUP, other leg to GND |
| Relay IN | 25 | left (D25) | Relay VCC to VIN (5 V) |
| Buzzer + | 33 | left (D33) | Active buzzer |
Power: 3V3 (right, bottom), VIN = 5 V (left, bottom), GND (either side, bottom).
