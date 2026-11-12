# Android 5.0 for the web

A browser port of Android 5.0 Lollipop, built from this AOSP `android-5.0.0_r5`
tree. The finished builds are in [`../releases`](../releases).

## What's in it

The Java framework and ART runtime aren't emulated. The system UI and apps are
reimplemented in modern JavaScript/CSS, while everything that makes Lollipop look
and sound like Lollipop is taken from this source tree at build time. Two native
AOSP libraries are compiled to WebAssembly, unmodified, and run in the page.

| Piece | Where it comes from |
| --- | --- |
| **SVOX Pico TTS → WebAssembly** | `external/svox/pico/lib`, compiled with clang/wasm-ld and a ~300-line freestanding libc (`native/libc`). Voices: `external/svox/pico/lang`. Used by Settings › Text-to-speech, TalkBack-lite and the Phone app. |
| **Sonivox EAS MIDI synth → WebAssembly** | `external/sonivox/arm-wt-22k` (portable C kernels, same defines as its `Android.mk`), with a memory-backed host layer (`native/eas_hostweb.c`). Plays the tree's MIDI/XMF files (including Replica Island's soundtrack) and local `.mid` files in Music. |
| Boot animation | Port of `BootAnimation::android()` (`frameworks/base/cmds/bootanimation`) using `android-logo-mask.png` / `android-logo-shine.png`, including its 4px/frame scroll and 12 fps pacing. |
| Battery icon | Port of `BatteryMeterView.draw()` (bolt path from `batterymeter_bolt_points`), fed by the Battery Status API. |
| Status bar, Quick Settings, keyguard, recents, volume icons | 179 SystemUI/framework **VectorDrawables converted to SVG** at build time (`tools/vector2svg.mjs`). |
| Navigation bar, Launcher, Settings, DeskClock icons | xxhdpi PNGs from `frameworks/base/packages/SystemUI`, `packages/apps/*`. |
| Fonts | Roboto (Thin…Bold), Roboto Condensed and Droid Sans Mono from `frameworks/base/data/fonts`. |
| Sounds | Material ringtones, notifications, alarms and UI effects from `frameworks/base/data/sounds`. |
| Wallpapers | Nexus 6 (`device/moto/shamu`) Lollipop wallpaper plus the AOSP defaults. |
| Calculator | Port of `Calculator.java`, `CalculatorExpressionBuilder`, the tokenizer and the evaluator (arity is replaced by a JS parser). |
| Easter eggs | `PlatLogoActivity` and **LLand** (Flappy Android) ported from Java, using the original dimensions from `lland_config.xml`. |
| Strings & build props | `version_defaults.mk`, `build_id.mk` and SystemUI/Settings `strings.xml`. |

### System
Activity/window manager with tasks and back stack, launch animations, the
notification manager with heads-up notifications, Quick Settings (Wi-Fi from
`navigator.connection`, real colour inversion and brightness, flashlight through
the torch constraint), a lock screen with swipe/PIN/pattern, Overview with live
task snapshots, the volume panel, the power menu (power off / reboot), screen
timeout, and developer options (show touches, layout bounds, animation scale).

### Apps
Launcher3 (pages, hotseat, all-apps with circular reveal, drag & drop, overview
mode, widgets, wallpaper picker), Settings, Calculator, Clock (alarms with a
radial time picker, world clock, timer, stopwatch), Browser (`<iframe>`), Camera
(`getUserMedia`, photos and video via `MediaRecorder`), Gallery (IndexedDB),
Contacts (vCard import/export), Phone (DTMF tones; simulated calls answered by
Pico TTS), Messaging (with a reply bot), Music (Media Session API), Sound
Recorder, Calendar.

### Installing apps: WAPK packages
The port has a PackageInstaller for **`.wapk`** packages ([format and runtime
API](docs/WAPK.md)). To install one:
- drop the file onto the page;
- use Settings › Apps › ⋮ › *Install app from file*;
- open it in the file explorer;
- or load the page with `?install=<url>`.

Installation requires Settings › Security › *Unknown sources*, just like on a
device. Installed apps appear on the home screen, in all apps and in
Settings › Apps (App info shows their permissions and has an Uninstall button),
and persist in IndexedDB.

`tools/apk2wapk.mjs` converts an APK: metadata, label and icon come from the
APK's `AndroidManifest.xml` and `resources.arsc`. The Dalvik bytecode can't run
in a browser, so behaviour comes from a web implementation directory. Example:

```bash
node tools/apk2wapk.mjs cx-file-explorer-2-7-6.apk --impl wapk/com.cxinventor.file.explorer \
  -o ../releases/wapk/com.cxinventor.file.explorer-2.7.6.wapk
```

`wapk/com.cxinventor.file.explorer/` is a web file explorer written for that
package. It provides:
- `/sdcard` on the Origin Private File System;
- a read-only `/system` built from the AOSP files in the build;
- local folders through the File System Access API;
- a library view by file type, copy/move/rename/delete, zip and unzip;
- image, media and text viewers, and installing `.wapk` files from storage.

Original replacements with their own names and art:
- `wapk/org.android5web.swiftbrowser` replaces Opera Mini;
- `wapk/org.android5web.talkingpip` replaces Talking Tom Cat. It uses the
  microphone through the gated `media` API and Pico TTS through the `tts` API.

### Web platform features used
ES modules bundled with esbuild (plus dynamic `import()` of WAPK entry modules), WebAssembly, Origin Private File System, File System Access API, Compression Streams (ZIP), SubtleCrypto (package checksums), Web Audio, Web Animations,
CSS custom properties, `clip-path` reveals, `color-mix()`, Pointer Events,
IndexedDB, Service Worker + Web App Manifest (offline/installable), Battery
Status, Network Information, Media Capture, MediaRecorder, Media Session,
Geolocation, Web Share, Web Bluetooth and the Storage API, each feature-detected
with a fallback.

## Building

Requirements: Node 18+, `clang` and `wasm-ld` with the wasm32 target (LLVM 15+),
and Python 3 with Pillow (optional, used to downscale wallpapers).

```bash
cd web
npm install
npm run build          # node tools/build.mjs  (rebuilds the .wasm when sources change)
```

`node tools/build.mjs --native` forces the WebAssembly rebuild, and `--dev`
skips minification. To serve the multi-file build locally:

```bash
python3 -m http.server --directory ../releases/android-5.0-web 8080
```

URL flags: `?noboot` skips the boot animation, `?unlock` skips the lock screen,
`?fullscreen` forces the frameless phone layout.

## Layout

```
web/
  native/        libc shim, Pico + EAS front-ends/host layers, build.sh
  tools/         build.mjs (asset extraction, bundling, releases), vector2svg.mjs, apk2wapk.mjs
  docs/WAPK.md   WAPK package format + runtime API
  wapk/          web implementations used when converting APKs
  src/index.html, src/sw.js
  src/css/       base widgets, SystemUI, Launcher, apps
  src/js/core/   system (AMS/WMS), ui widgets, prefs, db, sound, tts, midi, notifications,
                 packages (PackageManager + WAPK runtime), storage, zip, apk (AXML/ARSC parsers)
  src/js/systemui/  bootanim, statusbar, battery, navbar, shade, keyguard, recents, volume, power
  src/js/launcher/  Launcher3
  src/js/apps/   one module per app
```

All AOSP content is under the Apache License 2.0 (see the NOTICE files in the
respective source directories).
