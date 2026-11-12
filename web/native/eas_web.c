/*
 * WebAssembly front-end for the unmodified Sonivox EAS synthesizer
 * (external/sonivox/arm-wt-22k): renders SMF / XMF / RTTTL / iMelody / OTA
 * files to 16-bit stereo PCM at 22050 Hz, mirroring the calls made by
 * frameworks/av/media/libmediaplayerservice/MidiFile.cpp.
 */
#include <stdlib.h>
#include <string.h>
#include "eas.h"
#include "eas_reverb.h"

static unsigned char *out; static int out_len, out_cap;
static int append(const void *d, int n) {
    if (out_len + n > out_cap) {
        int nc = out_cap ? out_cap * 2 : 1 << 20;
        while (nc < out_len + n) nc *= 2;
        unsigned char *nb = realloc(out, nc);
        if (!nb) return -1;
        out = nb; out_cap = nc;
    }
    memcpy(out + out_len, d, n); out_len += n; return 0;
}

__attribute__((export_name("eas_web_sample_rate"))) int eas_web_sample_rate(void) { return EAS_Config()->sampleRate; }
__attribute__((export_name("eas_web_channels"))) int eas_web_channels(void) { return EAS_Config()->numChannels; }
__attribute__((export_name("eas_web_output"))) unsigned char *eas_web_output(void) { return out; }

/* Returns the number of PCM bytes rendered, or a negative EAS error code. */
__attribute__((export_name("eas_web_render")))
int eas_web_render(const unsigned char *data, int len, int max_seconds) {
    const S_EAS_LIB_CONFIG *cfg = EAS_Config();
    EAS_DATA_HANDLE eas = NULL; EAS_HANDLE stream = NULL; EAS_RESULT r;
    EAS_FILE loc; loc.path = (const char *)data; loc.fd = 0; loc.offset = 0; loc.length = len;
    out_len = 0;
    if ((r = EAS_Init(&eas)) != EAS_SUCCESS) return (int)r;
    EAS_SetParameter(eas, EAS_MODULE_REVERB, EAS_PARAM_REVERB_PRESET, EAS_PARAM_REVERB_CHAMBER);
    EAS_SetParameter(eas, EAS_MODULE_REVERB, EAS_PARAM_REVERB_BYPASS, EAS_FALSE);
    if ((r = EAS_OpenFile(eas, &loc, &stream)) != EAS_SUCCESS) { EAS_Shutdown(eas); return (int)r; }
    if ((r = EAS_Prepare(eas, stream)) != EAS_SUCCESS) { EAS_CloseFile(eas, stream); EAS_Shutdown(eas); return (int)r; }
    EAS_PCM *buf = malloc(sizeof(EAS_PCM) * cfg->mixBufferSize * cfg->numChannels);
    long frames = 0, limit = (long)max_seconds * cfg->sampleRate;
    for (;;) {
        EAS_STATE state;
        EAS_State(eas, stream, &state);
        if (state == EAS_STATE_STOPPED || state == EAS_STATE_ERROR) break;
        EAS_I32 count = 0;
        if ((r = EAS_Render(eas, buf, cfg->mixBufferSize, &count)) != EAS_SUCCESS) break;
        if (append(buf, count * cfg->numChannels * (int)sizeof(EAS_PCM))) break;
        frames += count;
        if (frames > limit) break;
    }
    free(buf);
    EAS_CloseFile(eas, stream);
    EAS_Shutdown(eas);
    return out_len;
}
