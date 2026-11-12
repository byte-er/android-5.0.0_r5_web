#ifndef _WEB_MATH_H
#define _WEB_MATH_H
/* sqrt/floor/ceil/fabs lower to native wasm instructions; the
 * transcendental functions are imported from the JS Math object. */
#define WASM_IMPORT(n) __attribute__((import_module("env"), import_name(n)))
WASM_IMPORT("sin") double sin(double);
WASM_IMPORT("cos") double cos(double);
WASM_IMPORT("tan") double tan(double);
WASM_IMPORT("exp") double exp(double);
WASM_IMPORT("log") double log(double);
WASM_IMPORT("log10") double log10(double);
WASM_IMPORT("pow") double pow(double, double);
WASM_IMPORT("atan") double atan(double);
WASM_IMPORT("atan2") double atan2(double, double);
static inline double sqrt(double x) { return __builtin_sqrt(x); }
static inline double floor(double x) { return __builtin_floor(x); }
static inline double ceil(double x) { return __builtin_ceil(x); }
static inline double fabs(double x) { return __builtin_fabs(x); }
static inline float sqrtf(float x) { return __builtin_sqrtf(x); }
static inline float fabsf(float x) { return __builtin_fabsf(x); }
#define M_PI 3.14159265358979323846
#endif
