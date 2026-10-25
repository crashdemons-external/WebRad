/** Named compatibility setups for existing native modes. */
export class FormatPresets {
    /**
     * Create a compatibility preset while preserving the native codec mode and usual saved ID.
     * @param {Object} base Native catalog entry retained by the preset.
     * @param {string} suffix Preset ID suffix; empty retains the usual native ID.
     * @param {string} name Preset display name.
     * @param {Object} presetSettings Setting overrides selecting the preset.
     * @param {string} presetDescription Standalone description of this compatibility setup.
     * @param {Object} capabilities Optional encode/decode capability overrides.
     * @returns {Object} Preset entry preserving the native mode.
     */
    static preset(base, suffix, name, presetSettings, presetDescription, capabilities = {}) {
        return {
            ...base,
            ...capabilities,
            id: suffix ? `${base.id}-${suffix}` : base.id,
            nativeName: base.name,
            name,
            presetSettings,
            presetDescription
        };
    }
    /**
     * Restrict a preset's capabilities to text by removing picture directions.
     * @param {Object} base Native catalog entry retained by the preset.
     * @returns {Object} Text-only capability overrides.
     */
    static textOnly(base) {
        return {
            inputs: base.inputs.filter((type) => type !== 'picture'),
            outputs: base.outputs.filter((type) => type !== 'picture'),
            imageTx: false
        };
    }
    /**
     * Restrict a preset's capabilities to supported picture directions.
     * @param {Object} base Native catalog entry retained by the preset.
     * @returns {Object} Picture-only capability overrides.
     */
    static pictureOnly(base) {
        return {
            inputs: base.inputs.filter((type) => type === 'picture'),
            outputs: base.outputs.filter((type) => type === 'picture')
        };
    }
    /**
     * Define common teletype baud, tone-spacing and character-code combinations.
     * @param {Object} base Native catalog entry retained by the preset.
     * @returns {Object[]} Common RTTY compatibility presets.
     */
    static rttyPresets(base) {
        // Baud/shift values are indexes into the native fldigi tables. Custom shift
        // is needed for the 450 Hz weather service; Baudot uses 1.5 stop bits.
        const profiles = [
            ['', 'RTTY 45 · 45.45 baud / 170 Hz · Baudot (usual)', 1, 3, 170, 0],
            ['50-170', 'RTTY 50 · 50 baud / 170 Hz · Baudot', 2, 3, 170, 0],
            ['75-170', 'RTTY 75N · 75 baud / 170 Hz · Baudot', 4, 3, 170, 0],
            ['75-850', 'RTTY 75W · 75 baud / 850 Hz · Baudot', 4, 9, 850, 0],
            ['50-425', 'RTTY 50 · 50 baud / 425 Hz · Baudot', 2, 8, 425, 0],
            ['50-450', 'RTTY weather · 50 baud / 450 Hz · Baudot', 2, 10, 450, 0],
            ['50-85', 'RTTY weather · 50 baud / 85 Hz · Baudot', 2, 1, 85, 0],
            ['100-850', 'RTTY 100 · 100 baud / 850 Hz · Baudot', 5, 9, 850, 0],
            ['110-ascii7', 'RTTY ASCII · 110 baud / 170 Hz · 7-bit', 6, 3, 170, 1],
            ['300-ascii8', 'RTTY ASCII · 300 baud / 170 Hz · 8-bit', 9, 3, 170, 2]
        ];
        const bauds = [45, 45.45, 50, 56, 75, 100, 110, 150, 200, 300];
        return profiles.map(([suffix, name, baud, shift, hz, bits]) =>
            FormatPresets.preset(
                base,
                suffix,
                name,
                {
                    rttyBaud: baud,
                    rttyShift: shift,
                    ...(shift === 10 ? { rttyCustomShift: hz } : {}),
                    rttyBits: bits,
                    rttyParity: 0,
                    rttyStop: bits ? 0 : 1
                },
                FormatPresets.rttyDescription(bauds[baud], hz, bits)
            )
        );
    }
    /** Describe the character format and tone spacing of an RTTY preset. */
    static rttyDescription(baud, shift, bits) {
        const characterFormat = bits
            ? `${bits === 1 ? '7' : '8'}-bit ASCII characters, no parity check, and one stop bit`
            : '5-bit Baudot characters, no parity check, and 1.5 stop bits';
        return `This radio-teletype (RTTY) preset carries text at ${baud} symbols per second using two audio tones ${shift} Hz apart. It uses ${characterFormat}. Match these settings and the tone frequency to the recording; other combinations remain available in Advanced.`;
    }
    /**
     * Define usual Morse sending-speed presets for the existing native mode.
     * @param {Object} base Native catalog entry retained by the preset.
     * @returns {Object[]} Morse speed presets.
     */
    static cwPresets(base) {
        return [18, 5, 12, 25, 35].map((speed) =>
            FormatPresets.preset(
                base,
                speed === 18 ? '' : `speed-${speed}`,
                `Morse · ${speed} words/minute${speed === 18 ? ' (usual)' : ''}`,
                { cwSpeed: speed },
                `This Morse-code preset sends letters, numbers, and punctuation as short and long tones at ${speed} words per minute. The receiver starts at this speed and follows speed changes automatically. Match the tone frequency to the recording.`
            )
        );
    }
    /**
     * Define FSQ text speeds and picture geometries with standalone compatibility guidance.
     * @param {Object} base Native catalog entry retained by the preset.
     * @returns {Object[]} FSQ text and picture presets.
     */
    static fsqPresets(base) {
        const usual = FormatPresets.preset(
            base,
            '',
            'FSQ-3 · 320 × 240 color (usual)',
            { fsqBaud: 3, fsqImageSize: 1 },
            'FSQ-3 carries typed radio messages with audio tones and sender identification. This preset also sends 320 × 240 color pictures. FSQ picture headers use the FSQ-3 speed; picture dimensions are detected from the header. Match the tone frequency to the recording.'
        );
        const speeds = [1.5, 2, 4.5, 6].map((speed) =>
            FormatPresets.preset(
                base,
                `speed-${String(speed).replace('.', '-')}`,
                `FSQ-${speed} · text`,
                { fsqBaud: speed },
                `FSQ-${speed} carries typed radio messages with audio tones and sender identification. Sender and receiver must use the FSQ-${speed} text-speed setting. For FSQ picture reception, select an FSQ-3 picture preset.`,
                FormatPresets.textOnly(base)
            )
        );
        const sizes = [
            [0, 160, 120, 'color'],
            [2, 640, 480, 'grayscale'],
            [3, 640, 480, 'color'],
            [4, 240, 300, 'color'],
            [5, 240, 300, 'grayscale'],
            [6, 120, 150, 'color'],
            [7, 120, 150, 'grayscale']
        ];
        const pictures = sizes.map(([size, width, height, color]) =>
            FormatPresets.preset(
                base,
                `picture-${size}`,
                `FSQ picture · ${width} × ${height} ${color}`,
                { fsqBaud: 3, fsqImageSize: size },
                `This FSQ picture preset sends a ${width} × ${height} ${color} image using audio tones and sender identification. Reception uses the FSQ-3 header speed and detects picture dimensions from the header. Match the tone frequency to the recording.`,
                FormatPresets.pictureOnly(base)
            )
        );
        return [usual, ...speeds, ...pictures];
    }
    /**
     * Define IFKP text speeds and picture geometry/color presets.
     * @param {Object} base Native catalog entry retained by the preset.
     * @returns {Object[]} IFKP text and picture presets.
     */
    static ifkpPresets(base) {
        const usual = FormatPresets.preset(
            base,
            '',
            'IFKP 1.0× · 160 × 120 color (usual)',
            { ifkpBaud: 1, imageSize: 3, imageColor: 'color' },
            'IFKP 1.0× carries typed text at its normal sending speed and also sends pictures with audio tones. This preset sends 160 × 120 color pictures. Match the text-speed setting and tone frequency; picture dimensions are detected from the header.'
        );
        const speeds = [
            [0, '0.5×', 'half'],
            [2, '2.0×', 'double']
        ].map(([speed, label, word]) =>
            FormatPresets.preset(
                base,
                `speed-${speed}`,
                `IFKP ${label} · ${word} speed text`,
                { ifkpBaud: speed },
                `IFKP ${label} carries typed radio messages with a sequence of audio tones at ${word} the normal IFKP sending speed. Match the IFKP ${label} text-speed setting and tone frequency to the recording.`,
                FormatPresets.textOnly(base)
            )
        );
        const pictures = [];
        for (const [size, width, height] of [
            [0, 59, 74],
            [1, 120, 150],
            [2, 240, 300],
            [3, 160, 120],
            [4, 320, 240],
            [5, 640, 480]
        ]) {
            for (const color of ['color', 'gray']) {
                if (size === 3 && color === 'color') continue;
                const label = color === 'gray' ? 'grayscale' : 'color';
                pictures.push(
                    FormatPresets.preset(
                        base,
                        `picture-${size}-${color}`,
                        `IFKP picture · ${width} × ${height} ${label}`,
                        { ifkpBaud: 1, imageSize: size, imageColor: color },
                        `This IFKP picture preset sends a ${width} × ${height} ${label} image as a sequence of audio tones, with a normal-speed IFKP header. The receiver detects picture dimensions from the header. Match the tone frequency to the recording.`,
                        FormatPresets.pictureOnly(base)
                    )
                );
            }
        }
        return [usual, ...speeds, ...pictures];
    }
    /**
     * Define keypad tone/gap timing presets for the existing DTMF modem.
     * @param {Object} base Native catalog entry retained by the preset.
     * @returns {Object[]} DTMF timing presets.
     */
    static keypadPresets(base) {
        return [
            [50, 50, 'usual'],
            [100, 100, 'slower'],
            [250, 100, 'long tones']
        ].map(([tone, gap, label], index) =>
            FormatPresets.preset(
                base,
                index ? `timing-${tone}-${gap}` : '',
                `Keypad tones · ${tone} ms / ${gap} ms (${label})`,
                { dtmfToneMs: tone, dtmfGapMs: gap },
                `Dual-tone multi-frequency (DTMF) signaling carries phone keypad digits and symbols as pairs of tones. This preset generates ${tone}-millisecond tones with ${gap}-millisecond pauses. The receiver detects keys automatically; these timing settings control generation.`
            )
        );
    }
    /**
     * Enumerate all HAMDRM transport profiles with their native compatibility controls.
     * @param {Object} base Native catalog entry retained by the preset.
     * @returns {Object[]} All HAMDRM transport profiles.
     */
    static digitalPresets(base) {
        const profiles = [];
        // All 72 combinations are supported by the supplied QSSTV core. Put the
        // existing E/2.5 kHz/16-QAM/high/long setup first and keep its original ID.
        for (const mode of [2, 0, 1])
            for (const bandwidth of [1, 0])
                for (const qam of [1, 0, 2])
                    for (const protection of [0, 1])
                        for (const interleave of [0, 1]) {
                            const usual =
                                mode === 2 && bandwidth === 1 && qam === 1 && protection === 0 && interleave === 0;
                            const robustness = ['A', 'B', 'E'][mode],
                                khz = bandwidth ? '2.5' : '2.2',
                                points = [4, 16, 64][qam];
                            const protect = protection ? 'Normal' : 'High',
                                spread = interleave ? 'Short' : 'Long';
                            profiles.push(
                                FormatPresets.preset(
                                    base,
                                    usual ? '' : `profile-${mode}${bandwidth}${qam}${protection}${interleave}`,
                                    `HAMDRM ${robustness} / ${khz} kHz / ${points}-QAM / ${protect} / ${spread}${usual ? ' (usual)' : ''}`,
                                    {
                                        drmMode: mode,
                                        drmBandwidth: bandwidth,
                                        drmQam: qam,
                                        drmProtection: protection,
                                        drmInterleave: interleave,
                                        rs: 2
                                    },
                                    `This HAMDRM file-transfer preset uses robustness mode ${robustness}, ${khz} kHz of audio bandwidth, ${points}-QAM data encoding, ${protect.toLowerCase()} channel error protection, and ${spread.toLowerCase()} spreading of data over time. File recovery protection starts at RS2 and can be adjusted in Advanced. The receiver detects the transmitted transport profile automatically.`
                                )
                            );
                        }
        return profiles;
    }
    /**
     * Expand native catalog entries into named presets in their established order.
     * @param {Object[]} formats Ordered native or expanded catalog entries.
     * @returns {Object[]} Expanded catalog preserving native order.
     */
    static expandPresets(formats) {
        return formats.flatMap((format) => {
            if (format.engine === 'drm') return FormatPresets.digitalPresets(format);
            if (format.engine !== 'fldigi') return [format];
            const build = {
                RTTY: FormatPresets.rttyPresets.bind(FormatPresets),
                CW: FormatPresets.cwPresets.bind(FormatPresets),
                FSQ: FormatPresets.fsqPresets.bind(FormatPresets),
                IFKP: FormatPresets.ifkpPresets.bind(FormatPresets),
                DTMF: FormatPresets.keypadPresets.bind(FormatPresets)
            }[format.family];
            return build ? build(format) : [format];
        });
    }
}
export const expandPresets = FormatPresets.expandPresets.bind(FormatPresets);
