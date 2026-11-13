const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("helena", {
  request: (path, options) =>
    ipcRenderer.invoke("helena:request", path, options),
  openExternal: (url) => ipcRenderer.invoke("helena:open-external", url),
  onEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("helena:event", listener);
    return () => ipcRenderer.removeListener("helena:event", listener);
  },
});
