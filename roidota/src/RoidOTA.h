#ifndef ROIDOTA_H
#define ROIDOTA_H

#include <WiFiManager.h>
#include <PubSubClient.h>
#include <HTTPUpdate.h>
#include <WiFiClient.h>

// =========================
// 🔧 Configuration
// =========================
const char* device_id = "esp_2";  // Change per device
const char* mqtt_server = "192.168.1.100";  // Update with server IP
const char* firmware_base_url = "http://192.168.1.100/firmware/";

// =========================
// 🔌 Network Clients
// =========================
extern WiFiClient espClient;
extern PubSubClient mqttClient;

// =========================
// 📡 MQTT Topics
// =========================
extern String response_topic;
extern const char* request_topic;

// =========================
// 🔁 Functions
// =========================
void connectToWiFi();
void connectToMQTT();
void performOTA(const String& firmware_name);
void callback(char* topic, byte* payload, unsigned int length);

#endif