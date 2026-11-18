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
 * pvrsrvinit - initialise the PowerVR SGX user-space services.
 *
 * Replacement for the prebuilt /system/bin/pvrsrvinit shipped with the
 * SGX530 DDK.  The prebuilt is a non-PIE executable, which the Android 5.0
 * dynamic linker refuses to run.  All it does is call SrvInit() from
 * libsrv_init.so, so this does the same from a PIE binary.  The library is
 * loaded with dlopen() so that the build does not need the proprietary
 * blobs to be present at link time.
 */

#define LOG_TAG "pvrsrvinit"

#include <dlfcn.h>
#include <stdio.h>

#include <cutils/log.h>

typedef int (*srv_init_fn)(void);

int main(void)
{
    void *lib;
    srv_init_fn srv_init;
    int err;

    lib = dlopen("libsrv_init.so", RTLD_NOW);
    if (!lib) {
        ALOGE("cannot load libsrv_init.so: %s", dlerror());
        return 1;
    }

    srv_init = (srv_init_fn) dlsym(lib, "SrvInit");
    if (!srv_init) {
        ALOGE("libsrv_init.so has no SrvInit: %s", dlerror());
        return 1;
    }

    /* PVRSRV_OK == 0 */
    err = srv_init();
    if (err != 0) {
        ALOGE("SrvInit failed: %d", err);
        return 1;
    }

    ALOGI("PowerVR SGX services initialised");
    return 0;
}
