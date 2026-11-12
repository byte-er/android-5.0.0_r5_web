#!/bin/sh
# Compiles native AOSP libraries to standalone WebAssembly modules using plain
# clang + wasm-ld (no Emscripten/WASI) and the tiny libc in ./libc:
#   svoxpico.wasm  <- external/svox/pico/lib          (SVOX Pico TTS)
#   sonivox.wasm   <- external/sonivox/arm-wt-22k     (Sonivox EAS MIDI synth)
# The AOSP sources are compiled unmodified.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT=${1:-"$HERE/../build/native"}
CC=${CC:-clang}
# Pico and EAS rely on signed overflow wrapping and on null checks that
# clang would otherwise optimise away, hence -fwrapv etc.
BASE="--target=wasm32 ${OPT:--O2 -fwrapv -fno-strict-aliasing -fno-delete-null-pointer-checks} -nostdlib -ffreestanding -funsigned-char \
  -fno-builtin-printf -isystem $HERE/libc/include -Wno-everything"
LDFLAGS="--no-entry --export-dynamic --allow-undefined-file=$HERE/imports.txt -z stack-size=1048576 \
  --initial-memory=8388608 --max-memory=268435456 -O2 --strip-debug --gc-sections"

mkdir -p "$OUT/obj/pico" "$OUT/obj/eas"
$CC $BASE -c "$HERE/libc/libc.c" -o "$OUT/obj/libc.o"

# --- SVOX Pico
PICO="$ROOT/external/svox/pico/lib"
OBJS=""
for s in $(sed -n 's/^\t\(pico[a-z0-9]*\.c\).*/\1/p' "$PICO/Android.mk"); do
  $CC $BASE -D__linux__ -I"$PICO" -c "$PICO/$s" -o "$OUT/obj/pico/${s%.c}.o"
  OBJS="$OBJS $OUT/obj/pico/${s%.c}.o"
done
$CC $BASE -D__linux__ -I"$PICO" -c "$HERE/pico_web.c" -o "$OUT/obj/pico_web.o"
wasm-ld $LDFLAGS -o "$OUT/svoxpico.wasm" $OBJS "$OUT/obj/libc.o" "$OUT/obj/pico_web.o"
echo "built $OUT/svoxpico.wasm ($(wc -c < "$OUT/svoxpico.wasm") bytes)"

# --- Sonivox EAS (same configuration as external/sonivox/arm-wt-22k/Android.mk,
#     minus the ARM assembly kernels, so the portable C kernels are used)
EAS="$ROOT/external/sonivox/arm-wt-22k"
EASFLAGS="-DEAS_WT_SYNTH -D_IMELODY_PARSER -D_RTTTL_PARSER -D_OTA_PARSER -D_XMF_PARSER -DNUM_OUTPUT_CHANNELS=2 \
  -D_SAMPLE_RATE_22050 -DMAX_SYNTH_VOICES=64 -D_8_BIT_SAMPLES -D_FILTER_ENABLED -DDLS_SYNTHESIZER -D_REVERB_ENABLED \
  -I$EAS/host_src -I$EAS/lib_src"
OBJS=""
for s in $(sed -n 's/^\tlib_src\/\([a-z0-9_]*\.c\).*/\1/p' "$EAS/Android.mk") eas_config.c; do
  src="$EAS/lib_src/$s"; [ -f "$src" ] || src="$EAS/host_src/$s"
  $CC $BASE $EASFLAGS -c "$src" -o "$OUT/obj/eas/${s%.c}.o"
  OBJS="$OBJS $OUT/obj/eas/${s%.c}.o"
done
$CC $BASE $EASFLAGS -c "$HERE/eas_hostweb.c" -o "$OUT/obj/eas_hostweb.o"
$CC $BASE $EASFLAGS -c "$HERE/eas_web.c" -o "$OUT/obj/eas_web.o"
wasm-ld $LDFLAGS -o "$OUT/sonivox.wasm" $OBJS "$OUT/obj/libc.o" "$OUT/obj/eas_hostweb.o" "$OUT/obj/eas_web.o"
echo "built $OUT/sonivox.wasm ($(wc -c < "$OUT/sonivox.wasm") bytes)"
