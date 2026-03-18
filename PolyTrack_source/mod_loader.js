(() => {
  const STORAGE_KEY = "polytrack_mod_selection";
  const overlay = document.getElementById("boot-mod-picker");
  const optionsRoot = document.querySelector("[data-mod-options]");
  const currentLabel = document.querySelector("[data-current-mod]");
  const modsPathLabel = document.querySelector("[data-mod-path]");
  const errorsLabel = document.querySelector("[data-mod-errors]");
  const bootLogo = document.querySelector(".boot-mod-logo");
  const modHost = window.polytrackModHost ?? null;
  const registry = new Map();
  const VANILLA_LOGO_SRC = "images/logo.svg";
  const MODDED_LOGO_SRC = "images/logo_modded.svg";

  const loaderState = {
    manifests: [],
    errors: [],
    activeModId: "vanilla",
    activeRecord: null,
    activeCleanup: [],
    featureFlags: new Set(),
    currentLoadingManifest: null,
    isStarting: false,
    hasStarted: false
  };

  const vanillaManifest = Object.freeze({
    id: "vanilla",
    name: "Vanilla",
    description: "Start the game without loading a gameplay mod.",
    version: "built-in",
    author: "PolyTrack",
    isVanilla: true
  });

  function logLoaderMessage(message) {
    if (window.electron && "function" == typeof window.electron.log) {
      window.electron.log(`[PolyTrack Mod Loader] ${message}`);
    } else {
      console.log(`[PolyTrack Mod Loader] ${message}`);
    }
  }

  function readStoredMod() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || vanillaManifest.id;
    } catch (error) {
      return vanillaManifest.id;
    }
  }

  function writeStoredMod(modId) {
    try {
      window.localStorage.setItem(STORAGE_KEY, modId);
    } catch (error) {}
  }

  function getFeatureList() {
    return Array.from(loaderState.featureFlags).sort();
  }

  function emitModChange() {
    document.documentElement.dataset.polytrackMod = loaderState.activeModId;
    document.documentElement.dataset.polytrackFeatures = getFeatureList().join(" ");
    window.dispatchEvent(new CustomEvent("polytrack-mod-change", {
      detail: {
        modId: loaderState.activeModId,
        features: getFeatureList()
      }
    }));
  }

  function getThemeLogoSrc() {
    return loaderState.activeModId === vanillaManifest.id ? VANILLA_LOGO_SRC : MODDED_LOGO_SRC;
  }

  function updateBootLogo() {
    if (bootLogo instanceof HTMLImageElement) {
      bootLogo.src = getThemeLogoSrc();
    }
  }

  function updateLogoElement(element) {
    if (!(element instanceof HTMLImageElement)) {
      return;
    }
    const currentSource = element.getAttribute("src") || element.src || "";
    if (!/logo(?:_modded)?\.svg(?:$|[?#])/i.test(currentSource)) {
      return;
    }
    const nextSource = getThemeLogoSrc();
    if (currentSource !== nextSource) {
      element.setAttribute("src", nextSource);
    }
  }

  function scanLogoElements(root) {
    if (root instanceof HTMLImageElement) {
      updateLogoElement(root);
      return;
    }
    if (!(root instanceof Element) && !(root instanceof Document)) {
      return;
    }
    if (root instanceof Element) {
      updateLogoElement(root);
    }
    for (const image of root.querySelectorAll("img")) {
      updateLogoElement(image);
    }
  }

  function installDefaultThemeHooks() {
    updateBootLogo();
    if (loaderState.activeModId === vanillaManifest.id) {
      return;
    }
    scanLogoElements(document);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if ("attributes" === record.type) {
          updateLogoElement(record.target);
          continue;
        }
        for (const node of record.addedNodes) {
          scanLogoElements(node);
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"]
    });
    registerActiveCleanup(() => observer.disconnect());
  }

  function setFeatureEnabled(featureName, enabled) {
    if ("string" != typeof featureName || 0 === featureName.trim().length) {
      return;
    }
    const normalizedName = featureName.trim();
    const changed = enabled
      ? !loaderState.featureFlags.has(normalizedName) && (loaderState.featureFlags.add(normalizedName), true)
      : loaderState.featureFlags.delete(normalizedName);
    if (changed) {
      emitModChange();
    }
  }

  function clearActiveCleanup() {
    while (loaderState.activeCleanup.length > 0) {
      const cleanup = loaderState.activeCleanup.pop();
      if ("function" != typeof cleanup) {
        continue;
      }
      try {
        cleanup();
      } catch (error) {
        console.error(error);
      }
    }
  }

  function registerActiveCleanup(cleanup) {
    if ("function" == typeof cleanup) {
      loaderState.activeCleanup.push(cleanup);
    }
    return cleanup;
  }

  function createModApi(manifest) {
    const storageKey = key => `polytrack_mod:${manifest.id}:${key}`;
    return {
      manifest,
      log(...parts) {
        logLoaderMessage(`[mod:${manifest.id}] ${parts.map(part => String(part)).join(" ")}`);
      },
      enableFeature(featureName) {
        setFeatureEnabled(featureName, true);
      },
      disableFeature(featureName) {
        setFeatureEnabled(featureName, false);
      },
      isFeatureEnabled(featureName) {
        return loaderState.featureFlags.has(featureName);
      },
      addCleanup(cleanup) {
        return registerActiveCleanup(cleanup);
      },
      injectStyle(cssText) {
        const styleElement = document.createElement("style");
        styleElement.dataset.modId = manifest.id;
        styleElement.textContent = String(cssText);
        document.head.appendChild(styleElement);
        registerActiveCleanup(() => styleElement.remove());
        return styleElement;
      },
      waitForElement(selector, callback) {
        if ("string" != typeof selector || "function" != typeof callback) {
          return;
        }
        const runCallback = () => {
          const element = document.querySelector(selector);
          if (null == element) {
            return false;
          }
          const cleanup = callback(element);
          if ("function" == typeof cleanup) {
            registerActiveCleanup(cleanup);
          }
          return true;
        };
        if (runCallback()) {
          return;
        }
        const observer = new MutationObserver(() => {
          if (runCallback()) {
            observer.disconnect();
          }
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
        registerActiveCleanup(() => observer.disconnect());
      },
      assetUrl(relativePath) {
        if (!modHost || "function" != typeof modHost.resolveModAssetUrl) {
          return "";
        }
        const response = modHost.resolveModAssetUrl(manifest.id, relativePath);
        if (response && "object" == typeof response && "error" in response) {
          throw new Error(response.error);
        }
        return response;
      },
      storage: {
        get(key, fallback = null) {
          try {
            const rawValue = window.localStorage.getItem(storageKey(key));
            return null == rawValue ? fallback : JSON.parse(rawValue);
          } catch (error) {
            return fallback;
          }
        },
        set(key, value) {
          try {
            window.localStorage.setItem(storageKey(key), JSON.stringify(value));
          } catch (error) {
            console.error(error);
          }
        },
        remove(key) {
          try {
            window.localStorage.removeItem(storageKey(key));
          } catch (error) {
            console.error(error);
          }
        }
      }
    };
  }

  window.PolyTrackMods = {
    register(definition) {
      const manifest = loaderState.currentLoadingManifest;
      if (null == manifest) {
        throw new Error("PolyTrackMods.register(...) must be called while a mod script is loading.");
      }
      if (null == definition || "object" != typeof definition || Array.isArray(definition)) {
        throw new Error(`Mod "${manifest.id}" must register an object.`);
      }
      const registrationId = "string" == typeof definition.id ? definition.id : manifest.id;
      if (registrationId !== manifest.id) {
        throw new Error(`Mod "${manifest.id}" registered as "${registrationId}".`);
      }
      if (registry.has(registrationId)) {
        throw new Error(`Mod "${registrationId}" was registered more than once.`);
      }
      registry.set(registrationId, {
        manifest,
        definition,
        api: createModApi(manifest)
      });
    },
    getActiveModId() {
      return loaderState.activeModId;
    },
    setActiveMod(modId) {
      return activateMod(modId);
    },
    isFeatureEnabled(featureName) {
      return loaderState.featureFlags.has(featureName);
    },
    listMods() {
      return loaderState.manifests.map(mod => ({
        id: mod.id,
        name: mod.name,
        description: mod.description,
        version: mod.version,
        author: mod.author,
        disabled: !!mod.disabled,
        disabledReason: mod.disabledReason || ""
      }));
    },
    getModsDirectory() {
      return modHost && "function" == typeof modHost.getModsDirectory ? modHost.getModsDirectory() : "";
    }
  };

  function loadDiscoveredMods() {
    const manifests = [vanillaManifest];
    if (!modHost || "function" != typeof modHost.scanMods || "function" != typeof modHost.loadModEntry) {
      loaderState.errors.push("Filesystem bridge unavailable. Only Vanilla mode can be used.");
      loaderState.manifests = manifests;
      return;
    }
    const scanResult = modHost.scanMods();
    if (Array.isArray(scanResult.errors)) {
      loaderState.errors.push(...scanResult.errors);
    }
    const discoveredMods = Array.isArray(scanResult.mods) ? scanResult.mods : [];
    for (const manifest of discoveredMods) {
      try {
        const entry = modHost.loadModEntry(manifest.id);
        if (entry && "object" == typeof entry && "error" in entry) {
          throw new Error(entry.error);
        }
        loaderState.currentLoadingManifest = manifest;
        new Function(`${entry.code}\n//# sourceURL=${entry.sourceUrl}`)();
        if (!registry.has(manifest.id)) {
          throw new Error(`Mod "${manifest.id}" did not call PolyTrackMods.register(...).`);
        }
        manifests.push(manifest);
      } catch (error) {
        console.error(error);
        manifests.push({
          ...manifest,
          disabled: true,
          disabledReason: error instanceof Error ? error.message : String(error)
        });
        loaderState.errors.push(`${manifest.name}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        loaderState.currentLoadingManifest = null;
      }
    }
    loaderState.manifests = manifests;
  }

  function getSelectableManifest(modId) {
    const selectedManifest = loaderState.manifests.find(mod => mod.id === modId && !mod.disabled);
    return selectedManifest ?? vanillaManifest;
  }

  function activateMod(modId) {
    const selectedManifest = getSelectableManifest(modId);
    const previousRecord = loaderState.activeRecord;
    if (previousRecord && "function" == typeof previousRecord.definition.deactivate) {
      try {
        previousRecord.definition.deactivate(previousRecord.api);
      } catch (error) {
        console.error(error);
      }
    }
    clearActiveCleanup();
    loaderState.activeRecord = null;
    loaderState.featureFlags.clear();
    loaderState.activeModId = selectedManifest.id;
    if (!selectedManifest.isVanilla) {
      const selectedRecord = registry.get(selectedManifest.id);
      if (selectedRecord) {
        loaderState.activeRecord = selectedRecord;
        if ("function" == typeof selectedRecord.definition.activate) {
          try {
            selectedRecord.definition.activate(selectedRecord.api);
          } catch (error) {
            console.error(error);
            loaderState.errors.push(`${selectedManifest.name}: ${error instanceof Error ? error.message : String(error)}`);
            clearActiveCleanup();
            loaderState.activeRecord = null;
            loaderState.featureFlags.clear();
            loaderState.activeModId = vanillaManifest.id;
          }
        }
      } else {
        loaderState.errors.push(`${selectedManifest.name}: No registered mod entry was found.`);
        loaderState.activeModId = vanillaManifest.id;
      }
    }
    installDefaultThemeHooks();
    writeStoredMod(loaderState.activeModId);
    emitModChange();
    render();
    return loaderState.activeModId;
  }

  function formatModMeta(mod) {
    const parts = [];
    if ("string" == typeof mod.version && 0 !== mod.version.length) {
      parts.push(`v${mod.version}`);
    }
    if ("string" == typeof mod.author && 0 !== mod.author.length) {
      parts.push(`by ${mod.author}`);
    }
    if ("string" == typeof mod.gameVersion && 0 !== mod.gameVersion.length) {
      parts.push(`for ${mod.gameVersion}`);
    }
    if (mod.disabled && mod.disabledReason) {
      parts.push(`disabled: ${mod.disabledReason}`);
    }
    return parts.join(" | ");
  }

  function render() {
    const selectedManifest = getSelectableManifest(loaderState.activeModId);
    document.documentElement.dataset.polytrackMod = selectedManifest.id;
    updateBootLogo();
    optionsRoot.textContent = "";
    let shortcutNumber = 1;
    for (const mod of loaderState.manifests) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "boot-mod-option";
      if (mod.id === selectedManifest.id) {
        button.classList.add("is-selected");
      }
      if (mod.disabled || loaderState.isStarting) {
        button.classList.add("is-disabled");
      }
      button.disabled = !!mod.disabled || loaderState.isStarting;
      if (!mod.disabled && shortcutNumber <= 9) {
        button.dataset.shortcut = String(shortcutNumber);
      }
      button.dataset.modId = mod.id;
      button.setAttribute("aria-pressed", mod.id === selectedManifest.id ? "true" : "false");

      const inner = document.createElement("span");
      inner.className = "boot-mod-option-inner";
      button.appendChild(inner);

      const indexLabel = document.createElement("span");
      indexLabel.className = "boot-mod-option-index";
      indexLabel.textContent = mod.disabled || shortcutNumber > 9 ? "MOD" : `${shortcutNumber}.`;
      inner.appendChild(indexLabel);

      const titleLabel = document.createElement("span");
      titleLabel.className = "boot-mod-option-title";
      titleLabel.textContent = mod.name;
      inner.appendChild(titleLabel);

      const descriptionLabel = document.createElement("span");
      descriptionLabel.className = "boot-mod-option-copy";
      descriptionLabel.textContent = mod.disabled
        ? mod.disabledReason || "This mod is currently unavailable."
        : mod.description || "No description provided.";
      inner.appendChild(descriptionLabel);

      const metaLabel = document.createElement("span");
      metaLabel.className = "boot-mod-option-meta";
      metaLabel.textContent = formatModMeta(mod);
      inner.appendChild(metaLabel);

      button.addEventListener("click", () => {
        if (mod.disabled || loaderState.isStarting) {
          return;
        }
        startGame(mod.id);
      });

      optionsRoot.appendChild(button);
      if (!mod.disabled && shortcutNumber <= 9) {
        shortcutNumber++;
      }
    }

    if (loaderState.isStarting) {
      currentLabel.textContent = `Loading ${selectedManifest.name}...`;
    } else if (loaderState.hasStarted) {
      currentLabel.textContent = `Active: ${selectedManifest.name}`;
    } else {
      currentLabel.textContent = `Selected: ${selectedManifest.name}. Pick a mod to start PolyTrack.`;
    }

    const modsDirectory = window.PolyTrackMods.getModsDirectory();
    modsPathLabel.textContent = 0 !== modsDirectory.length ? `Mods folder: ${modsDirectory}` : "Mods folder unavailable.";

    if (loaderState.errors.length > 0) {
      errorsLabel.hidden = false;
      errorsLabel.textContent = loaderState.errors.join("\n");
    } else {
      errorsLabel.hidden = true;
      errorsLabel.textContent = "";
    }
  }

  function loadGameScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  async function startGame(modId) {
    if (loaderState.isStarting || loaderState.hasStarted) {
      return;
    }
    loaderState.isStarting = true;
    activateMod(modId);
    try {
      await loadGameScript("error_screen.bundle.js");
      await loadGameScript("main.bundle.js");
      loaderState.hasStarted = true;
      overlay.hidden = true;
    } catch (error) {
      console.error(error);
      loaderState.errors.push(error instanceof Error ? error.message : String(error));
      loaderState.isStarting = false;
      render();
    }
  }

  function shouldBlockBoostKey(event) {
    return "ControlLeft" === event.code && !loaderState.featureFlags.has("ctrl_boost");
  }

  window.addEventListener("keydown", event => {
    if (shouldBlockBoostKey(event)) {
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener("keyup", event => {
    if (shouldBlockBoostKey(event)) {
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener("keydown", event => {
    if (overlay.hidden || loaderState.isStarting) {
      return;
    }
    const availableMods = loaderState.manifests.filter(mod => !mod.disabled);
    const digitMatch = /^Digit([1-9])$/.exec(event.code);
    if (digitMatch) {
      const index = Number(digitMatch[1]) - 1;
      const mod = availableMods[index];
      if (mod) {
        event.preventDefault();
        startGame(mod.id);
      }
    }
  });

  loadDiscoveredMods();
  loaderState.activeModId = getSelectableManifest(readStoredMod()).id;
  emitModChange();
  render();
})();
