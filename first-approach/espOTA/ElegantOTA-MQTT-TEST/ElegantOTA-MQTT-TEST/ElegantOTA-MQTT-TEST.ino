#include <WiFi.h>
#include <WiFiManager.h>
#include <WebServer.h>
#include <ElegantOTA.h>
#include <PubSubClient.h>

WebServer server(80);
WiFiClient espClient;
PubSubClient client(espClient);

const char* mqtt_server = "192.168.1.131";  // IP of your PC running Mosquitto
const int mqtt_port = 1883;

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  Serial.print("[MQTT] Message received on topic ");
  Serial.print(topic);
  Serial.print(": ");
  Serial.println(msg);

  if (msg == "led_on") {
    digitalWrite(2, HIGH);
    client.publish("esp32/status", "LED is ON");
  } else if (msg == "led_off") {
    digitalWrite(2, LOW);
    client.publish("esp32/status", "LED is OFF");
  }
}

void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("Connecting to MQTT...");
    if (client.connect("ESP32Client")) {
      Serial.println("connected!");
      client.subscribe("esp32/cmd");

      String ip = WiFi.localIP().toString();
      client.publish("esp32/ip", ip.c_str(),true);


    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT); // On-board LED

  // WiFiManager
  WiFiManager wm;
  wm.autoConnect("ESP_OTA", "password");

  // MQTT
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(mqttCallback);

  // ElegantOTA
  server.on("/", []() {
    server.send(200, "text/plain", "Visit /update for ElegantOTA");
  });
  ElegantOTA.begin(&server);
  server.begin();
}

void loop() {
  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();         // MQTT
  server.handleClient(); // OTA
}