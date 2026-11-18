#
# Copyright (C) 2014 The Android Open Source Project
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
#

# Boot files for the CyanogenMod u-boot, and a flashable installer.
#
# The CM u-boot (the one with the "Hold ^ for menu" boot menu) loads two
# U-Boot legacy images from the FAT boot partition (eMMC p1, or SD p1 when
# booting from SD):
#     uImage    kernel  (loaded at 0x81c00000, runs at 0x80008000)
#     uRamdisk  ramdisk (loaded at 0x82000000)
# and appends "androidboot.bootdevice=eMMC|SD" to the kernel command line.
#
# Targets:
#   make encore_bootfiles   ->  $OUT/uImage, $OUT/uRamdisk
#   make encore_installer   ->  $OUT/aosp_encore-installer.zip  (CWM/TWRP)
# Both are also built by a plain "make".

ENCORE_MKUIMAGE := device/bn/encore/tools/mkuimage.py
ENCORE_UIMAGE := $(PRODUCT_OUT)/uImage
ENCORE_URAMDISK := $(PRODUCT_OUT)/uRamdisk

# These are the build system's own outputs; their paths are fixed, so they
# can be named here even though build/core/Makefile is read later.
ENCORE_KERNEL := $(PRODUCT_OUT)/kernel
ENCORE_RAMDISK := $(PRODUCT_OUT)/ramdisk.img
ENCORE_SYSTEMIMAGE := $(PRODUCT_OUT)/system.img

$(ENCORE_UIMAGE): $(ENCORE_KERNEL) $(ENCORE_MKUIMAGE)
	@echo "Making u-boot kernel image: $@"
	$(hide) python $(ENCORE_MKUIMAGE) -T kernel \
		-a $(BOARD_KERNEL_LOADADDR) -e $(BOARD_KERNEL_LOADADDR) \
		-n "AOSP $(PLATFORM_VERSION) encore kernel" $< $@

$(ENCORE_URAMDISK): $(ENCORE_RAMDISK) $(ENCORE_MKUIMAGE)
	@echo "Making u-boot ramdisk image: $@"
	$(hide) python $(ENCORE_MKUIMAGE) -T ramdisk -a 0 -e 0 \
		-n "AOSP $(PLATFORM_VERSION) encore ramdisk" $< $@

.PHONY: encore_bootfiles
encore_bootfiles: $(ENCORE_UIMAGE) $(ENCORE_URAMDISK)

# ---------------------------------------------------------------------------
# Flashable zip.  update-binary is a shell script (works with the CWM and
# TWRP builds people use on the Nook Color); it writes system.img raw to the
# system partition of the boot medium and copies uImage/uRamdisk to the boot
# partition, keeping a backup of the previous files.
# ---------------------------------------------------------------------------
ENCORE_INSTALLER := $(PRODUCT_OUT)/$(TARGET_PRODUCT)-installer.zip
ENCORE_INSTALLER_SRC := device/bn/encore/installer
ENCORE_INSTALLER_STAGE := $(call intermediates-dir-for,PACKAGING,encore_installer)

$(ENCORE_INSTALLER): $(ENCORE_UIMAGE) $(ENCORE_URAMDISK) $(ENCORE_SYSTEMIMAGE) \
		$(ENCORE_INSTALLER_SRC)/update-binary $(ENCORE_INSTALLER_SRC)/updater-script
	@echo "Making installer: $@"
	$(hide) rm -rf $(ENCORE_INSTALLER_STAGE) $@
	$(hide) mkdir -p $(ENCORE_INSTALLER_STAGE)/META-INF/com/google/android
	$(hide) cp $(ENCORE_INSTALLER_SRC)/update-binary $(ENCORE_INSTALLER_SRC)/updater-script \
		$(ENCORE_INSTALLER_STAGE)/META-INF/com/google/android/
	$(hide) cp $(ENCORE_UIMAGE) $(ENCORE_URAMDISK) $(ENCORE_SYSTEMIMAGE) $(ENCORE_INSTALLER_STAGE)/
	$(hide) echo "$(BUILD_FINGERPRINT)" > $(ENCORE_INSTALLER_STAGE)/build.txt
	$(hide) (cd $(ENCORE_INSTALLER_STAGE) && zip -qr9 $(abspath $@) META-INF build.txt uImage uRamdisk system.img)
	@echo "Installer ready: $@"

.PHONY: encore_installer
encore_installer: $(ENCORE_INSTALLER)

droidcore: encore_bootfiles encore_installer
