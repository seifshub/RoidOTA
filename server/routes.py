from flask import Blueprint, request, jsonify
from manifest import get_all, save_manifest

manifest_bp = Blueprint('manifest_bp', __name__)

@manifest_bp.route("/manifest", methods=["GET"])
def get_manifest():
    return jsonify(get_all())

@manifest_bp.route("/manifest", methods=["POST"])
def update_manifest():
    try:
        data = request.get_json()
        if not isinstance(data, dict):
            raise ValueError("Manifest must be a JSON object")
        save_manifest(data)
        return {"status": "success", "message": "Manifest updated."}, 200
    except Exception as e:
        return {"status": "error", "message": str(e)}, 400