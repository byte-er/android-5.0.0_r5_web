/*
 * WebAssembly front-end for the unmodified SVOX Pico TTS engine found in
 * external/svox/pico/lib. It plays the role that
 * external/svox/pico/tts/com_svox_picottsengine.cpp plays on a device:
 * load the text-analysis (ta) and signal-generation (sg) resources,
 * build a voice, and pump text through pico_putTextUtf8()/pico_getData().
 */
#include <stdlib.h>
#include <string.h>
#include "picoapi.h"
#include "picodefs.h"

#define PICO_MEM_SIZE 2500000   /* same value the Android TTS engine uses */
#define VOICE_NAME "PicoVoice"

static void *mem;
static pico_System sys;
static pico_Resource ta_res, sg_res;
static pico_Engine engine;
static char ta_name[PICO_MAX_RESOURCE_NAME_SIZE], sg_name[PICO_MAX_RESOURCE_NAME_SIZE];
static unsigned char *out_buf;
static int out_len, out_cap;

static void shutdown_engine(void) {
    if (engine) { pico_disposeEngine(sys, &engine); pico_releaseVoiceDefinition(sys, (pico_Char *)VOICE_NAME); engine = 0; }
    if (sg_res) pico_unloadResource(sys, &sg_res);
    if (ta_res) pico_unloadResource(sys, &ta_res);
    sg_res = ta_res = 0;
}

/* Both files must have been registered with web_register_file() first. */
__attribute__((export_name("pico_web_load")))
int pico_web_load(const char *ta_file, const char *sg_file) {
    int st;
    if (!mem) {
        mem = malloc(PICO_MEM_SIZE);
        if (!mem) return -1;
        if ((st = pico_initialize(mem, PICO_MEM_SIZE, &sys))) return st;
    }
    shutdown_engine();
    if ((st = pico_loadResource(sys, (const pico_Char *)ta_file, &ta_res))) return st;
    if ((st = pico_loadResource(sys, (const pico_Char *)sg_file, &sg_res))) return st;
    if ((st = pico_getResourceName(sys, ta_res, ta_name))) return st;
    if ((st = pico_getResourceName(sys, sg_res, sg_name))) return st;
    if ((st = pico_createVoiceDefinition(sys, (const pico_Char *)VOICE_NAME))) return st;
    if ((st = pico_addResourceToVoiceDefinition(sys, (const pico_Char *)VOICE_NAME, (const pico_Char *)ta_name))) return st;
    if ((st = pico_addResourceToVoiceDefinition(sys, (const pico_Char *)VOICE_NAME, (const pico_Char *)sg_name))) return st;
    return pico_newEngine(sys, (const pico_Char *)VOICE_NAME, &engine);
}

static int append(const void *d, int n) {
    if (out_len + n > out_cap) {
        int nc = out_cap ? out_cap * 2 : 1 << 18;
        while (nc < out_len + n) nc *= 2;
        unsigned char *nb = realloc(out_buf, nc);
        if (!nb) return -1;
        out_buf = nb; out_cap = nc;
    }
    memcpy(out_buf + out_len, d, n);
    out_len += n;
    return 0;
}

/* Synthesizes NUL-terminated UTF-8 text (may contain Pico SSML-like
 * <pitch>/<speed>/<volume> tags). Returns the number of PCM bytes
 * (16-bit mono, 16 kHz) available at pico_web_output(), or <0 on error. */
__attribute__((export_name("pico_web_synth")))
int pico_web_synth(const char *text) {
    if (!engine) return -2;
    out_len = 0;
    pico_Int16 sent, recv, type;
    short buf[1024];
    int left = (int)strlen(text) + 1; /* include the terminating NUL to flush */
    const pico_Char *p = (const pico_Char *)text;
    pico_resetEngine(engine, PICO_RESET_SOFT);
    while (left > 0) {
        pico_Int16 chunk = left > 32000 ? 32000 : (pico_Int16)left;
        if (pico_putTextUtf8(engine, p, chunk, &sent)) return -3;
        left -= sent; p += sent;
        int st;
        do {
            st = pico_getData(engine, buf, sizeof buf, &recv, &type);
            if (recv > 0 && append(buf, recv)) return -4;
        } while (st == PICO_STEP_BUSY);
        if (st != PICO_STEP_IDLE) return -5;
    }
    return out_len;
}

__attribute__((export_name("pico_web_output")))
unsigned char *pico_web_output(void) { return out_buf; }
