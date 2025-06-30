// File: src/main.cpp

#include <WiFiManager.h>
#include <PubSubClient.h>
#include <HTTPUpdate.h>
#include <WiFiClient.h>

const char* device_id = "esp_2";  // ⚠️ Change per device
const char* mqtt_server = "192.168.1.100";  // ⚠️ Update with PC/server IP
const char* firmware_base_url = "http://192.168.1.100/firmware/";

WiFiClient espClient;
PubSubClient mqttClient(espClient);
String response_topic = "roidota/response/" + String(device_id);
const char* request_topic = "roidota/request";

void connectToWiFi() {
  WiFiManager wm;
  Serial.println("🔧 Starting WiFiManager...");
  bool res = wm.autoConnect("ESP32_AP");
  if (!res) {
    Serial.println("❌ WiFi Failed. Restarting...");
    ESP.restart();
  }
  Serial.println("✅ Connected to WiFi!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void connectToMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("📡 Connecting to MQTT...");
    if (mqttClient.connect(device_id)) {
      Serial.println(" connected!");
      mqttClient.subscribe(response_topic.c_str());
      mqttClient.publish(request_topic, device_id);
    } else {
      Serial.printf("❌ Failed. State: %d. Retrying...\n", mqttClient.state());
      delay(2000);
    }
  }
}

void performOTA(const String& firmware_name) {
  String full_url = firmware_base_url + firmware_name;
  Serial.printf("⬇️ Downloading: %s\n", full_url.c_str());

  t_httpUpdate_return result = httpUpdate.update(espClient, full_url);
  
  switch (result) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("❌ OTA Failed (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("ℹ️ No update available.");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("✅ OTA Success. Rebooting...");
      break;
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  String firmware_name;
  for (unsigned int i = 0; i < length; i++) {
    firmware_name += (char)payload[i];
  }
  Serial.printf("📥 Received firmware: %s\n", firmware_name.c_str());
  performOTA(firmware_name);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  connectToWiFi();
  mqttClient.setServer(mqtt_server, 1883);
  mqttClient.setCallback(callback);
}

void loop() {
  if (!mqttClient.connected()) {
    connectToMQTT();
  }
  mqttClient.loop();
}