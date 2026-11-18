#!/bin/bash
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
# build-kernel.sh - build the Nook Color kernel and Wi-Fi modules and install
# them as prebuilts in device/bn/encore-kernel (zImage, modules/*.ko), which
# is what the AOSP build packs into uImage and system/lib/modules.
#
# usage (from the top of the tree):  device/bn/encore/build-kernel.sh [-j N]
#
# Sources:  kernel/bn/encore                      (CM encore-omap3-3.0.y)
#           hardware/ti/wlan/mac80211/compat_wl12xx (TI WL1271 driver)
# Toolchain: prebuilts/gcc/linux-x86/arm/arm-eabi-4.8

set -e

TOP=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$TOP"

JOBS=$(nproc 2>/dev/null || echo 4)
[ "$1" = "-j" ] && JOBS=$2

DEFCONFIG=${DEFCONFIG:-encore_lollipop_defconfig}
KERNEL_SRC=$TOP/kernel/bn/encore
COMPAT_SRC=$TOP/hardware/ti/wlan/mac80211/compat_wl12xx
KOUT=${KERNEL_OUT:-$TOP/out/target/product/encore/obj/KERNEL_OBJ}
DEST=$TOP/device/bn/encore-kernel
export ARCH=arm
export CROSS_COMPILE=arm-eabi-
export PATH=$TOP/prebuilts/gcc/linux-x86/arm/arm-eabi-4.8/bin:$PATH

echo "==> kernel ($DEFCONFIG) -> $KOUT"
mkdir -p "$KOUT"
make -C "$KERNEL_SRC" O="$KOUT" $DEFCONFIG
make -C "$KERNEL_SRC" O="$KOUT" -j"$JOBS" zImage modules

echo "==> compat_wl12xx Wi-Fi modules"
# compat-wireless builds in its source tree; work on a copy so the tree
# stays clean.
CWORK=$KOUT/compat_wl12xx
rm -rf "$CWORK"
cp -a "$COMPAT_SRC" "$CWORK"
make -C "$CWORK" -j"$JOBS" KLIB="$KOUT" KLIB_BUILD="$KOUT" \
    KERNEL_DIR="$KOUT" ARCH=arm CROSS_COMPILE=arm-eabi-

echo "==> installing to $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/modules"
cp "$KOUT/arch/arm/boot/zImage" "$DEST/zImage"
for m in compat/compat.ko net/wireless/cfg80211.ko net/mac80211/mac80211.ko \
         drivers/net/wireless/wl12xx/wl12xx.ko \
         drivers/net/wireless/wl12xx/wl12xx_sdio.ko; do
    if [ -f "$CWORK/$m" ]; then
        arm-eabi-strip --strip-debug -o "$DEST/modules/$(basename $m)" "$CWORK/$m"
    fi
done
# any other modules the kernel config builds (none by default)
find "$KOUT" -path "$CWORK" -prune -o -name '*.ko' -print | while read m; do
    case "$(basename $m)" in
        cfg80211.ko|mac80211.ko|wl12xx.ko|wl12xx_sdio.ko) ;;  # compat versions win
        *) arm-eabi-strip --strip-debug -o "$DEST/modules/$(basename $m)" "$m" ;;
    esac
done

cat > "$DEST/README" <<EOF
Prebuilt kernel for the Nook Color (encore), built by device/bn/encore/build-kernel.sh

source:    kernel/bn/encore ($(sed -n 's/^VERSION = //p;s/^PATCHLEVEL = //p;s/^SUBLEVEL = //p' "$KERNEL_SRC/Makefile" | paste -sd.)) $DEFCONFIG
wifi:      hardware/ti/wlan/mac80211/compat_wl12xx
toolchain: $(arm-eabi-gcc --version | head -1)
version:   $(strings "$KOUT/vmlinux" | grep -m1 '^Linux version')
EOF
ls -l "$DEST" "$DEST/modules"
echo "==> done"
