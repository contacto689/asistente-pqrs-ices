const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const URL_BASE = IS_LOCAL
    ? "http://127.0.0.1:8000"
    : "https://asistente-pqrs-ices.onrender.com";

let perfilSeleccionado = "colaborador";
let modoSeleccionado = "respuesta_pqrs";
let tokenSesion = sessionStorage.getItem("ices_token") || "";
let rolSesion = sessionStorage.getItem("ices_rol") || "";
let ultimaCartaLimpia = "";
let historialChat = [];
let leyendoVoz = false;
let escalaFuente = 100;

window.onload = async () => {
    verificarServidor();

    // Atajos de teclado accesibles (Esc cierra modales, Ctrl+Enter envía)
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            cerrarModalGuia();
            document.getElementById("menu-accesibilidad").classList.add("hidden");
            document.getElementById("popover-pii").classList.add("hidden");
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && document.activeElement.id === "texto-pqrs") {
            procesarConsulta();
        }
    });

    if (tokenSesion && rolSesion) {
        mostrarPanelAutenticado(false);
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

// --- MODAL DE INDUCCIÓN (GUÍA DE USO) ---
function abrirModalGuia() {
    const modal = document.getElementById("modal-guia");
    modal.classList.remove("hidden");
    modal.querySelector("button").focus();
}

function cerrarModalGuia() {
    const check = document.getElementById("check-no-mostrar-guia");
    if (check && check.checked) {
        sessionStorage.setItem("icfes_ocultar_guia", "1");
    }
    document.getElementById("modal-guia").classList.add("hidden");
}

function seleccionarPerfil(perfil) {
    perfilSeleccionado = perfil;
    const btnColab = document.getElementById("btn-perfil-colab");
    const btnAdmin = document.getElementById("btn-perfil-admin");
    const label = document.getElementById("label-perfil-activo");

    if (perfil === "colaborador") {
        btnColab.className = "p-3.5 rounded-xl border-2 border-icfes-navy bg-icfes-navy/5 text-left transition-all";
        btnColab.setAttribute("aria-checked", "true");
        btnAdmin.className = "p-3.5 rounded-xl border-2 border-slate-200 bg-white hover:border-icfes-navy/40 text-left transition-all";
        btnAdmin.setAttribute("aria-checked", "false");
        label.innerText = "Colaborador";
    } else {
        btnAdmin.className = "p-3.5 rounded-xl border-2 border-icfes-navy bg-icfes-navy/5 text-left transition-all";
        btnAdmin.setAttribute("aria-checked", "true");
        btnColab.className = "p-3.5 rounded-xl border-2 border-slate-200 bg-white hover:border-icfes-navy/40 text-left transition-all";
        btnColab.setAttribute("aria-checked", "false");
        label.innerText = "Administrativo";
    }
}

function seleccionarModo(modo) {
    modoSeleccionado = modo;
    const btnResp = document.getElementById("modo-respuesta");
    const btnCons = document.getElementById("modo-consulta");

    if (modo === "respuesta_pqrs") {
        btnResp.className = "p-3.5 rounded-xl border-2 border-icfes-navy bg-icfes-navy/5 text-left transition-all";
        btnResp.setAttribute("aria-checked", "true");
        btnCons.className = "p-3.5 rounded-xl border-2 border-slate-200 bg-white hover:border-icfes-navy/40 text-left transition-all";
        btnCons.setAttribute("aria-checked", "false");
    } else {
        btnCons.className = "p-3.5 rounded-xl border-2 border-icfes-navy bg-icfes-navy/5 text-left transition-all";
        btnCons.setAttribute("aria-checked", "true");
        btnResp.className = "p-3.5 rounded-xl border-2 border-slate-200 bg-white hover:border-icfes-navy/40 text-left transition-all";
        btnResp.setAttribute("aria-checked", "false");
    }
}

function usarPlantillaRapida(textoPlantilla) {
    const textarea = document.getElementById("texto-pqrs");
    textarea.value = textoPlantilla;
    textarea.focus();
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
        mostrarPanelAutenticado(true);
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
    ultimaCartaLimpia = "";
    historialChat = [];
    document.getElementById("texto-pqrs").value = "";
    document.getElementById("badge-habeas").classList.add("hidden");
    document.getElementById("popover-pii").classList.add("hidden");
    document.getElementById("btn-copiar").classList.add("hidden");
    document.getElementById("btn-descargar").classList.add("hidden");
    document.getElementById("btn-voz").classList.add("hidden");
    document.getElementById("contenedor-respuesta").innerHTML = `
        <div class="flex items-start gap-3 text-slate-600 animate-view">
            <div class="w-8 h-8 rounded-full bg-icfes-navy text-white flex items-center justify-center font-display font-bold text-xs shrink-0 mt-0.5" aria-hidden="true">
                IA
            </div>
            <div class="text-sm leading-relaxed">
                <p class="font-semibold text-icfes-deep">¡Bienvenido al Asistente PQRS del ICFES!</p>
                <p class="mt-1 text-slate-500">Escríbeme una consulta normativa o pega una solicitud ciudadana. Generaré una respuesta institucional con membrete oficial, clasificación automática y lectura por voz.</p>
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

function mostrarPanelAutenticado(recienLogueado) {
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

    if (recienLogueado && !sessionStorage.getItem("icfes_ocultar_guia")) {
        abrirModalGuia();
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
                    <button type="button" onclick="eliminarManual('${doc.id}')" class="text-xs text-rose-600 hover:bg-rose-50 font-bold px-3 py-1.5 rounded-full transition">
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

// Parsear respuesta estructurada (Clasificación + Carta Oficial + Soporte Interno)
function parsearRespuestaEstructurada(texto) {
    const tieneBloques = texto.includes("[[CARTA_OFICIAL]]");
    if (!tieneBloques) {
        return { estructurada: false, textoPlano: texto };
    }

    let clasificacion = { tipo: "PQRS", tema: "Institucional", plazo: "15 días hábiles" };
    const matchClasif = texto.match(/\[\[CLASIFICACION\]\]([\s\S]*?)\[\[CARTA_OFICIAL\]\]/);
    if (matchClasif) {
        const bloque = matchClasif[1];
        const t = bloque.match(/Tipo:\s*(.+)/i);
        const m = bloque.match(/Tema:\s*(.+)/i);
        const p = bloque.match(/Plazo:\s*(.+)/i);
        if (t) clasificacion.tipo = t[1].trim();
        if (m) clasificacion.tema = m[1].trim();
        if (p) clasificacion.plazo = p[1].trim();
    }

    const matchCarta = texto.match(/\[\[CARTA_OFICIAL\]\]([\s\S]*?)(\[\[SOPORTE_INTERNO\]\]|$)/);
    const carta = matchCarta ? matchCarta[1].trim() : texto;

    const matchSoporte = texto.match(/\[\[SOPORTE_INTERNO\]\]([\s\S]*)$/);
    const soporte = matchSoporte ? matchSoporte[1].trim() : "";

    return { estructurada: true, clasificacion, carta, soporte };
}

function renderizarChat() {
    const contenedor = document.getElementById("contenedor-respuesta");
    if (historialChat.length === 0) return;

    contenedor.innerHTML = historialChat.map((msg, idx) => {
        if (msg.rol === "user") {
            return `
                <div class="mb-4 flex justify-end animate-view">
                    <div class="max-w-[85%] bg-icfes-navy text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm shadow-xs whitespace-pre-wrap">${escapeHTML(msg.texto)}</div>
                </div>
            `;
        } else {
            const parsed = parsearRespuestaEstructurada(msg.texto);
            if (!parsed.estructurada) {
                return `
                    <div class="mb-4 flex justify-start animate-view">
                        <div class="max-w-[96%] bg-white border border-icfes-border text-slate-800 rounded-2xl rounded-bl-sm px-4 py-3.5 text-sm leading-relaxed shadow-xs whitespace-pre-wrap">${formatearTextoSeguro(parsed.textoPlano)}</div>
                    </div>
                `;
            }

            return `
                <div class="mb-5 space-y-3 animate-view">
                    <!-- Chips de Clasificación Automática -->
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-[11px] font-bold bg-icfes-navy text-white px-3 py-1 rounded-full">
                            Tipo: ${escapeHTML(parsed.clasificacion.tipo)}
                        </span>
                        <span class="text-[11px] font-bold bg-icfes-teal/15 text-icfes-teal border border-icfes-teal/30 px-3 py-1 rounded-full">
                            Tema: ${escapeHTML(parsed.clasificacion.tema)}
                        </span>
                        <span class="text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 rounded-full">
                            Plazo: ${escapeHTML(parsed.clasificacion.plazo)}
                        </span>
                    </div>

                    <!-- Tarjeta A: Carta Oficial con Membrete ICFES -->
                    <article aria-label="Borrador oficial para enviar al ciudadano"
                        class="bg-white border-2 border-icfes-navy/20 rounded-2xl overflow-hidden shadow-sm">
                        <div class="bg-icfes-navy/5 border-b border-icfes-border px-4 py-2.5 flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span class="font-display font-extrabold text-sm text-icfes-navy">icfes</span>
                                <span class="text-xs font-bold text-icfes-deep">· Borrador Oficial para Ciudadano</span>
                            </div>
                            <span class="text-[10px] font-bold uppercase tracking-wider text-icfes-green">Listo para envío</span>
                        </div>
                        <div class="p-4 sm:p-5 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">${formatearTextoSeguro(parsed.carta)}</div>
                    </article>

                    <!-- Tarjeta B: Soporte Interno Plegable (Solo Funcionario) -->
                    ${parsed.soporte ? `
                    <details class="bg-slate-100/90 border border-slate-200 rounded-xl overflow-hidden">
                        <summary class="px-4 py-2.5 text-xs font-bold text-icfes-deep cursor-pointer select-none flex items-center justify-between hover:bg-slate-200/60 transition">
                            <span>🔒 Soporte Documental Interno (Solo uso funcionario ICFES)</span>
                            <span class="text-[11px] text-icfes-navy underline">Ver respaldo</span>
                        </summary>
                        <div class="px-4 py-3 text-xs text-slate-700 leading-relaxed border-t border-slate-200 whitespace-pre-wrap bg-white/70">${formatearTextoSeguro(parsed.soporte)}</div>
                    </details>
                    ` : ""}
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
    const btnDescargar = document.getElementById("btn-descargar");
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

        const parsed = parsearRespuestaEstructurada(data.respuesta);
        ultimaCartaLimpia = parsed.estructurada ? parsed.carta : data.respuesta;

        historialChat.push({ rol: "assistant", texto: data.respuesta });
        renderizarChat();

        // Actualizar auditoría PII
        badgeHabeas.innerText = `🛡️ ${data.datos_anonimizados} dato(s) PII protegido(s)`;
        badgeHabeas.classList.remove("hidden");

        const det = data.detalle_pii || {};
        document.getElementById("contenido-auditoria-pii").innerHTML = `
            <div>• Nombres propios: <strong>${det.nombres || 0}</strong></div>
            <div>• Documentos ID: <strong>${det.documentos || 0}</strong></div>
            <div>• Teléfonos: <strong>${det.telefonos || 0}</strong></div>
            <div>• Correos: <strong>${det.correos || 0}</strong></div>
        `;

        btnCopiar.classList.remove("hidden");
        btnDescargar.classList.remove("hidden");
        btnVoz.classList.remove("hidden");
    } catch (err) {
        historialChat.pop();
        renderizarChat();
        contenedor.innerHTML += `<p role="alert" class="text-xs font-semibold text-rose-600 mt-2">${escapeHTML(err.message)}</p>`;
    } finally {
        btn.disabled = false;
        btn.innerText = "Analizar y Generar Respuesta";
    }
}

function toggleDetallePII() {
    const pop = document.getElementById("popover-pii");
    const badge = document.getElementById("badge-habeas");
    const oculto = pop.classList.toggle("hidden");
    badge.setAttribute("aria-expanded", String(!oculto));
}

// --- EXPORTAR DOCUMENTO WORD INSTITUCIONAL (.DOC) ---
function descargarDocumentoOficial() {
    if (!ultimaCartaLimpia) return;
    const fechaHoy = new Date().toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" });
    const contenidoHtml = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>Respuesta Oficial ICFES</title></head>
        <body style="font-family: Arial, sans-serif; color: #1E293B; line-height: 1.6; margin: 40px;">
            <div style="border-bottom: 3px solid #0B4A7E; padding-bottom: 12px; margin-bottom: 24px;">
                <h2 style="color: #0B4A7E; margin: 0;">ICFES — Instituto Colombiano para la Evaluación de la Educación</h2>
                <p style="font-size: 12px; color: #64748B; margin: 4px 0 0 0;">Atención y Servicios a la Ciudadanía · Gestión PQRS</p>
            </div>
            <p style="font-size: 13px; color: #475569;">Bogotá D.C., ${fechaHoy}</p>
            <div style="font-size: 14px; white-space: pre-wrap; margin-top: 20px;">${escapeHTML(ultimaCartaLimpia).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</div>
            <div style="border-top: 1px solid #CBD5E1; margin-top: 40px; padding-top: 10px; font-size: 11px; color: #64748B;">
                Instituto Colombiano para la Evaluación de la Educación - ICFES · Calle 26 No. 69-76, Edificio Elemento, Bogotá D.C.
            </div>
        </body>
        </html>
    `;
    const blob = new Blob(['\ufeff', contenidoHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Respuesta_PQRS_ICFES_${new Date().toISOString().slice(0, 10)}.doc`;
    a.click();
    URL.revokeObjectURL(url);
}

// --- LECTOR POR VOZ ---
function alternarLectorVoz() {
    if (!("speechSynthesis" in window)) {
        alert("Tu navegador no soporta lectura por voz.");
        return;
    }
    if (leyendoVoz) {
        detenerLectorVoz();
        return;
    }
    if (!ultimaCartaLimpia) return;

    window.speechSynthesis.cancel();
    const textoLimpio = ultimaCartaLimpia.replace(/\*\*/g, "").replace(/[#_]/g, "");
    const utterance = new SpeechSynthesisUtterance(textoLimpio);
    utterance.lang = "es-CO";
    utterance.rate = 1.0;

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

// --- DICTADO POR VOZ ---
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
    recognition.onend = () => { label.innerText = "Dictar por voz"; };
    recognition.onerror = () => { label.innerText = "Dictar por voz"; };

    recognition.start();
}

// --- ACCESIBILIDAD INCLUSIVA (WCAG 2.1 AA) ---
function toggleMenuAccesibilidad() {
    const menu = document.getElementById("menu-accesibilidad");
    const btn = document.getElementById("btn-accesibilidad");
    const oculto = menu.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", String(!oculto));
}

function cambiarTamanoTexto(delta) {
    escalaFuente = Math.min(130, Math.max(90, escalaFuente + delta * 5));
    document.documentElement.style.fontSize = `${escalaFuente}%`;
}

function alternarContraste() {
    document.body.classList.toggle("high-contrast");
}

function alternarDislexia() {
    document.body.classList.toggle("dyslexia-mode");
}

function alternarEscalaGrises() {
    document.body.classList.toggle("grayscale-mode");
}

function restablecerAccesibilidad() {
    escalaFuente = 100;
    document.documentElement.style.fontSize = "100%";
    document.body.classList.remove("high-contrast", "dyslexia-mode", "grayscale-mode");
}

function copiarRespuesta() {
    if (!ultimaCartaLimpia) return;
    navigator.clipboard.writeText(ultimaCartaLimpia.replace(/\*\*/g, ""));
    const btn = document.getElementById("btn-copiar");
    btn.innerText = "¡Carta copiada!";
    setTimeout(() => { btn.innerText = "Copiar carta"; }, 2000);
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