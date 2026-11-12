# WAPK: web application packages for Android 5.0 for the web

A `.wapk` is to this browser port what an `.apk` is to a device: a single file
that the system **PackageInstaller** installs, shows on the home screen, lists
in Settings › Apps and can uninstall. It runs on the WAPK runtime (API level
21, runtime version 1) instead of ART.

## Container

A WAPK is a ZIP archive (stored or deflate entries):

```
WAPK-MANIFEST.json     required: package metadata (below)
main.js                required: entry module (manifest.entry)
icon.png               required: launcher icon (manifest.icon)
style.css              optional: listed in manifest.styles, injected while installed
res/**                 optional: resources, available via android.resource(path)
META-INF/SOURCE.json   optional: provenance (e.g. the APK it was converted from)
```

### `WAPK-MANIFEST.json`

```json
{
  "wapk": 1,
  "package": "com.example.app",
  "label": "Example",
  "versionCode": 1,
  "versionName": "1.0",
  "minSdkVersion": 21,
  "targetSdkVersion": 21,
  "minRuntime": 1,
  "permissions": ["android.permission.READ_EXTERNAL_STORAGE"],
  "icon": "icon.png",
  "entry": "main.js",
  "styles": ["style.css"],
  "theme": { "colorPrimary": "#1e88e5", "colorPrimaryDark": "#1565c0", "colorAccent": "#ff6d00" },
  "fullscreen": false,
  "files": { "main.js": "<sha-256 hex>", "icon.png": "<sha-256 hex>" }
}
```

The installer rejects a package when:
- `wapk` is not `1`, or the package name is invalid;
- `minSdkVersion > 21` or `minRuntime` is newer than the runtime;
- the entry, icon or a listed style is missing;
- any listed file is missing, or its SHA-256 doesn't match `files`.

Installing the same package again is an update and keeps the app's data.
Installing a lower `versionCode` over a higher one is refused. As on Android
5.0, installation is blocked until Settings › Security › **Unknown sources** is
enabled.

## Entry module

`main.js` is an ES module whose default export receives the runtime API and
returns the app's main Activity class:

```js
export default android => class extends android.App {
  onCreate(root, intent) { root.append(android.ui.toolbar({ title: android.manifest.label })); }
  onBack() { return false; }        // true if handled
  onResume() {} onPause() {} onDestroy() {}
};
```

The window element carries `data-app="<package>"`; scope CSS with it.

## Runtime API (version 1)

| Member | Description |
| --- | --- |
| `App` | Activity base class (`finish()`, `setStatusBarColor()`, `setFullscreen()`) |
| `h, icon, vector, letterTile, drag, onLongPress, fmtTime, fmtDate, clamp` | DOM and UI helpers used by the system apps |
| `ui` | Material widgets: `toolbar, listItem, switchItem, switchEl, checkbox, subheader, divider, slider, button, fab, dialog, prompt, toast, popupMenu, PageStack, tabs, emptyState` |
| `manifest, SDK_INT, buildProps, runtimeVersion` | Package and platform information |
| `resource(path)` / `readResource(path)` | Object URL / Blob for a file inside the package |
| `prefs.get(k, def)`, `prefs.set(k, v)` | Per-package SharedPreferences (removed on uninstall) |
| `notify(n)`, `cancelNotification(id)` | NotificationManager |
| `startActivity(pkg, intent)` | Launch another app |
| `sound.click/playEffect/vibrate`, `sound.audioContext()`, `sound.mediaVolume()`, `is24HourFormat()` | Platform feedback and the shared Web Audio context |
| `tts.available()`, `tts.speak(text, { rate, pitch, lang })`, `tts.stop()` | Text-to-speech via the Pico engine (WebAssembly) |
| `media.getUserMedia(constraints)` | **Requires** `RECORD_AUDIO` for audio and `CAMERA` for video |
| `zip.readZip(bytes)`, `zip.writeZip(entries)` | ZIP support |
| `storage` | **Requires** `READ_EXTERNAL_STORAGE` or `WRITE_EXTERNAL_STORAGE`. Volumes: `internal()` = `/sdcard` (Origin Private File System, with an IndexedDB fallback), `system()` = read-only `/system` built from AOSP, `pickFolder()` = a local folder via the File System Access API. Each volume has `list / stat / readFile / writeFile / mkdir / remove`. Helpers: `copy, walk, usage, join, dirname, basename, ext, mimeOf, kindOf` |
| `installPackage(bytes, name)` | **Requires** `REQUEST_INSTALL_PACKAGES`. Opens the system PackageInstaller |

Accessing a gated member without the permission throws a `SecurityError`.

## Converting an APK

```bash
node tools/apk2wapk.mjs app.apk --impl wapk/<package> -o out.wapk
```

`apk2wapk` parses `AndroidManifest.xml` and `resources.arsc` with
`src/js/core/apk.js`. It copies the package name, version, SDK levels, label
and the launcher icon Android 5.0 would pick (resolved for API 21 / xxxhdpi),
and records the APK's SHA-256, DEX files, native ABIs and full permission list
in `META-INF/SOURCE.json`.

Dalvik bytecode (`classes*.dex`) and native libraries **cannot run in the
browser**, so the app's behaviour comes from a web implementation in the
`--impl` directory:
- `main.js`, plus optional `style.css` and `res/`;
- an optional `wapk.json` that overrides `theme`, `label`, `fullscreen`,
  `permissions` and `minSdkVersion`. To ship an original identity rather than the APK's branding, it can also override `package`, `versionName`, `versionCode` and `icon` (a file in the directory); the APK is then recorded under `replaces` in `META-INF/SOURCE.json`.

Without `--impl`, a stub app is generated that says so.

Dropping a raw `.apk` on the device opens the installer, which explains that
the APK must be converted first.
