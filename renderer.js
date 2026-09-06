const { ipcRenderer } = require("electron");

const playButton = document.getElementById("play");
const status = document.getElementById("status");
const usernameInput = document.getElementById("username");

const usernameGuardado = localStorage.getItem("fomeland-username");
if (usernameGuardado) {
    usernameInput.value = usernameGuardado;
}

// --- Sonido simple generado con Web Audio API, sin archivos externos ---
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

// --- Verificación de Java al iniciar la ventana ---
async function verificarJava() {

    const resultado = await ipcRenderer.invoke("verificar-java");

    if (!resultado.instalado) {
        status.innerText = "⚠️ No se detectó Java instalado. Necesitás JDK 25 o superior.";
        playButton.disabled = true;
        return false;
    }

    if (!resultado.cumple) {
        status.innerText = `⚠️ Tenés Java ${resultado.version}, pero se necesita JDK 25 o superior.`;
        playButton.disabled = true;
        return false;
    }

    status.innerText = "✅ Java verificado (versión " + resultado.version + ")";
    return true;

}

// --- Auto-actualización del launcher ---
ipcRenderer.on("actualizacion-launcher", (event, { estado, porcentaje }) => {

    if (estado === "disponible") {
        status.innerText = "⬇️ Hay una actualización del launcher, descargando...";
    }

    if (estado === "descargando") {
        status.innerText = `⬇️ Descargando actualización: ${porcentaje}%`;
    }

    if (estado === "listo") {
        status.innerText = "✅ Actualización lista. Reiniciando...";
        setTimeout(() => {
            ipcRenderer.invoke("reiniciar-para-actualizar");
        }, 1500);
    }

});

// --- Inicialización al cargar la ventana ---
verificarJava();

ipcRenderer.on("minecraft-log", (event, data) => {
    console.log("[MC]", data);
});

playButton.addEventListener("click", async () => {

    try {

        const javaOk = await verificarJava();

        if (!javaOk) {
            return;
        }

        const username = usernameInput.value.trim();

        if (!username) {
            status.innerText = "⚠️ Ingresá un nombre de usuario";
            return;
        }

        localStorage.setItem("fomeland-username", username);

        playButton.innerText = "INICIANDO...";
        playButton.disabled = true;

        status.innerText = "🔎 Buscando actualizaciones";

        const { manifest, necesitaClienteNuevo, necesitaNeoforgeNuevo } =
            await ipcRenderer.invoke("chequear-actualizacion");

        const existeInstalacionBase = await ipcRenderer.invoke("existe-minecraft");

        if (!existeInstalacionBase || necesitaClienteNuevo) {

            status.innerText = "📦 Descargando/Actualizando contenido";

            await ipcRenderer.invoke("instalar-cliente", manifest.zipUrl);

            sonidoDescargaCompleta();

        }

        if (!existeInstalacionBase || necesitaNeoforgeNuevo) {

            status.innerText = "⚙️ Instalando NeoForge";

            await ipcRenderer.invoke("instalar-neoforge", manifest.installerUrl);

            sonidoDescargaCompleta();

        }

        if (!existeInstalacionBase || necesitaClienteNuevo || necesitaNeoforgeNuevo) {

            await ipcRenderer.invoke("guardar-version-instalada", manifest);

            status.innerText = "✅ Instalación actualizada";

            await esperar(800);

        }
        else {

            status.innerText = "✅ Todo está al día";

        }

        await esperar(500);

        status.innerText = "🚀 Iniciando Minecraft";

        await ipcRenderer.invoke("abrir-minecraft", username);

        status.innerText = "✅ Minecraft iniciado";

    }
    catch (error) {

        console.error(error);

        status.innerText = "❌ Error: " + error.message;

        playButton.disabled = false;

        playButton.innerText = "JUGAR";
    }

});

ipcRenderer.on("minecraft-cerrado", (event, code) => {
    console.log("Minecraft se cerró con código:", code);
    status.innerText = "👋 Minecraft cerrado";
    playButton.disabled = false;
    playButton.innerText = "JUGAR";
});

function esperar(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));

}