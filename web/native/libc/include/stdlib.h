#ifndef _WEB_STDLIB_H
#define _WEB_STDLIB_H
#include <stddef.h>
#include <stdint.h>
void *malloc(size_t n);
void *calloc(size_t a, size_t b);
void *realloc(void *p, size_t n);
void free(void *p);
int atoi(const char *s);
int abs(int x);
long labs(long x);
void abort(void);
void exit(int code);
#endif
