const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const URL_BASE = IS_LOCAL
    ? "http://127.0.0.1:8000"
    : "https://asistente-pqrs-ices.onrender.com";

let perfilSeleccionado = "colaborador";
let modoSeleccionado = "respuesta_pqrs";
let tokenSesion = sessionStorage.getItem("ices_token") || "";
let rolSesion = sessionStorage.getItem("ices_rol") || "";
let ultimaRespuestaTexto = "";
let historialChat = [];
let leyendoVoz = false;
let escalaFuente = 100;

window.onload = async () => {
    verificarServidor();
    if (tokenSesion && rolSesion) {
        mostrarPanelAutenticado();
    }
};

async function verificarServidor() {
    const punto = document.getElementById("indicador-servidor");
    const texto = document.getElementById("texto-servidor");
    try {
        const res = await fetch(`${URL_BASE}/health`);
        const data = await res.json();
        punto.className = "inline-block w-2 h-2 rounded-full bg-icfes-green";
        texto.innerText = `Sistema en línea · ${data.manuales_cargados} manual(es) activo(s)`;
    } catch {
        punto.className = "inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse";
        texto.innerText = "Iniciando servicio institucional...";
    }
}

function seleccionarPerfil(perfil) {
    perfilSeleccionado = perfil;
    const btnColab = document.getElementById("btn-perfil-colab");
    const btnAdmin = document.getElementById("btn-perfil-admin");
    const label = document.getElementById("label-perfil-activo");

    if (perfil === "colaborador") {
        btnColab.className = "p-3.5 rounded-xl border-2 border-icfes-navy bg-icfes-navy/5 text-left transition-all";
        btnAdmin.className = "p-3.5 rounded-xl border-2 border-slate-200 bg-white hover:border-icfes-navy/40 text-left transition-all";
        label.innerText = "Colaborador";
    } else {
        btnAdmin.className = "p-3.5 rounded-xl border-2 border-icfes-navy bg-icfes-navy/5 text-left transition-all";
        btnColab.className = "p-3.5 rounded-xl border-2 border-slate-200 bg-white hover:border-icfes-navy/40 text-left transition-all";
        label.innerText = "Administrativo";
    }
}

function seleccionarModo(modo) {
    modoSeleccionado = modo;
    const btnResp = document.getElementById("modo-respuesta");
    const btnCons = document.getElementById("modo-consulta");

    if (modo === "respuesta_pqrs") {
        btnResp.className = "p-3.5 rounded-xl border-2 border-icfes-navy bg-icfes-navy/5 text-left transition-all";
        btnCons.className = "p-3.5 rounded-xl border-2 border-slate-200 bg-white hover:border-icfes-navy/40 text-left transition-all";
    } else {
        btnCons.className = "p-3.5 rounded-xl border-2 border-icfes-navy bg-icfes-navy/5 text-left transition-all";
        btnResp.className = "p-3.5 rounded-xl border-2 border-slate-200 bg-white hover:border-icfes-navy/40 text-left transition-all";
    }
}

async function iniciarSesion(e) {
    e.preventDefault();
    const password = document.getElementById("input-password").value;
    const elError = document.getElementById("login-error");
    const btn = document.getElementById("btn-ingresar");

    elError.classList.add("hidden");
    btn.disabled = true;
    btn.innerText = "Validando...";

    try {
        const res = await fetch(`${URL_BASE}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rol: perfilSeleccionado, password })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Credenciales incorrectas.");

        tokenSesion = data.token;
        rolSesion = data.rol;
        sessionStorage.setItem("ices_token", tokenSesion);
        sessionStorage.setItem("ices_rol", rolSesion);
        document.getElementById("input-password").value = "";
        mostrarPanelAutenticado();
    } catch (err) {
        elError.innerText = err.message;
        elError.classList.remove("hidden");
    } finally {
        btn.disabled = false;
        btn.innerText = "Siguiente";
    }
}

function limpiarConversacion() {
    detenerLectorVoz();
    ultimaRespuestaTexto = "";
    historialChat = [];
    document.getElementById("texto-pqrs").value = "";
    document.getElementById("badge-habeas").classList.add("hidden");
    document.getElementById("btn-copiar").classList.add("hidden");
    document.getElementById("btn-voz").classList.add("hidden");
    document.getElementById("contenedor-respuesta").innerHTML = `
        <div class="flex items-start gap-3 text-slate-600 animate-view">
            <div class="w-8 h-8 rounded-full bg-icfes-navy text-white flex items-center justify-center font-display font-bold text-xs shrink-0 mt-0.5">
                IA
            </div>
            <div class="text-sm leading-relaxed">
                <p class="font-semibold text-icfes-deep">¡Bienvenido al Asistente PQRS del ICFES!</p>
                <p class="mt-1 text-slate-500">Escríbeme una consulta normativa o pega el texto de una solicitud ciudadana. Generaré una respuesta institucional fundamentada y podrás escucharla con el lector de voz integrado.</p>
            </div>
        </div>
    `;
}

function cerrarSesion() {
    tokenSesion = "";
    rolSesion = "";
    sessionStorage.removeItem("ices_token");
    sessionStorage.removeItem("ices_rol");
    limpiarConversacion();

    document.getElementById("vista-panel").classList.add("hidden");
    document.getElementById("barra-sesion").classList.add("hidden");
    document.getElementById("vista-login").classList.remove("hidden");
}

function mostrarPanelAutenticado() {
    document.getElementById("vista-login").classList.add("hidden");
    document.getElementById("vista-panel").classList.remove("hidden");
    document.getElementById("barra-sesion").classList.remove("hidden");

    const badge = document.getElementById("badge-rol");
    badge.innerText = rolSesion === "admin" ? "Perfil: Administrativo" : "Perfil: Colaborador";

    if (rolSesion === "admin") {
        document.getElementById("modulo-admin").classList.remove("hidden");
        document.getElementById("banner-docs-colaborador").classList.add("hidden");
    } else {
        document.getElementById("modulo-admin").classList.add("hidden");
        document.getElementById("banner-docs-colaborador").classList.remove("hidden");
    }

    cargarDocumentos();
}

async function cargarDocumentos() {
    try {
        const res = await fetch(`${URL_BASE}/api/documentos`, {
            headers: { "Authorization": `Bearer ${tokenSesion}` }
        });
        if (res.status === 403) return cerrarSesion();
        const data = await res.json();

        const docs = data.documentos || [];
        document.getElementById("contador-docs").innerText = `${docs.length} / ${data.maximo} cargados`;

        const listaAdmin = document.getElementById("lista-documentos-admin");
        if (docs.length === 0) {
            listaAdmin.innerHTML = `<p class="text-xs text-slate-500">Aún no hay manuales PDF cargados. Sube el primer documento para habilitar consultas.</p>`;
        } else {
            listaAdmin.innerHTML = docs.map(doc => `
                <div class="flex items-center justify-between bg-white border border-icfes-border rounded-xl px-4 py-3 shadow-xs animate-view">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-icfes-navy/10 text-icfes-navy flex items-center justify-center font-bold text-xs">
                            PDF
                        </div>
                        <div>
                            <div class="text-xs font-bold text-icfes-deep">${escapeHTML(doc.nombre)}</div>
                            <div class="text-[11px] text-slate-500">${doc.size_mb} MB · Cargado: ${doc.fecha}</div>
                        </div>
                    </div>
                    <button onclick="eliminarManual('${doc.id}')" class="text-xs text-rose-600 hover:bg-rose-50 font-bold px-3 py-1.5 rounded-full transition">
                        Eliminar
                    </button>
                </div>
            `).join("");
        }

        const nombresColab = document.getElementById("nombres-docs-colab");
        nombresColab.innerText = docs.length > 0
            ? docs.map(d => d.nombre).join("  ·  ")
            : "Ningún manual cargado aún (solicite al Administrador cargar los PDFs).";

        verificarServidor();
    } catch (err) {
        console.error(err);
    }
}

async function subirManual() {
    const input = document.getElementById("input-pdf");
    const btn = document.getElementById("btn-subir-pdf");
    const alerta = document.getElementById("alerta-admin");

    if (!input.files || input.files.length === 0) {
        mostrarAlertaAdmin("Selecciona un archivo PDF antes de subir.", true);
        return;
    }

    const archivo = input.files[0];
    const formData = new FormData();
    formData.append("archivo", archivo);

    btn.disabled = true;
    btn.innerText = "Procesando PDF...";
    alerta.classList.add("hidden");

    try {
        const res = await fetch(`${URL_BASE}/api/documentos/subir`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${tokenSesion}` },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al subir manual");

        input.value = "";
        mostrarAlertaAdmin(data.mensaje, false);
        cargarDocumentos();
    } catch (err) {
        mostrarAlertaAdmin(err.message, true);
    } finally {
        btn.disabled = false;
        btn.innerText = "Subir y Procesar PDF";
    }
}

async function eliminarManual(docId) {
    try {
        const res = await fetch(`${URL_BASE}/api/documentos/${encodeURIComponent(docId)}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${tokenSesion}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        mostrarAlertaAdmin(data.mensaje, false);
        cargarDocumentos();
    } catch (err) {
        mostrarAlertaAdmin(err.message, true);
    }
}

function mostrarAlertaAdmin(mensaje, esError) {
    const alerta = document.getElementById("alerta-admin");
    alerta.innerText = mensaje;
    alerta.className = esError
        ? "mt-4 text-xs font-semibold rounded-xl p-3.5 bg-rose-50 border border-rose-200 text-rose-700 animate-view"
        : "mt-4 text-xs font-semibold rounded-xl p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 animate-view";
    alerta.classList.remove("hidden");
}

function formatearTextoSeguro(str) {
    const escapado = escapeHTML(str);
    return escapado.replace(/\*\*(.+?)\*\*/g, '<strong class="text-icfes-deep font-bold">$1</strong>');
}

function renderizarChat() {
    const contenedor = document.getElementById("contenedor-respuesta");
    if (historialChat.length === 0) return;

    contenedor.innerHTML = historialChat.map(msg => {
        if (msg.rol === "user") {
            return `
                <div class="mb-4 flex justify-end animate-view">
                    <div class="max-w-[85%] bg-icfes-navy text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm shadow-xs whitespace-pre-wrap">${escapeHTML(msg.texto)}</div>
                </div>
            `;
        } else {
            return `
                <div class="mb-4 flex justify-start animate-view">
                    <div class="max-w-[96%] bg-white border border-icfes-border text-slate-800 rounded-2xl rounded-bl-sm px-4 py-3.5 text-sm leading-relaxed shadow-xs whitespace-pre-wrap">${formatearTextoSeguro(msg.texto)}</div>
                </div>
            `;
        }
    }).join("");

    contenedor.scrollTop = contenedor.scrollHeight;
}

async function procesarConsulta() {
    const inputEl = document.getElementById("texto-pqrs");
    const texto = inputEl.value.trim();
    const contenedor = document.getElementById("contenedor-respuesta");
    const btn = document.getElementById("btn-consultar");
    const badgeHabeas = document.getElementById("badge-habeas");
    const btnCopiar = document.getElementById("btn-copiar");
    const btnVoz = document.getElementById("btn-voz");

    if (!texto) return;

    detenerLectorVoz();
    btn.disabled = true;
    btn.innerText = "Analizando fuentes ICFES...";
    inputEl.value = "";

    const historialPrevio = [...historialChat];
    historialChat.push({ rol: "user", texto });
    renderizarChat();

    contenedor.innerHTML += `
        <div class="flex items-center gap-2 text-xs font-semibold text-icfes-navy animate-pulse mt-2">
            <span class="w-2 h-2 rounded-full bg-icfes-teal"></span>
            <span>Consultando documentos institucionales del ICFES...</span>
        </div>
    `;
    contenedor.scrollTop = contenedor.scrollHeight;

    try {
        const res = await fetch(`${URL_BASE}/api/consultar`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${tokenSesion}`
            },
            body: JSON.stringify({
                modo: modoSeleccionado,
                texto,
                historial: historialPrevio
            })
        });
        if (res.status === 403) return cerrarSesion();
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al procesar consulta");

        ultimaRespuestaTexto = data.respuesta;
        historialChat.push({ rol: "assistant", texto: data.respuesta });
        renderizarChat();

        badgeHabeas.innerText = `🛡️ ${data.datos_anonimizados} dato(s) PII protegido(s)`;
        badgeHabeas.classList.remove("hidden");
        btnCopiar.classList.remove("hidden");
        btnVoz.classList.remove("hidden");
    } catch (err) {
        historialChat.pop();
        renderizarChat();
        contenedor.innerHTML += `<p class="text-xs font-semibold text-rose-600 mt-2">${escapeHTML(err.message)}</p>`;
    } finally {
        btn.disabled = false;
        btn.innerText = "Analizar y Generar Respuesta";
    }
}

// --- LECTOR POR VOZ (TEXT-TO-SPEECH EN ESPAÑOL) ---
function alternarLectorVoz() {
    if (!("speechSynthesis" in window)) {
        alert("Tu navegador no soporta lectura por voz.");
        return;
    }
    if (leyendoVoz) {
        detenerLectorVoz();
        return;
    }
    if (!ultimaRespuestaTexto) return;

    window.speechSynthesis.cancel();
    const textoLimpio = ultimaRespuestaTexto.replace(/\*\*/g, "").replace(/[#_]/g, "");
    const utterance = new SpeechSynthesisUtterance(textoLimpio);
    utterance.lang = "es-CO";
    utterance.rate = 1.02;

    utterance.onstart = () => {
        leyendoVoz = true;
        document.getElementById("icono-voz-quieto").classList.add("hidden");
        document.getElementById("ecualizador-voz").classList.remove("hidden");
        document.getElementById("ecualizador-voz").classList.add("inline-flex");
        document.getElementById("texto-btn-voz").innerText = "Detener";
    };

    utterance.onend = () => detenerLectorVoz();
    utterance.onerror = () => detenerLectorVoz();

    window.speechSynthesis.speak(utterance);
}

function detenerLectorVoz() {
    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }
    leyendoVoz = false;
    const icono = document.getElementById("icono-voz-quieto");
    const eq = document.getElementById("ecualizador-voz");
    const txt = document.getElementById("texto-btn-voz");
    if (icono) icono.classList.remove("hidden");
    if (eq) {
        eq.classList.add("hidden");
        eq.classList.remove("inline-flex");
    }
    if (txt) txt.innerText = "Escuchar";
}

// --- DICTADO POR VOZ (SPEECH-TO-TEXT) ---
function alternarDictadoVoz() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("El dictado por micrófono está disponible en Chrome, Edge o Safari reciente.");
        return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "es-CO";
    recognition.interimResults = false;

    const label = document.getElementById("label-dictar");
    label.innerText = "Escuchando...";

    recognition.onresult = (event) => {
        const transcripcion = event.results[0][0].transcript;
        const textarea = document.getElementById("texto-pqrs");
        textarea.value = (textarea.value ? textarea.value + " " : "") + transcripcion;
    };
    recognition.onend = () => { label.innerText = "Dictar"; };
    recognition.onerror = () => { label.innerText = "Dictar"; };

    recognition.start();
}

// --- ACCESIBILIDAD ---
function toggleMenuAccesibilidad() {
    document.getElementById("menu-accesibilidad").classList.toggle("hidden");
}

function cambiarTamanoTexto(delta) {
    escalaFuente = Math.min(125, Math.max(90, escalaFuente + delta * 5));
    document.documentElement.style.fontSize = `${escalaFuente}%`;
}

function alternarContraste() {
    document.body.classList.toggle("high-contrast");
}

function copiarRespuesta() {
    if (!ultimaRespuestaTexto) return;
    navigator.clipboard.writeText(ultimaRespuestaTexto);
    const btn = document.getElementById("btn-copiar");
    btn.innerText = "¡Copiado!";
    setTimeout(() => { btn.innerText = "Copiar texto"; }, 2000);
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}