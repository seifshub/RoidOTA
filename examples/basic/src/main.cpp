#include <Arduino.h>
#include <RoidOTA.h>

// ======= Application topics =======
#define CUSTOM_PUB_TOPIC "user/esp/test"
#define CUSTOM_SUB_TOPIC "user/esp/command"

const int LED_PIN = 2;

// Called for every MQTT message that is not addressed to RoidOTA itself.
void handleCustomMessage(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.printf("[USER] Received message on %s: %s\n", topic, message.c_str());

  if (message == "blink") {
    digitalWrite(LED_PIN, HIGH);
    delay(300);
    digitalWrite(LED_PIN, LOW);
  }
}

// ======= USER SETUP: runs once, after WiFi and MQTT are set up =======
void userSetup() {
  pinMode(LED_PIN, OUTPUT);

  RoidOTA::onMessage(handleCustomMessage);
  // Subscriptions made through RoidOTA are restored after every reconnect.
  RoidOTA::subscribe(CUSTOM_SUB_TOPIC);
  RoidOTA::publish(CUSTOM_PUB_TOPIC, "Hello from ESP32 with RoidOTA!");
}

// ======= USER LOOP: keep it non-blocking so OTA stays responsive =======
void userLoop() {
  static unsigned long lastToggle = 0;
  static bool ledOn = false;

  if (millis() - lastToggle >= 1000) {
    lastToggle = millis();
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
  }
}

// ======= CORE SETUP & LOOP =======
void setup() {
  RoidOTA::begin(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD, userSetup, userLoop);
}

void loop() {
  RoidOTA::handle();
}
