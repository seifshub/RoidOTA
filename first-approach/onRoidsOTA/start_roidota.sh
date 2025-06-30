#!/bin/bash

echo "🔄 Starting RoidOTA System..."

# Optional: Start MQTT broker
echo "🚀 Starting Mosquitto Broker..."
mosquitto -c mosquitto/mosquitto.conf > mqtt.log 2>&1 &

sleep 1

# Start RoidOTA server
echo "📡 Starting RoidOTA Server..."
python3 roidota_server.py > roidota_server.log 2>&1 &

echo "✅ All components launched."
