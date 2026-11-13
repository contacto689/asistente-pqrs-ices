from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='frontend', static_url_path='')
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "proyecto": "Asistente PQRS ICES",
        "version": "2.0-init"
    }), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port)