#ifndef ROIDOTA_H
#define ROIDOTA_H

#include <WiFiManager.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <Update.h>
#include <ArduinoJson.h>
#include <WiFiClient.h>

typedef void (*UserFunction)();

enum class RoidStatus {
  BOOTING,
  WIFI_CONNECTED,
  MqTT_CONNECTED,
  UPDATING,
  ERROR
};

class RoidOTA {
public:
  // Core methods
  static void begin(const char* id, UserFunction setupFn, UserFunction loopFn);
  static void begin(const char* id, const char* username, const char* password, UserFunction setupFn, UserFunction loopFn);
  static void handle();
  
  // MQTT access method
  static PubSubClient& mqtt();
  
  // Topic handling methods
  static bool isRoidTopic(const char* topic);
  static void handleInternalMessage(const char* topic, const byte* payload, unsigned int length);
  
  // Status tracking methods
  static RoidStatus status();
  static const char* statusStr();

private:
  static RoidStatus currentStatus;
  static WiFiClient espClient;
  static PubSubClient mqttClient;
  static const char* deviceId;
  static const char* mqttUsername;
  static const char* mqttPassword;
  static UserFunction userSetup;
  static UserFunction userLoop;
  static unsigned long bootTime;
  static unsigned long lastHeartbeat;
  static unsigned long lastReconnect;

  static String topicStatus;
  static String topicResponse;
  static String topicCmd;
  static String topicAck;
  static String topicLogs;  
  
  // Helper methods
  static void setStatus(RoidStatus newStatus);
  static const char* getStatusStr(RoidStatus status);
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
};

#endif