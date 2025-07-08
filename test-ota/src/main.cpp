#include <WiFi.h>
#include <HTTPClient.h>
#include <Update.h>

// Replace with your WiFi credentials
const char* ssid = "TT-ALHN-37FA-2.4";
const char* password = "cxG46TNtcw";

// Replace with your full OTA firmware URL (accessible from ESP)
const char* firmwareUrl = "http://192.168.1.162:3000/firmware/firmware_v7.bin";
void performOTA(const char* binURL);
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password);
  
  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n❌ Failed to connect to WiFi. Rebooting...");
    delay(3000);
    ESP.restart();
  }

  Serial.println("\n✅ Connected to WiFi");
  Serial.println("Starting OTA update...");
  performOTA(firmwareUrl);
}

void loop() {
  // Nothing to do here
}

void performOTA(const char* binURL) {
  WiFiClient client;
  HTTPClient http;

  Serial.printf("Fetching firmware from: %s\n", binURL);
  http.begin(client, binURL);

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("❌ HTTP GET failed: %d\n", httpCode);
    http.end();
    return;
  }

  int contentLength = http.getSize();
  if (contentLength <= 0) {
    Serial.println("❌ Invalid content length");
    http.end();
    return;
  }

  bool canBegin = Update.begin(contentLength);
  if (!canBegin) {
    Serial.println("❌ Not enough space to begin OTA");
    http.end();
    return;
  }

  WiFiClient& updateStream = http.getStream();
  size_t written = Update.writeStream(updateStream);

  if (written == contentLength) {
    Serial.println("✅ Firmware written successfully");
  } else {
    Serial.printf("❌ Firmware write failed: %d/%d bytes\n", written, contentLength);
    Update.end();
    http.end();
    return;
  }

  if (Update.end()) {
    if (Update.isFinished()) {
      Serial.println("✅ OTA finished successfully! Rebooting...");
      delay(2000);
      ESP.restart();
    } else {
      Serial.println("❌ OTA failed: Not finished properly");
    }
  } else {
    Serial.printf("❌ OTA error: %s\n", Update.errorString());
  }

  http.end();
}
