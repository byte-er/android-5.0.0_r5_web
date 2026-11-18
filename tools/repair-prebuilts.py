#!/usr/bin/env python3
"""Repair damage introduced when this AOSP tree was uploaded through the web.

Two kinds of damage are fixed:

1. Files that were symlinks/hardlinks upstream (toolchain driver aliases,
   shared-library version links, ...) arrived as *empty* regular files.
   They are recreated as relative symlinks pointing at the real file,
   using rules derived from the standard GNU toolchain / glibc layout.

2. Executables (ELF binaries and '#!' scripts) lost their exec bit.

Run from the top of the tree:   python3 tools/repair-prebuilts.py [--dry-run]
The script is idempotent.
"""
import os
import re
import stat
import sys

DRY = "--dry-run" in sys.argv
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# Default linker per toolchain (read from each gcc's configure line: the
# Android cross toolchains for arm/x86 were built with --enable-gold=default).
def default_ld(bindir, triple):
    gcc = os.path.join(bindir, triple + "-gcc")
    try:
        data = open(gcc, "rb").read()
        if b"--enable-gold=default" in data:
            return "ld.gold"
    except OSError:
        pass
    return "ld.bfd"

fixed = []
unresolved = []


def nonempty(p):
    return os.path.isfile(p) and not os.path.islink(p) and os.path.getsize(p) > 0 \
        or (os.path.islink(p) and os.path.exists(p))


def link(path, target):
    """Replace empty file `path` by a relative symlink to `target`."""
    rel = os.path.relpath(target, os.path.dirname(path))
    fixed.append((path, rel))
    if DRY:
        return
    os.remove(path)
    os.symlink(rel, path)


def resolve_toolchain(path):
    d, name = os.path.split(path)
    # <tc>/bin/<triple>-<tool>
    m = re.match(r"(.+)-(c\+\+|gcc-[\d.]+|ld)$", name)
    if os.path.basename(d) == "bin" and m:
        triple, tool = m.groups()
        if tool == "c++":
            tgt = triple + "-g++"
        elif tool.startswith("gcc-"):
            tgt = triple + "-gcc"
        else:
            tgt = triple + "-" + default_ld(d, triple)
        cand = os.path.join(d, tgt)
        if nonempty(cand):
            return cand
    # <tc>/<triple>/bin/<tool>  ->  <tc>/bin/<triple>-<tool>
    parent = os.path.dirname(d)
    triple = os.path.basename(parent)
    if os.path.basename(d) == "bin":
        tcbin = os.path.join(os.path.dirname(parent), "bin")
        tool = {"c++": "g++", "cc": "gcc"}.get(name, name)
        if tool == "ld":
            tool = default_ld(tcbin, triple)
        cand = os.path.join(tcbin, triple + "-" + tool)
        if os.path.exists(cand):
            return cand
    # liblto_plugin.so / .so.0 -> liblto_plugin.so.0.0.0
    if name.startswith("liblto_plugin.so"):
        cand = os.path.join(d, "liblto_plugin.so.0.0.0")
        if nonempty(cand):
            return cand
    return None


LIB_ALIASES = {
    "libcurses.so": "libncurses.so",
    "libcurses.a": "libncurses.a",
    "libtermcap.so": "libncurses.so",
    "libtermcap.a": "libncurses.a",
    "ncurses.h": "curses.h",
}


def resolve_library(path):
    d, name = os.path.split(path)
    if name in LIB_ALIASES:
        cand = os.path.join(d, LIB_ALIASES[name])
        if os.path.exists(cand) or os.path.isfile(cand):
            return cand
    m = re.match(r"^(ld-linux[\w-]*|lib[\w+-]+?)\.so((?:\.\d+)*)$", name)
    if not m:
        return None
    base, ver = m.groups()
    entries = sorted(os.listdir(d))
    # Longer version strings first: libX.so -> libX.so.6 -> libX.so.6.3.0
    longer = [e for e in entries if e.startswith(name + ".")]
    longer.sort(key=lambda e: (len(e), e))
    for e in longer:
        if e != name:
            return os.path.join(d, e)
    # glibc layout: libc.so.6 -> libc-2.11.1.so, ld-linux*.so.2 -> ld-2.11.1.so
    gbase = "ld" if base.startswith("ld-linux") else base
    for e in entries:
        if re.match(re.escape(gbase) + r"-[\d.]+\.so$", e):
            return os.path.join(d, e)
    # mesa/libGL.so.1 etc: look one directory up / down
    for alt in (os.path.dirname(d), os.path.join(d, "mesa")):
        if os.path.isdir(alt):
            for e in sorted(os.listdir(alt)):
                if e.startswith(base + ".so.") and nonempty(os.path.join(alt, e)):
                    return os.path.join(alt, e)
    return None


def main():
    for top in ("prebuilts",):
        for dp, dns, fns in os.walk(top):
            if "/darwin" in dp or "/.git" in dp:
                continue
            for fn in fns:
                p = os.path.join(dp, fn)
                if os.path.islink(p) or not os.path.isfile(p) or os.path.getsize(p):
                    continue
                if fn in ("__init__.py", "macro_list") or fn.endswith(".py"):
                    continue  # legitimately empty upstream
                tgt = resolve_toolchain(p) or resolve_library(p)
                if tgt:
                    link(p, tgt)
                elif re.search(r"(\.so(\.\d+)*|\.a|/bin/[^/]+)$", p):
                    unresolved.append(p)

    # Restore exec bits on ELF binaries and scripts.
    nexec = 0
    for dp, dns, fns in os.walk("."):
        if "/.git" in dp or dp.startswith("./out"):
            dns[:] = []
            continue
        for fn in fns:
            p = os.path.join(dp, fn)
            if os.path.islink(p) or not os.path.isfile(p):
                continue
            mode = os.stat(p).st_mode
            if mode & stat.S_IXUSR:
                continue
            try:
                with open(p, "rb") as f:
                    head = f.read(4)
            except OSError:
                continue
            if head == b"\x7fELF" or head[:2] == b"#!":
                nexec += 1
                if not DRY:
                    os.chmod(p, mode | 0o111)

    for p, t in fixed:
        print("link  %s -> %s" % (p, t))
    for p in unresolved:
        print("UNRESOLVED %s" % p)
    print("%d links restored, %d unresolved, %d files made executable%s"
          % (len(fixed), len(unresolved), nexec, " (dry run)" if DRY else ""))


main()
