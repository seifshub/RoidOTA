// lib/RoidOTA/src/RoidOTA.h
#ifndef ROIDOTA_H
#define ROIDOTA_H

#include <WiFiClient.h>
#include <PubSubClient.h>
#include <Update.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

namespace RoidOTA {

void begin(PubSubClient& client, const char* deviceId);
void loop();
void handleMessage(char* topic, byte* payload, unsigned int length);

} // namespace RoidOTA

#endif