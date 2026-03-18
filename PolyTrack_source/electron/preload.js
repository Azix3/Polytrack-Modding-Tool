const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  quit: () => ipcRenderer.send("quit"),
  addFullscreenChangeListener: listener => ipcRenderer.on("fullscreen-change", () => listener()),
  isFullscreen: () => ipcRenderer.sendSync("is-fullscreen"),
  setFullscreen: isFullscreen => ipcRenderer.send("set-fullscreen", isFullscreen),
  getArgv: () => ipcRenderer.sendSync("get-argv"),
  log: message => ipcRenderer.send("log-message", message)
});

contextBridge.exposeInMainWorld("polytrackModHost", {
  getModsDirectory: () => ipcRenderer.sendSync("polytrack-mods-directory"),
  scanMods: () => ipcRenderer.sendSync("polytrack-mods-scan"),
  loadModEntry: modId => ipcRenderer.sendSync("polytrack-mods-load-entry", modId),
  resolveModAssetUrl: (modId, relativePath) =>
    ipcRenderer.sendSync("polytrack-mods-resolve-asset-url", modId, relativePath)
});
