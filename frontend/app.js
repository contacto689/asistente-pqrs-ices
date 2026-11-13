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
        punto.className = "inline-block w-2 h-2 rounded-full bg-emerald-400";
        texto.innerText = `Servidor activo · ${data.manuales_cargados} manual(es) en línea`;
    } catch {
        punto.className = "inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse";
        texto.innerText = "Despertando servidor en la nube...";
    }
}

function seleccionarPerfil(perfil) {
    perfilSeleccionado = perfil;
    const btnColab = document.getElementById("btn-perfil-colab");
    const btnAdmin = document.getElementById("btn-perfil-admin");
    const label = document.getElementById("label-perfil-activo");

    if (perfil === "colaborador") {
        btnColab.className = "p-3.5 rounded-2xl border-2 border-amber-500 bg-amber-500/10 text-left transition";
        btnAdmin.className = "p-3.5 rounded-2xl border-2 border-slate-800 bg-slate-950/60 hover:border-slate-700 text-left transition";
        label.innerText = "Colaborador";
    } else {
        btnAdmin.className = "p-3.5 rounded-2xl border-2 border-amber-500 bg-amber-500/10 text-left transition";
        btnColab.className = "p-3.5 rounded-2xl border-2 border-slate-800 bg-slate-950/60 hover:border-slate-700 text-left transition";
        label.innerText = "Administrativo";
    }
}

function seleccionarModo(modo) {
    modoSeleccionado = modo;
    const btnResp = document.getElementById("modo-respuesta");
    const btnCons = document.getElementById("modo-consulta");

    if (modo === "respuesta_pqrs") {
        btnResp.className = "p-3 rounded-xl border border-amber-500 bg-amber-500/10 text-left transition";
        btnCons.className = "p-3 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-slate-700 text-left transition";
    } else {
        btnCons.className = "p-3 rounded-xl border border-amber-500 bg-amber-500/10 text-left transition";
        btnResp.className = "p-3 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-slate-700 text-left transition";
    }
}

async function iniciarSesion(e) {
    e.preventDefault();
    const password = document.getElementById("input-password").value;
    const elError = document.getElementById("login-error");
    const btn = document.getElementById("btn-ingresar");

    elError.classList.add("hidden");
    btn.disabled = true;
    btn.innerText = "Verificando credenciales...";

    try {
        const res = await fetch(`${URL_BASE}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rol: perfilSeleccionado, password })
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || "Error al iniciar sesión");
        }

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
        btn.innerText = "Ingresar al Asistente";
    }
}

function cerrarSesion() {
    tokenSesion = "";
    rolSesion = "";
    historialChat = [];
    sessionStorage.removeItem("ices_token");
    sessionStorage.removeItem("ices_rol");
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
                <div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5">
                    <div>
                        <div class="text-xs font-bold text-white">${escapeHTML(doc.nombre)}</div>
                        <div class="text-[11px] text-slate-400">${doc.size_mb} MB · Subido: ${doc.fecha}</div>
                    </div>
                    <button onclick="eliminarManual('${doc.id}')" class="text-xs text-rose-400 hover:text-rose-300 font-semibold px-2.5 py-1 rounded-lg bg-rose-950/40">
                        Eliminar
                    </button>
                </div>
            `).join("");
        }

        const nombresColab = document.getElementById("nombres-docs-colab");
        nombresColab.innerText = docs.length > 0
            ? docs.map(d => d.nombre).join("  |  ")
            : "⚠️ Ningún manual cargado aún (solicite al Administrador cargar los PDFs).";

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
    btn.innerText = "Subiendo y cifrando PDF...";
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
        ? "mt-4 text-xs rounded-xl p-3 bg-rose-950/60 border border-rose-800 text-rose-300"
        : "mt-4 text-xs rounded-xl p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-300";
    alerta.classList.remove("hidden");
}

function renderizarChat() {
    const contenedor = document.getElementById("contenedor-respuesta");
    if (historialChat.length === 0) {
        contenedor.innerHTML = `<p class="text-sm text-slate-500">Hola 👋 Soy tu Asistente IA del ICES. Escríbeme una consulta sobre los documentos cargados o pega el texto de una PQRS para ayudarte a redactar la respuesta.</p>`;
        return;
    }

    contenedor.innerHTML = historialChat.map(msg => {
        if (msg.rol === "user") {
            return `
                <div class="mb-4 flex justify-end">
                    <div class="max-w-[85%] bg-amber-500/15 border border-amber-500/40 text-amber-100 rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap">${escapeHTML(msg.texto)}</div>
                </div>
            `;
        } else {
            return `
                <div class="mb-4 flex justify-start">
                    <div class="max-w-[95%] bg-slate-900 border border-slate-800 text-slate-200 rounded-2xl px-4 py-3.5 text-sm leading-relaxed whitespace-pre-wrap">${escapeHTML(msg.texto)}</div>
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

    if (!texto) return;

    btn.disabled = true;
    btn.innerText = "Pensando y verificando fuentes...";
    inputEl.value = "";

    const historialPrevio = [...historialChat];
    historialChat.push({ rol: "user", texto });
    renderizarChat();

    contenedor.innerHTML += `<p id="indicador-escribiendo" class="text-xs text-amber-400 animate-pulse mt-2">Asistente ICES analizando documentos...</p>`;
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
    } catch (err) {
        historialChat.pop();
        renderizarChat();
        contenedor.innerHTML += `<p class="text-sm text-rose-400 mt-2">${escapeHTML(err.message)}</p>`;
    } finally {
        btn.disabled = false;
        btn.innerText = "Analizar y Generar Respuesta";
    }
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