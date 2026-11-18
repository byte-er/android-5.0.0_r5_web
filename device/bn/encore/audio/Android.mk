LOCAL_PATH := $(call my-dir)

include $(CLEAR_VARS)
LOCAL_MODULE := audio.primary.encore
LOCAL_MODULE_RELATIVE_PATH := hw
LOCAL_MODULE_TAGS := optional
LOCAL_SRC_FILES := audio_hw.c
LOCAL_C_INCLUDES += \
    external/tinyalsa/include \
    $(call include-path-for, audio-utils)
LOCAL_SHARED_LIBRARIES := liblog libcutils libtinyalsa libaudioutils
LOCAL_CFLAGS := -Wall -Wno-unused-function
include $(BUILD_SHARED_LIBRARY)
