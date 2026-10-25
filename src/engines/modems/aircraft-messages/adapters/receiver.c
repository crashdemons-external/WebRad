#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "acarsdec.h"
#include "acars.h"
#include "msk.h"
runtime_t R;
extern void wr_aircraft_message(const char *message, int length);
void outputmsg(msgblk_t *block) {
    char message[320];
    int length = snprintf(message, sizeof(message), "Aircraft %.7s · mode %c · label %.2s · block %c: ", block->txt.d.addr, block->txt.d.mode, block->txt.d.label, block->txt.d.bid);
    int offset = offsetof(struct txtdata_s, text);
    for (int i = offset; i < block->txtlen && length < 318; i++) {
        unsigned char value = block->txt.raw[i];
        if (value >= 32 && value < 127) message[length++] = value;
        else if (value == '\n' || value == '\r') message[length++] = '\n';
    }
    message[length++] = '\n';
    wr_aircraft_message(message, length);
}
int wr_aircraft_decode(const float *samples, int length) {
    channel_t channel;
    memset(&channel, 0, sizeof(channel));
    memset(&R, 0, sizeof(R));
    R.channels = &channel;
    R.nbch = 1;
    if (initMsk(&channel)) return -1;
    initAcars(&channel);
    for (int at = 0; at < length; at += 1024) {
        int count = length - at < 1024 ? length - at : 1024;
        channel.dm_buffer = (float *)(samples + at);
        demodMSK(&channel, count);
    }
    free(channel.inb);
    free(channel.blk);
    return 0;
}
