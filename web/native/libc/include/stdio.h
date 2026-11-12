/* Minimal stdio for the Android-5.0-web WebAssembly port.
 * Files are served from an in-memory table filled by JavaScript. */
#ifndef _WEB_STDIO_H
#define _WEB_STDIO_H
#include <stddef.h>
#include <stdint.h>
#include <stdarg.h>
typedef struct _web_file FILE;
typedef long fpos_t;
#define EOF (-1)
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
FILE *fopen(const char *name, const char *mode);
int fclose(FILE *f);
int fflush(FILE *f);
int fgetc(FILE *f);
size_t fread(void *ptr, size_t size, size_t n, FILE *f);
size_t fwrite(const void *ptr, size_t size, size_t n, FILE *f);
int fseek(FILE *f, long off, int whence);
long ftell(FILE *f);
int fgetpos(FILE *f, fpos_t *pos);
int fsetpos(FILE *f, const fpos_t *pos);
void clearerr(FILE *f);
int feof(FILE *f);
int vsnprintf(char *dst, size_t n, const char *fmt, va_list ap);
int vsprintf(char *dst, const char *fmt, va_list ap);
int sprintf(char *dst, const char *fmt, ...);
int snprintf(char *dst, size_t n, const char *fmt, ...);
int printf(const char *fmt, ...);
int fprintf(FILE *f, const char *fmt, ...);
int vfprintf(FILE *f, const char *fmt, va_list ap);
extern FILE *stdout, *stderr;
#endif
