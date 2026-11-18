#!/usr/bin/env python
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

"""Wrap a file in a U-Boot legacy image header (what "mkimage" produces).

Only what the Nook Color needs is supported: ARM, Linux, uncompressed
payloads of type kernel or ramdisk.  Works with Python 2.6+ and 3.x, so it
runs from the AOSP 5.0 build without needing u-boot-tools on the host.

usage: mkuimage.py -T kernel|ramdisk [-a LOAD] [-e ENTRY] [-n NAME] IN OUT
       mkuimage.py -l IMAGE        (print the header of an existing image)
"""

import binascii
import getopt
import struct
import sys
import time

IH_MAGIC = 0x27051956
IH_OS_LINUX = 5
IH_ARCH_ARM = 2
IH_TYPE = {"kernel": 2, "ramdisk": 3, "multi": 4}
IH_COMP_NONE = 0
HEADER_FMT = ">IIIIIIIBBBB32s"   # 64 bytes, big endian
HEADER_SIZE = struct.calcsize(HEADER_FMT)


def crc32(data):
    # binascii is always built in (some prebuilt Pythons lack zlib); same CRC-32.
    return binascii.crc32(data) & 0xffffffff


def make_image(payload, img_type, load, entry, name, timestamp=None):
    if timestamp is None:
        timestamp = int(time.time())
    name = name.encode("ascii", "replace")[:31]
    fields = [IH_MAGIC, 0, timestamp, len(payload), load, entry, crc32(payload),
              IH_OS_LINUX, IH_ARCH_ARM, IH_TYPE[img_type], IH_COMP_NONE, name]
    header = struct.pack(HEADER_FMT, *fields)
    fields[1] = crc32(header)               # header CRC, computed with hcrc=0
    return struct.pack(HEADER_FMT, *fields) + payload


def parse_image(data):
    if len(data) < HEADER_SIZE:
        raise ValueError("file too short")
    f = list(struct.unpack(HEADER_FMT, data[:HEADER_SIZE]))
    if f[0] != IH_MAGIC:
        raise ValueError("bad magic 0x%08x" % f[0])
    hcrc = f[1]
    f[1] = 0
    if crc32(struct.pack(HEADER_FMT, *f)) != hcrc:
        raise ValueError("bad header CRC")
    payload = data[HEADER_SIZE:HEADER_SIZE + f[3]]
    if len(payload) != f[3] or crc32(payload) != f[6]:
        raise ValueError("bad data size/CRC")
    types = dict((v, k) for k, v in IH_TYPE.items())
    return {
        "name": f[11].rstrip(b"\0").decode("ascii", "replace"),
        "time": f[2], "size": f[3], "load": f[4], "entry": f[5],
        "os": f[7], "arch": f[8], "type": types.get(f[9], f[9]), "comp": f[10],
    }


def main(argv):
    try:
        opts, args = getopt.getopt(argv, "T:a:e:n:l")
    except getopt.GetoptError as e:
        sys.exit("mkuimage: %s\n%s" % (e, __doc__))
    o = dict(opts)
    if "-l" in o:
        info = parse_image(open(args[0], "rb").read())
        for k in ("name", "type", "size", "load", "entry", "time"):
            v = info[k]
            print("%-6s %s" % (k, ("0x%08x" % v) if k in ("load", "entry") else v))
        return
    if len(args) != 2 or o.get("-T") not in IH_TYPE:
        sys.exit(__doc__)
    payload = open(args[0], "rb").read()
    img = make_image(payload, o["-T"], int(o.get("-a", "0"), 0),
                     int(o.get("-e", "0"), 0), o.get("-n", ""))
    open(args[1], "wb").write(img)


if __name__ == "__main__":
    main(sys.argv[1:])
