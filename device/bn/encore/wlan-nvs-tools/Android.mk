LOCAL_PATH := $(call my-dir)

# store-mac-addr: writes /data/misc/wifi/wl1271-nvs.bin with this device's
# MAC address (see store_mac_addr.c); run from init.encore.rc.
include $(CLEAR_VARS)
LOCAL_MODULE := store-mac-addr
LOCAL_MODULE_TAGS := optional
LOCAL_SRC_FILES := store_mac_addr.c
LOCAL_SHARED_LIBRARIES := liblog
include $(BUILD_EXECUTABLE)

# The wl12xx driver loads ti-connectivity/wl1271-nvs.bin from the firmware
# directory; point it at the per-device copy in /data.
NVS_SYMLINK := $(TARGET_OUT_ETC)/firmware/ti-connectivity/wl1271-nvs.bin
$(NVS_SYMLINK): $(LOCAL_INSTALLED_MODULE)
	@mkdir -p $(dir $@)
	@rm -rf $@
	$(hide) ln -sf /data/misc/wifi/wl1271-nvs.bin $@

ALL_DEFAULT_INSTALLED_MODULES += $(NVS_SYMLINK)
ALL_MODULES.$(LOCAL_MODULE).INSTALLED := \
	$(ALL_MODULES.$(LOCAL_MODULE).INSTALLED) $(NVS_SYMLINK)
