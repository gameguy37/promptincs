const { contextBridge, ipcRenderer } = require("electron");

const MENU_CHANNEL = "menu-command";
const FORMAT_CHANNEL = "format-command";

contextBridge.exposeInMainWorld("promptinc", {
  onOpen: (cb) => ipcRenderer.on("promptinc:open", (_e, result) => cb(result)),
  openDialog: () => ipcRenderer.send("promptinc:openDialog"),
  onMenuCommand: (cb) => {
    const listener = (_e, command) => cb(command);
    ipcRenderer.on(MENU_CHANNEL, listener);
    return () => ipcRenderer.removeListener(MENU_CHANNEL, listener);
  },
  onFormatCommand: (cb) => {
    const listener = (_e, command) => cb(command);
    ipcRenderer.on(FORMAT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(FORMAT_CHANNEL, listener);
  },
  updater: {
    onEvent: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on("promptinc:updater", listener);
      return () => ipcRenderer.removeListener("promptinc:updater", listener);
    },
    checkNow: () => ipcRenderer.send("promptinc:updater-check"),
    quitAndInstall: () => ipcRenderer.send("promptinc:updater-quit-and-install"),
  },
});

// Generic bridge: window.electron.on('menu-command', cb)
contextBridge.exposeInMainWorld("electron", {
  on: (channel, cb) => {
    if (channel !== MENU_CHANNEL && channel !== FORMAT_CHANNEL) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  off: (channel, cb) => ipcRenderer.removeListener(channel, cb),
});