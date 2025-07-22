#include "RoidOTA.h"

namespace RoidOTA {

static PubSubClient* mqttClientPtr = nullptr;
static const char* deviceId = nullptr;
static unsigned long lastHeartbeat = 0;
static const unsigned long HEARTBEAT_INTERVAL = 30000; 

#define TOPIC_PREFIX "roidota"
#define TOPIC_REQUEST TOPIC_PREFIX "/request"
#define TOPIC_RESPONSE_PREFIX TOPIC_PREFIX "/response/"
#define TOPIC_CMD_PREFIX TOPIC_PREFIX "/cmd/"
#define TOPIC_ACK_PREFIX TOPIC_PREFIX "/ack/"
#define TOPIC_LOGS_PREFIX TOPIC_PREFIX "/logs/"
#define TOPIC_STATUS_PREFIX TOPIC_PREFIX "/status/"

void sendLog(const char* level, const char* message);
void sendHeartbeat();
void performOTA(const String& firmwareUrl);
void sendOtaAck(bool success, const char* message);
void handleCommand(const String& payload);

void begin(PubSubClient& client, const char* id) {
  mqttClientPtr = &client;
  deviceId = id;

  String responseTopic = String(TOPIC_RESPONSE_PREFIX) + deviceId;
  String cmdTopic = String(TOPIC_CMD_PREFIX) + deviceId;

  mqttClientPtr->subscribe(responseTopic.c_str());
  mqttClientPtr->subscribe(cmdTopic.c_str());

  sendHeartbeat();
  sendLog("INFO", "RoidOTA initialized");

  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["ip"] = WiFi.localIP().toString();
  doc["timestamp"] = millis();
  char buf[256];
  serializeJson(doc, buf);
  mqttClientPtr->publish(TOPIC_REQUEST, buf);
}

void loop() {
  if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
}

void handleMessage(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (int i = 0; i < length; ++i) msg += (char)payload[i];

  String responseTopic = String(TOPIC_RESPONSE_PREFIX) + deviceId;
  String cmdTopic = String(TOPIC_CMD_PREFIX) + deviceId;

  if (strcmp(topic, responseTopic.c_str()) == 0) {
    StaticJsonDocument<256> doc;
    deserializeJson(doc, msg);
    if (doc.containsKey("firmware_url")) {
      performOTA(doc["firmware_url"].as<String>());
    }
  } else if (strcmp(topic, cmdTopic.c_str()) == 0) {
    handleCommand(msg);
  }
}

void sendHeartbeat() {
  if (!mqttClientPtr->connected()) return;

  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["uptime"] = millis();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["timestamp"] = millis();
  char buffer[256];
  serializeJson(doc, buffer);
  String statusTopic = String(TOPIC_STATUS_PREFIX) + deviceId;
  mqttClientPtr->publish(statusTopic.c_str(), buffer);
}

void sendLog(const char* level, const char* message) {
  if (!mqttClientPtr->connected()) return;

  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["level"] = level;
  doc["message"] = message;
  doc["timestamp"] = millis();
  char buffer[256];
  serializeJson(doc, buffer);
  String logTopic = String(TOPIC_LOGS_PREFIX) + deviceId;
  mqttClientPtr->publish(logTopic.c_str(), buffer);
}

void sendOtaAck(bool success, const char* message) {
  if (!mqttClientPtr->connected()) return;

  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["success"] = success;
  doc["message"] = message;
  doc["timestamp"] = millis();
  char buffer[256];
  serializeJson(doc, buffer);
  String ackTopic = String(TOPIC_ACK_PREFIX) + deviceId;
  mqttClientPtr->publish(ackTopic.c_str(), buffer);
}

void performOTA(const String& binURL) {
  sendLog("INFO", ("Starting OTA from: " + binURL).c_str());
  sendOtaAck(false, "Starting OTA...");

  HTTPClient http;
  http.begin(binURL);
  int httpCode = http.GET();

  if (httpCode != 200) {
    sendLog("ERROR", ("HTTP GET failed, code: " + String(httpCode)).c_str());
    sendOtaAck(false, "Failed HTTP");
    http.end();
    return;
  }

  int contentLength = http.getSize();
  if (contentLength <= 0) {
    sendLog("ERROR", "Content length invalid or zero");
    sendOtaAck(false, "Invalid content length");
    http.end();
    return;
  }

  if (!Update.begin(contentLength)) {
    sendLog("ERROR", "Not enough space for OTA");
    sendOtaAck(false, "Update.begin failed");
    http.end();
    return;
  }

  WiFiClient& stream = http.getStream();
  size_t written = Update.writeStream(stream);

  if (written == contentLength) {
    if (Update.end() && Update.isFinished()) {
      sendLog("INFO", "OTA update successful. Restarting...");
      sendOtaAck(true, "OTA complete");
      delay(1000);
      ESP.restart();
    } else {
      sendLog("ERROR", "Update did not finish correctly");
      sendOtaAck(false, "Incomplete update");
    }
  } else {
    sendLog("ERROR", ("Write failed: " + String(written) + "/" + String(contentLength)).c_str());
    sendOtaAck(false, "Write failure");
    Update.end();
  }

  http.end();
}

void handleCommand(const String& payload) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, payload);
  String cmd = doc["command"];
  if (cmd == "restart") {
    sendLog("INFO", "Restart command received");
    ESP.restart();
  } else if (cmd == "heartbeat") {
    sendHeartbeat();
  }
}

}