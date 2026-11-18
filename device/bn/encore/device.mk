#
# Copyright (C) 2009 The Android Open Source Project
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
#

# Hardware-specific product configuration for the Nook Color (encore).

LOCAL_PATH := device/bn/encore

DEVICE_PACKAGE_OVERLAYS += $(LOCAL_PATH)/overlay

# 1024x600 @ 160 dpi -> 600 dp smallest width: tablet UI, mdpi resources
PRODUCT_CHARACTERISTICS := tablet
PRODUCT_AAPT_CONFIG := normal large mdpi
PRODUCT_AAPT_PREF_CONFIG := mdpi
PRODUCT_LOCALES += mdpi

# Kernel (built by device/bn/encore/build-kernel.sh) and Wi-Fi modules
PRODUCT_COPY_FILES += \
    device/bn/encore-kernel/zImage:kernel

PRODUCT_COPY_FILES += \
    $(foreach m,$(wildcard device/bn/encore-kernel/modules/*.ko),$(m):system/lib/modules/$(notdir $(m)))

# Init, ueventd, fstab
PRODUCT_COPY_FILES += \
    $(LOCAL_PATH)/init.encore.rc:root/init.encore.rc \
    $(LOCAL_PATH)/init.encore.usb.rc:root/init.encore.usb.rc \
    $(LOCAL_PATH)/ueventd.encore.rc:root/ueventd.encore.rc \
    $(LOCAL_PATH)/fstab.encore:root/fstab.encore

PRODUCT_PACKAGES += \
    fsfinder

# Input: touchscreens (two panel variants) and buttons
PRODUCT_COPY_FILES += \
    $(LOCAL_PATH)/prebuilt/usr/idc/cyttsp-i2c.idc:system/usr/idc/cyttsp-i2c.idc \
    $(LOCAL_PATH)/prebuilt/usr/idc/ft5x06-i2c.idc:system/usr/idc/ft5x06-i2c.idc \
    $(LOCAL_PATH)/prebuilt/usr/keylayout/gpio-keys.kl:system/usr/keylayout/gpio-keys.kl

# Graphics: PowerVR SGX530
# (Android 5.0 finds the driver as /vendor/lib/egl/lib{EGL,GLESv1_CM,GLESv2}_*.so;
# egl.cfg is no longer used.)
PRODUCT_COPY_FILES += \
    $(LOCAL_PATH)/etc/powervr.ini:system/etc/powervr.ini

PRODUCT_PACKAGES += \
    pvrsrvinit

# Hardware features
PRODUCT_COPY_FILES += \
    $(LOCAL_PATH)/etc/permissions/core_hardware.xml:system/etc/permissions/core_hardware.xml \
    frameworks/native/data/etc/tablet_core_hardware.xml:system/etc/permissions/tablet_core_hardware.xml \
    frameworks/native/data/etc/android.hardware.sensor.accelerometer.xml:system/etc/permissions/android.hardware.sensor.accelerometer.xml \
    frameworks/native/data/etc/android.hardware.touchscreen.multitouch.distinct.xml:system/etc/permissions/android.hardware.touchscreen.multitouch.distinct.xml \
    frameworks/native/data/etc/android.hardware.wifi.xml:system/etc/permissions/android.hardware.wifi.xml \
    frameworks/native/data/etc/android.hardware.usb.accessory.xml:system/etc/permissions/android.hardware.usb.accessory.xml \
    frameworks/native/data/etc/android.hardware.usb.host.xml:system/etc/permissions/android.hardware.usb.host.xml \
    frameworks/native/data/etc/android.software.sip.voip.xml:system/etc/permissions/android.software.sip.voip.xml

# Media
PRODUCT_COPY_FILES += \
    $(LOCAL_PATH)/etc/media_profiles.xml:system/etc/media_profiles.xml \
    $(LOCAL_PATH)/etc/media_codecs.xml:system/etc/media_codecs.xml \
    frameworks/av/media/libstagefright/data/media_codecs_google_audio.xml:system/etc/media_codecs_google_audio.xml \
    frameworks/av/media/libstagefright/data/media_codecs_google_video.xml:system/etc/media_codecs_google_video.xml

# Audio
PRODUCT_COPY_FILES += \
    $(LOCAL_PATH)/etc/audio_policy.conf:system/etc/audio_policy.conf

PRODUCT_PACKAGES += \
    audio.primary.encore \
    audio.usb.default \
    audio.r_submix.default \
    tinyplay \
    tinycap \
    tinymix

# Wi-Fi: TI WL1271 (firmware from hardware/ti/wlan, MAC address patched
# into the nvs file at boot by store-mac-addr)
PRODUCT_PACKAGES += \
    wl127x-fw-4-sr.bin \
    wl127x-fw-4-mr.bin \
    wl127x-fw-4-plt.bin \
    wl1271-nvs_127x.bin \
    store-mac-addr \
    wpa_supplicant \
    wpa_supplicant.conf \
    dhcpcd.conf \
    libwpa_client \
    hostapd

PRODUCT_COPY_FILES += \
    hardware/ti/wlan/mac80211/firmware/127x/LICENCE:system/etc/firmware/ti-connectivity/LICENCE \
    $(LOCAL_PATH)/etc/wpa_supplicant_overlay.conf:system/etc/wifi/wpa_supplicant_overlay.conf

PRODUCT_PROPERTY_OVERRIDES += \
    wifi.interface=wlan0 \
    wifi.supplicant_scan_interval=30

# Other HALs
PRODUCT_PACKAGES += \
    lights.encore \
    sensors.encore \
    power.encore

# Boot-counter reset (see init.encore.rc) and battery history logging
PRODUCT_COPY_FILES += \
    $(LOCAL_PATH)/prebuilt/bin/clear_bootcnt.sh:system/bin/clear_bootcnt.sh \
    $(LOCAL_PATH)/prebuilt/bin/log_battery_data.sh:system/bin/log_battery_data.sh

# Filesystem tools
PRODUCT_PACKAGES += \
    make_ext4fs \
    e2fsck \
    setup_fs

# ---------------------------------------------------------------------------
# 512 MB RAM tuning
# ---------------------------------------------------------------------------
$(call inherit-product, frameworks/native/build/phone-hdpi-512-dalvik-heap.mk)

PRODUCT_PROPERTY_OVERRIDES += \
    ro.config.low_ram=true \
    ro.config.max_starting_bg=6 \
    dalvik.vm.dex2oat-Xms=32m \
    dalvik.vm.dex2oat-Xmx=256m \
    dalvik.vm.dex2oat-filter=balanced \
    dalvik.vm.image-dex2oat-filter=everything \
    ro.hwui.texture_cache_size=12 \
    ro.hwui.layer_cache_size=8 \
    ro.hwui.r_buffer_cache_size=1 \
    ro.hwui.path_cache_size=2 \
    ro.hwui.gradient_cache_size=0.5 \
    ro.hwui.drop_shadow_cache_size=1 \
    ro.hwui.text_small_cache_width=1024 \
    ro.hwui.text_small_cache_height=512 \
    ro.hwui.text_large_cache_width=1024 \
    ro.hwui.text_large_cache_height=512

# Display / GPU
PRODUCT_PROPERTY_OVERRIDES += \
    ro.sf.lcd_density=160 \
    ro.opengles.version=131072 \
    ro.hwui.disable_scissor_opt=true \
    ro.bq.gpu_to_cpu_unsupported=1

# USB: MTP by default (userdebug/eng builds append ",adb" automatically)
PRODUCT_DEFAULT_PROPERTY_OVERRIDES += \
    persist.sys.usb.config=mtp

# Proprietary blobs (vendor/bn/encore, see fetch-vendor-blobs.sh)
$(call inherit-product-if-exists, vendor/bn/encore/encore-vendor.mk)
