const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
let autoUpdater = null;
try {
  // electron-updater is only present in packaged installs; guard for dev runs.
  autoUpdater = require("electron-updater").autoUpdater;
} catch (err) {
  console.warn("[updater] electron-updater not available:", err && err.message);
}

// The full PrompTinc web app (Edit Mode, Prompt Mode, Play Along Room,
// all host controls) lives at this URL. The desktop app is a native
// wrapper around the complete site — NOT a stripped-down viewer.
const APP_URL = process.env.PROMPTINC_APP_URL || "https://promptin.me/";

let mainWindow = null;
// File path requested before the window/renderer is ready (double-click launch).
let pendingFile = null;

function readPromptinc(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return {
      ok: true,
      name: path.basename(filePath),
      base64: buf.toString("base64"),
      filePath,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), filePath };
  }
}

function sendFile(filePath) {
  if (!filePath) return;
  const result = readPromptinc(filePath);
  if (!result.ok) {
    dialog.showErrorBox("Couldn't open script", result.error || "Unknown error");
    return;
  }
  if (!mainWindow || !mainWindow.webContents) {
    pendingFile = filePath;
    return;
  }
  const dispatch = () => {
    // Dispatch a CustomEvent that the web app listens for. The renderer
    // decodes the base64 payload into a real File and pushes it through
    // the same import path used by drag-and-drop and the file picker,
    // landing the script directly in the Edit Mode canvas.
    const payload = JSON.stringify({ name: result.name, base64: result.base64 });
    const js = `(() => {
      const detail = ${payload};
      const fire = () => window.dispatchEvent(new CustomEvent('promptinc:electron-import', { detail }));
      if (window.__promptincReady) fire();
      else window.addEventListener('promptinc:renderer-ready', fire, { once: true });
    })();`;
    mainWindow.webContents.executeJavaScript(js).catch((e) => console.error(e));
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", dispatch);
  } else {
    dispatch();
  }
}

function openFileDialog() {
  const picks = dialog.showOpenDialogSync(mainWindow, {
    title: "Open PrompTinc Script",
    filters: [{ name: "PrompTinc Script", extensions: ["promptinc", "json"] }],
    properties: ["openFile"],
  });
  if (picks && picks[0]) sendFile(picks[0]);
}

function send(channel, payload) {
  if (!mainWindow || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

// Relay a custom menu action to the React renderer.
const cmd = (label, command, accelerator) => ({
  label,
  ...(accelerator ? { accelerator } : {}),
  click: () => send("menu-command", command),
});

// Relay a native Format-menu action to the React renderer (TipTap).
const fmt = (label, command, accelerator) => ({
  label,
  ...(accelerator ? { accelerator } : {}),
  click: () => send("format-command", command),
});

function buildMenu() {
  const isMac = process.platform === "darwin";

  const appMenu = {
    label: "Promptin' Circumstance",
    submenu: [
      { role: "about", label: "About Promptin' Circumstance" },
      { type: "separator" },
      cmd("Preferences\u2026", "preferences", "CmdOrCtrl+,"),
      { type: "separator" },
      { role: "services", submenu: [] },
      { type: "separator" },
      { role: "hide", label: "Hide Promptin' Circumstance" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit", label: "Quit Promptin' Circumstance" },
    ],
  };

  const fileMenu = {
    label: "File",
    submenu: [
      cmd("New Show", "new-show", "CmdOrCtrl+N"),
      { label: "Open\u2026", accelerator: "CmdOrCtrl+O", click: openFileDialog },
      cmd("Save", "save", "CmdOrCtrl+S"),
      { type: "separator" },
      isMac ? { role: "close" } : { role: "quit" },
    ],
  };

  const editMenu = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      ...(isMac ? [{ role: "pasteAndMatchStyle" }] : []),
      { role: "delete" },
      { role: "selectAll" },
      { type: "separator" },
      {
        label: "Find",
        submenu: [
          cmd("Find\u2026", "find", "CmdOrCtrl+F"),
          cmd("Find and Replace\u2026", "find-replace", isMac ? "Alt+Cmd+F" : "Ctrl+Alt+F"),
          cmd("Find Next", "find-next", "CmdOrCtrl+G"),
          cmd("Find Previous", "find-previous", "Shift+CmdOrCtrl+G"),
        ],
      },
      ...(isMac
        ? [
            {
              label: "Spelling and Grammar",
              submenu: [
                { role: "startSpeaking", visible: false },
                { label: "Check Document Now", accelerator: "CmdOrCtrl+;", role: "toggleSpellChecker" },
                { label: "Check Spelling While Typing", role: "toggleSpellChecker" },
              ],
            },
          ]
        : []),
      {
        label: "Transformations",
        submenu: [
          cmd("Make Upper Case", "transform-upper"),
          cmd("Make Lower Case", "transform-lower"),
          cmd("Capitalize", "transform-capitalize"),
        ],
      },
      {
        label: "Speech",
        submenu: [cmd("Start Speaking", "speech-start"), cmd("Stop Speaking", "speech-stop")],
      },
    ],
  };

  const viewMenu = {
    label: "View",
    submenu: [
      cmd("Toggle Prompt Mode", "toggle-prompt", "CmdOrCtrl+R"),
      { type: "separator" },
      cmd("Zoom In", "zoom-in", "CmdOrCtrl+Plus"),
      cmd("Zoom Out", "zoom-out", "CmdOrCtrl+-"),
      cmd("Actual Size", "zoom-reset", "CmdOrCtrl+0"),
      { type: "separator" },
      { role: "togglefullscreen", accelerator: isMac ? "Control+Cmd+F" : "F11" },
      { role: "toggleDevTools" },
    ],
  };

  const bookmarksMenu = {
    label: "Bookmarks",
    submenu: [
      cmd("Add Bookmark", "bookmark-add", "CmdOrCtrl+B"),
      cmd("Next Bookmark", "bookmark-next", "CmdOrCtrl+]"),
      cmd("Previous Bookmark", "bookmark-previous", "CmdOrCtrl+["),
      { type: "separator" },
      cmd("Clear All Bookmarks", "bookmark-clear"),
    ],
  };

  // Standard Apple typography menu, wired to TipTap through `format-command`.
  const formatMenu = {
    label: "Format",
    submenu: [
      {
        label: "Style",
        submenu: [
          fmt("Bold", "bold", "CmdOrCtrl+B"),
          fmt("Italic", "italic", "CmdOrCtrl+I"),
          fmt("Underline", "underline", "CmdOrCtrl+U"),
          fmt("Strikethrough", "strikethrough"),
        ],
      },
      {
        label: "Size",
        submenu: [
          fmt("Bigger", "size-bigger", "CmdOrCtrl+Plus"),
          fmt("Smaller", "size-smaller", "CmdOrCtrl+-"),
          fmt("Slightly Bigger", "size-slightly-bigger", "Control+CmdOrCtrl+Plus"),
          fmt("Slightly Smaller", "size-slightly-smaller", "Control+CmdOrCtrl+-"),
          fmt("Document Bigger", "document-bigger", "Alt+CmdOrCtrl+Plus"),
          fmt("Document Smaller", "document-smaller", "Alt+CmdOrCtrl+-"),
        ],
      },
      {
        label: "Alignment",
        submenu: [
          fmt("Align Left", "align-left", "CmdOrCtrl+{"),
          fmt("Center", "align-center", "CmdOrCtrl+|"),
          fmt("Justify", "align-justify"),
          fmt("Align Right", "align-right", "CmdOrCtrl+}"),
          { type: "separator" },
          {
            label: "Writing Direction",
            submenu: [
              fmt("Left to Right", "direction-ltr"),
              fmt("Right to Left", "direction-rtl"),
            ],
          },
        ],
      },
      {
        label: "Baseline",
        submenu: [
          fmt("Use Default", "baseline-default"),
          fmt("Superscript", "baseline-superscript"),
          fmt("Subscript", "baseline-subscript"),
          fmt("Raise", "baseline-raise"),
          fmt("Lower", "baseline-lower"),
        ],
      },
      {
        label: "Ligature",
        submenu: [
          fmt("Use Default", "ligature-default"),
          fmt("Use None", "ligature-none"),
          fmt("Use All", "ligature-all"),
        ],
      },
      {
        label: "Kern",
        submenu: [
          fmt("Use Default", "kern-default"),
          fmt("Use None", "kern-none"),
          fmt("Tighten", "kern-tighten"),
          fmt("Loosen", "kern-loosen"),
        ],
      },
    ],
  };

  const windowMenu = {
    label: "Window",
    role: "window",
    submenu: isMac
      ? [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
          { type: "separator" },
          { role: "window" },
        ]
      : [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
  };

  const template = [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    editMenu,
    formatMenu,
    viewMenu,
    bookmarksMenu,
    windowMenu,
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Load the complete PrompTinc web application — full routing stack,
  // Edit Mode, Prompt Mode, Play Along Room, and every config menu.
  mainWindow.loadURL(APP_URL);
  buildMenu();
  if (pendingFile) {
    sendFile(pendingFile);
    pendingFile = null;
  }
  mainWindow.on("closed", () => (mainWindow = null));
}

function sendUpdaterEvent(channel, payload) {
  if (!mainWindow || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  try {
    mainWindow.webContents.send(channel, payload);
  } catch (err) {
    console.warn("[updater] send failed", channel, err && err.message);
  }
}

function setupAutoUpdater() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => sendUpdaterEvent("promptinc:updater", { type: "checking" }));
  autoUpdater.on("update-available", (info) =>
    sendUpdaterEvent("promptinc:updater", { type: "update-available", info })
  );
  autoUpdater.on("update-not-available", (info) =>
    sendUpdaterEvent("promptinc:updater", { type: "update-not-available", info })
  );
  autoUpdater.on("download-progress", (progress) =>
    sendUpdaterEvent("promptinc:updater", { type: "download-progress", progress })
  );
  autoUpdater.on("update-downloaded", (info) =>
    sendUpdaterEvent("promptinc:updater", { type: "update-downloaded", info })
  );
  autoUpdater.on("error", (err) =>
    sendUpdaterEvent("promptinc:updater", { type: "error", message: String(err && err.message ? err.message : err) })
  );

  const kickOff = () => {
    try {
      autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      console.warn("[updater] check failed", err && err.message);
    }
  };
  if (mainWindow && mainWindow.webContents) {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", kickOff);
    } else {
      kickOff();
    }
  }
}

// macOS: double-click on a .promptinc file
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) sendFile(filePath);
  else pendingFile = filePath;
});

// Windows/Linux: file passed as a CLI argument
function fileFromArgv(argv) {
  return argv.find((a) => /\.(promptinc|json)$/i.test(a)) || null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const f = fileFromArgv(argv);
    if (f) sendFile(f);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const argFile = fileFromArgv(process.argv.slice(1));
    if (argFile) pendingFile = argFile;
    createWindow();
    setupAutoUpdater();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

ipcMain.on("promptinc:openDialog", openFileDialog);

ipcMain.on("promptinc:updater-quit-and-install", () => {
  if (!autoUpdater) return;
  try {
    autoUpdater.quitAndInstall();
  } catch (err) {
    console.warn("[updater] quitAndInstall failed", err && err.message);
  }
});

ipcMain.on("promptinc:updater-check", () => {
  if (!autoUpdater) return;
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    console.warn("[updater] manual check failed", err && err.message);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});