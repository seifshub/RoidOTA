import paho.mqtt.client as mqtt
import logging
from config import MQTT_BROKER, MQTT_PORT, REQUEST_TOPIC, RESPONSE_BASE_TOPIC
from manifest import get_firmware

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        logging.info("MQTT Connected")
        client.subscribe(REQUEST_TOPIC)
    else:
        logging.error(f"MQTT Connection failed with code {rc}")

def on_message(client, userdata, msg):
    try:
        device_id = msg.payload.decode("utf-8").strip()
        logging.info(f"Received device ID: {device_id}")
        firmware = get_firmware(device_id)
        if firmware:
            response_topic = RESPONSE_BASE_TOPIC + device_id
            client.publish(response_topic, firmware)
            logging.info(f"Sent firmware '{firmware}' to {device_id}")
        else:
            logging.warning(f"No firmware mapped for {device_id}")
    except Exception as e:
        logging.error(f"Error handling MQTT message: {e}")

def run_mqtt():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, MQTT_PORT)
    client.loop_forever()