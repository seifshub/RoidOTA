#include "roidOTA.h"


// =========================
//  Global Variables
// =========================
WiFiClient espClient;
PubSubClient mqttClient(espClient);
unsigned long lastHeartbeat = 0;
unsigned long lastMqttReconnect = 0;
unsigned long bootTime = 0;

// =========================
//  Setup Function
// =========================
void setup() {
  Serial.begin(115200);
  bootTime = millis();
  
  Serial.println("RoidOTA Device Starting...");
  Serial.printf("Device ID: %s\n", device_id);
  
  connectToWiFi();
  
  mqttClient.setServer(mqtt_server, 1883);
  mqttClient.setCallback(callback);
  mqttClient.setBufferSize(512);
  
  connectToMQTT();
  
  // User setup code
  {{USER_SETUP}}
}

// =========================
//  Main Loop
// =========================
void loop() {
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();
  
  // Send heartbeat
  if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
  
  // User loop code
  {{USER_LOOP}}
}

// =========================
//  WiFi Connection
// =========================
void connectToWiFi() {
  WiFiManager wifiManager;
  wifiManager.setAPStaticIPConfig(IPAddress(10,0,1,1), IPAddress(10,0,1,1), IPAddress(255,255,255,0));
  
  if (!wifiManager.autoConnect("RoidOTA-Setup")) {
    Serial.println("Failed to connect WiFi");
    ESP.restart();
  }
  
  Serial.println("WiFi connected");
  Serial.printf("IP address: %s\n", WiFi.localIP().toString().c_str());
}

// =========================
//  MQTT Connection
// =========================
void connectToMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Attempting MQTT connection...");
    
    if (mqttClient.connect(device_id)) {
      Serial.println("connected");
      
      // Subscribe to relevant topics
      mqttClient.subscribe(TOPIC_RESPONSE);
      mqttClient.subscribe(TOPIC_CMD);
      
      // Send initial request
      sendOtaRequest();
      
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void reconnectMQTT() {
  if (millis() - lastMqttReconnect >= 5000) {
    lastMqttReconnect = millis();
    connectToMQTT();
  }
}

// =========================
//  MQTT Message Handling
// =========================
void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  Serial.printf("Message received on topic: %s\n", topic);
  Serial.printf("Message: %s\n", message.c_str());
  
  if (strcmp(topic, TOPIC_RESPONSE) == 0) {
    handleOtaResponse(message);
  } else if (strcmp(topic, TOPIC_CMD) == 0) {
    handleCommand(message);
  }
}

// =========================
//  Heartbeat Function
// =========================
void sendHeartbeat() {
  if (!mqttClient.connected()) return;
  
  StaticJsonDocument<256> doc;
  doc["device_id"] = device_id;
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["uptime"] = getUptime();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["timestamp"] = millis();
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  if (mqttClient.publish(TOPIC_STATUS, buffer)) {
    Serial.println("Heartbeat sent");
  } else {
    Serial.println("Failed to send heartbeat");
  }
}

// =========================
//  OTA Functions
// =========================
void sendOtaRequest() {
  if (!mqttClient.connected()) return;
  
  StaticJsonDocument<256> doc;
  doc["device_id"] = device_id;
  doc["ip"] = WiFi.localIP().toString();
  doc["timestamp"] = millis();
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  if (mqttClient.publish(TOPIC_REQUEST, buffer)) {
    Serial.println("OTA request sent");
  }
}

void handleOtaResponse(String message) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, message);
  
  if (doc.containsKey("firmware_url")) {
    String firmwareUrl = doc["firmware_url"];
    performOTA(firmwareUrl);
  }
}

void performOTA(const String& binURL) {
  Serial.printf("Performing OTA from URL: %s\n", binURL.c_str());
  sendLog("INFO", ("Starting OTA from: " + binURL).c_str());
  sendOtaAck(false, "Starting OTA...");

  HTTPClient http;
  http.begin(binURL);
  int httpCode = http.GET();

  if (httpCode != 200) {
    String err = "HTTP GET failed, code: " + String(httpCode);
    sendLog("ERROR", err.c_str());
    sendOtaAck(false, err.c_str());
    http.end();
    return;
  }

  int contentLength = http.getSize();
  if (contentLength <= 0) {
    sendLog("ERROR", "Content-Length invalid or zero");
    sendOtaAck(false, "No content in update");
    http.end();
    return;
  }

  bool canBegin = Update.begin(contentLength);
  if (!canBegin) {
    sendLog("ERROR", "Not enough space for OTA");
    sendOtaAck(false, "Insufficient flash space");
    http.end();
    return;
  }

  WiFiClient& stream = http.getStream();
  size_t written = Update.writeStream(stream);

  if (written == contentLength) {
    if (Update.end()) {
      if (Update.isFinished()) {
        sendLog("INFO", "OTA update successful. Restarting...");
        sendOtaAck(true, "OTA update complete");
        delay(1000);
        ESP.restart();
      } else {
        sendLog("ERROR", "Update not finished properly");
        sendOtaAck(false, "OTA incomplete");
      }
    } else {
      String err = "Update.end() failed: " + String(Update.getError());
      sendLog("ERROR", err.c_str());
      sendOtaAck(false, err.c_str());
    }
  } else {
    String err = "Write failed: " + String(written) + "/" + String(contentLength);
    sendLog("ERROR", err.c_str());
    sendOtaAck(false, err.c_str());
    Update.end();
  }

  http.end();
}


void sendOtaAck(bool success, const char* message) {
  if (!mqttClient.connected()) return;
  
  StaticJsonDocument<256> doc;
  doc["device_id"] = device_id;
  doc["success"] = success;
  doc["message"] = message;
  doc["timestamp"] = millis();
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  mqttClient.publish(TOPIC_ACK, buffer);
}

// =========================
//  Command Handling
// =========================
void handleCommand(String message) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, message);
  
  String command = doc["command"];
  
  if (command == "restart") {
    sendLog("INFO", "Restart command received");
    ESP.restart();
  } else if (command == "heartbeat") {
    sendHeartbeat();
  }
}

// =========================
//  Logging Function
// =========================
void sendLog(const char* level, const char* message) {
  if (!mqttClient.connected()) return;
  
  StaticJsonDocument<256> doc;
  doc["device_id"] = device_id;
  doc["level"] = level;
  doc["message"] = message;
  doc["timestamp"] = millis();
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  mqttClient.publish(TOPIC_LOGS, buffer);
}

// =========================
//  Utility Functions
// =========================
String getDeviceId() {
  return String(device_id);
}

String getMacAddress() {
  return WiFi.macAddress();
}

unsigned long getUptime() {
  return millis() - bootTime;
}

// =========================
//  User Functions
// =========================
{{USER_FUNCTIONS}}