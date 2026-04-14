This is a tool to create mods for and to edit functions within Polytrack 0.6.0

Also in this folder is a decompiled copy of Polytrack 0.6.0

# PolyTrack Modding Guide

It covers:
- how the packaged mod loader works
- how to create and install folder-based mods
- what the built-in mod API exposes [more API points to come]
- optional advanced workflows for editing tracks or repacking the app bundle

## What This Package Changes

After installation, the important files live inside the PolyTrack install folder:

```text
<PolyTrack>
  PolyTrack.exe
  mods\
    ctrl-boost\
    _template\
    README_MODS.md
  resources\
    app.asar
    app.asar.original   (created automatically the first time the app is repacked)
```

Runtime requirements for this mod system are:
- `resources\app.asar`
- the `mods` folder

Nothing outside the PolyTrack folder is required for normal use.

## What Users See In-Game

When PolyTrack starts, the mod loader appears before the main menu.

Behavior:
- `Vanilla` starts the game without loading an external gameplay mod.
- Any non-vanilla mod starts the game in modded mode.
- Vanilla uses the normal blue PolyTrack branding.
- Non-vanilla mods use the red/gold branding by default so modded builds are visually obvious.

## Recommended Modding Method

The recommended way to make mods for this package is to create folder-based mods inside:

```text
<PolyTrack>\mods
```

This is safer than editing `app.asar` directly, easier to share, and what the boot selector is designed to load.

## Mod Folder Layout

Each playable mod needs its own folder with:

```text
<PolyTrack>\mods\<your-mod>\
  manifest.json
  mod.js
```

The loader ignores folders that start with `_`, so `_template` is provided as a safe starting point that will not appear in the selector until copied and renamed.

## Quick Start For Creating A Mod

1. Copy `_template` to a new folder, for example `my-first-mod`.
2. Edit `manifest.json`.
3. Change the `id` in both `manifest.json` and `mod.js`.
4. Add your mod logic to `mod.js`.
5. Launch PolyTrack and select your mod in the boot menu.

## Manifest Format

Example:

```json
{
  "id": "my_first_mod",
  "name": "My First Mod",
  "version": "1.0.0",
  "author": "Your Name",
  "gameVersion": "0.6.0",
  "entry": "mod.js",
  "description": "What this mod does."
}
```

Field reference:
- `id`: required. Lowercase letters, numbers, underscores, and hyphens only.
- `name`: required. Displayed in the boot selector.
- `version`: optional but recommended.
- `author`: optional but recommended.
- `gameVersion`: optional. Good for documentation and compatibility tracking.
- `entry`: required. Usually `mod.js`.
- `description`: optional but recommended. Displayed in the selector.

Rules:
- The `id` in `manifest.json` must match the `id` used in `window.PolyTrackMods.register(...)`.
- Duplicate mod IDs are rejected.
- If the manifest is invalid or the script fails to load, the selector will show that mod as disabled.

## Mod Entry File

Each mod entry file should call:

```js
window.PolyTrackMods.register({
  id: "my_first_mod",
  activate(api) {
    api.log("Activated");
  },
  deactivate(api) {
    api.log("Deactivated");
  }
});
```

Lifecycle:
- `activate(api)` runs when the user chooses that mod and the game is about to start.
- `deactivate(api)` runs if the loader switches away from that mod before another one is activated.

For normal startup use, `activate` is the main place to put your logic.

## Mod API Reference

The loader exposes:

```js
window.PolyTrackMods.register({ id, activate(api), deactivate(api) })
```

Inside `activate(api)` and `deactivate(api)`, the following helpers are available:

### `api.manifest`

The parsed manifest for the current mod.

### `api.log(...parts)`

Writes a namespaced log message through the Electron bridge.

Example:

```js
api.log("Hello from my mod");
```

### `api.enableFeature(name)`

Enables a built-in loader feature flag.

Currently supported built-in feature:
- `ctrl_boost`

Example:

```js
api.enableFeature("ctrl_boost");
```

### `api.disableFeature(name)`

Disables a built-in loader feature flag.

### `api.isFeatureEnabled(name)`

Checks whether a built-in feature is currently enabled.

### `api.injectStyle(cssText)`

Injects a `<style>` tag into the page and automatically removes it when the mod is cleaned up.

Example:

```js
api.injectStyle(`
  body::after {
    content: "My Mod";
    position: fixed;
    right: 12px;
    top: 12px;
    z-index: 999999;
    color: white;
  }
`);
```

### `api.waitForElement(selector, callback)`

Waits until an element matching `selector` exists, then runs `callback(element)`.

If `callback` returns a function, that return value is treated as cleanup and will be called automatically later.

Example:

```js
api.waitForElement("#ui", element => {
  api.log("UI is ready");
});
```

### `api.assetUrl(relativePath)`

Resolves a file inside your mod folder to a usable `file://` URL.

Example:

```js
const imageUrl = api.assetUrl("assets/banner.png");
```

### `api.storage.get(key, fallback)`

Reads JSON-backed local storage for the current mod namespace.

### `api.storage.set(key, value)`

Writes JSON-backed local storage for the current mod namespace.

### `api.storage.remove(key)`

Deletes a stored value for the current mod namespace.

### `api.addCleanup(fn)`

Registers a cleanup callback that will run when the mod is unloaded or replaced.

Example:

```js
const onResize = () => api.log("resize");
window.addEventListener("resize", onResize);
api.addCleanup(() => window.removeEventListener("resize", onResize));
```

## Example Mods

### Minimal Mod

```js
window.PolyTrackMods.register({
  id: "hello_mod",
  activate(api) {
    api.log("Hello Mod is active");
  }
});
```

### Enable Ctrl Boost

```js
window.PolyTrackMods.register({
  id: "ctrl_boost",
  activate(api) {
    api.enableFeature("ctrl_boost");
  },
  deactivate(api) {
    api.disableFeature("ctrl_boost");
  }
});
```

### Add A Visible Label

```js
window.PolyTrackMods.register({
  id: "label_mod",
  activate(api) {
    api.injectStyle(`
      body::after {
        content: "LABEL MOD";
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 1000000;
        padding: 8px 10px;
        background: rgba(0, 0, 0, 0.65);
        color: #fff;
        font: 12px/1.2 sans-serif;
      }
    `);
  }
});
```

## Troubleshooting Folder Mods

If a mod does not appear:
- Make sure the folder name does not start with `_`.
- Make sure the folder contains both `manifest.json` and `mod.js`.
- Make sure the manifest `id` matches the `register(...)` `id`.

If a mod appears as disabled:
- Read the error text shown in the boot selector.
- Check for JSON mistakes in `manifest.json`.
- Check for JS syntax errors or registration errors in `mod.js`.

If you only see vanilla:
- Confirm the mod files are in `<PolyTrack>\mods`.
- Confirm the package was extracted into the actual PolyTrack install folder.
- Confirm `resources\app.asar` from this package has replaced the original one.

## Advanced Modding

Folder-based mods are the supported path for this package. If you need deeper changes, the included tools can help with advanced workflows.

### Track Tool

`track_tool.js` can decode and encode PolyTrack track strings.

Usage:

```powershell
node "<PolyTrack_mod_tools>\track_tool.js" decode "<input.track>" "<output.json>"
node "<PolyTrack_mod_tools>\track_tool.js" encode "<input.json>" "<output.track>"
```

Notes:
- `decode` autodetects PolyTrack export strings and save strings.
- `encode` writes an export string unless the JSON contains `kind: "save"`.

Useful decoded fields:
- `environmentId`: `0=Summer`, `1=Winter`, `2=Desert`
- `sunAngleRepresentation`: stored in 2-degree steps
- `rotationAxis`: `0=YPositive`, `1=YNegative`, `2=XPositive`, `3=XNegative`, `4=ZPositive`, `5=ZNegative`

### Editing The App Bundle Directly

If you are maintaining the loader itself or changing the packaged game files, the extracted app bundle is the advanced workspace.

Important files in an extracted bundle:
- `main.bundle.js`: main gameplay and UI code
- `simulation_worker.bundle.js`: simulation worker logic
- `electron\main.js`: Electron main process
- `electron\preload.js`: browser bridge
- `images\`, `audio\`, `models\`: direct asset replacement targets

### Repacking The App

`repack_app.ps1` repacks an extracted app folder into `app.asar`.

Recommended usage is to always pass explicit paths:

```powershell
powershell -ExecutionPolicy Bypass -File "<PolyTrack_mod_tools>\repack_app.ps1" `
  -SourceDir "<Extracted app folder>" `
  -GameDir "<PolyTrack folder>"
```

Behavior:
- Writes the output to `<PolyTrack>\resources\app.asar`
- Creates `<PolyTrack>\resources\app.asar.original` the first time it overwrites the app

### Enabling DevTools

`enable_devtools.ps1` modifies the extracted Electron `main.js` so Chromium DevTools can be opened.

Recommended usage:

```powershell
powershell -ExecutionPolicy Bypass -File "<PolyTrack_mod_tools>\enable_devtools.ps1" `
  -SourceDir "<Extracted app folder>"
```

This is only for advanced debugging of an extracted workspace. Normal folder-based mods do not need it.

## Recommended Workflow Summary

For most users:
1. Extract the mod pack into the PolyTrack install folder.
2. Put mods in `<PolyTrack>\mods`.
3. Launch PolyTrack.
4. Pick a mod in the boot selector.

For mod authors:
1. Copy `_template`.
2. Edit `manifest.json`.
3. Write `mod.js`.
4. Test by launching the game through the packaged boot selector.

For advanced maintainers:
1. Work from an extracted app bundle.
2. Edit the bundle files directly.
3. Repack with `repack_app.ps1`.
4. Rebuild the release package if you are distributing the result.
