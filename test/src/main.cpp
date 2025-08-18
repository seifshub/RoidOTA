#include <Arduino.h>
#include <RoidOTA.h>

// ======= Custom Topic Definitions =======
#define CUSTOM_PUB_TOPIC "user/esp/test"
#define CUSTOM_SUB_TOPIC "user/esp/command"

PubSubClient& mqttClient = RoidOTA::mqtt();


// ======= User Callback for Custom Topic =======
void handleCustomMessage(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.printf("[USER] Received message on %s: %s\n", topic, message.c_str());

  if (message == "blink") {
    digitalWrite(2, HIGH);
    delay(300);
    digitalWrite(2, LOW);
  }
}

// ======= USER SETUP =======
void userSetup() {
  Serial.println("userSetup(): Setting up LED pin...");
  pinMode(2, OUTPUT);

  // Custom topic subscription
  mqttClient.subscribe(CUSTOM_SUB_TOPIC);
  mqttClient.setCallback([](char* topic, byte* payload, unsigned int length) {
    // Let RoidOTA handle its topics
    if (RoidOTA::isRoidTopic(topic)) {
      RoidOTA::handleInternalMessage(topic, payload, length);
    } else {
      handleCustomMessage(topic, payload, length);
    }
  });

  // Initial custom publish
  mqttClient.publish(CUSTOM_PUB_TOPIC, "Hello from ESP32 with RoidOTA!");
}

// ======= USER LOOP =======
void userLoop() {
  static unsigned long lastPub = 0;
  if (millis() - lastPub >= 1000) {
    digitalWrite(2, HIGH);
    delay(1000);
    digitalWrite(2, LOW);
    delay(1000);

    lastPub = millis();
  }
}

// ======= CORE SETUP & LOOP =======
void setup() {
  Serial.begin(115200);
  RoidOTA::begin(DEVICE_ID, "admin", "admin", userSetup, userLoop);
}

void loop() {
  RoidOTA::handle(); 
}


