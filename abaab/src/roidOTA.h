#ifndef ROIDOTA_H
#define ROIDOTA_H

#include <WiFiManager.h>
#include <PubSubClient.h>
#include <Update.h>
#include<HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>

#ifndef DEVICE_ID
#define DEVICE_ID "esp_1"
#endif

#ifndef HEARTBEAT_INTERVAL
#define HEARTBEAT_INTERVAL 30000  // 30 seconds
#endif

// =========================
//  Configuration
// =========================
const char* device_id = "esp_1";
const char* mqtt_server = "192.168.1.162";  
const char* firmware_base_url = "http://192.168.1.162/firmware/";

// =========================
//  MQTT Topics
// =========================
#define TOPIC_PREFIX "roidota"
#define TOPIC_REQUEST TOPIC_PREFIX "/request"
#define TOPIC_RESPONSE TOPIC_PREFIX "/response/" DEVICE_ID
#define TOPIC_STATUS TOPIC_PREFIX "/status/" DEVICE_ID
#define TOPIC_LOGS TOPIC_PREFIX "/logs/" DEVICE_ID
#define TOPIC_CMD TOPIC_PREFIX "/cmd/" DEVICE_ID
#define TOPIC_ACK TOPIC_PREFIX "/ack/" DEVICE_ID

// =========================
//  Network Clients
// =========================
extern WiFiClient espClient;
extern PubSubClient mqttClient;

// =========================
//  Global Variables
// =========================
extern unsigned long lastHeartbeat;
extern unsigned long lastMqttReconnect;
extern unsigned long bootTime;

// =========================
//      Functions
// =========================
void connectToWiFi();
void connectToMQTT();
void reconnectMQTT();
void performOTA(const String& firmware_url);
void callback(char* topic, byte* payload, unsigned int length);
void sendHeartbeat();
void sendOtaRequest();
void sendOtaAck(bool success, const char* message = "");
void sendLog(const char* level, const char* message);
void handleOtaResponse(String message);
void handleCommand(String message);

// =========================
//  Utility Functions
// =========================
String getDeviceId();
String getMacAddress();
unsigned long getUptime();

#endif