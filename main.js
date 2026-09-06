const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const AdmZip = require("adm-zip");
const axios = require("axios");
const { lanzarMinecraft } = require("./launcher");
const { autoUpdater } = require("electron-updater");

let ventanaPrincipal;

const rutaMinecraft = path.join(app.getPath("appData"), ".FomeLandLauncher");
const CUSTOM_VERSION = "neoforge-26.2.0.75";

const MANIFEST_URL = "https://raw.githubusercontent.com/HekerKiller/FomeLandLauncherClean/main/version.json";

const versionLocalPath = path.join(rutaMinecraft, "version-instalada.json");
const descargasTempPath = path.join(app.getPath("temp"), "fomeland-launcher-descargas");

function createWindow() {

    ventanaPrincipal = new BrowserWindow({
        width: 1280,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    ventanaPrincipal.loadFile("index.html");
}

app.whenReady().then(() => {

    createWindow();

    autoUpdater.checkForUpdatesAndNotify();

});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

function enviarProgreso(mensaje) {
    if (ventanaPrincipal) {
        ventanaPrincipal.webContents.send("minecraft-log", mensaje);
    }
}

// --- Auto-actualización del launcher (electron-updater + GitHub Releases) ---

autoUpdater.on("update-available", () => {
    if (ventanaPrincipal) {
        ventanaPrincipal.webContents.send("actualizacion-launcher", { estado: "disponible" });
    }
});

autoUpdater.on("download-progress", (progreso) => {
    if (ventanaPrincipal) {
        ventanaPrincipal.webContents.send("actualizacion-launcher", {
            estado: "descargando",
            porcentaje: Math.round(progreso.percent)
        });
    }
});

autoUpdater.on("update-downloaded", () => {
    if (ventanaPrincipal) {
        ventanaPrincipal.webContents.send("actualizacion-launcher", { estado: "listo" });
    }
});

autoUpdater.on("error", (err) => {
    console.error("[AutoUpdater ERROR]", err);
});

ipcMain.handle("reiniciar-para-actualizar", () => {
    autoUpdater.quitAndInstall();
});

// --- Descarga y manifest del modpack ---

async function descargarArchivo(url, destino, etiqueta) {

    const carpetaDestino = path.dirname(destino);

    if (!fs.existsSync(carpetaDestino)) {
        fs.mkdirSync(carpetaDestino, { recursive: true });
    }

    const respuesta = await axios({
        method: "GET",
        url: url,
        responseType: "stream"
    });

    const total = parseInt(respuesta.headers["content-length"] || "0", 10);
    let descargado = 0;
    let ultimoPorcentaje = -1;

    const writer = fs.createWriteStream(destino);

    respuesta.data.on("data", (chunk) => {
        descargado += chunk.length;
        if (total > 0) {
            const porcentaje = Math.floor((descargado / total) * 100);
            if (porcentaje !== ultimoPorcentaje) {
                ultimoPorcentaje = porcentaje;
                enviarProgreso(`[Descarga] ${etiqueta}: ${porcentaje}%`);
            }
        }
    });

    respuesta.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        respuesta.data.on("error", reject);
    });
}

async function obtenerManifest() {

    const respuesta = await axios.get(MANIFEST_URL, {
        headers: { "Cache-Control": "no-cache" },
        params: { t: Date.now() }
    });

    return respuesta.data;

}

function leerVersionLocal() {

    if (!fs.existsSync(versionLocalPath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(versionLocalPath, "utf-8"));
    } catch {
        return null;
    }

}

function guardarVersionLocal(manifest) {

    if (!fs.existsSync(rutaMinecraft)) {
        fs.mkdirSync(rutaMinecraft, { recursive: true });
    }

    fs.writeFileSync(versionLocalPath, JSON.stringify({
        clientVersion: manifest.clientVersion,
        neoforgeVersion: manifest.neoforgeVersion
    }, null, 2));

}

ipcMain.handle("chequear-actualizacion", async () => {

    const manifest = await obtenerManifest();
    const local = leerVersionLocal();

    const necesitaClienteNuevo = !local || local.clientVersion !== manifest.clientVersion;
    const necesitaNeoforgeNuevo = !local || local.neoforgeVersion !== manifest.neoforgeVersion;

    return {
        manifest,
        necesitaClienteNuevo,
        necesitaNeoforgeNuevo
    };

});

ipcMain.handle("existe-minecraft", async () => {

    const modsExiste = fs.existsSync(path.join(rutaMinecraft, "mods"));

    const versionJsonExiste = fs.existsSync(
        path.join(rutaMinecraft, "versions", CUSTOM_VERSION, CUSTOM_VERSION + ".json")
    );

    return modsExiste && versionJsonExiste;

});

ipcMain.handle("instalar-cliente", async (event, zipUrl) => {

    const zipPath = path.join(descargasTempPath, "FomeLandClient.zip");

    enviarProgreso("Descargando contenido del cliente...");

    await descargarArchivo(zipUrl, zipPath, "Cliente FomeLand");

    if (!fs.existsSync(rutaMinecraft)) {
        fs.mkdirSync(rutaMinecraft, { recursive: true });
    }

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(rutaMinecraft, true);

    fs.unlinkSync(zipPath);

    return true;
});

ipcMain.handle("instalar-neoforge", async (event, installerUrl) => {

    const installerPath = path.join(descargasTempPath, "neoforge-installer.jar");

    enviarProgreso("Descargando instalador de NeoForge...");

    await descargarArchivo(installerUrl, installerPath, "NeoForge Installer");

    if (!fs.existsSync(rutaMinecraft)) {
        fs.mkdirSync(rutaMinecraft, { recursive: true });
    }

    const launcherProfilesPath = path.join(rutaMinecraft, "launcher_profiles.json");

    if (!fs.existsSync(launcherProfilesPath)) {

        const perfilVacio = {
            profiles: {},
            selectedProfile: "",
            clientToken: "",
            authenticationDatabase: {},
            launcherVersion: {
                name: "1.6.61",
                format: 21
            }
        };

        fs.writeFileSync(launcherProfilesPath, JSON.stringify(perfilVacio, null, 2));

    }

    return new Promise((resolve, reject) => {

        const proceso = spawn("java", [
            "-jar",
            installerPath,
            "--installClient",
            rutaMinecraft
        ], {
            cwd: rutaMinecraft
        });

        let stderrCompleto = "";

        proceso.stdout.on("data", (data) => {
            console.log("[NeoForge Installer]", data.toString());
            enviarProgreso(data.toString());
        });

        proceso.stderr.on("data", (data) => {
            const texto = data.toString();
            stderrCompleto += texto;
            console.error("[NeoForge Installer ERROR]", texto);
            enviarProgreso(texto);
        });

        proceso.on("error", (err) => {
            reject(new Error("No se pudo ejecutar 'java'. ¿Está instalado y en el PATH? Detalle: " + err.message));
        });

        proceso.on("close", (code) => {
            if (code === 0) {
                fs.unlinkSync(installerPath);
                resolve(true);
            } else {
                reject(new Error("El instalador de NeoForge terminó con código " + code + (stderrCompleto ? (" | " + stderrCompleto.slice(0, 500)) : "")));
            }
        });

    });

});

ipcMain.handle("guardar-version-instalada", async (event, manifest) => {
    guardarVersionLocal(manifest);
    return true;
});

ipcMain.handle("verificar-java", async () => {

    return new Promise((resolve) => {

        const proceso = spawn("java", ["-version"]);

        let salida = "";

        proceso.stderr.on("data", (data) => {
            salida += data.toString();
        });

        proceso.on("error", () => {
            resolve({ instalado: false, version: null, cumple: false });
        });

        proceso.on("close", () => {

            const match = salida.match(/version "(\d+)/);

            if (!match) {
                resolve({ instalado: true, version: null, cumple: false });
                return;
            }

            const versionMayor = parseInt(match[1], 10);

            resolve({
                instalado: true,
                version: versionMayor,
                cumple: versionMayor >= 25
            });

        });

    });

});

// --- Lanzar Minecraft ---

ipcMain.handle("abrir-minecraft", async (event, username) => {

    const proc = lanzarMinecraft({
        username: username && username.trim() ? username.trim() : "Jugador",
        customVersion: CUSTOM_VERSION,
        rootPath: rutaMinecraft
    });

    proc.stdout.on("data", (data) => {
        console.log("[MC]", data.toString());
        enviarProgreso(data.toString());
    });

    proc.stderr.on("data", (data) => {
        console.error("[MC ERROR]", data.toString());
        enviarProgreso(data.toString());
    });

    proc.on("error", (err) => {
        console.error("[MC spawn error]", err);
        enviarProgreso("[MC spawn error] " + err.message);
    });

    proc.on("close", (code) => {
        console.log("Minecraft cerrado, código:", code);
        if (ventanaPrincipal) {
            ventanaPrincipal.webContents.send("minecraft-cerrado", code);
        }
    });

    return true;
});