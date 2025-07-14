#include "RoidOTA.h"

// Initialize static members
RoidStatus RoidOTA::currentStatus = RoidStatus::BOOTING;

// ========== MQTT Client Access ==========
PubSubClient& RoidOTA::mqtt() {
  return mqttClient;
}

// ========== Status Management ==========
RoidStatus RoidOTA::status() {
  return currentStatus;
}

const char* RoidOTA::statusStr() {
  switch (currentStatus) {
    case RoidStatus::BOOTING:
      return "BOOTING";
    case RoidStatus::WIFI_CONNECTED:
      return "WIFI_CONNECTED";
    case RoidStatus::MqTT_CONNECTED:
      return "MQTT_CONNECTED";
    case RoidStatus::UPDATING:
      return "UPDATING";
    case RoidStatus::ERROR:
      return "ERROR";
    default:
      return "UNKNOWN";
  }
}

void RoidOTA::setStatus(RoidStatus newStatus) {
  if (currentStatus != newStatus) {
    RoidStatus oldStatus = currentStatus;
    currentStatus = newStatus;
    
    // Log status change
    char logMessage[128];
    snprintf(logMessage, sizeof(logMessage), "Status changed: %s -> %s", 
             statusStr(), statusStr());
    sendLog("INFO", logMessage);
    
    Serial.printf("[RoidOTA] Status: %s -> %s\n", 
                  statusStr(), statusStr());
  }
}

// ========== begin() ==========
void RoidOTA::begin(const char* id, UserFunction setupFn, UserFunction loopFn) {
  deviceId = id;
  userSetup = setupFn;
  userLoop = loopFn;
  bootTime = millis();

  Serial.begin(115200);
  Serial.printf("[RoidOTA] Booting device: %s\n", deviceId);
  
  setStatus(RoidStatus::BOOTING);
  
  connectWiFi();

  mqttClient.setServer("192.168.1.162", 1883); 
  mqttClient.setCallback(callback);
  mqttClient.setBufferSize(512);

  connectMQTT();

  if (userSetup) userSetup();
}

// ========== loop() ==========
void RoidOTA::handle() {
  loop();  // simply forward to your loop implementation
}

void RoidOTA::loop() {
  if (!mqttClient.connected()) {
    if (currentStatus == RoidStatus::MqTT_CONNECTED) {
      setStatus(RoidStatus::WIFI_CONNECTED); // Downgrade status
    }
    reconnectMQTT();
  }
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
  String apName = "RoidOTA-" + String(deviceId);
  
  if (!wm.autoConnect(apName.c_str())) {
    Serial.println("[RoidOTA] WiFi failed. Restarting...");
    setStatus(RoidStatus::ERROR);
    delay(3000);
    ESP.restart();
  }

  Serial.println("[RoidOTA] WiFi connected.");
  Serial.printf("[RoidOTA] IP: %s\n", WiFi.localIP().toString().c_str());
  
  setStatus(RoidStatus::WIFI_CONNECTED);
}

// ========== MQTT ==========
void RoidOTA::connectMQTT() {
  Serial.printf("[RoidOTA] Connecting to MQTT...\n");
  
  while (!mqttClient.connected()) {
    if (mqttClient.connect(deviceId)) {
      Serial.printf("[RoidOTA] MQTT connected as %s\n", deviceId);
      
      setStatus(RoidStatus::MqTT_CONNECTED);

      mqttClient.subscribe(("roidota/response/" + String(deviceId)).c_str());
      mqttClient.subscribe(("roidota/cmd/" + String(deviceId)).c_str());

      sendOtaRequest();  // Ask for firmware on boot
    } else {
      Serial.printf("[RoidOTA] MQTT failed: rc=%d. Retrying...\n", mqttClient.state());
      setStatus(RoidStatus::ERROR);
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
  StaticJsonDocument<512> doc;
  doc["device_id"] = deviceId;
  doc["ip"] = WiFi.localIP().toString();
  doc["uptime"] = getUptime();
  doc["rssi"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["timestamp"] = millis();
  doc["status"] = statusStr();  

  char buffer[512];
  serializeJson(doc, buffer);
  mqttClient.publish(("roidota/status/" + String(deviceId)).c_str(), buffer);
}

// ========== OTA ==========
void RoidOTA::sendOtaRequest() {
  StaticJsonDocument<512> doc;
  doc["device_id"] = deviceId; 
  doc["ip"] = WiFi.localIP().toString();
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  char buffer[512];
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
  
  setStatus(RoidStatus::UPDATING);
  
  sendLog("INFO", "Starting OTA...");
  sendOtaAck(false, "Starting OTA");

  HTTPClient http;
  http.begin(firmwareUrl);
  int httpCode = http.GET();

  if (httpCode != 200) {
    setStatus(RoidStatus::ERROR);
    sendLog("ERROR", "HTTP GET failed");
    sendOtaAck(false, "Failed to fetch update");
    return;
  }

  int len = http.getSize();
  if (!Update.begin(len)) {
    setStatus(RoidStatus::ERROR);
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
    setStatus(RoidStatus::ERROR);
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
  } else if (command == "status") {
    // Send current status immediately
    sendHeartbeat();
  }
}

// ========== Logging ==========
void RoidOTA::sendLog(const char* level, const char* message) {
  StaticJsonDocument<512> doc;
  doc["device_id"] = deviceId;
  doc["level"] = level;
  doc["message"] = message;
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  char buffer[512];
  serializeJson(doc, buffer);
  mqttClient.publish(("roidota/logs/" + String(deviceId)).c_str(), buffer);
}

void RoidOTA::sendOtaAck(bool success, const char* msg) {
  StaticJsonDocument<512> doc;
  doc["device_id"] = deviceId;
  doc["success"] = success;
  doc["message"] = msg;
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  char buffer[512];
  serializeJson(doc, buffer);
  mqttClient.publish(("roidota/ack/" + String(deviceId)).c_str(), buffer);
}

// ========== Utilities ==========
unsigned long RoidOTA::getUptime() {
  return millis() - bootTime;
}

bool RoidOTA::isRoidTopic(const char* topic) {
  return strncmp(topic, "roidota/", 8) == 0; 
}

void RoidOTA::handleInternalMessage(const char* topic, const byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  String base = String("roidota/");
  String id = String(deviceId);

  if (String(topic) == base + "response/" + id) {
    handleOtaResponse(message);
  } else if (String(topic) == base + "cmd/" + id) {
    handleCommand(message);
  } else {
    Serial.printf("[RoidOTA] Unknown internal topic: %s\n", topic);
  }
}
