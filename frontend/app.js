const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const URL_BASE = IS_LOCAL 
    ? "http://127.0.0.1:8000" 
    : "https://asistente-pqrs-ices.onrender.com";

console.log("🚀 Conectado a:", URL_BASE);

window.onload = async () => {
    const elEstado = document.getElementById("estado-conexion");
    try {
        const res = await fetch(`${URL_BASE}/health`);
        const data = await res.json();
        elEstado.innerText = `✅ Conectado: ${data.proyecto} (${data.version})`;
        elEstado.className = "text-sm text-emerald-400 font-semibold";
    } catch (error) {
        elEstado.innerText = "⏳ Esperando despliegue del servidor en Render...";
        elEstado.className = "text-sm text-amber-400";
    }
};