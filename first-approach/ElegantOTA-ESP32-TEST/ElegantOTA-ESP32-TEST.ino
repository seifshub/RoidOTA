#include <WiFi.h>
#include <WiFiManager.h>        
#include <WebServer.h>
#include <ElegantOTA.h>         

WebServer server(80);  // Create web server on port 80

// wifi connection using WiFiManager
void WifiSetup() {
  WiFiManager wm;
  bool res = wm.autoConnect("ESP_AP", "password");  // Fallback AP credentials

  if (!res) {
    Serial.println("####-----ESP NOT CONNECTED-----####");
    ESP.restart();
  } else {
    Serial.println("####-----ESP CONNECTED SUCCESSFULLY -----####");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  }
}

void setup() {
  Serial.begin(115200);
  WifiSetup();

 
  server.on("/", []() {
    server.send(200, "text/plain", "ESP32 OTA is ready. Go to /update");
  });

  ElegantOTA.begin(&server);    // start the elegantOTA
  server.begin();               // starting web server
  Serial.println("web server started. Go to http://<ESP_IP>/update");
}

void loop() {
  server.handleClient();        // haandle web requests
}