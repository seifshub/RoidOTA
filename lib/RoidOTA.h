#ifndef ROIDOTA_H
#define ROIDOTA_H

#include <WiFiManager.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <Update.h>
#include <ArduinoJson.h>
#include <WiFiClient.h>

typedef void (*UserFunction)();

class RoidOTA {
public:
    static void begin(const char* id, UserFunction setupFn, UserFunction loopFn);
    static void loop();

private:
    static void connectWiFi();
    static void connectMQTT();
    static void reconnectMQTT();
    static void callback(char* topic, byte* payload, unsigned int length);
    static void sendHeartbeat();
    static void sendOtaRequest();
    static void performOTA(const String& firmwareUrl);
    static void handleOtaResponse(const String& message);
    static void handleCommand(const String& message);
    static void sendOtaAck(bool success, const char* message);
    static void sendLog(const char* level, const char* message);
    static unsigned long getUptime();

    static inline const char* deviceId = "esp_x";
    static inline UserFunction userSetup = nullptr;
    static inline UserFunction userLoop = nullptr;

    static inline WiFiClient espClient;
    static inline PubSubClient mqttClient = PubSubClient(espClient);
    static inline unsigned long bootTime = 0;
    static inline unsigned long lastHeartbeat = 0;
    static inline unsigned long lastReconnect = 0;
};

#endif
