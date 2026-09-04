const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
ipcMain.handle("existe-minecraft", async () => {

    return fs.existsSync("./minecraft/versions");

});
function createWindow() {

    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile("index.html");
}

app.whenReady().then(createWindow);

ipcMain.handle("crear-carpetas", async () => {

    const carpetas = [
        "./minecraft",
        "./minecraft/mods",
        "./minecraft/config",
        "./minecraft/logs",
        "./minecraft/libraries",
        "./minecraft/versions",
        "./minecraft",
    ];

    carpetas.forEach(carpeta => {
        if (!fs.existsSync(carpeta)) {
            fs.mkdirSync(carpeta, { recursive: true });
        }
    });

    return true;
});