#!/bin/bash
#
# compile-check.sh - compile (not link) the device's native sources with the
# AOSP arm toolchain and the tree's bionic/HAL headers.  This is a quick
# sanity check that does not need a configured AOSP build ("lunch").
#
# usage: device/bn/encore/tools/compile-check.sh [files...]   (from the top of the tree)

set -e
TOP=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$TOP"
TC=prebuilts/gcc/linux-x86/arm/arm-linux-androideabi-4.8/bin/arm-linux-androideabi-
OUT=${OUT_CHECK:-/tmp/encore-compile-check}
mkdir -p "$OUT"

INC="
 -isystem bionic/libc/arch-arm/include -isystem bionic/libc/include
 -isystem bionic/libc/kernel/uapi -isystem bionic/libc/kernel/uapi/asm-arm
 -isystem bionic/libm/include -isystem bionic/libm/include/arm
 -isystem bionic/libstdc++/include -isystem $(${TC}gcc -print-file-name=include)
 -I system/core/include -I hardware/libhardware/include
 -I hardware/libhardware_legacy/include -I frameworks/native/include
 -I system/media/audio_utils/include -I system/media/audio_effects/include
 -I external/tinyalsa/include -I external/libnl/include
 -I device/bn/encore/include
 -include build/core/combo/include/arch/linux-arm/AndroidConfig.h
"
FLAGS="-march=armv7-a -mfloat-abi=softfp -mfpu=neon -mthumb -Os -fpic -fPIE
 -fno-exceptions -ffunction-sections -fdata-sections -funwind-tables
 -fstack-protector -Wa,--noexecstack -Werror=format-security
 -D_FORTIFY_SOURCE=2 -fno-short-enums -DANDROID -D__ARM_ARCH_7__
 -D__ARM_ARCH_7A__ -nostdinc -Wall -Wno-unused-parameter"

FILES="$@"
[ -z "$FILES" ] && FILES=$(find device/bn/encore -name '*.c' -o -name '*.cpp' | grep -v /tools/)
rc=0
for f in $FILES; do
  case "$f" in
    *.cpp) CC="${TC}g++ -fno-rtti -std=gnu++11";;
    *)     CC="${TC}gcc -std=gnu99";;
  esac
  # pick up per-directory extra flags from the module's Android.mk
  extra=""
  grep -q -- "-Werror" "$(dirname $f)/Android.mk" 2>/dev/null && extra="-Werror"
  if $CC $FLAGS $INC $extra -c "$f" -o "$OUT/$(basename $f).o" 2>"$OUT/$(basename $f).log"; then
    printf "OK    %s\n" "$f"
  else
    printf "FAIL  %s\n" "$f"; sed 's/^/      /' "$OUT/$(basename $f).log" | head -30; rc=1
  fi
done
exit $rc
