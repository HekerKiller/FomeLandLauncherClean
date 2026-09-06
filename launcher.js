const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function uuidOffline(username) {

    const hash = crypto.createHash("md5").update("OfflinePlayer:" + username).digest();

    hash[6] = (hash[6] & 0x0f) | 0x30;
    hash[8] = (hash[8] & 0x3f) | 0x80;

    const hex = hash.toString("hex");

    return [
        hex.substring(0, 8),
        hex.substring(8, 12),
        hex.substring(12, 16),
        hex.substring(16, 20),
        hex.substring(20, 32)
    ].join("-");
}

function resolverLibrerias(rootPath, librariesJson) {

    const rutas = [];

    for (const lib of librariesJson) {

        if (lib.rules) {

            const permitido = lib.rules.every((regla) => {
                if (regla.action === "allow" && regla.os) {
                    return regla.os.name === "windows";
                }
                if (regla.action === "disallow" && regla.os) {
                    return regla.os.name !== "windows";
                }
                return true;
            });

            if (!permitido) continue;

        }

        if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) {
            rutas.push(path.join(rootPath, "libraries", lib.downloads.artifact.path));
        }
        else if (lib.name) {
            const partes = lib.name.split(":");
            if (partes.length >= 3) {
                const [grupo, artefacto, version, clasificador] = partes;
                const grupoRuta = grupo.replace(/\./g, path.sep);
                const nombreArchivo = `${artefacto}-${version}` + (clasificador ? `-${clasificador}` : "") + ".jar";
                rutas.push(path.join(rootPath, "libraries", grupoRuta, artefacto, version, nombreArchivo));
            }
        }

    }

    return rutas;
}

// Extrae argumentos de una lista arguments.jvm / arguments.game, evaluando reglas de SO
function extraerArgs(lista) {

    const resultado = [];

    if (!lista) return resultado;

    for (const item of lista) {

        if (typeof item === "string") {
            resultado.push(item);
            continue;
        }

        if (typeof item === "object" && item.value) {

            let permitido = true;

            if (item.rules) {
                permitido = item.rules.every((regla) => {
                    if (regla.action === "allow" && regla.os) {
                        return regla.os.name === "windows";
                    }
                    if (regla.action === "disallow" && regla.os) {
                        return regla.os.name !== "windows";
                    }
                    if (regla.action === "allow" && regla.features) {
                        return false; // no soportamos features especiales (demo, quickplay, etc.)
                    }
                    return true;
                });
            }

            if (!permitido) continue;

            if (Array.isArray(item.value)) {
                resultado.push(...item.value);
            } else {
                resultado.push(item.value);
            }

        }

    }

    return resultado;
}

function sustituirPlaceholders(args, variables) {

    return args.map((arg) => {

        return arg.replace(/\$\{([^}]+)\}/g, (match, clave) => {
            return variables[clave] !== undefined ? variables[clave] : match;
        });

    });

}

function lanzarMinecraft({ username, customVersion, rootPath }) {

    const uuid = uuidOffline(username);

    const versionJsonPath = path.join(rootPath, "versions", customVersion, customVersion + ".json");

    if (!fs.existsSync(versionJsonPath)) {
        throw new Error("No se encontró el archivo de versión: " + versionJsonPath);
    }

    const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, "utf-8"));

    let librariesCombinadas = versionJson.libraries || [];
    let mainClass = versionJson.mainClass;
    let jvmArgsCrudos = [];
    let gameArgsCrudos = [];
    let inheritsFrom = versionJson.inheritsFrom;
    let padreJson = null;

    if (inheritsFrom) {

        const padreJsonPath = path.join(rootPath, "versions", inheritsFrom, inheritsFrom + ".json");

        if (fs.existsSync(padreJsonPath)) {

            padreJson = JSON.parse(fs.readFileSync(padreJsonPath, "utf-8"));

            librariesCombinadas = [...(padreJson.libraries || []), ...librariesCombinadas];

            if (!mainClass) mainClass = padreJson.mainClass;

            if (padreJson.arguments) {
                jvmArgsCrudos.push(...extraerArgs(padreJson.arguments.jvm));
                gameArgsCrudos.push(...extraerArgs(padreJson.arguments.game));
            }

        }

    }

    if (versionJson.arguments) {
        jvmArgsCrudos.push(...extraerArgs(versionJson.arguments.jvm));
        gameArgsCrudos.push(...extraerArgs(versionJson.arguments.game));
    }

    const rutasLibrerias = resolverLibrerias(rootPath, librariesCombinadas);

    const jarBase = inheritsFrom || customVersion;
    const clientJarPath = path.join(rootPath, "versions", jarBase, jarBase + ".jar");

    const classpath = [...rutasLibrerias, clientJarPath].join(";");

    const assetsDir = path.join(rootPath, "assets");
    const assetIndex = (versionJson.assetIndex && versionJson.assetIndex.id)
        || (padreJson && padreJson.assetIndex && padreJson.assetIndex.id)
        || "26.2";

    const nativesDir = path.join(rootPath, "versions", jarBase, "natives");

    const variables = {
        auth_player_name: username,
        version_name: customVersion,
        game_directory: rootPath,
        assets_root: assetsDir,
        assets_index_name: assetIndex,
        auth_uuid: uuid,
        auth_access_token: "0",
        auth_xuid: "0",
        clientid: "0",
        user_type: "legacy",
        user_properties: "{}",
        version_type: "release",
        natives_directory: nativesDir,
        launcher_name: "FomeLandLauncher",
        launcher_version: "1.0",
        classpath: classpath,
        library_directory: path.join(rootPath, "libraries"),
        classpath_separator: ";"
    };

    const jvmArgs = sustituirPlaceholders(jvmArgsCrudos, variables);
    const gameArgs = sustituirPlaceholders(gameArgsCrudos, variables);

    // Si el json no trae ya -cp con classpath sustituido, lo agregamos manualmente
    const yaTieneClasspath = jvmArgs.some((a) => a.includes(classpath));

    const argsFinales = [
        "-Xmx8G",
        "-Xms2G",
        ...jvmArgs
    ];

    if (!yaTieneClasspath) {
        argsFinales.push("-cp", classpath);
    }

    argsFinales.push(mainClass, ...gameArgs);

    console.log("[Comando Java]", "java", argsFinales.join(" "));

    const proc = spawn("java", argsFinales, {
        cwd: rootPath
    });

    return proc;
}

module.exports = { lanzarMinecraft };