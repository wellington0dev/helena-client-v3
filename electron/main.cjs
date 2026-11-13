const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const DEV_URL = "http://127.0.0.1:4200";
const isDev = process.argv.includes("--dev");
let mainWindow;
let ownsDaemon = false;
let statusSocket;

function localConfigDir() {
  if (process.env.HELENA_CONFIG_DIR) return process.env.HELENA_CONFIG_DIR;
  if (process.platform === "win32" && process.env.APPDATA)
    return path.join(process.env.APPDATA, "Helena");
  return path.join(os.homedir(), ".config", "helena");
}

function localPort() {
  return Number(
    process.env.CLIENT_LOCAL_PORT || process.env.CLIENT_PANEL_PORT || 4100,
  );
}

function localToken() {
  return fs
    .readFileSync(path.join(localConfigDir(), "local-token"), "utf8")
    .trim();
}

async function existingDaemon() {
  try {
    const response = await fetch(`http://127.0.0.1:${localPort()}/health`, {
      signal: AbortSignal.timeout(350),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function startBackend() {
  // Reuse the user's existing daemon if present; otherwise start the same client services inside Electron.
  if (await existingDaemon()) {
    try {
      const response = await fetch(`http://127.0.0.1:${localPort()}/v1/capabilities`, {
        headers: { Authorization: `Bearer ${localToken()}` },
        signal: AbortSignal.timeout(800),
      });
      const capabilities = await response.json();
      if (capabilities?.electronRenderer && capabilities?.backendProxy) return;
    } catch { /* running service predates desktop API */ }
    throw new Error('Há uma versão antiga do serviço Helena ativa. Atualize ou pare o serviço antes de iniciar o aplicativo desktop.');
  }
  let packagedConfig = {};
  try { packagedConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dist-desktop", "runtime-config.json"), "utf8")); } catch { /* desenvolvimento ou instalação antiga */ }
  const centralUrl = packagedConfig.centralUrl || "http://localhost:4510";
  await import(path.join(__dirname, "..", "dist-desktop", "daemon.mjs"));
  ownsDaemon = true;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await existingDaemon()) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(
    "O backend local da Helena não iniciou na porta configurada.",
  );
}

function connectStatusEvents() {
  const WebSocket = require("ws");
  try {
    statusSocket = new WebSocket(`ws://127.0.0.1:${localPort()}/v1/events`, [
      `helena.bearer.${localToken()}`,
    ]);
    statusSocket.on("message", (raw) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        mainWindow.webContents.send("helena:event", JSON.parse(raw.toString()));
      } catch {
        /* ignore malformed events */
      }
    });
    statusSocket.on("close", () => setTimeout(connectStatusEvents, 1500));
    statusSocket.on("error", () => statusSocket?.close());
  } catch {
    setTimeout(connectStatusEvents, 1500);
  }
}

function senderIsTrusted(event) {
  const url = event.senderFrame?.url ?? "";
  return (
    event.senderFrame === event.sender.mainFrame &&
    (isDev ? url.startsWith(DEV_URL) : url.startsWith("file://"))
  );
}

ipcMain.handle("helena:request", async (event, requestPath, options = {}) => {
  if (!senderIsTrusted(event)) throw new Error("Origem IPC não autorizada.");
  if (
    typeof requestPath !== "string" ||
    !requestPath.startsWith("/v1/") ||
    requestPath.includes("..")
  ) {
    throw new Error("Rota local inválida.");
  }
  const method = options.method ?? "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
    throw new Error("Método não permitido.");
  const response = await fetch(
    `http://127.0.0.1:${localPort()}${requestPath}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${localToken()}`,
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      // O backend pode levar vários minutos para concluir um turno de chat; um timeout menor deixaria o turno
      // rodando e debitando créditos depois que o renderer já recebeu erro.
      signal: AbortSignal.timeout(15 * 60_000),
    },
  );
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data };
});

ipcMain.handle("helena:open-external", async (event, target) => {
  if (!senderIsTrusted(event)) throw new Error("Origem IPC não autorizada.");
  let url;
  try { url = new URL(target); } catch { throw new Error("Endereço inválido."); }
  if (url.protocol !== "https:") throw new Error("Só é permitido abrir endereços HTTPS.");
  await shell.openExternal(url.toString());
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 580,
    title: "Helena",
    backgroundColor: "#f7f7f8",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isDev ? !url.startsWith(DEV_URL) : !url.startsWith("file://"))
      event.preventDefault();
  });
  if (isDev) void mainWindow.loadURL(DEV_URL);
  else
    void mainWindow.loadFile(
      path.join(__dirname, "..", "desktop-ui", "dist", "index.html"),
    );
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    createWindow();
    connectStatusEvents();
  } catch (error) {
    const { dialog } = require("electron");
    dialog.showErrorBox(
      "Helena não iniciou",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  statusSocket?.close();
  if (ownsDaemon) process.emit("SIGTERM");
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
