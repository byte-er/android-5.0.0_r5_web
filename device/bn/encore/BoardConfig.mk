#
# Copyright (C) 2007 The Android Open Source Project
# Copyright (C) 2012 The CyanogenMod Project
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Board configuration for the Barnes & Noble Nook Color ("encore") running
# AOSP 5.0 (Lollipop), booted by the CyanogenMod u-boot.
#
# Hardware: TI OMAP3621 (Cortex-A8 @ 800 MHz-1 GHz), PowerVR SGX530,
#           512 MB RAM, 1024x600 LCD, TI WL1271 Wi-Fi/BT, TLV320AIC3100 audio.

TARGET_BOOTLOADER_BOARD_NAME := encore
TARGET_BOARD_PLATFORM := omap3
TARGET_NO_BOOTLOADER := true
TARGET_NO_RADIOIMAGE := true

# Proprietary blobs (vendor/bn/encore, see fetch-vendor-blobs.sh)
-include vendor/bn/encore/BoardConfigVendor.mk

# Architecture
TARGET_ARCH := arm
TARGET_ARCH_VARIANT := armv7-a-neon
TARGET_CPU_VARIANT := cortex-a8
TARGET_CPU_ABI := armeabi-v7a
TARGET_CPU_ABI2 := armeabi
TARGET_CPU_SMP := false

COMMON_GLOBAL_CFLAGS += -DTARGET_OMAP3 -DOMAP_ENHANCEMENT

# ---------------------------------------------------------------------------
# Kernel / boot images
#
# The CyanogenMod u-boot does not understand Android boot.img files.  It
# loads separate u-boot "legacy" images from the FAT boot partition:
#   uImage   + uRamdisk   normal boot
#   uRecImg  + uRecRam    recovery
#   uAltImg  + uAltRam    alternate boot (boot menu)
# device/bn/encore/uboot.mk turns the kernel and ramdisk into those files.
# The kernel command line comes from u-boot (it appends
# androidboot.bootdevice=SD|eMMC), not from here.
# ---------------------------------------------------------------------------
# The kernel itself is a prebuilt (device/bn/encore-kernel/zImage, made by
# device/bn/encore/build-kernel.sh) copied to $OUT/kernel by device.mk.
BOARD_KERNEL_LOADADDR := 0x80008000
BOARD_KERNEL_CMDLINE := console=ttyO0,115200n8 rw init=/init

# Recovery stays whatever the user already has (CWM/TWRP as uRecImg/uRecRam);
# AOSP's recovery is not built or installed.
TARGET_NO_RECOVERY := true

# ---------------------------------------------------------------------------
# Partitions (internal eMMC; SD-card installs use the same sizes or larger)
#   p1 boot (vfat)  p2 rom (vfat)  p5 system  p6 userdata  p7 cache  p8 media
# ---------------------------------------------------------------------------
TARGET_USERIMAGES_USE_EXT4 := true
# The installer writes system.img straight to the partition with dd, so it
# must be a plain (non-sparse) ext4 image.
TARGET_USERIMAGES_SPARSE_EXT_DISABLED := true
BOARD_SYSTEMIMAGE_PARTITION_SIZE := 461942784
BOARD_USERDATAIMAGE_PARTITION_SIZE := 987648000
BOARD_FLASH_BLOCK_SIZE := 4096
TARGET_RECOVERY_FSTAB := device/bn/encore/fstab.encore

# ---------------------------------------------------------------------------
# Graphics: PowerVR SGX530 (DDK 1.9, prebuilt), no hardware composer yet.
# SurfaceFlinger falls back to the gralloc framebuffer device.
# ---------------------------------------------------------------------------
USE_OPENGL_RENDERER := true
NUM_FRAMEBUFFER_SURFACE_BUFFERS := 2
# The 3.0 kernel has no sync framework.
TARGET_RUNNING_WITHOUT_SYNC_FRAMEWORK := true
# SGX530 does not support EGL_KHR_gl_colorspace.
BOARD_EGL_WORKAROUND_BUG_10194508 := true
# EGL_KHR_fence_sync is slow on this driver.
COMMON_GLOBAL_CFLAGS += -DDONT_USE_FENCE_SYNC
# The driver supports EGL_IMG_context_priority.
COMMON_GLOBAL_CFLAGS += -DHAS_CONTEXT_PRIORITY
# Boot animation tuned for 512 MB RAM.
TARGET_BOOTANIMATION_PRELOAD := true
TARGET_BOOTANIMATION_TEXTURE_CACHE := true

# ---------------------------------------------------------------------------
# Wi-Fi: TI WL1271 using the compat-wireless wl12xx driver built by
# device/bn/encore/build-kernel.sh (from hardware/ti/wlan).
# ---------------------------------------------------------------------------
USES_TI_MAC80211 := true
BOARD_WPA_SUPPLICANT_DRIVER := NL80211
WPA_SUPPLICANT_VERSION := VER_0_8_X
BOARD_WPA_SUPPLICANT_PRIVATE_LIB := lib_driver_cmd_wl12xx
BOARD_HOSTAPD_DRIVER := NL80211
BOARD_HOSTAPD_PRIVATE_LIB := lib_driver_cmd_wl12xx
BOARD_WLAN_DEVICE := wl12xx_mac80211
BOARD_SOFTAP_DEVICE := wl12xx_mac80211
WIFI_DRIVER_MODULE_PATH := "/system/lib/modules/wl12xx_sdio.ko"
WIFI_DRIVER_MODULE_NAME := "wl12xx_sdio"
WIFI_FIRMWARE_LOADER := ""
COMMON_GLOBAL_CFLAGS += -DUSES_TI_MAC80211

# ---------------------------------------------------------------------------
# Bluetooth: TI WL1271 over TI-ST.  Disabled until a TI libbt-vendor is
# ported (AOSP 5.0 has none); the kernel side is already in place.
# ---------------------------------------------------------------------------
BOARD_HAVE_BLUETOOTH := false
BOARD_BLUETOOTH_BDROID_BUILDCFG_INCLUDE_DIR := device/bn/encore/bluetooth

# Audio: native tinyalsa HAL (device/bn/encore/audio)
BOARD_USES_GENERIC_AUDIO := false

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
BOARD_VOLD_MAX_PARTITIONS := 8
BOARD_VOLD_EMMC_SHARES_DEV_MAJOR := true
TARGET_USE_CUSTOM_LUN_FILE_PATH := "/sys/class/android_usb/android0/f_mass_storage/lun%d/file"

# ---------------------------------------------------------------------------
# Runtime / memory (512 MB RAM)
# ---------------------------------------------------------------------------
# Compile the ART boot image at build time; compiling it on the device needs
# more RAM than is available while the system is starting.  Apps are compiled
# on the device at install / first boot (system partition is only 440 MiB).
WITH_DEXPREOPT := true
WITH_DEXPREOPT_BOOT_IMG_ONLY := true
DONT_DEXPREOPT_PREBUILTS := true

# SELinux: the 3.0 kernel is built without it, so init skips loading the
# policy.  That is only allowed on userdebug/eng builds (ALLOW_DISABLE_SELINUX);
# build aosp_encore-userdebug.
