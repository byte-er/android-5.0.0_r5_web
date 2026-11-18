/*
 * Copyright (C) 2014 Steven Luo
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
 * fsfinder - set up storage for the medium the Nook Color booted from.
 *
 * The CyanogenMod u-boot passes androidboot.bootdevice=eMMC|SD on the
 * kernel command line.  Run from init.encore.rc ("on fs", before
 * mount_all), this
 *
 *  1. creates /dev/block/by-name/{boot,system,userdata} pointing at the
 *     eMMC (p1/p5/p6) or SD card (p1/p2/p3) partitions, which fstab.encore
 *     refers to, and
 *  2. when booted from SD, makes vold use the last partition of the SD card
 *     (the FAT data partition of an SD install) as sdcard1 instead of the
 *     whole card: a copy of /fstab.encore with that change is written to
 *     /dev/fstab.encore and bind-mounted over the original.
 *
 * It is linked statically because it runs before /system is mounted.
 * (This replaces CM's configure_vold.sh, which needed busybox sed/sort.)
 */

#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <unistd.h>

#define CMDLINE_MAX 1024
#define BOOTDEVICE_PARAM "androidboot.bootdevice="
#define SYMLINKS_DIR "/dev/block/by-name/"

#define FSTAB "/fstab.encore"
#define FSTAB_SD "/dev/fstab.encore"
#define SDCARD1_AUTO "voldmanaged=sdcard1:auto"

typedef enum {
    UNKNOWN,
    EMMC,
    SD,
} bootdevice_t;

static bootdevice_t parse_bootdevice_arg(const char *arg)
{
    size_t namelen = strlen(BOOTDEVICE_PARAM);

    if (strncmp(BOOTDEVICE_PARAM, arg, namelen) == 0) {
        arg += namelen;
        if (strcmp("eMMC", arg) == 0)
            return EMMC;
        else if (strcmp("SD", arg) == 0)
            return SD;
    }
    return UNKNOWN;
}

static bootdevice_t get_bootdevice(void)
{
    FILE *fp;
    char cmdline[CMDLINE_MAX];
    char *arg;
    bootdevice_t bootdev = UNKNOWN;

    if (!(fp = fopen("/proc/cmdline", "r"))) {
        fprintf(stderr, "fsfinder: couldn't open kernel command line\n");
        return UNKNOWN;
    }
    if (!fgets(cmdline, sizeof(cmdline), fp)) {
        fprintf(stderr, "fsfinder: couldn't read kernel command line\n");
        fclose(fp);
        return UNKNOWN;
    }
    fclose(fp);
    cmdline[strcspn(cmdline, "\n")] = '\0';

    for (arg = strtok(cmdline, " "); arg && bootdev == UNKNOWN;
         arg = strtok(NULL, " "))
        bootdev = parse_bootdevice_arg(arg);
    return bootdev;
}

/* Highest partition number of mmcblk1, from sysfs (0 if none). */
static int last_sd_partition(void)
{
    DIR *d = opendir("/sys/block/mmcblk1");
    struct dirent *e;
    int last = 0;

    if (!d)
        return 0;
    while ((e = readdir(d)) != NULL) {
        int n;
        if (sscanf(e->d_name, "mmcblk1p%d", &n) == 1 && n > last)
            last = n;
    }
    closedir(d);
    return last;
}

/* Rewrite the sdcard1 vold entry for an SD-card install. */
static int setup_sd_fstab(void)
{
    FILE *in, *out;
    char line[512];
    int part = last_sd_partition();
    int changed = 0;

    if (part <= 0) {
        fprintf(stderr, "fsfinder: no partitions found on mmcblk1\n");
        return -1;
    }
    if (!(in = fopen(FSTAB, "r"))) {
        perror("fsfinder: " FSTAB);
        return -1;
    }
    if (!(out = fopen(FSTAB_SD, "w"))) {
        perror("fsfinder: " FSTAB_SD);
        fclose(in);
        return -1;
    }
    while (fgets(line, sizeof(line), in)) {
        char *p = strstr(line, SDCARD1_AUTO);
        if (p && line[0] != '#') {
            /* "...voldmanaged=sdcard1:auto<rest>" ->
               "...voldmanaged=sdcard1:<part>,nonremovable<rest>" */
            *p = '\0';
            fprintf(out, "%svoldmanaged=sdcard1:%d,nonremovable%s",
                    line, part, p + strlen(SDCARD1_AUTO));
            changed = 1;
        } else {
            fputs(line, out);
        }
    }
    fclose(in);
    if (fclose(out) != 0) {
        perror("fsfinder: writing " FSTAB_SD);
        return -1;
    }
    if (!changed)
        return 0;
    if (mount(FSTAB_SD, FSTAB, NULL, MS_BIND, NULL) != 0) {
        perror("fsfinder: bind-mounting " FSTAB_SD);
        return -1;
    }
    return 0;
}

static int make_links(const char *boot, const char *system, const char *data)
{
    if (symlink(boot, SYMLINKS_DIR "boot") ||
        symlink(data, SYMLINKS_DIR "userdata") ||
        symlink(system, SYMLINKS_DIR "system")) {
        if (errno != EEXIST) {
            perror("fsfinder: creating device symlink failed");
            return 1;
        }
    }
    return 0;
}

int main(void)
{
    bootdevice_t bootdev = get_bootdevice();

    if (bootdev == UNKNOWN)
        fprintf(stderr, "fsfinder: boot device not on kernel command line, "
                "assuming eMMC\n");

    if (bootdev == SD) {
        setup_sd_fstab();
        return make_links("/dev/block/mmcblk1p1", "/dev/block/mmcblk1p2",
                          "/dev/block/mmcblk1p3");
    }
    return make_links("/dev/block/mmcblk0p1", "/dev/block/mmcblk0p5",
                      "/dev/block/mmcblk0p6");
}
