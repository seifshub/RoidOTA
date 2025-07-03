import json
import logging
from config import MANIFEST_PATH

firmware_map = {}

def load_manifest():
    global firmware_map
    try:
        with open(MANIFEST_PATH, 'r') as f:
            firmware_map = json.load(f)
        logging.info("📄 Manifest loaded.")
    except Exception as e:
        logging.warning(f"Could not load manifest: {e}")
        firmware_map = {}

def save_manifest(data):
    global firmware_map
    firmware_map = data
    with open(MANIFEST_PATH, 'w') as f:
        json.dump(firmware_map, f, indent=2)
    logging.info("Manifest saved.")

def get_firmware(device_id):
    return firmware_map.get(device_id)

def get_all():
    return firmware_map