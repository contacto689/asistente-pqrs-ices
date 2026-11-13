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
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024
CORS(app, resources={r"/*": {"origins": "*"}})

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "ices-admin-2026")
COLAB_PASSWORD = os.environ.get("COLAB_PASSWORD", "ices-colab-2026")
SECRET_KEY = os.environ.get("SECRET_KEY", "ices-hmac-default-key").encode("utf-8")

client = genai.Client(api_key=GEMINI_API_KEY, http_options={'api_version': 'v1beta'}) if GEMINI_API_KEY else None

MAX_MANUALES = 5
MANUALES_ACTIVOS = {}


def generar_token(rol: str) -> str:
    expira = int(time.time()) + (8 * 3600)
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


def reparar_encoding(nombre: str) -> str:
    try:
        return nombre.encode('latin-1').decode('utf-8')
    except Exception:
        return nombre


def anonimizar_datos_personales(texto: str):
    detalle = {
        "correos": 0,
        "telefonos": 0,
        "documentos": 0,
        "nombres": 0
    }

    texto, n = re.subn(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL_PROTEGIDO]', texto)
    detalle["correos"] += n

    texto, n = re.subn(r'(?<!\d)(\+?57\s*)?(3\d{2}[\s-]?\d{3}[\s-]?\d{4}|\d{7,10})(?!\d)', '[TELEFONO_PROTEGIDO]', texto)
    detalle["telefonos"] += n

    texto, n = re.subn(
        r'\b(CC|C\.C\.|TI|T\.I\.|NIT|CE|Identificación|Cédula)\s*[:#-]?\s*[\d.,]{5,15}\b',
        r'\1 [DOCUMENTO_PROTEGIDO]',
        texto,
        flags=re.IGNORECASE
    )
    detalle["documentos"] += n

    texto, n = re.subn(
        r'(Peticionario|Solicitante|Nombre|Ciudadano|Suscrito|Remitente)\s*[:]\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){1,3})',
        r'\1: [NOMBRE_PROTEGIDO]',
        texto,
        flags=re.IGNORECASE
    )
    detalle["nombres"] += n

    texto, n = re.subn(
        r'\b(soy|mi nombre es|me llamo)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){1,3})(?=[,.\n]|$)',
        r'\1 [NOMBRE_PROTEGIDO]',
        texto,
        flags=re.IGNORECASE
    )
    detalle["nombres"] += n

    total = sum(detalle.values())
    return texto, total, detalle


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "proyecto": "Asistente PQRS ICFES",
        "version": "3.0-enterprise",
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
        return jsonify({"error": f"Límite alcanzado: máximo {MAX_MANUALES} manuales PDF activos."}), 400

    if 'archivo' not in request.files:
        return jsonify({"error": "No se recibió ningún archivo PDF."}), 400

    archivo = request.files['archivo']
    nombre_limpio = reparar_encoding(archivo.filename or "manual.pdf")

    if not nombre_limpio.lower().endswith('.pdf'):
        return jsonify({"error": "Solo se permiten manuales en formato PDF."}), 400

    contenido = archivo.read()
    size_mb = round(len(contenido) / (1024 * 1024), 2)
    if size_mb > 20.0:
        return jsonify({"error": f"El archivo pesa {size_mb} MB y supera el máximo permitido de 20 MB."}), 400

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(contenido)
            tmp_path = tmp.name

        uploaded_file = client.files.upload(
            file=tmp_path,
            config=types.UploadFileConfig(
                display_name=nombre_limpio,
                mime_type="application/pdf"
            )
        )

        MANUALES_ACTIVOS[uploaded_file.name] = {
            "file_obj": uploaded_file,
            "display_name": nombre_limpio,
            "size_mb": size_mb,
            "uploaded_at": time.strftime("%Y-%m-%d %H:%M")
        }

        return jsonify({
            "mensaje": f"Manual '{nombre_limpio}' cargado y cifrado en el motor documental.",
            "documento": {
                "id": uploaded_file.name,
                "nombre": nombre_limpio,
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


@app.route('/api/consultar', methods=['POST'])
@requiere_rol(["admin", "colaborador"])
def consultar_pqrs():
    if not client:
        return jsonify({"error": "GEMINI_API_KEY no configurada en el servidor."}), 500

    if not MANUALES_ACTIVOS:
        return jsonify({
            "error": "No hay manuales PDF cargados. El Administrador debe subir al menos un manual del ICFES antes de iniciar."
        }), 400

    datos = request.get_json(silent=True) or {}
    modo = datos.get("modo", "respuesta_pqrs")
    texto_usuario = datos.get("texto", "").strip()
    historial = datos.get("historial", [])

    if not texto_usuario:
        return jsonify({"error": "Escribe un mensaje o pega el texto de la PQRS."}), 400

    texto_seguro, total_pii, detalle_pii = anonimizar_datos_personales(texto_usuario)
    nombres_manuales = ", ".join([v["display_name"] for v in MANUALES_ACTIVOS.values()])

    if modo == "respuesta_pqrs":
        instruccion_modo = (
            "MODO ACTIVO: REDACCIÓN DE RESPUESTA OFICIAL PQRS PARA EL CIUDADANO.\n"
            "- Si el usuario solo saluda o hace una consulta general sin presentar un caso ciudadano, respóndele cordialmente como su Asistente IA del ICFES sin usar etiquetas de bloque.\n"
            "- Cuando el usuario presente una PQRS o caso de un ciudadano, DEBES usar EXACTAMENTE estas etiquetas delimitadoras para que el sistema separe las tarjetas en pantalla:\n"
            "[[CLASIFICACION]]\n"
            "Tipo: <Petición | Queja | Reclamo | Sugerencia | Consulta>\n"
            "Tema: <Ej: Pagos y Devoluciones | Inscripciones | Citaciones | Resultados | General>\n"
            "Plazo: <Plazo legal según manuales o Ley 1755/2015, ej: 15 días hábiles>\n"
            "[[CARTA_OFICIAL]]\n"
            "<Redacta aquí únicamente la carta oficial formal, respetuosa y lista para enviar al ciudadano, dirigida a [NOMBRE_PROTEGIDO], explicando los pasos o requisitos según los documentos del ICFES. NUNCA incluyas citas textuales informales, marcas de tiempo de grabaciones ni nombres internos de funcionarios.>\n"
            "[[SOPORTE_INTERNO]]\n"
            "<Explica aquí al funcionario del ICFES en qué documento(s), sección o marca de tiempo exacta se respalda la respuesta y qué verificación interna debe realizar antes de enviar.>"
        )
    else:
        instruccion_modo = (
            "MODO ACTIVO: ASISTENTE CONVERSACIONAL Y CONSULTA INTERNA DEL ICFES.\n"
            "- Conversa de forma natural, cercana y clara con el colaborador como su asistente experto del ICFES.\n"
            "- Responde sus preguntas, resume procedimientos o aclara dudas citando con precisión el documento PDF correspondiente."
        )

    system_prompt = (
        f"Eres el Asistente IA Oficial de Gestión de PQRS del ICFES. Documentos institucionales cargados: [{nombres_manuales}].\n\n"
        "REGLA DE ORO — CERO ALUCINACIONES:\n"
        "- Todo procedimiento, requisito, plazo o canal de atención que indiques DEBE basarse estrictamente en los PDFs adjuntos.\n"
        "- Si un dato o requisito específico no aparece en los PDFs cargados, indícalo con claridad y sin inventar nada.\n"
        "- Conserva siempre las etiquetas de anonimización ([NOMBRE_PROTEGIDO], [DOCUMENTO_PROTEGIDO], etc.).\n\n"
        f"{instruccion_modo}"
    )

    contenidos = [info["file_obj"] for info in MANUALES_ACTIVOS.values()]

    if historial:
        resumen_chat = "\n".join([
            f"{'Colaborador' if m.get('rol') == 'user' else 'Asistente ICFES'}: {m.get('texto', '')}"
            for m in historial[-6:]
        ])
        contenidos.append(f"HISTORIAL RECIENTE:\n{resumen_chat}\n\nNUEVO MENSAJE:\n{texto_seguro}")
    else:
        contenidos.append(f"MENSAJE:\n{texto_seguro}")

    try:
        respuesta = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contenidos,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.2
            )
        )

        return jsonify({
            "respuesta": respuesta.text,
            "datos_anonimizados": total_pii,
            "detalle_pii": detalle_pii,
            "manuales_consultados": [v["display_name"] for v in MANUALES_ACTIVOS.values()]
        })
    except Exception as e:
        return jsonify({"error": f"Error en el motor de análisis: {str(e)}"}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port)