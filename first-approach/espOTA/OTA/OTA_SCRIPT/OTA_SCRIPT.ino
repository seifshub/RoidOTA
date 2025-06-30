#include <WiFi.h>
#include <WiFiManager.h>         
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <Update.h>

// 🧠 MQTT Broker Info
const char* mqtt_server = "192.168.1.131";
const int mqtt_port = 1883;
const char* firmware_url = "http://192.168.1.131:8000/test-script.ino.bin";
// 🔌 MQTT Setup
WiFiClient espClient;
PubSubClient client(espClient);

// 📡 WiFi Setup (with WiFiManager)
void setupWifi() {
  WiFiManager wm;
  bool res = wm.autoConnect("ESP_AP", "password");
  if (!res) {
    Serial.println("----- ### ESP failed to connect :( ### -----");
    ESP.restart();
  }
  Serial.println("----- ESP SUCCESSFULLY Connected to WiFi :D ### -----");
}

// 🔁 MQTT Setup
void setupMQTT() {
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(mqttCallback);  // You need to define this later
}

// 🔄 MQTT Reconnect Loop
void reconnectMQTT() {
  while (!client.connected()) {
    Serial.println("Connecting to MQTT.......");
    if (client.connect("ESP32Client")) {
      Serial.println("Connected !!");
      client.subscribe("esp32/update");
      client.publish("esp32/ip", WiFi.localIP().toString().c_str());
    } else {
      Serial.print("Failed, rc=");
      Serial.print(client.state());
      delay(2000);
    }
  }
}
//mqtt implementation
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message arrived on topic: ");
  Serial.println(topic);
  Serial.print("Message: ");
  String message;
  for (unsigned int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
    message += (char)payload[i];
  }
  Serial.println();

  if (message == "start_ota") {
    Serial.println("Starting OTA update...");
    performOTAUpdate(firmware_url);
  }
}

//performing OTA flashing 
void performOTAUpdate(const char* url) {
  HTTPClient http;

  Serial.println("Connecting to firmware server...");
  http.begin(url);
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    int contentLength = http.getSize();
    Serial.printf("Firmware size: %d bytes\n", contentLength);

    if (contentLength > 0) {
      WiFiClient *client = http.getStreamPtr();

      // Start OTA Update
      if (!Update.begin(contentLength)) {
        Serial.println("Not enough space to begin OTA");
        return;
      }

      Serial.println("Writing to flash...");
      size_t written = Update.writeStream(*client);

      if (written == contentLength) {
        Serial.println("Written : " + String(written) + " successfully");
      } else {
        Serial.println("Written only : " + String(written) + "/" + String(contentLength) + ". Retry?");
      }

      if (Update.end()) {
        Serial.println("OTA done!");
        if (Update.isFinished()) {
          Serial.println("Update successfully completed. Rebooting...");
          ESP.restart();
        } else {
          Serial.println("Update not finished? Something went wrong!");
        }
      } else {
        Serial.printf("Update failed. Error #: %d\n", Update.getError());
      }
    } else {
      Serial.println("Content-Length not defined or zero");
    }
  } else {
    Serial.printf("HTTP GET failed, error: %d\n", httpCode);
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  setupWifi();
  setupMQTT();
}

void loop() {
  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();
}