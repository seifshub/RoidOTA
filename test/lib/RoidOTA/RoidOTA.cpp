#include "RoidOTA.h"

RoidStatus RoidOTA::currentStatus = RoidStatus::BOOTING;
WiFiClient RoidOTA::espClient;
PubSubClient RoidOTA::mqttClient(espClient);
const char* RoidOTA::deviceId = "esp_x";
UserFunction RoidOTA::userSetup = nullptr;
UserFunction RoidOTA::userLoop = nullptr;
unsigned long RoidOTA::bootTime = 0;
unsigned long RoidOTA::lastHeartbeat = 0;
unsigned long RoidOTA::lastReconnect = 0;

String RoidOTA::topicStatus;
String RoidOTA::topicResponse;
String RoidOTA::topicCmd;
String RoidOTA::topicAck;
String RoidOTA::topicLogs;

RoidStatus RoidOTA::status() {
  return currentStatus;
}

const char* RoidOTA::statusStr() {
  switch (currentStatus) {
    case RoidStatus::BOOTING: return "BOOTING";
    case RoidStatus::WIFI_CONNECTED: return "WIFI_CONNECTED";
    case RoidStatus::MqTT_CONNECTED: return "MQTT_CONNECTED";
    case RoidStatus::UPDATING: return "UPDATING";
    case RoidStatus::ERROR: return "ERROR";
    default: return "UNKNOWN";
  }
}

void RoidOTA::setStatus(RoidStatus newStatus) {
  if (newStatus == currentStatus) return;
  RoidStatus oldStatus = currentStatus;
  currentStatus = newStatus;

  char buf[128];
  snprintf(buf, sizeof(buf), "Status changed: %s -> %s", getStatusStr(oldStatus), statusStr());
  sendLog("INFO", buf);
  Serial.println(buf);
}

const char* RoidOTA::getStatusStr(RoidStatus s) {
  switch (s) {
    case RoidStatus::BOOTING: return "BOOTING";
    case RoidStatus::WIFI_CONNECTED: return "WIFI_CONNECTED";
    case RoidStatus::MqTT_CONNECTED: return "MQTT_CONNECTED";
    case RoidStatus::UPDATING: return "UPDATING";
    case RoidStatus::ERROR: return "ERROR";
    default: return "UNKNOWN";
  }
}

PubSubClient& RoidOTA::mqtt() {
  return mqttClient;
}

// ========== begin() ==========
void RoidOTA::begin(const char* id, UserFunction setupFn, UserFunction loopFn) {
  deviceId = id;
  userSetup = setupFn;
  userLoop = loopFn;
  bootTime = millis();
  
  topicStatus = "roidota/status/" + String(deviceId);
  topicResponse = "roidota/response/" + String(deviceId);
  topicCmd = "roidota/cmd/" + String(deviceId);
  topicAck = "roidota/ack/" + String(deviceId);
  topicLogs = "roidota/logs/" + String(deviceId);

  Serial.begin(115200);
  Serial.printf("[RoidOTA] Booting device: %s\n", deviceId);
  
  connectWiFi();
  Serial.println(MQTT_SERVER);
  mqttClient.setServer(MQTT_SERVER, 1883); 
  mqttClient.setCallback(callback);
  mqttClient.setBufferSize(512);

  connectMQTT();

  setStatus(RoidStatus::MqTT_CONNECTED);

  if (userSetup) userSetup();
}


void RoidOTA::handle() {
  if (!mqttClient.connected()) {
    if (currentStatus == RoidStatus::MqTT_CONNECTED) {
      setStatus(RoidStatus::WIFI_CONNECTED); 
    }
    reconnectMQTT();
  }
  mqttClient.loop();

  if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL) {
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
    Serial.println("[RoidOTA] WiFi connection failed. Restarting...");
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
      mqttClient.subscribe(topicResponse.c_str());
      mqttClient.subscribe(topicCmd.c_str());
      sendOtaRequest();
      Serial.printf("[RoidOTA] MQTT connected as %s\n", deviceId);
      break;
    } else {
      Serial.println("[RoidOTA] MQTT connect failed, retrying in 5s...");
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
  if (isRoidTopic(topic)) {
    handleInternalMessage(topic, payload, length);
  }
}

bool RoidOTA::isRoidTopic(const char* topic) {
  return strncmp(topic, "roidota/", 8) == 0;
}

void RoidOTA::handleInternalMessage(const char* topic, const byte* payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; ++i) msg += (char)payload[i];

  if (String(topic) == topicResponse) handleOtaResponse(msg);
  else if (String(topic) == topicCmd) handleCommand(msg);
}



// ========== OTA ==========
void RoidOTA::sendOtaRequest() {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId; 
  doc["ip"] = WiFi.localIP().toString();
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

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
    sendHeartbeat();
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
  mqttClient.publish(topicStatus.c_str(), buffer);
}
// ========== Logging ==========
void RoidOTA::sendLog(const char* level, const char* message) {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["level"] = level;
  doc["message"] = message;
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  char buffer[256];
  serializeJson(doc, buffer);
  mqttClient.publish(topicLogs.c_str(), buffer);
}

void RoidOTA::sendOtaAck(bool success, const char* msg) {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["success"] = success;
  doc["message"] = msg;
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  char buffer[256];
  serializeJson(doc, buffer);
  mqttClient.publish(topicAck.c_str(), buffer);
}

// ========== Utilities ==========
unsigned long RoidOTA::getUptime() {
  return millis() - bootTime;
}


