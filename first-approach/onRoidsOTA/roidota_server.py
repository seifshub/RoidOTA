import paho.mqtt.client as mqtt
import json

broker_address = "localhost"
request_topic = "roidota/request"
response_base_topic = "roidota/response/"
manifest_path = "manifest.json"

# Load manifest once
def load_manifest():
    try:
        with open(manifest_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ Failed to load manifest: {e}")
        return {}

firmware_map = load_manifest()

def on_connect(client, userdata, flags, rc):
    print("✅ MQTT Connected" if rc == 0 else f"❌ Failed to connect, code {rc}")
    client.subscribe(request_topic)

def on_message(client, userdata, msg):
    try:
        device_id = msg.payload.decode('utf-8').strip()
        print(f"📥 Received device ID: {device_id}")

        firmware = firmware_map.get(device_id)
        if firmware:
            response_topic = response_base_topic + device_id
            client.publish(response_topic, firmware)
            print(f"📤 Sent firmware '{firmware}' to {device_id}")
        else:
            print(f"⚠️ No firmware found for {device_id}")
    except Exception as e:
        print(f"❌ Error handling message: {e}")

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

client.connect(broker_address)
client.loop_forever()
