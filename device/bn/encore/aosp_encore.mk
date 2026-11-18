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

# AOSP 5.0 for the Barnes & Noble Nook Color (wifi-only tablet).

$(call inherit-product, $(SRC_TARGET_DIR)/product/full_base.mk)
$(call inherit-product, device/bn/encore/device.mk)

PRODUCT_NAME := aosp_encore
PRODUCT_DEVICE := encore
PRODUCT_BRAND := Android
PRODUCT_MODEL := Nook Color
PRODUCT_MANUFACTURER := Barnes & Noble
