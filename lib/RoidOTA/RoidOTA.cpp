#include "RoidOTA.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Update.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>

// ArduinoJson 7 replaced the fixed-capacity documents with JsonDocument.
#if ARDUINOJSON_VERSION_MAJOR >= 7
#define ROIDOTA_JSON(name, capacity) JsonDocument name
#else
#define ROIDOTA_JSON(name, capacity) DynamicJsonDocument name(capacity)
#endif

#ifdef ROIDOTA_SILENT
#define ROIDOTA_LOG(...)
#else
#define ROIDOTA_LOG(format, ...) Serial.printf("[RoidOTA] " format "\n", ##__VA_ARGS__)
#endif

namespace {
const unsigned long RECONNECT_INTERVAL_MS = 5000;
const unsigned long DOWNLOAD_STALL_TIMEOUT_MS = 15000;
const unsigned long WIFI_PORTAL_TIMEOUT_S = 180;
const uint16_t MQTT_BUFFER_SIZE = 2048;  // firmware offers carry a signed URL
const uint16_t MQTT_KEEPALIVE_S = 30;
const char* const PREFS_NAMESPACE = "roidota";
const char* const PREFS_FIRMWARE_ID = "fw_id";
}  // namespace

RoidStatus RoidOTA::currentStatus = RoidStatus::BOOTING;
WiFiClient RoidOTA::espClient;
PubSubClient RoidOTA::mqttClient(espClient);

String RoidOTA::deviceId = "esp_x";
String RoidOTA::mqttUsername;
String RoidOTA::mqttPassword;
String RoidOTA::mqttHost = MQTT_SERVER;
uint16_t RoidOTA::mqttPort = MQTT_PORT;
const char* RoidOTA::caCert = nullptr;
String RoidOTA::currentFirmwareId;

UserFunction RoidOTA::userSetup = nullptr;
UserFunction RoidOTA::userLoop = nullptr;
RoidMessageCallback RoidOTA::userCallback = nullptr;
String RoidOTA::userTopics[ROIDOTA_MAX_USER_TOPICS];
uint8_t RoidOTA::userTopicCount = 0;

unsigned long RoidOTA::bootTime = 0;
unsigned long RoidOTA::lastHeartbeat = 0;
unsigned long RoidOTA::lastReconnect = 0;
unsigned long RoidOTA::restartAt = 0;
bool RoidOTA::otaInProgress = false;

String RoidOTA::topicStatus;
String RoidOTA::topicResponse;
String RoidOTA::topicCmd;
String RoidOTA::topicAck;
String RoidOTA::topicLogs;

// ========== Status ==========
RoidStatus RoidOTA::status() { return currentStatus; }

const char* RoidOTA::statusStr() { return getStatusStr(currentStatus); }

bool RoidOTA::isConnected() { return mqttClient.connected(); }

const String& RoidOTA::firmwareId() { return currentFirmwareId; }

const char* RoidOTA::getStatusStr(RoidStatus s) {
  switch (s) {
    case RoidStatus::BOOTING: return "BOOTING";
    case RoidStatus::DISCONNECTED: return "DISCONNECTED";
    case RoidStatus::WIFI_CONNECTED: return "WIFI_CONNECTED";
    case RoidStatus::MqTT_CONNECTED: return "MQTT_CONNECTED";
    case RoidStatus::UPDATING: return "UPDATING";
    case RoidStatus::ERROR: return "ERROR";
    default: return "UNKNOWN";
  }
}

void RoidOTA::setStatus(RoidStatus newStatus) {
  if (newStatus == currentStatus) return;
  RoidStatus oldStatus = currentStatus;
  currentStatus = newStatus;

  char buf[96];
  snprintf(buf, sizeof(buf), "Status changed: %s -> %s", getStatusStr(oldStatus), statusStr());
  ROIDOTA_LOG("%s", buf);
  sendLog("INFO", buf);
}

// ========== Configuration ==========
void RoidOTA::setServer(const char* host, uint16_t port) {
  mqttHost = host ? host : "";
  mqttPort = port;
}

void RoidOTA::setCACert(const char* rootCA) { caCert = rootCA; }

void RoidOTA::onMessage(RoidMessageCallback cb) { userCallback = cb; }

PubSubClient& RoidOTA::mqtt() { return mqttClient; }

bool RoidOTA::publish(const char* topic, const char* payload, bool retained) {
  return mqttClient.connected() && mqttClient.publish(topic, payload, retained);
}

bool RoidOTA::subscribe(const char* topic) {
  if (!topic || !*topic) return false;

  bool known = false;
  for (uint8_t i = 0; i < userTopicCount; i++) {
    if (userTopics[i] == topic) known = true;
  }
  if (!known) {
    if (userTopicCount >= ROIDOTA_MAX_USER_TOPICS) {
      ROIDOTA_LOG("Cannot subscribe to %s: raise ROIDOTA_MAX_USER_TOPICS", topic);
      return false;
    }
    userTopics[userTopicCount++] = topic;
  }
  // When offline, the subscription is made on the next (re)connect.
  return mqttClient.connected() ? mqttClient.subscribe(topic) : true;
}

// ========== begin() / handle() ==========
void RoidOTA::begin(const char* id, UserFunction setupFn, UserFunction loopFn) {
  begin(id, "", "", setupFn, loopFn);
}

void RoidOTA::begin(const char* id, const char* username, const char* password,
                    UserFunction setupFn, UserFunction loopFn) {
  // Copied, so callers may pass temporaries.
  deviceId = id ? id : "";
  mqttUsername = username ? username : "";
  mqttPassword = password ? password : "";
  userSetup = setupFn;
  userLoop = loopFn;
  bootTime = millis();

  topicStatus = "roidota/status/" + deviceId;
  topicResponse = "roidota/response/" + deviceId;
  topicCmd = "roidota/cmd/" + deviceId;
  topicAck = "roidota/ack/" + deviceId;
  topicLogs = "roidota/logs/" + deviceId;

  Serial.begin(115200);
  ROIDOTA_LOG("Booting device: %s", deviceId.c_str());

  Preferences prefs;
  if (prefs.begin(PREFS_NAMESPACE, true)) {
    currentFirmwareId = prefs.getString(PREFS_FIRMWARE_ID, "");
    prefs.end();
  }

  connectWiFi();

  if (mqttHost.length() == 0) {
    ROIDOTA_LOG("No MQTT broker configured: define MQTT_SERVER or call setServer()");
  }
  mqttClient.setServer(mqttHost.c_str(), mqttPort);
  mqttClient.setCallback(callback);
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);
  mqttClient.setKeepAlive(MQTT_KEEPALIVE_S);
  mqttClient.setSocketTimeout(5);

  // A single attempt: if the broker is down, handle() keeps retrying in the
  // background while the application runs normally.
  lastReconnect = millis();
  connectMQTT(true);

  if (userSetup) userSetup();
}

void RoidOTA::handle() {
  if (restartAt != 0 && (long)(millis() - restartAt) >= 0) {
    mqttClient.disconnect();
    delay(100);
    ESP.restart();
  }

  if (mqttClient.connected()) {
    mqttClient.loop();

    if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL) {
      sendHeartbeat();
      // An error is reported for one heartbeat period, then cleared.
      if (currentStatus == RoidStatus::ERROR) setStatus(RoidStatus::MqTT_CONNECTED);
    }
  } else {
    bool wifiUp = WiFi.status() == WL_CONNECTED;
    setStatus(wifiUp ? RoidStatus::WIFI_CONNECTED : RoidStatus::DISCONNECTED);

    // Non-blocking: one connection attempt per interval, never a retry loop.
    if (wifiUp && millis() - lastReconnect >= RECONNECT_INTERVAL_MS) {
      lastReconnect = millis();
      connectMQTT(true);
    }
  }

  if (userLoop) userLoop();
}

// ========== WiFi ==========
void RoidOTA::connectWiFi() {
  WiFiManager wm;
  wm.setTitle(deviceId);
  wm.setConfigPortalTimeout(WIFI_PORTAL_TIMEOUT_S);
  String apName = "RoidOTA-" + deviceId;

  if (!wm.autoConnect(apName.c_str())) {
    ROIDOTA_LOG("WiFi connection failed. Restarting...");
    delay(3000);
    ESP.restart();
  }

  WiFi.setAutoReconnect(true);
  ROIDOTA_LOG("WiFi connected, IP: %s", WiFi.localIP().toString().c_str());
  setStatus(RoidStatus::WIFI_CONNECTED);
}

// ========== MQTT ==========
// Makes one connection attempt. `announce` is false while an update is being
// applied, so the backend does not mistake the reconnect for a reboot.
bool RoidOTA::connectMQTT(bool announce) {
  if (mqttHost.length() == 0) return false;
  ROIDOTA_LOG("Connecting to MQTT broker %s:%u...", mqttHost.c_str(), mqttPort);

  // Last will: the broker reports the device offline if it vanishes.
  String will = "{\"device_id\":\"" + deviceId + "\",\"status\":\"offline\"}";
  bool hasCredentials = mqttUsername.length() > 0;
  bool connected = mqttClient.connect(
      deviceId.c_str(),
      hasCredentials ? mqttUsername.c_str() : nullptr,
      hasCredentials ? mqttPassword.c_str() : nullptr,
      topicStatus.c_str(), 1, false, will.c_str());

  if (!connected) {
    // -4 timeout, -2 connect failed, 4 bad credentials, 5 unauthorized
    ROIDOTA_LOG("MQTT connect failed (state %d), retrying in %lus",
                mqttClient.state(), RECONNECT_INTERVAL_MS / 1000);
    return false;
  }

  bool subscribed = mqttClient.subscribe(topicResponse.c_str(), 1);
  subscribed = mqttClient.subscribe(topicCmd.c_str(), 1) && subscribed;
  for (uint8_t i = 0; i < userTopicCount; i++) {
    subscribed = mqttClient.subscribe(userTopics[i].c_str()) && subscribed;
  }
  if (!subscribed) ROIDOTA_LOG("One or more subscriptions failed");

  ROIDOTA_LOG("MQTT connected as %s", deviceId.c_str());
  if (announce) {
    setStatus(RoidStatus::MqTT_CONNECTED);
    sendOtaRequest();
  }
  sendHeartbeat();
  return true;
}

void RoidOTA::flushMQTT(unsigned long durationMs) {
  unsigned long start = millis();
  while (millis() - start < durationMs) {
    mqttClient.loop();
    delay(10);
  }
}

void RoidOTA::callback(char* topic, byte* payload, unsigned int length) {
  if (isRoidTopic(topic)) {
    handleInternalMessage(topic, payload, length);
  } else if (userCallback) {
    userCallback(topic, payload, length);
  }
}

bool RoidOTA::isRoidTopic(const char* topic) {
  return strncmp(topic, "roidota/", 8) == 0;
}

void RoidOTA::handleInternalMessage(const char* topic, const byte* payload, unsigned int len) {
  // Copy first: publishing from a handler reuses the client's receive buffer.
  String msg;
  msg.reserve(len);
  for (unsigned int i = 0; i < len; ++i) msg += (char)payload[i];

  if (topicResponse == topic) {
    handleOtaResponse(msg);
  } else if (topicCmd == topic) {
    handleCommand(msg);
  }
}

// ========== Outgoing messages ==========
void RoidOTA::sendOtaRequest() {
  ROIDOTA_JSON(doc, 384);
  doc["device_id"] = deviceId;
  doc["ip"] = WiFi.localIP().toString();
  doc["protocol"] = ROIDOTA_PROTOCOL_VERSION;
  if (currentFirmwareId.length() > 0) {
    doc["firmware_id"] = currentFirmwareId;
  } else {
    doc["firmware_id"] = nullptr;
  }
  doc["status"] = statusStr();
  doc["timestamp"] = millis();

  String out;
  serializeJson(doc, out);
  mqttClient.publish("roidota/request", out.c_str());
}

void RoidOTA::sendHeartbeat() {
  lastHeartbeat = millis();
  if (!mqttClient.connected()) return;

  ROIDOTA_JSON(doc, 512);
  doc["device_id"] = deviceId;
  doc["ip"] = WiFi.localIP().toString();
  doc["uptime"] = getUptime();
  doc["rssi"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  if (currentFirmwareId.length() > 0) doc["firmware_id"] = currentFirmwareId;
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  String out;
  serializeJson(doc, out);
  mqttClient.publish(topicStatus.c_str(), out.c_str());
}

void RoidOTA::sendLog(const char* level, const char* message) {
  if (!mqttClient.connected()) return;

  ROIDOTA_JSON(doc, 512);
  doc["device_id"] = deviceId;
  doc["level"] = level;
  doc["message"] = message;
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  String out;
  serializeJson(doc, out);
  mqttClient.publish(topicLogs.c_str(), out.c_str());
}

void RoidOTA::sendOtaAck(bool success, const char* msg, const String& deploymentId) {
  ROIDOTA_JSON(doc, 512);
  doc["device_id"] = deviceId;
  doc["success"] = success;
  doc["message"] = msg;
  if (deploymentId.length() > 0) doc["deployment_id"] = deploymentId;
  doc["timestamp"] = millis();
  doc["status"] = statusStr();

  String out;
  serializeJson(doc, out);
  bool published = mqttClient.publish(topicAck.c_str(), out.c_str());
  ROIDOTA_LOG("OTA ack (%s: %s) %s", success ? "success" : "failure", msg,
              published ? "sent" : "NOT sent");
}

// ========== OTA ==========
void RoidOTA::handleOtaResponse(const String& message) {
  ROIDOTA_JSON(doc, 2048);
  DeserializationError parseError = deserializeJson(doc, message);
  if (parseError) {
    ROIDOTA_LOG("Firmware offer is not valid JSON: %s", parseError.c_str());
    sendLog("ERROR", "Failed to parse OTA response");
    sendOtaAck(false, "JSON parse error", "");
    return;
  }

  String deploymentId = doc["deployment_id"] | "";
  String url = doc["firmware_url"] | "";
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    ROIDOTA_LOG("Firmware offer has no usable firmware_url");
    sendLog("ERROR", "Invalid firmware URL");
    sendOtaAck(false, "Invalid firmware URL", deploymentId);
    return;
  }

  if (otaInProgress) {
    ROIDOTA_LOG("Ignoring firmware offer: an update is already running");
    return;
  }

  String md5 = doc["md5"] | "";
  String newFirmwareId = doc["firmware_id"] | "";
  size_t expectedSize = doc["size"] | 0;
  performOTA(url, md5, expectedSize, deploymentId, newFirmwareId);
}

void RoidOTA::performOTA(const String& url, const String& md5, size_t expectedSize,
                         const String& deploymentId, const String& newFirmwareId) {
  otaInProgress = true;
  ROIDOTA_LOG("Starting OTA (%u bytes expected)", (unsigned)expectedSize);

  setStatus(RoidStatus::UPDATING);
  sendHeartbeat();  // tells the backend the update is in progress
  flushMQTT(200);

  String error;
  bool ok = downloadAndFlash(url, md5, expectedSize, error);

  // A long download can outlast the MQTT keep-alive; the result must still
  // reach the backend, so restore the connection before reporting.
  for (uint8_t attempt = 0; attempt < 3 && !mqttClient.connected(); attempt++) {
    if (!connectMQTT(false)) delay(1000);
  }

  if (ok) {
    if (newFirmwareId.length() > 0) {
      // Reported on the next boot, so the backend can confirm the update
      // even if the acknowledgement below gets lost.
      Preferences prefs;
      if (prefs.begin(PREFS_NAMESPACE, false)) {
        prefs.putString(PREFS_FIRMWARE_ID, newFirmwareId);
        prefs.end();
      }
    }
    sendOtaAck(true, "Update success. Rebooting...", deploymentId);
    sendLog("INFO", "OTA success - restarting now");
    flushMQTT(1000);
    mqttClient.disconnect();  // clean disconnect: no "offline" last will
    delay(500);
    ESP.restart();
  }

  ROIDOTA_LOG("OTA failed: %s", error.c_str());
  setStatus(RoidStatus::ERROR);
  sendLog("ERROR", error.c_str());
  sendOtaAck(false, error.c_str(), deploymentId);
  sendHeartbeat();
  otaInProgress = false;
}

// Streams the image into the inactive OTA partition. Returns false and fills
// `error` on any failure; the running firmware is left untouched in that case.
bool RoidOTA::downloadAndFlash(const String& url, const String& md5, size_t expectedSize,
                               String& error) {
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  HTTPClient http;
  http.setTimeout(15000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  bool began;
  if (url.startsWith("https://")) {
    if (caCert) {
      secureClient.setCACert(caCert);
    } else {
      ROIDOTA_LOG("No CA certificate set: HTTPS server is not authenticated");
      secureClient.setInsecure();
    }
    began = http.begin(secureClient, url);
  } else {
    began = http.begin(plainClient, url);
  }
  if (!began) {
    error = "Invalid firmware URL";
    return false;
  }

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    error = "Failed to fetch update (HTTP " + String(httpCode) + ")";
    http.end();
    return false;
  }

  int contentLength = http.getSize();
  if (contentLength <= 0) {
    error = "Server did not report the firmware size";
    http.end();
    return false;
  }
  if (expectedSize > 0 && (size_t)contentLength != expectedSize) {
    error = "Firmware size mismatch";
    http.end();
    return false;
  }

  if (!Update.begin((size_t)contentLength)) {
    error = String("Not enough space: ") + Update.errorString();
    http.end();
    return false;
  }
  if (md5.length() == 32) Update.setMD5(md5.c_str());

  WiFiClient* stream = http.getStreamPtr();
  static uint8_t buffer[1024];
  size_t written = 0;
  unsigned long lastData = millis();
  unsigned long lastKeepAlive = millis();

  while (written < (size_t)contentLength) {
    size_t available = stream->available();
    if (available > 0) {
      size_t toRead = min(available, sizeof(buffer));
      toRead = min(toRead, (size_t)contentLength - written);
      int read = stream->readBytes(buffer, toRead);
      if (read <= 0) continue;
      if (Update.write(buffer, read) != (size_t)read) {
        error = String("Flash write failed: ") + Update.errorString();
        break;
      }
      written += read;
      lastData = millis();
    } else if (!http.connected()) {
      error = "Connection lost during download";
      break;
    } else if (millis() - lastData > DOWNLOAD_STALL_TIMEOUT_MS) {
      error = "Download stalled";
      break;
    } else {
      delay(1);
    }

    // Keep the MQTT session alive while downloading.
    if (millis() - lastKeepAlive > 1000) {
      mqttClient.loop();
      lastKeepAlive = millis();
    }
  }
  http.end();

  if (error.length() > 0) {
    Update.abort();
    return false;
  }
  // Update.end() verifies the MD5 checksum and switches the boot partition.
  if (!Update.end()) {
    error = String("Update rejected: ") + Update.errorString();
    return false;
  }
  return true;
}

// ========== Command Handling ==========
void RoidOTA::handleCommand(const String& message) {
  ROIDOTA_JSON(doc, 512);
  if (deserializeJson(doc, message)) {
    ROIDOTA_LOG("Ignoring command that is not valid JSON");
    return;
  }

  String command = doc["command"] | "";
  if (command == "restart") {
    if (otaInProgress) return;  // the update restarts the device itself
    sendLog("INFO", "Device restarting...");
    // Deferred to handle(), so the log line and the QoS 1 ack are sent first.
    restartAt = millis() + 500;
    if (restartAt == 0) restartAt = 1;
  } else if (command == "heartbeat" || command == "status") {
    sendHeartbeat();
  } else {
    ROIDOTA_LOG("Unknown command: %s", command.c_str());
  }
}

// ========== Utilities ==========
unsigned long RoidOTA::getUptime() { return millis() - bootTime; }
