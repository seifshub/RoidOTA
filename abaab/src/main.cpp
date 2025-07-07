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
      mqttClient.subscribe("roidota/response/");
      mqttClient.subscribe("roidota/cmd/");
      
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
  
  if (strcmp(topic, "roidota/response/") == 0) {
    handleOtaResponse(message);
  } else if (strcmp(topic, "roidota/cmd/") == 0) {
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
  
  if (mqttClient.publish("roidota/status/", buffer)) {
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

void performOTA(const String& firmware_url) {
  sendLog("INFO", "Starting OTA update");
  
  HTTPUpdate httpUpdate;
  httpUpdate.setLedPin(2, LOW);
  
  WiFiClient client;
  t_httpUpdate_return ret = httpUpdate.update(client, firmware_url);
  
  switch (ret) {
    case HTTP_UPDATE_FAILED:
      sendOtaAck(false, httpUpdate.getLastErrorString().c_str());
      sendLog("ERROR", ("OTA failed: " + httpUpdate.getLastErrorString()).c_str());
      break;
      
    case HTTP_UPDATE_NO_UPDATES:
      sendOtaAck(false, "No updates available");
      sendLog("INFO", "No updates available");
      break;
      
    case HTTP_UPDATE_OK:
      sendOtaAck(true, "OTA update successful");
      sendLog("INFO", "OTA update successful, restarting...");
      ESP.restart();
      break;
  }
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
  
  mqttClient.publish("roidota/ack/", buffer);
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
  
  mqttClient.publish("roidota/logs/", buffer);
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