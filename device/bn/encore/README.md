# AOSP 5.0 (Lollipop) for the Nook Color (`encore`)

Device configuration for building stock AOSP `android-5.0.0_r5` for the
Barnes & Noble Nook Color, booted by the **CyanogenMod u-boot** (the one with
the "Hold ^ for menu" boot menu that CM 7.2/9/10/11 installs).

| | |
|---|---|
| SoC | TI OMAP3621, Cortex-A8 @ up to 1 GHz |
| GPU | PowerVR SGX530 (prebuilt TI/IMG driver) |
| RAM | 512 MB |
| Display | 1024×600, 160 dpi (tablet UI, mdpi) |
| Wi-Fi / BT | TI WL1271 |
| Audio | TI TLV320AIC3100 |
| Kernel | 3.0.101 (CyanogenMod `encore-omap3-3.0.y`) |

## Status

This port has **not been booted on hardware yet**. What has been checked:

* `lunch aosp_encore-userdebug` passes. The AOSP build runs
  `make encore_bootfiles` and produces `uImage` and `uRamdisk`, and
  U-Boot's `mkimage -l` accepts both.
* The ramdisk contains `init.encore.rc`, `fstab.encore`, `ueventd.encore.rc` and a static `fsfinder`.
* The AOSP build compiles and links every device module: the audio, lights,
  sensors and power HALs, `pvrsrvinit` (PIE), `store-mac-addr`, and
  `wpa_supplicant`/`hostapd` with the TI driver library.
* The kernel and the Wi-Fi modules build from source. Module vermagic matches the kernel.
* `tools/mkuimage.py` writes images byte-identical to U-Boot's `mkimage` (except the timestamp).
* `store-mac-addr` produces byte-identical output to CM's script.
* `fsfinder` was tested against SD and eMMC command lines.
* **Not yet exercised**: a full `make` (system.img, which needs JDK 7 and
  about 100 GB) and the installer zip inside a real recovery.

What to expect on first boot:

| Area | Expected state |
|---|---|
| Display, touch, buttons, accelerometer, backlight | should work (CM drivers/HALs, adapted to the 5.0 HAL APIs) |
| Wi-Fi | should work (CM's compat-wireless wl12xx + TI wpa_supplicant library) |
| Audio (speaker, headphones, mic) | new tinyalsa HAL (`audio/`); routing is done by the codec driver |
| Internal storage (eMMC p8), microSD, USB OTG storage | via vold + FUSE, internal is primary |
| Graphics | SGX530 driver through the gralloc framebuffer; **no hardware composer yet** |
| Video playback | software codecs only (OMAP3 DSP codecs not ported) |
| Bluetooth | **disabled**. AOSP 5.0 has no TI `libbt-vendor`; the kernel side is ready |
| SELinux | not in the 3.0 kernel. Build **userdebug** or **eng**, not user |

## What is different from CM 11

* **Boot images**: `uboot.mk` turns the kernel and ramdisk into U-Boot
  legacy images (`uImage`, `uRamdisk`) with `tools/mkuimage.py`. No
  `boot.img` is involved. u-boot appends `androidboot.bootdevice=eMMC|SD`
  to the kernel command line, and `fsfinder` creates
  `/dev/block/by-name/*` from it, so one build runs from eMMC or from SD.
* **`pvrsrvinit`**: the prebuilt is non-PIE, and the 5.0 linker refuses to
  run non-PIE executables. `pvrsrvinit/` is an open-source PIE replacement.
  It calls `SrvInit()` in `libsrv_init.so`, which is all the original did.
* **Audio**: CM's prebuilt KitKat ALSA libraries are replaced by a native 5.0
  tinyalsa HAL.
* **Shell helpers**: AOSP 5.0's toolbox has no `sed`, `sort` or `printf`.
  CM's `configure_vold.sh` is now part of `fsfinder`, and `store-mac-addr.sh` is now C.
* **Graphics**: 5.0 finds the driver by file name in `/vendor/lib/egl`, so
  `egl.cfg` is gone. The OMAP3 hwcomposer is not built yet.
* **Memory**: 512 MB tuning (`ro.config.low_ram`, smaller HWUI caches, zram,
  KSM, dex2oat limits). The ART boot image is precompiled at build time
  (`WITH_DEXPREOPT_BOOT_IMG_ONLY`).

## Building

You need a normal AOSP 5.0 build machine. Use 64-bit Ubuntu 14.04 or similar
with **OpenJDK 7**, `gcc-multilib`/`lib32z1`/`lib32ncurses5` (the prebuilt
clang 3.5 and python are 32-bit), and about 100 GB free.

On a newer distribution (no Python 2, no JDK 7), the tree's own prebuilts
still work once the 32-bit runtime is installed. On Ubuntu 24.04:
`dpkg --add-architecture i386 && apt-get install libc6:i386 libstdc++6:i386 zlib1g:i386 libncurses6:i386`.
Then put `prebuilts/python/linux-x86/2.7.5/bin` first in `PATH`. You still
need a real JDK 7 (for example Azul Zulu 7) for the Java parts of the build.

```sh
# 1. proprietary SGX530 driver -> vendor/bn/encore (not committed)
device/bn/encore/fetch-vendor-blobs.sh            # from TheMuppets on GitHub
#   or: ... --adb                                 # from a Nook Color running CM
#   or: ... --dir /path/to/unpacked/cm/system

# 2. (optional) rebuild the kernel + Wi-Fi modules; a prebuilt is committed
device/bn/encore/build-kernel.sh

# 3. build
source build/envsetup.sh
lunch aosp_encore-userdebug
make -j8
```

Output in `out/target/product/encore/`:

* `aosp_encore-installer.zip`: flashable from CWM/TWRP
* `uImage`, `uRamdisk`: the boot files
* `system.img`: raw ext4 image

`make encore_bootfiles` builds only `uImage`/`uRamdisk`.
`make encore_installer` builds the zip.

## Installing

Requirements: a Nook Color that already runs CyanogenMod with the CM u-boot,
and CWM or TWRP recovery. Hold **n** + **power** at boot, or use the u-boot
menu.

1. In recovery, **make a backup** (nandroid).
2. Copy `aosp_encore-installer.zip` to the SD card.
3. If you are coming from another ROM: *wipe data/factory reset*. Internal
   storage (p8) is not touched.
4. Flash the zip. It detects whether recovery booted from eMMC or from SD and:
   * writes `system.img` to the system partition (eMMC p5 or SD p2)
   * copies `uImage`/`uRamdisk` to the boot partition, keeping the replaced
     files as `uImage.bak`/`uRamdisk.bak`, and the first ones it ever replaced
     as `uImage.orig`/`uRamdisk.orig`
5. Reboot. The first boot takes several minutes while ART compiles the apps.

It never touches the bootloader (`MLO`, `u-boot.bin`), recovery
(`uRecImg`/`uRecRam`), `/rom` (serial number, MAC address) or internal storage.

**Going back**: restore your nandroid backup in recovery. To recover the
previous kernel/ramdisk by hand, rename `uImage.orig`/`uRamdisk.orig` on the
boot partition back to `uImage`/`uRamdisk`.

## Debugging

* `adb logcat` works from early boot on userdebug. USB is `mtp,adb` by default.
* After a crash or hang, reboot into recovery and read `/proc/last_kmsg`
  (kernel RAM console) with `adb shell cat /proc/last_kmsg`.
* Serial console: `ttyO0`, 115200 8N1, if you have the UART wired up.
* What to look for, in order:
  1. `pvrsrvinit`: "PowerVR SGX services initialised"
  2. `surfaceflinger` loading `libEGL_POWERVR_SGX530_125.so`
  3. `zygote` / `system_server` reaching `sys.boot_completed=1`

## Layout

```
device/bn/encore/          this directory
  BoardConfig.mk, device.mk, aosp_encore.mk   board / product configuration
  uboot.mk                 uImage/uRamdisk + installer zip rules
  installer/               update-binary (shell) for the zip
  init.encore*.rc, ueventd.encore.rc, fstab.encore
  fsfinder/                boot-medium detection (ramdisk)
  pvrsrvinit/              SGX init (PIE replacement)
  audio/ liblights/ libsensors/ power/        HALs
  wlan-nvs-tools/          store-mac-addr
  build-kernel.sh          kernel + Wi-Fi module build
  fetch-vendor-blobs.sh    proprietary SGX driver
  tools/                   mkuimage.py, compile-check.sh
device/bn/encore-kernel/   prebuilt zImage + modules
kernel/bn/encore/          kernel source
hardware/ti/wlan/          TI WL1271 driver, firmware, supplicant library
```

## Next steps

1. Boot test, then fix what the logs show.
2. Port the OMAP3 hwcomposer (`hardware/ti/omap3/hwc` from CM) for vsync,
   screen blanking and less GPU load.
3. Bluetooth: port TI's `libbt-vendor` (from `hardware/ti/wpan` in CM).
4. OMAP3 DSP video codecs (`hardware/ti/omap3` OMX + dspbridge).
5. SELinux in the kernel, so that user builds and enforcing mode work.
