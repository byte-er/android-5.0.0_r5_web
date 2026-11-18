/*
 * Copyright (C) 2014 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * store-mac-addr - put the Nook Color's factory Wi-Fi MAC address into the
 * WL1271 nvs (calibration) file.
 *
 * The MAC address is stored by B&N as 12 hex digits in
 * /rom/devconf/MACAddress.  The wl12xx driver loads
 * /system/etc/firmware/ti-connectivity/wl1271-nvs.bin, which is a symlink
 * to /data/misc/wifi/wl1271-nvs.bin, written here from the generic nvs file
 * shipped in the ROM with the MAC address patched in: the four least
 * significant bytes, little endian, at offset 3 and the two most
 * significant bytes, little endian, at offset 10.
 *
 * C port of CM's store-mac-addr.sh, which needed busybox sed/printf.
 */

#define LOG_TAG "store-mac-addr"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cutils/log.h>

#define ROM_NVS     "/system/etc/firmware/ti-connectivity/wl1271-nvs_127x.bin"
#define NEW_NVS     "/data/misc/wifi/wl1271-nvs.bin"
#define MAC_FILE    "/rom/devconf/MACAddress"
#define MAX_NVS     (64 * 1024)

static ssize_t read_file(const char *path, unsigned char *buf, size_t max)
{
    int fd = open(path, O_RDONLY);
    ssize_t n, total = 0;

    if (fd < 0)
        return -1;
    while ((size_t)total < max &&
           (n = read(fd, buf + total, max - total)) > 0)
        total += n;
    close(fd);
    return total;
}

static int parse_mac(const char *s, unsigned char mac[6])
{
    int i;

    for (i = 0; i < 6; i++) {
        unsigned int v;
        char hex[3] = { s[2 * i], s[2 * i + 1], '\0' };
        char *end;
        if (!hex[0] || !hex[1])
            return -1;
        v = strtoul(hex, &end, 16);
        if (*end)
            return -1;
        mac[i] = v;
    }
    return 0;
}

int main(void)
{
    static unsigned char nvs[MAX_NVS];
    unsigned char old[MAX_NVS];
    char macstr[32];
    unsigned char mac[6];
    ssize_t len, oldlen, n;
    int fd;

    n = read_file(MAC_FILE, (unsigned char *)macstr, sizeof(macstr) - 1);
    if (n < 12) {
        ALOGE("cannot read MAC address from %s", MAC_FILE);
        return 1;
    }
    macstr[n] = '\0';
    if (parse_mac(macstr, mac) != 0) {
        ALOGE("malformed MAC address in %s", MAC_FILE);
        return 1;
    }

    len = read_file(ROM_NVS, nvs, sizeof(nvs));
    if (len < 12) {
        ALOGE("cannot read %s", ROM_NVS);
        return 1;
    }

    /* MAC bytes, as in the shell version:
       offset 3..6  <- mac[5] mac[4] mac[3] mac[2]
       offset 10,11 <- mac[1] mac[0] */
    nvs[3] = mac[5];
    nvs[4] = mac[4];
    nvs[5] = mac[3];
    nvs[6] = mac[2];
    nvs[10] = mac[1];
    nvs[11] = mac[0];

    /* Nothing to do if the file is already up to date. */
    oldlen = read_file(NEW_NVS, old, sizeof(old));
    if (oldlen == len && memcmp(old, nvs, len) == 0)
        return 0;

    fd = open(NEW_NVS ".tmp", O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) {
        ALOGE("cannot create %s.tmp: %s", NEW_NVS, strerror(errno));
        return 1;
    }
    if (write(fd, nvs, len) != len || fsync(fd) != 0) {
        ALOGE("cannot write %s.tmp: %s", NEW_NVS, strerror(errno));
        close(fd);
        unlink(NEW_NVS ".tmp");
        return 1;
    }
    close(fd);
    if (rename(NEW_NVS ".tmp", NEW_NVS) != 0) {
        ALOGE("cannot rename to %s: %s", NEW_NVS, strerror(errno));
        return 1;
    }
    ALOGI("wrote %s for MAC %02x:%02x:%02x:%02x:%02x:%02x", NEW_NVS,
          mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return 0;
}
