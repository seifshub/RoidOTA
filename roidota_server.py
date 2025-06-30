
from flask import Flask, jsonify, request
import json
import threading
import paho.mqtt.client as mqtt

app = Flask(__name__)

manifest_path = "firmware_manifest.json"
firmware_map = {}

mqtt_broker = "localhost"
mqtt_port = 1883
request_topic = "roidota/request"
response_base_topic = "roidota/response/"

# Load manifest
@app.route("/manifest", methods=["GET"])
def get_manifest():
    return jsonify(firmware_map)

@app.route("/manifest", methods=["POST"])
def update_manifest():
    global firmware_map
    try:
        firmware_map = request.json
        with open(manifest_path, 'w') as f:
            json.dump(firmware_map, f, indent=2)
        return {"status": "success", "message": "Manifest updated."}, 200
    except Exception as e:
        return {"status": "error", "message": str(e)}, 400

# MQTT logic

def load_manifest():
    global firmware_map
    try:
        with open(manifest_path, 'r') as f:
            firmware_map = json.load(f)
    except Exception as e:
        print(f"❌ Could not load manifest: {e}")
        firmware_map = {}

def on_connect(client, userdata, flags, rc):
    print("✅ MQTT Connected" if rc == 0 else f"❌ MQTT Connect failed: {rc}")
    client.subscribe(request_topic)

def on_message(client, userdata, msg):
    try:
        device_id = msg.payload.decode("utf-8").strip()
        print(f"📥 Received device ID: {device_id}")
        firmware = firmware_map.get(device_id)
        if firmware:
            response_topic = response_base_topic + device_id
            client.publish(response_topic, firmware)
            print(f"📤 Sent firmware '{firmware}' to {device_id}")
        else:
            print(f"⚠️ No firmware mapped for {device_id}")
    except Exception as e:
        print(f"❌ Error in MQTT message: {e}")

def run_mqtt():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(mqtt_broker, mqtt_port)
    client.loop_forever()

if __name__ == '__main__':
    load_manifest()
    threading.Thread(target=run_mqtt, daemon=True).start()
    app.run(host="0.0.0.0", port=5000)
