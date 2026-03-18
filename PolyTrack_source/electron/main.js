const { app, BrowserWindow, session, shell, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

let browserWindow = null;

const MODS_DIRECTORY = path.resolve(process.resourcesPath, "..", "mods");
const MOD_ID_PATTERN = /^[a-z0-9_-]+$/;

function isSafeRelativePath(basePath, targetPath) {
  const resolvedPath = path.resolve(basePath, targetPath);
  const relativePath = path.relative(basePath, resolvedPath);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function safeResolveModPath(modDirectory, relativePath) {
  if ("string" != typeof relativePath || 0 === relativePath.trim().length) {
    throw new Error("Mod path must be a non-empty string.");
  }
  if (!isSafeRelativePath(modDirectory, relativePath)) {
    throw new Error("Mod path escapes the mod directory.");
  }
  return path.resolve(modDirectory, relativePath);
}

function readModManifest(modDirectory) {
  const manifestPath = path.join(modDirectory, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Missing manifest.json");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (null == manifest || "object" != typeof manifest || Array.isArray(manifest)) {
    throw new Error("Manifest must contain a JSON object.");
  }
  if ("string" != typeof manifest.id || !MOD_ID_PATTERN.test(manifest.id)) {
    throw new Error("Manifest id must use lowercase letters, numbers, underscores, or hyphens.");
  }
  if ("string" != typeof manifest.name || 0 === manifest.name.trim().length) {
    throw new Error("Manifest name must be a non-empty string.");
  }
  if ("string" != typeof manifest.entry || 0 === manifest.entry.trim().length) {
    throw new Error("Manifest entry must be a non-empty string.");
  }
  const entryPath = safeResolveModPath(modDirectory, manifest.entry);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${manifest.entry}`);
  }
  return {
    id: manifest.id,
    name: manifest.name,
    description: "string" == typeof manifest.description ? manifest.description : "",
    version: "string" == typeof manifest.version ? manifest.version : "",
    author: "string" == typeof manifest.author ? manifest.author : "",
    gameVersion: "string" == typeof manifest.gameVersion ? manifest.gameVersion : "",
    entry: manifest.entry,
    directoryName: path.basename(modDirectory),
    directoryPath: modDirectory,
    entryPath
  };
}

function scanMods() {
  const mods = [];
  const errors = [];
  if (!fs.existsSync(MODS_DIRECTORY)) {
    return {
      mods,
      errors,
      modsDirectory: MODS_DIRECTORY
    };
  }
  const seenIds = new Set();
  for (const directory of fs.readdirSync(MODS_DIRECTORY, { withFileTypes: true })) {
    if (!directory.isDirectory() || directory.name.startsWith(".") || directory.name.startsWith("_")) {
      continue;
    }
    const modDirectory = path.join(MODS_DIRECTORY, directory.name);
    try {
      const manifest = readModManifest(modDirectory);
      if (seenIds.has(manifest.id)) {
        throw new Error(`Duplicate mod id "${manifest.id}"`);
      }
      seenIds.add(manifest.id);
      mods.push(manifest);
    } catch (error) {
      errors.push(`${directory.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    mods,
    errors,
    modsDirectory: MODS_DIRECTORY
  };
}

function getManifestById(modId) {
  const { mods } = scanMods();
  const manifest = mods.find(mod => mod.id === modId);
  if (null == manifest) {
    throw new Error(`Mod "${modId}" was not found.`);
  }
  return manifest;
}

const singleInstanceLockSuccessful = app.requestSingleInstanceLock();

if (singleInstanceLockSuccessful) {
  app.on("second-instance", () => {
    if (null != browserWindow) {
      if (browserWindow.isMinimized()) {
        browserWindow.restore();
      }
      browserWindow.focus();
    }
  });
} else {
  app.quit();
}

app.on("web-contents-created", (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (
      "https://www.kodub.com/" === url ||
      "https://opengameart.org/content/sci-fi-theme-1" === url ||
      "https://www.kodub.com/terms/polytrack" === url ||
      "https://www.kodub.com/privacy/polytrack" === url ||
      "https://www.kodub.com/discord/polytrack" === url
    ) {
      setImmediate(() => {
        shell.openExternal(url);
      });
    }
    return {
      action: "deny"
    };
  });

  contents.on("will-navigate", eventToCancel => {
    eventToCancel.preventDefault();
  });
});

ipcMain.on("get-argv", event => {
  event.returnValue = process.argv;
});

ipcMain.on("log-message", (event, message) => {
  console.log(message);
});

ipcMain.on("quit", () => {
  app.quit();
});

ipcMain.on("polytrack-mods-directory", event => {
  event.returnValue = MODS_DIRECTORY;
});

ipcMain.on("polytrack-mods-scan", event => {
  try {
    event.returnValue = scanMods();
  } catch (error) {
    event.returnValue = {
      mods: [],
      errors: [error instanceof Error ? error.message : String(error)],
      modsDirectory: MODS_DIRECTORY
    };
  }
});

ipcMain.on("polytrack-mods-load-entry", (event, modId) => {
  try {
    const manifest = getManifestById(modId);
    event.returnValue = {
      code: fs.readFileSync(manifest.entryPath, "utf8"),
      sourceUrl: pathToFileURL(manifest.entryPath).href
    };
  } catch (error) {
    event.returnValue = {
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.on("polytrack-mods-resolve-asset-url", (event, modId, relativePath) => {
  try {
    const manifest = getManifestById(modId);
    event.returnValue = pathToFileURL(safeResolveModPath(manifest.directoryPath, relativePath)).href;
  } catch (error) {
    event.returnValue = {
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.whenReady().then(() => {
  browserWindow = new BrowserWindow({
    width: 1024,
    height: 800,
    minWidth: 320,
    minHeight: 200,
    fullscreen: true,
    useContentSize: true,
    autoHideMenuBar: true,
    webPreferences: {
      devTools: false,
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: false
    }
  });

  browserWindow.removeMenu();

  browserWindow.webContents.on("before-input-event", (event, input) => {
    if (
      !input.isAutoRepeat &&
      "keyDown" === input.type &&
      ("F11" === input.code || (input.alt && "Enter" === input.code))
    ) {
      browserWindow.setFullScreen(!browserWindow.isFullScreen());
      event.preventDefault();
    }
  });

  browserWindow.webContents.on("will-prevent-unload", event => {
    event.preventDefault();
  });

  browserWindow.on("enter-full-screen", () => {
    browserWindow.webContents.send("fullscreen-change", true);
  });

  browserWindow.on("leave-full-screen", () => {
    browserWindow.webContents.send("fullscreen-change", false);
  });

  ipcMain.on("is-fullscreen", event => {
    event.returnValue = null != browserWindow && browserWindow.isFullScreen();
  });

  ipcMain.on("set-fullscreen", (event, isFullscreen) => {
    if (null != browserWindow) {
      browserWindow.setFullScreen(isFullscreen);
    }
  });

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
    details.requestHeaders.Origin = "https://app-polytrack-desktop.kodub.com";
    callback({
      requestHeaders: details.requestHeaders
    });
  });

  browserWindow.loadFile("index.html");
});
