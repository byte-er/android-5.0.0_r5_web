#!/bin/sh
# Compiles the AOSP SVOX Pico TTS library (external/svox/pico/lib, unmodified)
# to a standalone WebAssembly module using plain clang + wasm-ld.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PICO="$ROOT/external/svox/pico/lib"
OUT=${1:-"$HERE/../build/native"}
mkdir -p "$OUT/obj"
CC=${CC:-clang}
CFLAGS="--target=wasm32 ${OPT:--O2 -fwrapv -fno-strict-aliasing -fno-delete-null-pointer-checks} -nostdlib -ffreestanding -funsigned-char -fno-builtin-printf -D__linux__ \
  -isystem $HERE/libc/include -I$PICO -Wno-everything"
SRCS=$(sed -n 's/^\t\(pico[a-z0-9]*\.c\).*/\1/p' "$PICO/Android.mk")
OBJS=""
for s in $SRCS; do
  $CC $CFLAGS -c "$PICO/$s" -o "$OUT/obj/${s%.c}.o"
  OBJS="$OBJS $OUT/obj/${s%.c}.o"
done
$CC $CFLAGS -c "$HERE/libc/libc.c" -o "$OUT/obj/libc.o"
$CC $CFLAGS -c "$HERE/pico_web.c" -o "$OUT/obj/pico_web.o"
wasm-ld --no-entry --export-dynamic --allow-undefined-file="$HERE/imports.txt" \
  -z stack-size=1048576 --initial-memory=8388608 --max-memory=268435456 -O2 --strip-debug --gc-sections \
  -o "$OUT/svoxpico.wasm" $OBJS "$OUT/obj/libc.o" "$OUT/obj/pico_web.o"
echo "built $OUT/svoxpico.wasm ($(wc -c < "$OUT/svoxpico.wasm") bytes)"
