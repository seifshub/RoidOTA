#include "RoidOTA.h"

// ========== begin() ==========
void RoidOTA::begin(const char* id, UserFunction setupFn, UserFunction loopFn) {
  deviceId = id;
  userSetup = setupFn;
  userLoop = loopFn;
  bootTime = millis();

  Serial.begin(115200);
  Serial.printf("[RoidOTA] Booting device: %s\n", deviceId);

  connectWiFi();

  mqttClient.setServer("192.168.1.162", 1883); // Replace with your broker IP
  mqttClient.setCallback(callback);
  mqttClient.setBufferSize(512);

  connectMQTT();

  if (userSetup) userSetup();
}

// ========== loop() ==========
void RoidOTA::loop() {
  if (!mqttClient.connected()) reconnectMQTT();
  mqttClient.loop();

  if (millis() - lastHeartbeat >= 30000) {  // Heartbeat every 30s
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  if (userLoop) userLoop();
}

// ========== WiFi ==========
void RoidOTA::connectWiFi() {
  WiFiManager wm;
  wm.setTitle(deviceId);
  if (!wm.autoConnect("RoidOTA-" + String(deviceId))) {
    Serial.println("[RoidOTA] Failed to connect to WiFi. Rebooting...");
    delay(3000);
    ESP.restart();
  }

  Serial.println("[RoidOTA] WiFi connected.");
  Serial.printf("[RoidOTA] IP: %s\n", WiFi.localIP().toString().c_str());
}

// ========== MQTT ==========
void RoidOTA::connectMQTT() {
  Serial.printf("[RoidOTA] Connecting to MQTT...\n");
  while (!mqttClient.connected()) {
    if (mqttClient.connect(deviceId)) {
      Serial.printf("[RoidOTA] MQTT connected as %s\n", deviceId);

      mqttClient.subscribe(("roidota/response/" + String(deviceId)).c_str());
      mqttClient.subscribe(("roidota/cmd/" + String(deviceId)).c_str());

      sendOtaRequest();  // Ask for firmware on boot
    } else {
      Serial.printf("[RoidOTA] MQTT failed: rc=%d. Retrying...\n", mqttClient.state());
      delay(5000);
    }
  }
}

void RoidOTA::reconnectMQTT() {
  if (millis() - lastReconnect >= 5000) {
    lastReconnect = millis();
    connectMQTT();
  }
}

// ========== MQTT Callback ==========
void RoidOTA::callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  Serial.printf("[RoidOTA] Topic: %s\n", topic);
  Serial.printf("[RoidOTA] Payload: %s\n", msg.c_str());

  String res = "roidota/response/" + String(deviceId);
  String cmd = "roidota/cmd/" + String(deviceId);

  if (String(topic) == res) {
    handleOtaResponse(msg);
  } else if (String(topic) == cmd) {
    handleCommand(msg);
  }
}

// ========== Heartbeat ==========
void RoidOTA::sendHeartbeat() {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["ip"] = WiFi.localIP().toString();
  doc["uptime"] = getUptime();
  doc["rssi"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["timestamp"] = millis();

  char buffer[256];
  serializeJson(doc, buffer);
  mqttClient.publish(("roidota/status/" + String(deviceId)).c_str(), buffer);
}

// ========== OTA ==========
void RoidOTA::sendOtaRequest() {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["firmware"] = "v1.0.0"; // optional
  doc["ip"] = WiFi.localIP().toString();
  doc["timestamp"] = millis();

  char buffer[256];
  serializeJson(doc, buffer);
  mqttClient.publish("roidota/request", buffer);
}

void RoidOTA::handleOtaResponse(const String& message) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, message);

  if (doc.containsKey("firmware_url")) {
    performOTA(doc["firmware_url"]);
  }
}

void RoidOTA::performOTA(const String& firmwareUrl) {
  Serial.printf("[RoidOTA] Starting OTA from: %s\n", firmwareUrl.c_str());
  sendLog("INFO", "Starting OTA...");
  sendOtaAck(false, "Starting OTA");

  HTTPClient http;
  http.begin(firmwareUrl);
  int httpCode = http.GET();

  if (httpCode != 200) {
    sendLog("ERROR", "HTTP GET failed");
    sendOtaAck(false, "Failed to fetch update");
    return;
  }

  int len = http.getSize();
  if (!Update.begin(len)) {
    sendLog("ERROR", "Not enough space for OTA");
    sendOtaAck(false, "Not enough space");
    return;
  }

  WiFiClient& stream = http.getStream();
  size_t written = Update.writeStream(stream);

  if (written == len && Update.end() && Update.isFinished()) {
    sendOtaAck(true, "Update success. Rebooting...");
    sendLog("INFO", "OTA success");
    ESP.restart();
  } else {
    sendLog("ERROR", "OTA write failed");
    sendOtaAck(false, "OTA failed");
    Update.end();
  }

  http.end();
}

// ========== Command Handling ==========
void RoidOTA::handleCommand(const String& message) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, message);

  String command = doc["command"];
  if (command == "restart") {
    sendLog("INFO", "Device restarting...");
    ESP.restart();
  } else if (command == "heartbeat") {
    sendHeartbeat();
  }
}

// ========== Logging ==========
void RoidOTA::sendLog(const char* level, const char* message) {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["level"] = level;
  doc["message"] = message;
  doc["timestamp"] = millis();

  char buffer[256];
  serializeJson(doc, buffer);
  mqttClient.publish(("roidota/logs/" + String(deviceId)).c_str(), buffer);
}

void RoidOTA::sendOtaAck(bool success, const char* msg) {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["success"] = success;
  doc["message"] = msg;
  doc["timestamp"] = millis();

  char buffer[256];
  serializeJson(doc, buffer);
  mqttClient.publish(("roidota/ack/" + String(deviceId)).c_str(), buffer);
}

// ========== Utilities ==========
unsigned long RoidOTA::getUptime() {
  return millis() - bootTime;
}
