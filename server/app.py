from flask import Flask
import threading
from manifest import load_manifest
from mqtt_handler import run_mqtt
from routes import manifest_bp

app = Flask(__name__)
app.register_blueprint(manifest_bp)

if __name__ == '__main__':
    load_manifest()
    threading.Thread(target=run_mqtt, daemon=True).start()
    app.run(host="0.0.0.0", port=5000)