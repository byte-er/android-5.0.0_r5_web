LOCAL_PATH := $(call my-dir)

include $(CLEAR_VARS)
LOCAL_MODULE := pvrsrvinit
LOCAL_MODULE_TAGS := optional
LOCAL_SRC_FILES := pvrsrvinit.c
LOCAL_SHARED_LIBRARIES := libdl liblog
include $(BUILD_EXECUTABLE)
