const { ipcRenderer } = require("electron");

// Configuración del repositorio para obtener las novedades de GitHub
const REPO_OWNER = "HekerKiller";
const REPO_NAME = "FomeLandLauncherClean";

// Elementos del DOM
const playButton = document.getElementById("play");
const status = document.getElementById("status");
const usernameInput = document.getElementById("username");
const versionLabel = document.getElementById("launcher-version");
const changelogContainer = document.getElementById("changelog-container");

// Cargar usuario guardado en localStorage
const usernameGuardado = localStorage.getItem("fomeland-username");
if (usernameGuardado && usernameInput) {
    usernameInput.value = usernameGuardado;
}

// --- CARGA DINÁMICA DE NOVEDADES Y VERSIÓN ---
async function cargarNovedadesYVersion() {
    try {
        const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`);
        if (!response.ok) throw new Error("Error al conectar con GitHub");
        
        const releases = await response.json();

        if (Array.isArray(releases) && releases.length > 0) {
            // Actualizar etiqueta de versión si existe en el DOM
            if (versionLabel) {
                versionLabel.innerText = `${releases[0].tag_name || releases[0].name} • NeoForge`;
            }

            // Rellenar lista de novedades
            if (changelogContainer) {
                changelogContainer.innerHTML = "";
                releases.forEach(release => {
                    const card = document.createElement("div");
                    card.className = "changelog-card";
                    card.innerHTML = `
                        <span class="tag">${release.name || release.tag_name}</span>
                        <p class="description">${release.body ? release.body.replace(/\n/g, "<br>") : "Sin descripción disponible."}</p>
                    `;
                    changelogContainer.appendChild(card);
                });
            }
        }
    } catch (error) {
        console.warn("No se pudieron obtener las novedades desde GitHub:", error);
        if (changelogContainer) {
            changelogContainer.innerHTML = '<p class="description" style="color: #aaa; text-align: center;">No se pudieron cargar las novedades.</p>';
        }
    }
}

// --- SONIDOS SINTETIZADOS (Web Audio API) ---
function reproducirSonido(frecuencia = 880, duracionMs = 150) {
    try {
        const contexto = new (window.AudioContext || window.webkitAudioContext)();
        const oscilador = contexto.createOscillator();
        const ganancia = contexto.createGain();

        oscilador.type = "sine";
        oscilador.frequency.setValueAtTime(frecuencia, contexto.currentTime);

        ganancia.gain.setValueAtTime(0.15, contexto.currentTime);
        ganancia.gain.exponentialRampToValueAtTime(0.001, contexto.currentTime + duracionMs / 1000);

        oscilador.connect(ganancia);
        ganancia.connect(contexto.destination);

        oscilador.start();
        oscilador.stop(contexto.currentTime + duracionMs / 1000);
    } catch (error) {
        console.error("No se pudo reproducir sonido:", error);
    }
}

function sonidoDescargaCompleta() {
    reproducirSonido(660, 120);
    setTimeout(() => reproducirSonido(990, 180), 130);
}

// --- VERIFICACIÓN DE JAVA ---
async function verificarJava() {
    const resultado = await ipcRenderer.invoke("verificar-java");

    if (!resultado.instalado) {
        if (status) status.innerText = "⚠️ No se detectó Java instalado. Necesitás JDK 25 o superior.";
        if (playButton) playButton.disabled = true;
        return false;
    }

    if (!resultado.cumple) {
        if (status) status.innerText = `⚠️ Tenés Java ${resultado.version}, pero se necesita JDK 25 o superior.`;
        if (playButton) playButton.disabled = true;
        return false;
    }

    if (status) status.innerText = "✅ Java verificado (versión " + resultado.version + ")";
    return true;
}

// --- AUTO-ACTUALIZACIÓN DEL LAUNCHER ---
ipcRenderer.on("actualizacion-launcher", (event, { estado, porcentaje }) => {
    if (estado === "disponible") {
        if (status) status.innerText = "⬇️ Hay una actualización del launcher, descargando...";
    }

    if (estado === "descargando") {
        if (status) status.innerText = `⬇️ Descargando actualización: ${porcentaje}%`;
    }

    if (estado === "listo") {
        if (status) status.innerText = "✅ Actualización lista. Reiniciando...";
        setTimeout(() => {
            ipcRenderer.invoke("reiniciar-para-actualizar");
        }, 1500);
    }
});

// --- LOGS DE MINECRAFT ---
ipcRenderer.on("minecraft-log", (event, data) => {
    console.log("[MC]", data);
});

// --- EVENTO PRINCIPAL DEL BOTÓN JUGAR ---
playButton.addEventListener("click", async () => {
    try {
        const javaOk = await verificarJava();
        if (!javaOk) return;

        const username = usernameInput.value.trim();

        if (!username) {
            if (status) status.innerText = "⚠️ Ingresá un nombre de usuario";
            return;
        }

        // Guardar nombre en localStorage
        localStorage.setItem("fomeland-username", username);

        playButton.innerText = "INICIANDO...";
        playButton.disabled = true;

        if (status) status.innerText = "🔎 Buscando actualizaciones";

        const { manifest, necesitaClienteNuevo, necesitaNeoforgeNuevo } =
            await ipcRenderer.invoke("chequear-actualizacion");

        const existeInstalacionBase = await ipcRenderer.invoke("existe-minecraft");

        if (!existeInstalacionBase || necesitaClienteNuevo) {
            if (status) status.innerText = "📦 Descargando/Actualizando contenido";
            await ipcRenderer.invoke("instalar-cliente", manifest.zipUrl);
            sonidoDescargaCompleta();
        }

        if (!existeInstalacionBase || necesitaNeoforgeNuevo) {
            if (status) status.innerText = "⚙️ Instalando NeoForge";
            await ipcRenderer.invoke("instalar-neoforge", manifest.installerUrl);
            sonidoDescargaCompleta();
        }

        if (!existeInstalacionBase || necesitaClienteNuevo || necesitaNeoforgeNuevo) {
            await ipcRenderer.invoke("guardar-version-instalada", manifest);
            if (status) status.innerText = "✅ Instalación actualizada";
            await esperar(800);
        } else {
            if (status) status.innerText = "✅ Todo está al día";
        }

        await esperar(500);

        if (status) status.innerText = "🚀 Iniciando Minecraft";
        await ipcRenderer.invoke("abrir-minecraft", username);
        if (status) status.innerText = "✅ Minecraft iniciado";

    } catch (error) {
        console.error(error);
        if (status) status.innerText = "❌ Error: " + error.message;
        playButton.disabled = false;
        playButton.innerText = "JUGAR";
    }
});

// --- EVENTO MINECRAFT CERRADO ---
ipcRenderer.on("minecraft-cerrado", async (event, code) => {
    console.log("Minecraft se cerró con código:", code);
    
    if (status) status.innerText = "👋 Minecraft cerrado";
    
    // Espera 3 segundos antes de restablecer el estado
    await esperar(3000);
    
    if (status) status.innerText = "✨ Listo para iniciar";
    if (playButton) {
        playButton.disabled = false;
        playButton.innerText = "JUGAR";
    }
});

// Auxiliar de pausa
function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- INICIALIZACIÓN GENERAL ---
document.addEventListener("DOMContentLoaded", () => {
    verificarJava();
    cargarNovedadesYVersion();
});