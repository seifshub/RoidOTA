#include "RoidOTA.h"

RoidStatus RoidOTA::currentStatus = RoidStatus::BOOTING;
WiFiClient RoidOTA::espClient;
PubSubClient RoidOTA::mqttClient(espClient);
const char* RoidOTA::deviceId = "esp_x";
const char* RoidOTA::mqttUsername = "";
const char* RoidOTA::mqttPassword = "";
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
  begin(id, "", "", setupFn, loopFn);
}

void RoidOTA::begin(const char* id, const char* username, const char* password, UserFunction setupFn, UserFunction loopFn) {
  deviceId = id;
  mqttUsername = username;
  mqttPassword = password;
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
  mqttClient.setBufferSize(2048);

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
    Serial.println("[RoidOTA] Attempting MQTT connection...");
    
    // Connect with credentials if available, otherwise without
    bool connected = false;
    if (strlen(mqttUsername) > 0 && strlen(mqttPassword) > 0) {
      Serial.println("[RoidOTA] Connecting with authentication...");
      connected = mqttClient.connect(deviceId, mqttUsername, mqttPassword);
    } else {
      Serial.println("[RoidOTA] Connecting without authentication...");
      connected = mqttClient.connect(deviceId);
    }
    
    Serial.printf("[RoidOTA] Connection attempt result: %s\n", connected ? "SUCCESS" : "FAILED");
    
    if (connected) {
      Serial.printf("[RoidOTA] MQTT connected successfully as %s\n", deviceId);
      Serial.printf("[RoidOTA] Client state: %d\n", mqttClient.state());
      
      // Subscribe to topics WITH ERROR CHECKING
      Serial.printf("[RoidOTA] Subscribing to response topic: '%s'\n", topicResponse.c_str());
      bool sub1 = mqttClient.subscribe(topicResponse.c_str());
      Serial.printf("[RoidOTA] Response topic subscription result: %s\n", sub1 ? "SUCCESS" : "FAILED");
      
      Serial.printf("[RoidOTA] Subscribing to cmd topic: '%s'\n", topicCmd.c_str());
      bool sub2 = mqttClient.subscribe(topicCmd.c_str());
      Serial.printf("[RoidOTA] Cmd topic subscription result: %s\n", sub2 ? "SUCCESS" : "FAILED");

      // Send initial messages
      Serial.println("[RoidOTA] Sending OTA request...");
      sendOtaRequest();
      
      Serial.println("[RoidOTA] Sending heartbeat...");
      sendHeartbeat();
      
      Serial.printf("[RoidOTA] MQTT setup complete for device %s\n", deviceId);
      Serial.println("[RoidOTA] Waiting for messages...");
      break;
    } else {
      int state = mqttClient.state();
      Serial.printf("[RoidOTA] MQTT connect failed, client state: %d\n", state);
      
      // Decode MQTT client state
      switch(state) {
        case -4: Serial.println("[RoidOTA] MQTT_CONNECTION_TIMEOUT"); break;
        case -3: Serial.println("[RoidOTA] MQTT_CONNECTION_LOST"); break;
        case -2: Serial.println("[RoidOTA] MQTT_CONNECT_FAILED"); break;
        case -1: Serial.println("[RoidOTA] MQTT_DISCONNECTED"); break;
        case 1: Serial.println("[RoidOTA] MQTT_CONNECT_BAD_PROTOCOL"); break;
        case 2: Serial.println("[RoidOTA] MQTT_CONNECT_BAD_CLIENT_ID"); break;
        case 3: Serial.println("[RoidOTA] MQTT_CONNECT_UNAVAILABLE"); break;
        case 4: Serial.println("[RoidOTA] MQTT_CONNECT_BAD_CREDENTIALS"); break;
        case 5: Serial.println("[RoidOTA] MQTT_CONNECT_UNAUTHORIZED"); break;
        default: Serial.printf("[RoidOTA] Unknown state: %d\n", state); break;
      }
      
      Serial.println("[RoidOTA] Retrying MQTT connection in 5 seconds...");
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
  Serial.println("[RoidOTA] ========== CALLBACK TRIGGERED ==========");
  Serial.printf("[RoidOTA] Topic: '%s'\n", topic);
  Serial.printf("[RoidOTA] Length: %d\n", length);
  
  bool isRoid = isRoidTopic(topic);
  Serial.printf("[RoidOTA] Is RoidOTA topic: %s\n", isRoid ? "YES" : "NO");
  
  if (isRoid) {
    Serial.println("[RoidOTA] Processing RoidOTA message...");
    handleInternalMessage(topic, payload, length);
  } else {
    Serial.println("[RoidOTA] Ignoring non-RoidOTA message");
  }
  Serial.println("[RoidOTA] ==========================================");
}

bool RoidOTA::isRoidTopic(const char* topic) {
  return strncmp(topic, "roidota/", 8) == 0;
}

void RoidOTA::handleInternalMessage(const char* topic, const byte* payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; ++i) msg += (char)payload[i];

  if (String(topic) == topicResponse) {
    handleOtaResponse(msg);
  } else if (String(topic) == topicCmd) {
    handleCommand(msg);
  } else {
    Serial.printf("[RoidOTA] No handler for topic: %s\n", topic);
  }
}



// ========== OTA ==========
void RoidOTA::sendOtaRequest() {
  DynamicJsonDocument doc(512); 
  doc["device_id"] = deviceId; 
  doc["ip"] = WiFi.localIP().toString();
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  String buffer;
  serializeJson(doc, buffer);
  mqttClient.publish("roidota/request", buffer.c_str());
}

void RoidOTA::handleOtaResponse(const String& message) {
  DynamicJsonDocument doc(1024); 
  
  DeserializationError error = deserializeJson(doc, message);
  
  Serial.printf("[RoidOTA] OTA response received: %s\n", message.c_str());
  if (error) {
    Serial.printf("[RoidOTA] JSON parse failed: %s\n", error.c_str());
    sendLog("ERROR", "Failed to parse OTA response");
    sendOtaAck(false, "JSON parse error");
    setStatus(RoidStatus::ERROR);
    return;
  }
  
  if (doc.containsKey("firmware_url")) {
    String firmwareUrl = doc["firmware_url"];
    
    if (firmwareUrl != "null" && firmwareUrl.length() > 0) {
      performOTA(firmwareUrl);
    } else {
      Serial.println("[RoidOTA] Invalid firmware URL received");
      sendLog("ERROR", "Invalid firmware URL");
      sendOtaAck(false, "Invalid firmware URL");
      setStatus(RoidStatus::ERROR);
    }
  } else {
    Serial.println("[RoidOTA] No firmware_url in response");
    sendLog("ERROR", "No firmware URL in response");
    sendOtaAck(false, "No firmware URL");
    setStatus(RoidStatus::ERROR);
  }
}

void RoidOTA::performOTA(const String& firmwareUrl) {
  Serial.printf("[RoidOTA] Starting OTA from: %s\n", firmwareUrl.c_str());
  
  setStatus(RoidStatus::UPDATING);
  
  sendLog("INFO", "Starting OTA...");

  HTTPClient http;
  http.begin(firmwareUrl);
  int httpCode = http.GET();

  if (httpCode < 200 || httpCode >= 300) {
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

  Serial.printf("[RoidOTA] OTA Progress: written=%zu, expected=%d\n", written, len);
  
  bool updateEnded = Update.end();
  bool updateFinished = Update.isFinished();
  
  Serial.printf("[RoidOTA] Update.end()=%s, Update.isFinished()=%s\n", 
                updateEnded ? "true" : "false", 
                updateFinished ? "true" : "false");

  if (written == len && updateEnded && updateFinished) {
    Serial.println("[RoidOTA] OTA SUCCESS - sending ACK before restart");
    sendOtaAck(true, "Update success. Rebooting...");

    Serial.println("[RoidOTA] Waiting for ACK transmission...");
    for (int i = 0; i < 10; i++) {
        mqttClient.loop();  
        delay(100);        
    }
    
    sendLog("INFO", "OTA success - restarting now");
    Serial.println("[RoidOTA] Restarting in 2 seconds...");

    delay(2000);
    
    ESP.restart();
  } else {
    Serial.printf("[RoidOTA] OTA FAILED - written=%zu, len=%d, ended=%s, finished=%s\n", 
                  written, len, updateEnded ? "true" : "false", updateFinished ? "true" : "false");
    
    if (Update.hasError()) {
      Serial.printf("[RoidOTA] Update error: %s\n", Update.errorString());
      sendLog("ERROR", Update.errorString());
    }
    
    setStatus(RoidStatus::ERROR);
    sendLog("ERROR", "OTA write failed");
    sendOtaAck(false, "OTA failed");
    
    if (!updateEnded) {
      Update.end();
    }
  }

  http.end();
}

// ========== Command Handling ==========
void RoidOTA::handleCommand(const String& message) {
  DynamicJsonDocument doc(512);
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.printf("[RoidOTA] Command JSON parse failed: %s\n", error.c_str());
    return;
  }

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
  Serial.printf("[RoidOTA] Sending OTA ACK: success=%s, message=%s\n", 
                success ? "true" : "false", msg);
                
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["success"] = success;
  doc["message"] = msg;
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  char buffer[256];
  serializeJson(doc, buffer);
  
  Serial.printf("[RoidOTA] Publishing ACK to topic: %s\n", topicAck.c_str());
  Serial.printf("[RoidOTA] ACK payload: %s\n", buffer);
  
  bool published = mqttClient.publish(topicAck.c_str(), buffer);
  Serial.printf("[RoidOTA] ACK publish result: %s\n", published ? "SUCCESS" : "FAILED");
}

// ========== Utilities ==========
unsigned long RoidOTA::getUptime() {
  return millis() - bootTime;
}


