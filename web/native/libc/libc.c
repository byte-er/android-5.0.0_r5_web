/*
 * Tiny freestanding C runtime for compiling AOSP C libraries to
 * WebAssembly with plain clang (--target=wasm32, no WASI/emscripten).
 * Part of the Android 5.0 web port (web/README.md).
 */
#include <stddef.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define WASM_IMPORT(n) __attribute__((import_module("env"), import_name(n)))
WASM_IMPORT("js_log") void js_log(const char *s, int len);
WASM_IMPORT("js_now_ms") double js_now_ms(void);

/* ---------------------------------------------------------- memory */
extern unsigned char __heap_base;
static unsigned char *heap_top = 0;

typedef struct blk { size_t size; struct blk *next; } blk;
static blk *free_list = 0;

static void *sbrk_(size_t n) {
    if (!heap_top) heap_top = &__heap_base;
    n = (n + 15) & ~(size_t)15;
    size_t have = __builtin_wasm_memory_size(0) * 65536;
    size_t need = (size_t)(heap_top + n);
    if (need > have) {
        size_t pages = (need - have + 65535) / 65536;
        if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return 0;
    }
    void *p = heap_top;
    heap_top += n;
    return p;
}

void *malloc(size_t n) {
    n = (n + 15) & ~(size_t)15;
    blk **pp = &free_list;
    while (*pp) {
        if ((*pp)->size >= n) { blk *b = *pp; *pp = b->next; return b + 1; }
        pp = &(*pp)->next;
    }
    blk *b = sbrk_(n + sizeof(blk));
    if (!b) return 0;
    b->size = n;
    return b + 1;
}
void free(void *p) {
    if (!p) return;
    blk *b = (blk *)p - 1;
    b->next = free_list;
    free_list = b;
}
void *calloc(size_t a, size_t b) { void *p = malloc(a * b); if (p) memset(p, 0, a * b); return p; }
void *realloc(void *p, size_t n) {
    if (!p) return malloc(n);
    blk *b = (blk *)p - 1;
    if (b->size >= n) return p;
    void *q = malloc(n);
    if (q) { memcpy(q, p, b->size); free(p); }
    return q;
}
void abort(void) { __builtin_trap(); }
void exit(int code) { (void)code; __builtin_trap(); }
int abs(int x) { return x < 0 ? -x : x; }
long labs(long x) { return x < 0 ? -x : x; }
int atoi(const char *s) {
    int neg = 0, v = 0;
    while (*s == ' ' || *s == '\t' || *s == '\n') s++;
    if (*s == '-' || *s == '+') neg = (*s++ == '-');
    while (*s >= '0' && *s <= '9') v = v * 10 + (*s++ - '0');
    return neg ? -v : v;
}
clock_t clock(void) { return (clock_t)js_now_ms(); }

/* ---------------------------------------------------------- strings */
void *memcpy(void *d, const void *s, size_t n) {
    unsigned char *dd = d; const unsigned char *ss = s;
    while (n--) *dd++ = *ss++;
    return d;
}
void *memmove(void *d, const void *s, size_t n) {
    unsigned char *dd = d; const unsigned char *ss = s;
    if (dd == ss || n == 0) return d;
    if (dd < ss) { while (n--) *dd++ = *ss++; }
    else { dd += n; ss += n; while (n--) *--dd = *--ss; }
    return d;
}
void *memset(void *d, int c, size_t n) {
    unsigned char *dd = d;
    while (n--) *dd++ = (unsigned char)c;
    return d;
}
int memcmp(const void *a, const void *b, size_t n) {
    const unsigned char *x = a, *y = b;
    for (; n; n--, x++, y++) if (*x != *y) return *x - *y;
    return 0;
}
size_t strlen(const char *s) { const char *p = s; while (*p) p++; return p - s; }
int strcmp(const char *a, const char *b) {
    while (*a && *a == *b) { a++; b++; }
    return (unsigned char)*a - (unsigned char)*b;
}
int strncmp(const char *a, const char *b, size_t n) {
    for (; n; n--, a++, b++) {
        if (*a != *b) return (unsigned char)*a - (unsigned char)*b;
        if (!*a) return 0;
    }
    return 0;
}
char *strchr(const char *s, int c) {
    for (;; s++) { if (*s == (char)c) return (char *)s; if (!*s) return 0; }
}
char *strstr(const char *s, const char *sub) {
    size_t n = strlen(sub);
    if (!n) return (char *)s;
    for (; *s; s++) if (!strncmp(s, sub, n)) return (char *)s;
    return 0;
}
char *strcpy(char *d, const char *s) { char *r = d; while ((*d++ = *s++)); return r; }
char *strcat(char *d, const char *s) { strcpy(d + strlen(d), s); return d; }

/* ---------------------------------------------------------- printf */
static void out_c(char **d, size_t *left, int *count, char c) {
    if (*left > 1) { *(*d)++ = c; (*left)--; }
    (*count)++;
}
int vsnprintf(char *dst, size_t n, const char *f, va_list ap) {
    int count = 0; size_t left = n; char *d = dst;
    char tmp[32];
    for (; *f; f++) {
        if (*f != '%') { out_c(&d, &left, &count, *f); continue; }
        f++;
        int zero = 0, width = 0, lng = 0, left_al = 0;
        if (*f == '-') { left_al = 1; f++; }
        if (*f == '0') { zero = 1; f++; }
        while (*f >= '0' && *f <= '9') width = width * 10 + (*f++ - '0');
        while (*f == 'l' || *f == 'h' || *f == 'z') { if (*f == 'l') lng++; f++; }
        const char *s = tmp; int len = 0;
        switch (*f) {
        case 'd': case 'i': case 'u': case 'x': case 'X': case 'p': {
            unsigned long long v; int neg = 0;
            int base = (*f == 'x' || *f == 'X' || *f == 'p') ? 16 : 10;
            if (*f == 'd' || *f == 'i') {
                long long sv = lng >= 2 ? va_arg(ap, long long) : lng ? va_arg(ap, long) : va_arg(ap, int);
                if (sv < 0) { neg = 1; v = -sv; } else v = sv;
            } else if (*f == 'p') v = (size_t)va_arg(ap, void *);
            else v = lng >= 2 ? va_arg(ap, unsigned long long) : lng ? va_arg(ap, unsigned long) : va_arg(ap, unsigned);
            char *e = tmp + sizeof tmp; char *p = e;
            do { int dg = v % base; *--p = dg < 10 ? '0' + dg : (*f == 'X' ? 'A' : 'a') + dg - 10; v /= base; } while (v);
            if (neg) *--p = '-';
            s = p; len = e - p;
            break;
        }
        case 'f': {
            double v = va_arg(ap, double);
            char *p = tmp;
            if (v < 0) { *p++ = '-'; v = -v; }
            unsigned long long ip = (unsigned long long)v;
            double fr = v - (double)ip;
            char ib[24]; int il = 0;
            do { ib[il++] = '0' + ip % 10; ip /= 10; } while (ip);
            while (il) *p++ = ib[--il];
            *p++ = '.';
            for (int i = 0; i < 6; i++) { fr *= 10; int dg = (int)fr; *p++ = '0' + dg; fr -= dg; }
            len = p - tmp;
            break;
        }
        case 'c': tmp[0] = (char)va_arg(ap, int); len = 1; break;
        case 's': s = va_arg(ap, const char *); if (!s) s = "(null)"; len = strlen(s); break;
        case '%': tmp[0] = '%'; len = 1; break;
        default: tmp[0] = '%'; tmp[1] = *f; len = 2; break;
        }
        int pad = width > len ? width - len : 0;
        if (!left_al) while (pad-- > 0) out_c(&d, &left, &count, zero ? '0' : ' ');
        for (int i = 0; i < len; i++) out_c(&d, &left, &count, s[i]);
        if (left_al) while (pad-- > 0) out_c(&d, &left, &count, ' ');
    }
    if (n) *d = 0;
    return count;
}
int vsprintf(char *dst, const char *f, va_list ap) { return vsnprintf(dst, (size_t)-1 >> 1, f, ap); }
int sprintf(char *dst, const char *f, ...) { va_list ap; va_start(ap, f); int r = vsprintf(dst, f, ap); va_end(ap); return r; }
int snprintf(char *dst, size_t n, const char *f, ...) { va_list ap; va_start(ap, f); int r = vsnprintf(dst, n, f, ap); va_end(ap); return r; }
int vfprintf(FILE *fp, const char *f, va_list ap) {
    (void)fp; char buf[512]; int r = vsnprintf(buf, sizeof buf, f, ap);
    js_log(buf, (int)strlen(buf)); return r;
}
int fprintf(FILE *fp, const char *f, ...) { va_list ap; va_start(ap, f); int r = vfprintf(fp, f, ap); va_end(ap); return r; }
int printf(const char *f, ...) { va_list ap; va_start(ap, f); int r = vfprintf(0, f, ap); va_end(ap); return r; }

/* ---------------------------------------------------------- in-memory files */
struct _web_file { const unsigned char *data; long len, pos; int eof, used; };
#define MAX_VFILES 16
#define MAX_OPEN 16
static struct { char name[128]; const unsigned char *data; long len; } vfiles[MAX_VFILES];
static int nvfiles = 0;
static FILE open_files[MAX_OPEN];
FILE *stdout = 0, *stderr = 0;

/* Called from JS: register a file whose bytes already live in wasm memory. */
__attribute__((export_name("web_register_file")))
int web_register_file(const char *name, const unsigned char *data, long len) {
    for (int i = 0; i < nvfiles; i++)
        if (!strcmp(vfiles[i].name, name)) { vfiles[i].data = data; vfiles[i].len = len; return i; }
    if (nvfiles >= MAX_VFILES) return -1;
    size_t l = strlen(name); if (l > 127) l = 127;
    memcpy(vfiles[nvfiles].name, name, l); vfiles[nvfiles].name[l] = 0;
    vfiles[nvfiles].data = data; vfiles[nvfiles].len = len;
    return nvfiles++;
}
__attribute__((export_name("web_malloc"))) void *web_malloc(size_t n) { return malloc(n); }
__attribute__((export_name("web_free"))) void web_free(void *p) { free(p); }

FILE *fopen(const char *name, const char *mode) {
    if (mode[0] != 'r') return 0; /* read-only file system */
    for (int i = 0; i < nvfiles; i++) {
        if (strcmp(vfiles[i].name, name)) continue;
        for (int j = 0; j < MAX_OPEN; j++) {
            if (open_files[j].used) continue;
            open_files[j].used = 1; open_files[j].data = vfiles[i].data;
            open_files[j].len = vfiles[i].len; open_files[j].pos = 0; open_files[j].eof = 0;
            return &open_files[j];
        }
    }
    return 0;
}
int fclose(FILE *f) { if (f) f->used = 0; return 0; }
int fflush(FILE *f) { (void)f; return 0; }
int fgetc(FILE *f) {
    if (f->pos >= f->len) { f->eof = 1; return EOF; }
    return f->data[f->pos++];
}
size_t fread(void *ptr, size_t size, size_t n, FILE *f) {
    if (!size) return 0;
    long avail = f->len - f->pos;
    size_t cnt = n;
    if ((long)(size * n) > avail) { cnt = avail / size; f->eof = 1; }
    memcpy(ptr, f->data + f->pos, cnt * size);
    f->pos += cnt * size;
    return cnt;
}
size_t fwrite(const void *ptr, size_t size, size_t n, FILE *f) { (void)ptr; (void)size; (void)n; (void)f; return 0; }
int fseek(FILE *f, long off, int whence) {
    long p = whence == SEEK_SET ? off : whence == SEEK_CUR ? f->pos + off : f->len + off;
    if (p < 0 || p > f->len) return -1;
    f->pos = p; f->eof = 0; return 0;
}
long ftell(FILE *f) { return f->pos; }
int fgetpos(FILE *f, fpos_t *pos) { *pos = f->pos; return 0; }
int fsetpos(FILE *f, const fpos_t *pos) { f->pos = *pos; f->eof = 0; return 0; }
void clearerr(FILE *f) { f->eof = 0; }
int feof(FILE *f) { return f->eof; }
