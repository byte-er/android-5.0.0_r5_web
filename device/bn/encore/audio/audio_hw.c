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
 * Primary audio HAL for the Nook Color (encore).
 *
 * The audio codec is a TI TLV320AIC3100 on OMAP McBSP2 (ALSA card 0,
 * device 0).  The kernel codec driver switches between the speaker and the
 * headphone jack on its own (headphone-detect GPIO) and reports the jack
 * through the "h2w" switch, so this HAL does no mixer routing: it only moves
 * PCM data.  Playback runs at 44.1 kHz stereo; capture runs at 44.1 kHz
 * stereo in hardware and is down-mixed / resampled to what was requested.
 */

#define LOG_TAG "audio_hw_encore"
/*#define LOG_NDEBUG 0*/

#include <errno.h>
#include <pthread.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#include <cutils/log.h>
#include <cutils/str_parms.h>

#include <hardware/audio.h>
#include <hardware/hardware.h>
#include <system/audio.h>

#include <tinyalsa/asoundlib.h>
#include <audio_utils/resampler.h>

#define PCM_CARD            0
#define PCM_DEVICE          0

#define OUT_SAMPLING_RATE   44100
#define OUT_PERIOD_SIZE     1024
#define OUT_PERIOD_COUNT    4

#define IN_SAMPLING_RATE    44100
#define IN_PERIOD_SIZE      1024
#define IN_PERIOD_COUNT     2
#define IN_HW_CHANNELS      2

static const struct pcm_config pcm_config_out = {
    .channels = 2,
    .rate = OUT_SAMPLING_RATE,
    .period_size = OUT_PERIOD_SIZE,
    .period_count = OUT_PERIOD_COUNT,
    .format = PCM_FORMAT_S16_LE,
    .start_threshold = OUT_PERIOD_SIZE,
};

static const struct pcm_config pcm_config_in = {
    .channels = IN_HW_CHANNELS,
    .rate = IN_SAMPLING_RATE,
    .period_size = IN_PERIOD_SIZE,
    .period_count = IN_PERIOD_COUNT,
    .format = PCM_FORMAT_S16_LE,
};

struct encore_audio_device {
    struct audio_hw_device device;
    pthread_mutex_t lock;
    bool mic_mute;
    audio_mode_t mode;
};

struct encore_stream_out {
    struct audio_stream_out stream;
    pthread_mutex_t lock;
    struct encore_audio_device *dev;
    struct pcm *pcm;
    bool standby;
    audio_devices_t devices;
    uint64_t written;           /* frames written since open */
};

struct encore_stream_in {
    struct audio_stream_in stream;
    pthread_mutex_t lock;
    struct encore_audio_device *dev;
    struct pcm *pcm;
    bool standby;
    audio_devices_t devices;
    uint32_t sample_rate;
    uint32_t channels;          /* channels requested by the client */

    struct resampler_itfe *resampler;
    struct resampler_buffer_provider buf_provider;
    int16_t *hw_buffer;         /* IN_PERIOD_SIZE frames, IN_HW_CHANNELS */
    int16_t *conv_buffer;       /* IN_PERIOD_SIZE frames, client channels */
    size_t frames_in;
    int read_status;
};

/* ---------------------------------------------------------------------- */
/* Output stream                                                          */
/* ---------------------------------------------------------------------- */

/* Must be called with out->lock held. */
static int start_output(struct encore_stream_out *out)
{
    struct pcm_config config = pcm_config_out;

    out->pcm = pcm_open(PCM_CARD, PCM_DEVICE, PCM_OUT | PCM_MONOTONIC, &config);
    if (!pcm_is_ready(out->pcm)) {
        ALOGE("cannot open playback pcm: %s", pcm_get_error(out->pcm));
        pcm_close(out->pcm);
        out->pcm = NULL;
        return -ENODEV;
    }
    return 0;
}

/* Must be called with out->lock held. */
static void do_out_standby(struct encore_stream_out *out)
{
    if (!out->standby) {
        if (out->pcm) {
            pcm_close(out->pcm);
            out->pcm = NULL;
        }
        out->standby = true;
    }
}

static uint32_t out_get_sample_rate(const struct audio_stream *stream __unused)
{
    return OUT_SAMPLING_RATE;
}

static int out_set_sample_rate(struct audio_stream *stream __unused,
                               uint32_t rate __unused)
{
    return -ENOSYS;
}

static size_t out_get_buffer_size(const struct audio_stream *stream)
{
    return OUT_PERIOD_SIZE * audio_stream_out_frame_size((const struct audio_stream_out *)stream);
}

static audio_channel_mask_t out_get_channels(const struct audio_stream *stream __unused)
{
    return AUDIO_CHANNEL_OUT_STEREO;
}

static audio_format_t out_get_format(const struct audio_stream *stream __unused)
{
    return AUDIO_FORMAT_PCM_16_BIT;
}

static int out_set_format(struct audio_stream *stream __unused,
                          audio_format_t format __unused)
{
    return -ENOSYS;
}

static int out_standby(struct audio_stream *stream)
{
    struct encore_stream_out *out = (struct encore_stream_out *)stream;

    pthread_mutex_lock(&out->lock);
    do_out_standby(out);
    pthread_mutex_unlock(&out->lock);
    return 0;
}

static int out_dump(const struct audio_stream *stream __unused, int fd __unused)
{
    return 0;
}

static int out_set_parameters(struct audio_stream *stream, const char *kvpairs)
{
    struct encore_stream_out *out = (struct encore_stream_out *)stream;
    struct str_parms *parms;
    char value[32];

    parms = str_parms_create_str(kvpairs);
    if (str_parms_get_str(parms, AUDIO_PARAMETER_STREAM_ROUTING,
                          value, sizeof(value)) >= 0) {
        int val = atoi(value);
        pthread_mutex_lock(&out->lock);
        /* Routing is handled by the codec driver; just remember it. */
        if (val != 0)
            out->devices = val;
        pthread_mutex_unlock(&out->lock);
    }
    str_parms_destroy(parms);
    return 0;
}

static char *out_get_parameters(const struct audio_stream *stream __unused,
                                const char *keys __unused)
{
    return strdup("");
}

static uint32_t out_get_latency(const struct audio_stream_out *stream __unused)
{
    return (OUT_PERIOD_SIZE * OUT_PERIOD_COUNT * 1000) / OUT_SAMPLING_RATE;
}

static int out_set_volume(struct audio_stream_out *stream __unused,
                          float left __unused, float right __unused)
{
    /* No hardware volume: AudioFlinger applies software volume. */
    return -ENOSYS;
}

static ssize_t out_write(struct audio_stream_out *stream, const void *buffer,
                         size_t bytes)
{
    struct encore_stream_out *out = (struct encore_stream_out *)stream;
    size_t frame_size = audio_stream_out_frame_size(stream);
    int ret = 0;

    pthread_mutex_lock(&out->lock);
    if (out->standby) {
        ret = start_output(out);
        if (ret != 0)
            goto exit;
        out->standby = false;
    }

    ret = pcm_write(out->pcm, buffer, bytes);
    if (ret == 0)
        out->written += bytes / frame_size;

exit:
    pthread_mutex_unlock(&out->lock);

    if (ret != 0) {
        ALOGW("out_write error %d, sleeping to emulate playback", ret);
        usleep(bytes * 1000000 / frame_size / OUT_SAMPLING_RATE);
    }
    return bytes;
}

static int out_get_render_position(const struct audio_stream_out *stream __unused,
                                   uint32_t *dsp_frames __unused)
{
    return -EINVAL;
}

static int out_get_presentation_position(const struct audio_stream_out *stream,
                                         uint64_t *frames,
                                         struct timespec *timestamp)
{
    struct encore_stream_out *out = (struct encore_stream_out *)stream;
    int ret = -ENODATA;

    pthread_mutex_lock(&out->lock);
    if (out->pcm) {
        unsigned int avail;
        if (pcm_get_htimestamp(out->pcm, &avail, timestamp) == 0) {
            int64_t kernel_buffer = (int64_t)OUT_PERIOD_SIZE * OUT_PERIOD_COUNT;
            int64_t signed_frames = out->written - kernel_buffer + avail;
            if (signed_frames >= 0) {
                *frames = signed_frames;
                ret = 0;
            }
        }
    }
    pthread_mutex_unlock(&out->lock);
    return ret;
}

static int out_add_audio_effect(const struct audio_stream *stream __unused,
                                effect_handle_t effect __unused)
{
    return 0;
}

static int out_remove_audio_effect(const struct audio_stream *stream __unused,
                                   effect_handle_t effect __unused)
{
    return 0;
}

static int out_get_next_write_timestamp(const struct audio_stream_out *stream __unused,
                                        int64_t *timestamp __unused)
{
    return -EINVAL;
}

/* ---------------------------------------------------------------------- */
/* Input stream                                                           */
/* ---------------------------------------------------------------------- */

static int get_next_buffer(struct resampler_buffer_provider *buffer_provider,
                           struct resampler_buffer *buffer)
{
    struct encore_stream_in *in = (struct encore_stream_in *)
        ((char *)buffer_provider - offsetof(struct encore_stream_in, buf_provider));

    if (in->pcm == NULL) {
        buffer->raw = NULL;
        buffer->frame_count = 0;
        in->read_status = -ENODEV;
        return -ENODEV;
    }

    if (in->frames_in == 0) {
        size_t i;
        in->read_status = pcm_read(in->pcm, in->hw_buffer,
                pcm_frames_to_bytes(in->pcm, IN_PERIOD_SIZE));
        if (in->read_status != 0) {
            ALOGE("pcm_read error %d", in->read_status);
            buffer->raw = NULL;
            buffer->frame_count = 0;
            return in->read_status;
        }
        /* Down-mix the stereo hardware stream if mono was requested. */
        if (in->channels == 1) {
            for (i = 0; i < IN_PERIOD_SIZE; i++)
                in->conv_buffer[i] = (int16_t)(((int32_t)in->hw_buffer[2 * i] +
                                                in->hw_buffer[2 * i + 1]) / 2);
        } else {
            memcpy(in->conv_buffer, in->hw_buffer,
                   IN_PERIOD_SIZE * IN_HW_CHANNELS * sizeof(int16_t));
        }
        in->frames_in = IN_PERIOD_SIZE;
    }

    buffer->frame_count = (buffer->frame_count > in->frames_in) ?
                              in->frames_in : buffer->frame_count;
    buffer->i16 = in->conv_buffer +
                  (IN_PERIOD_SIZE - in->frames_in) * in->channels;
    return in->read_status;
}

static void release_buffer(struct resampler_buffer_provider *buffer_provider,
                           struct resampler_buffer *buffer)
{
    struct encore_stream_in *in = (struct encore_stream_in *)
        ((char *)buffer_provider - offsetof(struct encore_stream_in, buf_provider));

    in->frames_in -= buffer->frame_count;
}

/* Must be called with in->lock held. */
static int start_input(struct encore_stream_in *in)
{
    struct pcm_config config = pcm_config_in;

    in->pcm = pcm_open(PCM_CARD, PCM_DEVICE, PCM_IN, &config);
    if (!pcm_is_ready(in->pcm)) {
        ALOGE("cannot open capture pcm: %s", pcm_get_error(in->pcm));
        pcm_close(in->pcm);
        in->pcm = NULL;
        return -ENODEV;
    }
    in->frames_in = 0;
    if (in->resampler)
        in->resampler->reset(in->resampler);
    return 0;
}

/* Must be called with in->lock held. */
static void do_in_standby(struct encore_stream_in *in)
{
    if (!in->standby) {
        if (in->pcm) {
            pcm_close(in->pcm);
            in->pcm = NULL;
        }
        in->standby = true;
    }
}

static uint32_t in_get_sample_rate(const struct audio_stream *stream)
{
    struct encore_stream_in *in = (struct encore_stream_in *)stream;
    return in->sample_rate;
}

static int in_set_sample_rate(struct audio_stream *stream __unused,
                              uint32_t rate __unused)
{
    return -ENOSYS;
}

static size_t get_input_buffer_size(uint32_t sample_rate, int channel_count)
{
    /* ~20 ms, rounded up to a multiple of 16 frames */
    size_t size = (sample_rate * 20) / 1000;
    size = ((size + 15) / 16) * 16;
    return size * channel_count * sizeof(int16_t);
}

static size_t in_get_buffer_size(const struct audio_stream *stream)
{
    struct encore_stream_in *in = (struct encore_stream_in *)stream;
    return get_input_buffer_size(in->sample_rate, in->channels);
}

static audio_channel_mask_t in_get_channels(const struct audio_stream *stream)
{
    struct encore_stream_in *in = (struct encore_stream_in *)stream;
    return in->channels == 1 ? AUDIO_CHANNEL_IN_MONO : AUDIO_CHANNEL_IN_STEREO;
}

static audio_format_t in_get_format(const struct audio_stream *stream __unused)
{
    return AUDIO_FORMAT_PCM_16_BIT;
}

static int in_set_format(struct audio_stream *stream __unused,
                         audio_format_t format __unused)
{
    return -ENOSYS;
}

static int in_standby(struct audio_stream *stream)
{
    struct encore_stream_in *in = (struct encore_stream_in *)stream;

    pthread_mutex_lock(&in->lock);
    do_in_standby(in);
    pthread_mutex_unlock(&in->lock);
    return 0;
}

static int in_dump(const struct audio_stream *stream __unused, int fd __unused)
{
    return 0;
}

static int in_set_parameters(struct audio_stream *stream, const char *kvpairs)
{
    struct encore_stream_in *in = (struct encore_stream_in *)stream;
    struct str_parms *parms;
    char value[32];

    parms = str_parms_create_str(kvpairs);
    if (str_parms_get_str(parms, AUDIO_PARAMETER_STREAM_ROUTING,
                          value, sizeof(value)) >= 0) {
        int val = atoi(value) & ~AUDIO_DEVICE_BIT_IN;
        pthread_mutex_lock(&in->lock);
        if (val != 0)
            in->devices = val;
        pthread_mutex_unlock(&in->lock);
    }
    str_parms_destroy(parms);
    return 0;
}

static char *in_get_parameters(const struct audio_stream *stream __unused,
                               const char *keys __unused)
{
    return strdup("");
}

static int in_set_gain(struct audio_stream_in *stream __unused,
                       float gain __unused)
{
    return 0;
}

static ssize_t in_read(struct audio_stream_in *stream, void *buffer,
                       size_t bytes)
{
    struct encore_stream_in *in = (struct encore_stream_in *)stream;
    size_t frame_size = audio_stream_in_frame_size(stream);
    size_t frames = bytes / frame_size;
    size_t done = 0;
    int ret = 0;

    pthread_mutex_lock(&in->lock);
    if (in->standby) {
        ret = start_input(in);
        if (ret != 0)
            goto exit;
        in->standby = false;
    }

    while (done < frames) {
        size_t n = frames - done;
        if (in->resampler) {
            in->resampler->resample_from_provider(in->resampler,
                    (int16_t *)((char *)buffer + done * frame_size), &n);
        } else {
            struct resampler_buffer buf;
            memset(&buf, 0, sizeof(buf));
            buf.frame_count = n;
            get_next_buffer(&in->buf_provider, &buf);
            if (buf.raw) {
                memcpy((char *)buffer + done * frame_size, buf.raw,
                       buf.frame_count * frame_size);
                n = buf.frame_count;
            }
            release_buffer(&in->buf_provider, &buf);
        }
        ret = in->read_status;
        if (ret != 0 || n == 0)
            break;
        done += n;
    }

    if (ret == 0 && in->dev->mic_mute)
        memset(buffer, 0, bytes);

exit:
    pthread_mutex_unlock(&in->lock);

    if (ret != 0) {
        memset(buffer, 0, bytes);
        usleep(frames * 1000000 / in->sample_rate);
    }
    return bytes;
}

static uint32_t in_get_input_frames_lost(struct audio_stream_in *stream __unused)
{
    return 0;
}

static int in_add_audio_effect(const struct audio_stream *stream __unused,
                               effect_handle_t effect __unused)
{
    return 0;
}

static int in_remove_audio_effect(const struct audio_stream *stream __unused,
                                  effect_handle_t effect __unused)
{
    return 0;
}

/* ---------------------------------------------------------------------- */
/* Device                                                                 */
/* ---------------------------------------------------------------------- */

static int adev_open_output_stream(struct audio_hw_device *dev,
                                   audio_io_handle_t handle __unused,
                                   audio_devices_t devices,
                                   audio_output_flags_t flags __unused,
                                   struct audio_config *config,
                                   struct audio_stream_out **stream_out,
                                   const char *address __unused)
{
    struct encore_audio_device *adev = (struct encore_audio_device *)dev;
    struct encore_stream_out *out;

    /* Only 44.1 kHz stereo 16-bit is supported; tell AudioFlinger so. */
    if (config->sample_rate != OUT_SAMPLING_RATE ||
        config->channel_mask != AUDIO_CHANNEL_OUT_STEREO ||
        config->format != AUDIO_FORMAT_PCM_16_BIT) {
        config->sample_rate = OUT_SAMPLING_RATE;
        config->channel_mask = AUDIO_CHANNEL_OUT_STEREO;
        config->format = AUDIO_FORMAT_PCM_16_BIT;
        return -EINVAL;
    }

    out = calloc(1, sizeof(*out));
    if (!out)
        return -ENOMEM;

    out->stream.common.get_sample_rate = out_get_sample_rate;
    out->stream.common.set_sample_rate = out_set_sample_rate;
    out->stream.common.get_buffer_size = out_get_buffer_size;
    out->stream.common.get_channels = out_get_channels;
    out->stream.common.get_format = out_get_format;
    out->stream.common.set_format = out_set_format;
    out->stream.common.standby = out_standby;
    out->stream.common.dump = out_dump;
    out->stream.common.set_parameters = out_set_parameters;
    out->stream.common.get_parameters = out_get_parameters;
    out->stream.common.add_audio_effect = out_add_audio_effect;
    out->stream.common.remove_audio_effect = out_remove_audio_effect;
    out->stream.get_latency = out_get_latency;
    out->stream.set_volume = out_set_volume;
    out->stream.write = out_write;
    out->stream.get_render_position = out_get_render_position;
    out->stream.get_next_write_timestamp = out_get_next_write_timestamp;
    out->stream.get_presentation_position = out_get_presentation_position;

    pthread_mutex_init(&out->lock, NULL);
    out->dev = adev;
    out->standby = true;
    out->devices = devices;

    *stream_out = &out->stream;
    return 0;
}

static void adev_close_output_stream(struct audio_hw_device *dev __unused,
                                     struct audio_stream_out *stream)
{
    struct encore_stream_out *out = (struct encore_stream_out *)stream;

    out_standby(&stream->common);
    pthread_mutex_destroy(&out->lock);
    free(out);
}

static int check_input_parameters(uint32_t sample_rate, audio_format_t format,
                                  int channel_count)
{
    if (format != AUDIO_FORMAT_PCM_16_BIT)
        return -EINVAL;
    if (channel_count < 1 || channel_count > 2)
        return -EINVAL;
    switch (sample_rate) {
    case 8000:
    case 11025:
    case 16000:
    case 22050:
    case 32000:
    case 44100:
    case 48000:
        return 0;
    default:
        return -EINVAL;
    }
}

static size_t adev_get_input_buffer_size(const struct audio_hw_device *dev __unused,
                                         const struct audio_config *config)
{
    int channel_count = audio_channel_count_from_in_mask(config->channel_mask);

    if (check_input_parameters(config->sample_rate, config->format,
                               channel_count) != 0)
        return 0;
    return get_input_buffer_size(config->sample_rate, channel_count);
}

static int adev_open_input_stream(struct audio_hw_device *dev,
                                  audio_io_handle_t handle __unused,
                                  audio_devices_t devices,
                                  struct audio_config *config,
                                  struct audio_stream_in **stream_in,
                                  audio_input_flags_t flags __unused,
                                  const char *address __unused,
                                  audio_source_t source __unused)
{
    struct encore_audio_device *adev = (struct encore_audio_device *)dev;
    struct encore_stream_in *in;
    int channel_count = audio_channel_count_from_in_mask(config->channel_mask);
    int ret;

    *stream_in = NULL;
    if (check_input_parameters(config->sample_rate, config->format,
                               channel_count) != 0) {
        config->sample_rate = IN_SAMPLING_RATE;
        config->channel_mask = AUDIO_CHANNEL_IN_MONO;
        config->format = AUDIO_FORMAT_PCM_16_BIT;
        return -EINVAL;
    }

    in = calloc(1, sizeof(*in));
    if (!in)
        return -ENOMEM;

    in->stream.common.get_sample_rate = in_get_sample_rate;
    in->stream.common.set_sample_rate = in_set_sample_rate;
    in->stream.common.get_buffer_size = in_get_buffer_size;
    in->stream.common.get_channels = in_get_channels;
    in->stream.common.get_format = in_get_format;
    in->stream.common.set_format = in_set_format;
    in->stream.common.standby = in_standby;
    in->stream.common.dump = in_dump;
    in->stream.common.set_parameters = in_set_parameters;
    in->stream.common.get_parameters = in_get_parameters;
    in->stream.common.add_audio_effect = in_add_audio_effect;
    in->stream.common.remove_audio_effect = in_remove_audio_effect;
    in->stream.set_gain = in_set_gain;
    in->stream.read = in_read;
    in->stream.get_input_frames_lost = in_get_input_frames_lost;

    pthread_mutex_init(&in->lock, NULL);
    in->dev = adev;
    in->standby = true;
    in->devices = devices;
    in->sample_rate = config->sample_rate;
    in->channels = channel_count;

    in->hw_buffer = malloc(IN_PERIOD_SIZE * IN_HW_CHANNELS * sizeof(int16_t));
    in->conv_buffer = malloc(IN_PERIOD_SIZE * IN_HW_CHANNELS * sizeof(int16_t));
    if (!in->hw_buffer || !in->conv_buffer) {
        ret = -ENOMEM;
        goto err;
    }

    in->buf_provider.get_next_buffer = get_next_buffer;
    in->buf_provider.release_buffer = release_buffer;
    if (in->sample_rate != IN_SAMPLING_RATE) {
        ret = create_resampler(IN_SAMPLING_RATE, in->sample_rate, in->channels,
                               RESAMPLER_QUALITY_DEFAULT, &in->buf_provider,
                               &in->resampler);
        if (ret != 0) {
            ALOGE("cannot create resampler: %d", ret);
            goto err;
        }
    }

    *stream_in = &in->stream;
    return 0;

err:
    free(in->hw_buffer);
    free(in->conv_buffer);
    pthread_mutex_destroy(&in->lock);
    free(in);
    return ret;
}

static void adev_close_input_stream(struct audio_hw_device *dev __unused,
                                    struct audio_stream_in *stream)
{
    struct encore_stream_in *in = (struct encore_stream_in *)stream;

    in_standby(&stream->common);
    if (in->resampler)
        release_resampler(in->resampler);
    free(in->hw_buffer);
    free(in->conv_buffer);
    pthread_mutex_destroy(&in->lock);
    free(in);
}

static int adev_set_parameters(struct audio_hw_device *dev __unused,
                               const char *kvpairs __unused)
{
    return 0;
}

static char *adev_get_parameters(const struct audio_hw_device *dev __unused,
                                 const char *keys __unused)
{
    return strdup("");
}

static int adev_init_check(const struct audio_hw_device *dev __unused)
{
    return 0;
}

static int adev_set_voice_volume(struct audio_hw_device *dev __unused,
                                 float volume __unused)
{
    return -ENOSYS;
}

static int adev_set_master_volume(struct audio_hw_device *dev __unused,
                                  float volume __unused)
{
    return -ENOSYS;
}

static int adev_set_mode(struct audio_hw_device *dev, audio_mode_t mode)
{
    struct encore_audio_device *adev = (struct encore_audio_device *)dev;

    pthread_mutex_lock(&adev->lock);
    adev->mode = mode;
    pthread_mutex_unlock(&adev->lock);
    return 0;
}

static int adev_set_mic_mute(struct audio_hw_device *dev, bool state)
{
    struct encore_audio_device *adev = (struct encore_audio_device *)dev;

    adev->mic_mute = state;
    return 0;
}

static int adev_get_mic_mute(const struct audio_hw_device *dev, bool *state)
{
    const struct encore_audio_device *adev = (const struct encore_audio_device *)dev;

    *state = adev->mic_mute;
    return 0;
}

static int adev_dump(const audio_hw_device_t *device __unused, int fd __unused)
{
    return 0;
}

static int adev_close(hw_device_t *device)
{
    struct encore_audio_device *adev = (struct encore_audio_device *)device;

    pthread_mutex_destroy(&adev->lock);
    free(adev);
    return 0;
}

static int adev_open(const hw_module_t *module, const char *name,
                     hw_device_t **device)
{
    struct encore_audio_device *adev;

    if (strcmp(name, AUDIO_HARDWARE_INTERFACE) != 0)
        return -EINVAL;

    adev = calloc(1, sizeof(*adev));
    if (!adev)
        return -ENOMEM;

    adev->device.common.tag = HARDWARE_DEVICE_TAG;
    adev->device.common.version = AUDIO_DEVICE_API_VERSION_2_0;
    adev->device.common.module = (struct hw_module_t *)module;
    adev->device.common.close = adev_close;

    adev->device.init_check = adev_init_check;
    adev->device.set_voice_volume = adev_set_voice_volume;
    adev->device.set_master_volume = adev_set_master_volume;
    adev->device.set_mode = adev_set_mode;
    adev->device.set_mic_mute = adev_set_mic_mute;
    adev->device.get_mic_mute = adev_get_mic_mute;
    adev->device.set_parameters = adev_set_parameters;
    adev->device.get_parameters = adev_get_parameters;
    adev->device.get_input_buffer_size = adev_get_input_buffer_size;
    adev->device.open_output_stream = adev_open_output_stream;
    adev->device.close_output_stream = adev_close_output_stream;
    adev->device.open_input_stream = adev_open_input_stream;
    adev->device.close_input_stream = adev_close_input_stream;
    adev->device.dump = adev_dump;

    pthread_mutex_init(&adev->lock, NULL);
    adev->mode = AUDIO_MODE_NORMAL;

    *device = &adev->device.common;
    return 0;
}

static struct hw_module_methods_t hal_module_methods = {
    .open = adev_open,
};

struct audio_module HAL_MODULE_INFO_SYM = {
    .common = {
        .tag = HARDWARE_MODULE_TAG,
        .module_api_version = AUDIO_MODULE_API_VERSION_0_1,
        .hal_api_version = HARDWARE_HAL_API_VERSION,
        .id = AUDIO_HARDWARE_MODULE_ID,
        .name = "Nook Color audio HAL",
        .author = "The Android Open Source Project",
        .methods = &hal_module_methods,
    },
};
