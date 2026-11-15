#ifndef ROIDOTA_H
#define ROIDOTA_H

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

// ---------------------------------------------------------------------------
// Build-time configuration (override with -D flags in platformio.ini)
// ---------------------------------------------------------------------------

// MQTT broker host. May also be set at runtime with RoidOTA::setServer().
#ifndef MQTT_SERVER
#define MQTT_SERVER ""
#endif

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif

// Milliseconds between heartbeats. Keep it well below the backend's
// DEVICE_OFFLINE_AFTER_MS (90 s by default).
#ifndef HEARTBEAT_INTERVAL
#define HEARTBEAT_INTERVAL 30000
#endif

// Maximum number of topics registered through RoidOTA::subscribe().
#ifndef ROIDOTA_MAX_USER_TOPICS
#define ROIDOTA_MAX_USER_TOPICS 8
#endif

// Version of the device <-> backend protocol implemented by this library.
// From version 2 on, the device reports the firmware it runs and echoes the
// deployment ID, which lets the backend confirm updates after the reboot.
#define ROIDOTA_PROTOCOL_VERSION 2

typedef void (*UserFunction)();
typedef void (*RoidMessageCallback)(char* topic, byte* payload, unsigned int length);

enum class RoidStatus {
  BOOTING,
  DISCONNECTED,    // no WiFi
  WIFI_CONNECTED,  // WiFi up, MQTT broker not connected
  // Spelled this way on purpose: PubSubClient defines a MQTT_CONNECTED macro.
  MqTT_CONNECTED,
  UPDATING,
  ERROR
};

class RoidOTA {
public:
  // ----- lifecycle -----
  // Connects WiFi (captive portal on first boot) and MQTT, then runs setupFn.
  // Call from setup(); call handle() from loop().
  static void begin(const char* id, UserFunction setupFn, UserFunction loopFn);
  static void begin(const char* id, const char* username, const char* password,
                    UserFunction setupFn, UserFunction loopFn);
  static void handle();

  // ----- optional configuration, call before begin() -----
  static void setServer(const char* host, uint16_t port = MQTT_PORT);
  // PEM root certificate used to verify https:// firmware URLs. Without it
  // HTTPS downloads are not authenticated (the MD5 check still applies).
  static void setCACert(const char* rootCA);

  // ----- application messaging -----
  // Receives every message that is not addressed to RoidOTA itself.
  static void onMessage(RoidMessageCallback callback);
  // Subscribes now and again after every reconnect.
  static bool subscribe(const char* topic);
  static bool publish(const char* topic, const char* payload, bool retained = false);
  // Direct access to the underlying client. If you install your own callback
  // with mqtt().setCallback(), forward RoidOTA topics to handleInternalMessage().
  static PubSubClient& mqtt();
  static bool isRoidTopic(const char* topic);
  static void handleInternalMessage(const char* topic, const byte* payload, unsigned int length);

  // ----- state -----
  static RoidStatus status();
  static const char* statusStr();
  static bool isConnected();
  // ID of the firmware installed by the last successful OTA ("" if none).
  static const String& firmwareId();

private:
  static RoidStatus currentStatus;
  static WiFiClient espClient;
  static PubSubClient mqttClient;

  static String deviceId;
  static String mqttUsername;
  static String mqttPassword;
  static String mqttHost;
  static uint16_t mqttPort;
  static const char* caCert;
  static String currentFirmwareId;

  static UserFunction userSetup;
  static UserFunction userLoop;
  static RoidMessageCallback userCallback;
  static String userTopics[ROIDOTA_MAX_USER_TOPICS];
  static uint8_t userTopicCount;

  static unsigned long bootTime;
  static unsigned long lastHeartbeat;
  static unsigned long lastReconnect;
  static unsigned long restartAt;
  static bool otaInProgress;

  static String topicStatus;
  static String topicResponse;
  static String topicCmd;
  static String topicAck;
  static String topicLogs;

  static void setStatus(RoidStatus newStatus);
  static const char* getStatusStr(RoidStatus status);
  static void connectWiFi();
  static bool connectMQTT(bool announce);
  static void callback(char* topic, byte* payload, unsigned int length);
  static void flushMQTT(unsigned long durationMs);

  static void sendHeartbeat();
  static void sendOtaRequest();
  static void sendOtaAck(bool success, const char* message, const String& deploymentId);
  static void sendLog(const char* level, const char* message);

  static void handleOtaResponse(const String& message);
  static void handleCommand(const String& message);
  static void performOTA(const String& url, const String& md5, size_t expectedSize,
                         const String& deploymentId, const String& newFirmwareId);
  static bool downloadAndFlash(const String& url, const String& md5, size_t expectedSize,
                               String& error);
  static unsigned long getUptime();
};

#endif
