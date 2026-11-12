/*
 * EAS host wrapper for the web port of external/sonivox (replaces
 * host_src/eas_hostmm.c, which relies on POSIX file descriptors, pthreads
 * and SIGBUS handling). Files are read from memory: the locator's `path`
 * points at the file's bytes and `length` holds their size.
 */
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <stdio.h>
#include "eas_host.h"
#include "eas_types.h"
#include "eas.h"
#include "eas_report.h"

#define EAS_MAX_FILE_HANDLES 32

typedef struct eas_hw_file_tag {
    const unsigned char *data;
    EAS_I32 size, pos;
    EAS_BOOL used;
} EAS_HW_FILE;

typedef struct eas_hw_inst_data_tag { EAS_HW_FILE files[EAS_MAX_FILE_HANDLES]; } EAS_HW_INST_DATA;

EAS_RESULT EAS_HWInit(EAS_HW_DATA_HANDLE *p) { *p = calloc(1, sizeof(EAS_HW_INST_DATA)); return *p ? EAS_SUCCESS : EAS_ERROR_MALLOC_FAILED; }
EAS_RESULT EAS_HWShutdown(EAS_HW_DATA_HANDLE h) { free(h); return EAS_SUCCESS; }
void *EAS_HWRegisterSignalHandler(void) { return 0; }
EAS_RESULT EAS_HWUnRegisterSignalHandler(void *c) { (void)c; return EAS_SUCCESS; }
void *EAS_HWMalloc(EAS_HW_DATA_HANDLE h, EAS_I32 size) { (void)h; return malloc(size); }
void EAS_HWFree(EAS_HW_DATA_HANDLE h, void *p) { (void)h; free(p); }
void *EAS_HWMemCpy(void *d, const void *s, EAS_I32 n) { return memcpy(d, s, n); }
void *EAS_HWMemSet(void *d, int v, EAS_I32 n) { return memset(d, v, n); }
EAS_I32 EAS_HWMemCmp(const void *a, const void *b, EAS_I32 n) { return memcmp(a, b, n); }

EAS_RESULT EAS_HWOpenFile(EAS_HW_DATA_HANDLE h, EAS_FILE_LOCATOR loc, EAS_FILE_HANDLE *pFile, EAS_FILE_MODE mode) {
    *pFile = NULL;
    if (mode != EAS_FILE_READ) return EAS_ERROR_INVALID_FILE_MODE;
    for (int i = 0; i < EAS_MAX_FILE_HANDLES; i++) {
        EAS_HW_FILE *f = &h->files[i];
        if (f->used) continue;
        f->used = EAS_TRUE; f->data = (const unsigned char *)loc->path + loc->offset; f->size = (EAS_I32)loc->length; f->pos = 0;
        *pFile = f;
        return EAS_SUCCESS;
    }
    return EAS_ERROR_MAX_FILES_OPEN;
}
EAS_RESULT EAS_HWReadFile(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f, void *buf, EAS_I32 n, EAS_I32 *pRead) {
    (void)h;
    EAS_I32 avail = f->size - f->pos;
    if (n > avail) n = avail;
    if (n > 0) memcpy(buf, f->data + f->pos, n);
    f->pos += n > 0 ? n : 0;
    *pRead = n > 0 ? n : 0;
    return *pRead ? EAS_SUCCESS : EAS_EOF;
}
EAS_RESULT EAS_HWGetByte(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f, void *p) {
    (void)h;
    if (f->pos >= f->size) return EAS_EOF;
    *(EAS_U8 *)p = f->data[f->pos++];
    return EAS_SUCCESS;
}
EAS_RESULT EAS_HWGetWord(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f, void *p, EAS_BOOL msbFirst) {
    EAS_U8 c1, c2; EAS_RESULT r;
    if ((r = EAS_HWGetByte(h, f, &c1)) != EAS_SUCCESS) return r;
    if ((r = EAS_HWGetByte(h, f, &c2)) != EAS_SUCCESS) return r;
    *(EAS_U16 *)p = msbFirst ? (EAS_U16)((c1 << 8) | c2) : (EAS_U16)((c2 << 8) | c1);
    return EAS_SUCCESS;
}
EAS_RESULT EAS_HWGetDWord(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f, void *p, EAS_BOOL msbFirst) {
    EAS_U8 c[4]; EAS_RESULT r;
    for (int i = 0; i < 4; i++) if ((r = EAS_HWGetByte(h, f, &c[i])) != EAS_SUCCESS) return r;
    *(EAS_U32 *)p = msbFirst ? ((EAS_U32)c[0] << 24) | ((EAS_U32)c[1] << 16) | ((EAS_U32)c[2] << 8) | c[3]
                             : ((EAS_U32)c[3] << 24) | ((EAS_U32)c[2] << 16) | ((EAS_U32)c[1] << 8) | c[0];
    return EAS_SUCCESS;
}
EAS_RESULT EAS_HWFilePos(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f, EAS_I32 *pos) { (void)h; *pos = f->pos; return EAS_SUCCESS; }
EAS_RESULT EAS_HWFileSeek(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f, EAS_I32 pos) {
    (void)h; if (pos < 0 || pos > f->size) return EAS_ERROR_FILE_SEEK; f->pos = pos; return EAS_SUCCESS;
}
EAS_RESULT EAS_HWFileSeekOfs(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f, EAS_I32 ofs) { return EAS_HWFileSeek(h, f, f->pos + ofs); }
EAS_RESULT EAS_HWFileLength(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f, EAS_I32 *len) { (void)h; *len = f->size; return EAS_SUCCESS; }
EAS_RESULT EAS_HWDupHandle(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f, EAS_FILE_HANDLE *pDup) {
    for (int i = 0; i < EAS_MAX_FILE_HANDLES; i++) {
        EAS_HW_FILE *d = &h->files[i];
        if (d->used) continue;
        *d = *f; *pDup = d;
        return EAS_SUCCESS;
    }
    return EAS_ERROR_MAX_FILES_OPEN;
}
EAS_RESULT EAS_HWCloseFile(EAS_HW_DATA_HANDLE h, EAS_FILE_HANDLE f) { (void)h; f->used = EAS_FALSE; return EAS_SUCCESS; }
EAS_RESULT EAS_HWVibrate(EAS_HW_DATA_HANDLE h, EAS_BOOL s) { (void)h; (void)s; return EAS_SUCCESS; }
EAS_RESULT EAS_HWLED(EAS_HW_DATA_HANDLE h, EAS_BOOL s) { (void)h; (void)s; return EAS_SUCCESS; }
EAS_RESULT EAS_HWBackLight(EAS_HW_DATA_HANDLE h, EAS_BOOL s) { (void)h; (void)s; return EAS_SUCCESS; }
EAS_BOOL EAS_HWYield(EAS_HW_DATA_HANDLE h) { (void)h; return EAS_FALSE; }

/* eas_report.c replacement: debug messages are dropped */
void EAS_ReportEx(int severity, unsigned long hashCode, int serialNum, ...) { (void)severity; (void)hashCode; (void)serialNum; }
void EAS_Report(int severity, const char *fmt, ...) { (void)severity; (void)fmt; }
void EAS_ReportX(int severity, const char *fmt, ...) { (void)severity; (void)fmt; }
void EAS_SetDebugLevel(int severity) { (void)severity; }
void EAS_SetDebugFile(void *file, int flag) { (void)file; (void)flag; }
