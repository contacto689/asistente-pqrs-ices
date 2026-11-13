import os
import re
import hmac
import hashlib
import time
import tempfile
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

app = Flask(__name__, static_folder='frontend', static_url_path='')
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024  # Límite 25 MB por petición
CORS(app, resources={r"/*": {"origins": "*"}})

# Configuración de seguridad y credenciales
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "ices-admin-2026")
COLAB_PASSWORD = os.environ.get("COLAB_PASSWORD", "ices-colab-2026")
SECRET_KEY = os.environ.get("SECRET_KEY", "ices-hmac-default-key").encode("utf-8")

client = genai.Client(api_key=GEMINI_API_KEY, http_options={'api_version': 'v1beta'}) if GEMINI_API_KEY else None

# Registro en memoria de los PDFs activos (máximo 5 manuales institucionales)
MAX_MANUALES = 5
MANUALES_ACTIVOS = {}  # { file_name_api: { "display_name": str, "size_mb": float, "uploaded_at": str } }


# --- CAPA DE SEGURIDAD Y CIFRADO DE SESIÓN ---
def generar_token(rol: str) -> str:
    expira = int(time.time()) + (8 * 3600)  # Sesión válida por 8 horas
    payload = f"{rol}:{expira}"
    firma = hmac.new(SECRET_KEY, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{firma}"


def verificar_token(token: str):
    try:
        rol, expira_str, firma = token.split(":")
        if int(expira_str) < int(time.time()):
            return None
        payload = f"{rol}:{expira_str}"
        firma_esperada = hmac.new(SECRET_KEY, payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if hmac.compare_digest(firma, firma_esperada):
            return rol
    except Exception:
        return None
    return None


def requiere_rol(roles_permitidos):
    def decorador(f):
        @wraps(f)
        def envuelto(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "").strip()
            rol = verificar_token(token)
            if not rol or rol not in roles_permitidos:
                return jsonify({"error": "Acceso no autorizado o sesión expirada."}), 403
            request.usuario_rol = rol
            return f(*args, **kwargs)
        return envuelto
    return decorador


# --- CAPA DE PROTECCIÓN / ANONIMIZACIÓN DE DATOS PERSONALES (HABEAS DATA) ---
def anonimizar_datos_personales(texto: str):
    """Enmascara correos, cédulas/NIT, teléfonos y nombres tras etiquetas comunes antes de salir a la IA."""
    redacciones = 0

    # 1. Correos electrónicos
    texto, n = re.subn(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL_PROTEGIDO]', texto)
    redacciones += n

    # 2. Teléfonos / Celulares (7 a 12 dígitos)
    texto, n = re.subn(r'(?<!\d)(\+?57\s*)?(3\d{2}[\s-]?\d{3}[\s-]?\d{4}|\d{7,10})(?!\d)', '[TELEFONO_PROTEGIDO]', texto)
    redacciones += n

    # 3. Cédulas / Documentos con puntos o prefijos CC/NIT/TI
    texto, n = re.subn(r'\b(CC|C\.C\.|TI|T\.I\.|NIT|CE|Identificación|Cédula)\s*[:#-]?\s*[\d.,]{5,15}\b', r'\1 [DOCUMENTO_PROTEGIDO]', texto, flags=re.IGNORECASE)
    redacciones += n

    # 4. Nombres propios explícitos tras etiquetas típicas en PQRS
    texto, n = re.subn(
        r'(Peticionario|Solicitante|Nombre|Ciudadano|Suscrito|Remitente)\s*[:]\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})',
        r'\1: [NOMBRE_PROTEGIDO]',
        texto
    )
    redacciones += n

    return texto, redacciones


# --- RUTAS PÚBLICAS ---
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "proyecto": "Asistente PQRS ICES",
        "version": "2.1-secure",
        "manuales_cargados": len(MANUALES_ACTIVOS)
    }), 200


@app.route('/api/login', methods=['POST'])
def login():
    datos = request.get_json(silent=True) or {}
    rol = datos.get("rol", "").strip().lower()
    password = datos.get("password", "")

    if rol == "admin" and hmac.compare_digest(password, ADMIN_PASSWORD):
        return jsonify({"token": generar_token("admin"), "rol": "admin"})
    elif rol == "colaborador" and hmac.compare_digest(password, COLAB_PASSWORD):
        return jsonify({"token": generar_token("colaborador"), "rol": "colaborador"})

    return jsonify({"error": "Credenciales incorrectas para el perfil seleccionado."}), 401


# --- RUTAS DE GESTIÓN DOCUMENTAL (SOLO ADMINISTRADOR) ---
@app.route('/api/documentos', methods=['GET'])
@requiere_rol(["admin", "colaborador"])
def listar_documentos():
    lista = [
        {"id": k, "nombre": v["display_name"], "size_mb": v["size_mb"], "fecha": v["uploaded_at"]}
        for k, v in MANUALES_ACTIVOS.items()
    ]
    return jsonify({"documentos": lista, "maximo": MAX_MANUALES})


@app.route('/api/documentos/subir', methods=['POST'])
@requiere_rol(["admin"])
def subir_documento():
    if not client:
        return jsonify({"error": "GEMINI_API_KEY no configurada en el servidor."}), 500

    if len(MANUALES_ACTIVOS) >= MAX_MANUALES:
        return jsonify({"error": f"Límite alcanzado: máximo {MAX_MANUALES} manuales PDF activos. Elimine uno antes de subir otro."}), 400

    if 'archivo' not in request.files:
        return jsonify({"error": "No se recibió ningún archivo PDF."}), 400

    archivo = request.files['archivo']
    if not archivo.filename.lower().endswith('.pdf'):
        return jsonify({"error": "Solo se permiten manuales en formato PDF."}), 400

    contenido = archivo.read()
    size_mb = round(len(contenido) / (1024 * 1024), 2)
    if size_mb > 20.0:
        return jsonify({"error": f"El archivo pesa {size_mb} MB y supera el máximo permitido de 20 MB."}), 400

    # Guardar temporalmente de forma segura, subir a Gemini Files API y borrar archivo temporal local
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(contenido)
            tmp_path = tmp.name

        uploaded_file = client.files.upload(
            file=tmp_path,
            config=types.UploadFileConfig(
                display_name=archivo.filename,
                mime_type="application/pdf"
            )
        )

        MANUALES_ACTIVOS[uploaded_file.name] = {
            "file_obj": uploaded_file,
            "display_name": archivo.filename,
            "size_mb": size_mb,
            "uploaded_at": time.strftime("%Y-%m-%d %H:%M")
        }

        return jsonify({
            "mensaje": f"Manual '{archivo.filename}' cargado y cifrado en el motor documental.",
            "documento": {
                "id": uploaded_file.name,
                "nombre": archivo.filename,
                "size_mb": size_mb
            }
        }), 201
    except Exception as e:
        return jsonify({"error": f"Error procesando el PDF: {str(e)}"}), 500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.route('/api/documentos/<path:doc_id>', methods=['DELETE'])
@requiere_rol(["admin"])
def eliminar_documento(doc_id):
    if doc_id not in MANUALES_ACTIVOS:
        return jsonify({"error": "Documento no encontrado."}), 404
    try:
        if client:
            client.files.delete(name=doc_id)
    except Exception:
        pass
    nombre = MANUALES_ACTIVOS.pop(doc_id)["display_name"]
    return jsonify({"mensaje": f"Manual '{nombre}' eliminado correctamente."})


# --- RUTA DE CONSULTA Y REDACCIÓN PQRS (ADMINISTRADOR Y COLABORADOR) ---
@app.route('/api/consultar', methods=['POST'])
@requiere_rol(["admin", "colaborador"])
def consultar_pqrs():
    if not client:
        return jsonify({"error": "GEMINI_API_KEY no configurada en el servidor."}), 500

    if not MANUALES_ACTIVOS:
        return jsonify({
            "error": "No hay manuales PDF cargados. El Administrador debe subir al menos un manual del ICES antes de realizar consultas."
        }), 400

    datos = request.get_json(silent=True) or {}
    modo = datos.get("modo", "respuesta_pqrs")  # 'respuesta_pqrs' o 'consulta_normativa'
    texto_usuario = datos.get("texto", "").strip()

    if not texto_usuario:
        return jsonify({"error": "Debe ingresar el texto de la PQRS o la consulta."}), 400

    # Anonimización obligatoria antes de enviar a Gemini
    texto_seguro, datos_protegidos = anonimizar_datos_personales(texto_usuario)

    if modo == "respuesta_pqrs":
        instruccion_modo = (
            "MODO: REDACCIÓN DE RESPUESTA OFICIAL DE PQRS DEL ICES.\n"
            "Estructura la salida con:\n"
            "1. CLASIFICACIÓN Y PLAZO LEGAL/INTERNO (según los manuales).\n"
            "2. BORRADOR DE RESPUESTA FORMAL AL PETICIONARIO (tono institucional, claro y respetuoso, manteniendo intactas las etiquetas [NOMBRE_PROTEGIDO], [DOCUMENTO_PROTEGIDO], etc. para que el funcionario las complete localmente).\n"
            "3. FUENTES CITADAS (indica el nombre exacto del PDF y capítulo/artículo/página de donde se extrajo cada fundamento)."
        )
    else:
        instruccion_modo = (
            "MODO: CONSULTA NORMATIVA INTERNA DEL ICES.\n"
            "Responde de forma directa, técnica y estructurada a la pregunta del colaborador, citando textualmente "
            "el nombre del manual PDF, sección o artículo exacto que respalda cada afirmación."
        )

    system_prompt = (
        "Eres el Asistente Oficial de Gestión de PQRS del ICES. "
        "REGLA ABSOLUTA DE CERO ALUCINACIONES:\n"
        "- Responde ÚNICA Y EXCLUSIVAMENTE utilizando la información contenida en los manuales PDF adjuntos.\n"
        "- Tienes ESTRICTAMENTE PROHIBIDO usar conocimiento externo, suponer procedimientos o completar vacíos.\n"
        "- Si los manuales adjuntos NO contienen información suficiente para responder total o parcialmente la solicitud, "
        "decláralo explícitamente diciendo: '⚠️ SIN SOPORTE EN MANUALES CARGADOS: Los documentos oficiales del ICES cargados actualmente no contemplan este caso específico.'\n"
        "- Nunca reveles ni intentes reconstruir datos personales enmascarados.\n\n"
        f"{instruccion_modo}"
    )

    # Adjuntar todos los manuales activos + la consulta anonimizada
    contenidos = [info["file_obj"] for info in MANUALES_ACTIVOS.values()]
    contenidos.append(f"SOLICITUD DEL FUNCIONARIO:\n{texto_seguro}")

    try:
        respuesta = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contenidos,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.0
            )
        )

        return jsonify({
            "respuesta": respuesta.text,
            "datos_anonimizados": datos_protegidos,
            "manuales_consultados": [v["display_name"] for v in MANUALES_ACTIVOS.values()]
        })
    except Exception as e:
        return jsonify({"error": f"Error en el motor de análisis: {str(e)}"}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port)