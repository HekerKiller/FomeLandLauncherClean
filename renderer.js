const { ipcRenderer } = require("electron");

const playButton = document.getElementById("play");
const status = document.getElementById("status");


playButton.addEventListener("click", async () => {

    playButton.innerText = "INICIANDO...";
    playButton.disabled = true;

    status.innerText = "✅ Java encontrado";
    const existe = await ipcRenderer.invoke("existe-minecraft");

    if (!existe) {

        status.innerText = "📥 Primera ejecución";

        await esperar(1000);

    } else {

        status.innerText = "✅ Minecraft encontrado";

        await esperar(1000);

    }

    await esperar(1000);

    status.innerText = "📁 Creando directorios";

    await ipcRenderer.invoke("crear-carpetas");

    await esperar(1000);

    status.innerText = "✅ Directorios creados";

    await esperar(1000);

    status.innerText = "🎮 Preparado para instalar Minecraft 26.2";
});

function esperar(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}