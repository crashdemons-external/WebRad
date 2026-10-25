/* Bounded memory-only OpenJPEG adapter. BSD-2-Clause. */
#include <openjpeg.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>

typedef struct {
    unsigned char *data;
    size_t size, pos, cap;
    int writable;
} Memory;

static unsigned char *pixels = NULL;
static int width = 0, height = 0;
static Memory encoded = {0};

static OPJ_SIZE_T read_bytes(void *buffer, OPJ_SIZE_T length, void *user) {
    Memory *memory = user;
    if (memory->pos >= memory->size) return (OPJ_SIZE_T)-1;
    if (length > memory->size - memory->pos) length = memory->size - memory->pos;
    memcpy(buffer, memory->data + memory->pos, length);
    memory->pos += length;
    return length;
}

static OPJ_BOOL seek_bytes(OPJ_OFF_T position, void *user) {
    Memory *memory = user;
    if (position < 0 || (uint64_t)position > (memory->writable ? 32 * 1024 * 1024 : memory->size))
        return OPJ_FALSE;
    memory->pos = (size_t)position;
    return OPJ_TRUE;
}

static OPJ_OFF_T skip_bytes(OPJ_OFF_T length, void *user) {
    Memory *memory = user;
    return seek_bytes((OPJ_OFF_T)memory->pos + length, user) ? length : -1;
}

static OPJ_SIZE_T write_bytes(void *buffer, OPJ_SIZE_T length, void *user) {
    Memory *memory = user;
    if (memory->pos > 32 * 1024 * 1024 || length > 32 * 1024 * 1024 - memory->pos)
        return (OPJ_SIZE_T)-1;

    size_t needed = memory->pos + length;
    if (needed > memory->cap) {
        size_t capacity = needed * 2;
        if (capacity > 32 * 1024 * 1024) capacity = 32 * 1024 * 1024;
        void *data = realloc(memory->data, capacity);
        if (!data) return (OPJ_SIZE_T)-1;
        memory->data = data;
        memory->cap = capacity;
    }

    memcpy(memory->data + memory->pos, buffer, length);
    memory->pos += length;
    if (memory->pos > memory->size) memory->size = memory->pos;
    return length;
}

static opj_stream_t *stream(Memory *memory) {
    opj_stream_t *result = opj_stream_create(65536, !memory->writable);
    opj_stream_set_user_data(result, memory, NULL);
    opj_stream_set_user_data_length(result, memory->size);
    opj_stream_set_read_function(result, read_bytes);
    opj_stream_set_write_function(result, write_bytes);
    opj_stream_set_skip_function(result, skip_bytes);
    opj_stream_set_seek_function(result, seek_bytes);
    return result;
}

static void quiet(const char *message, void *user) {
    (void)message;
    (void)user;
}

static void handlers(opj_codec_t *codec) {
    opj_set_error_handler(codec, quiet, NULL);
    opj_set_warning_handler(codec, quiet, NULL);
    opj_set_info_handler(codec, quiet, NULL);
}

static int clamp(int value) {
    return value < 0 ? 0 : value > 255 ? 255 : value;
}

static int value(opj_image_comp_t *component, int x, int y) {
    int cx = x / component->dx, cy = y / component->dy;
    if (cx >= (int)component->w) cx = component->w - 1;
    if (cy >= (int)component->h) cy = component->h - 1;
    int result = component->data[cy * component->w + cx];
    if (component->sgnd) result += 1 << (component->prec - 1);
    return clamp((int)((int64_t)result * 255 / ((1 << component->prec) - 1)));
}

int jp2_decode(const unsigned char *bytes, int count) {
    free(pixels);
    pixels = NULL;
    width = height = 0;
    if (count < 2 || count > 16 * 1024 * 1024) return 0;

    Memory memory = {(unsigned char *)bytes, (size_t)count, 0, 0, 0};
    opj_image_t *image = NULL;
    opj_codec_t *codec = opj_create_decompress(bytes[0] == 255 && bytes[1] == 79 ? OPJ_CODEC_J2K : OPJ_CODEC_JP2);
    opj_dparameters_t params;
    opj_set_default_decoder_parameters(&params);
    handlers(codec);
    opj_stream_t *stream_data = stream(&memory);
    int ok = 0;

    if (!opj_setup_decoder(codec, &params) || !opj_read_header(stream_data, codec, &image) || !image) goto done;
    if (image->x0 || image->y0 || image->x1 < 1 || image->y1 < 1 ||
        (uint64_t)image->x1 * image->y1 > 40000000 || image->numcomps < 1 || image->numcomps > 4 ||
        image->color_space == OPJ_CLRSPC_CMYK)
        goto done;

    for (unsigned i = 0; i < image->numcomps; i++) {
        if (!image->comps[i].dx || !image->comps[i].dy || !image->comps[i].w || !image->comps[i].h ||
            image->comps[i].prec < 1 || image->comps[i].prec > 16 ||
            (uint64_t)image->comps[i].w * image->comps[i].h > 40000000)
            goto done;
    }

    if (!opj_decode(codec, stream_data, image) || !opj_end_decompress(codec, stream_data)) goto done;
    width = image->x1;
    height = image->y1;
    pixels = malloc((size_t)width * height * 4);
    if (!pixels) goto done;

    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            int r = value(&image->comps[0], x, y), g = r, b = r, a = 255;
            if (image->numcomps >= 3) {
                g = value(&image->comps[1], x, y);
                b = value(&image->comps[2], x, y);
                if (image->color_space == OPJ_CLRSPC_SYCC) {
                    int cb = g - 128, cr = b - 128;
                    g = clamp(r - .344136 * cb - .714136 * cr);
                    b = clamp(r + 1.772 * cb);
                    r = clamp(r + 1.402 * cr);
                }
            }
            if (image->numcomps == 4)
                a = value(&image->comps[3], x, y);
            else if (image->numcomps == 2)
                a = value(&image->comps[1], x, y);
            size_t p = ((size_t)y * width + x) * 4;
            pixels[p] = r;
            pixels[p + 1] = g;
            pixels[p + 2] = b;
            pixels[p + 3] = a;
        }
    }
    ok = 1;

done:
    if (image) opj_image_destroy(image);
    opj_stream_destroy(stream_data);
    opj_destroy_codec(codec);
    if (!ok) {
        free(pixels);
        pixels = NULL;
        width = height = 0;
    }
    return ok;
}

int jp2_width() { return width; }
int jp2_height() { return height; }
const unsigned char *jp2_pixels() { return pixels; }

int jp2_encode(const unsigned char *rgba, int w, int h, float ratio) {
    free(encoded.data);
    memset(&encoded, 0, sizeof(encoded));
    encoded.writable = 1;
    if (!rgba || w < 2 || h < 2 || (uint64_t)w * h > 40000000 || ratio < 1 || ratio > 1000) return 0;

    opj_image_cmptparm_t cp[3];
    memset(cp, 0, sizeof(cp));
    for (int i = 0; i < 3; i++) {
        cp[i].dx = cp[i].dy = 1;
        cp[i].w = w;
        cp[i].h = h;
        cp[i].prec = 8;
    }
    opj_image_t *image = opj_image_create(3, cp, OPJ_CLRSPC_SRGB);
    if (!image) return 0;
    image->x1 = w;
    image->y1 = h;
    for (int i = 0; i < w * h; i++) {
        for (int c = 0; c < 3; c++) image->comps[c].data[i] = rgba[i * 4 + c];
    }

    opj_cparameters_t params;
    opj_set_default_encoder_parameters(&params);
    params.tcp_numlayers = 1;
    params.tcp_rates[0] = ratio == 1 ? 0 : ratio;
    params.cp_disto_alloc = 1;
    params.tcp_mct = 1;
    params.irreversible = ratio > 1;
    params.numresolution = 1;
    int min = w < h ? w : h;
    while (params.numresolution < 6 && min >= 2) {
        params.numresolution++;
        min /= 2;
    }

    opj_codec_t *codec = opj_create_compress(OPJ_CODEC_JP2);
    handlers(codec);
    opj_stream_t *stream_data = stream(&encoded);
    int ok = opj_setup_encoder(codec, &params, image) && opj_start_compress(codec, image, stream_data) &&
             opj_encode(codec, stream_data) && opj_end_compress(codec, stream_data);

    opj_stream_destroy(stream_data);
    opj_destroy_codec(codec);
    opj_image_destroy(image);
    if (!ok) {
        free(encoded.data);
        memset(&encoded, 0, sizeof(encoded));
        return 0;
    }
    return encoded.size;
}

const unsigned char *jp2_file() { return encoded.data; }
