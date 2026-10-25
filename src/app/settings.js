import { AdditionalFormats } from './additional-formats.js';
import { defaults as modemDefaults } from '../runtime/engines/multimode/configuration.js';
/** Format-specific control definitions, defaults, validation and saved-setting migration. */
export class SettingsRegistry {
    /**
     * Define a bounded numeric control with its label, default, step and optional guidance.
     * @param {string} key Stable setting key used in saved controls.
     * @param {string} label Control label.
     * @param {*} value Default setting value.
     * @param {number} min Smallest accepted control value.
     * @param {number} max Largest accepted control value.
     * @param {number} step Numeric control increment.
     * @param {string} help Plain-language compatibility guidance.
     * @returns {Object} Numeric control descriptor.
     */
    static numberField(key, label, value, min, max, step = 1, help = '') {
        return { key, label, value, type: 'number', min, max, step, help };
    }
    /**
     * Define a boolean control with its label, default and optional guidance.
     * @param {string} key Stable setting key used in saved controls.
     * @param {string} label Control label.
     * @param {*} value Default setting value.
     * @param {string} help Plain-language compatibility guidance.
     * @returns {Object} Boolean control descriptor.
     */
    static booleanField(key, label, value, help = '') {
        return { key, label, value, type: 'checkbox', help };
    }
    /**
     * Define a text control with its label, default and optional guidance.
     * @param {string} key Stable setting key used in saved controls.
     * @param {string} label Control label.
     * @param {*} value Default setting value.
     * @param {string} help Plain-language compatibility guidance.
     * @returns {Object} Text control descriptor.
     */
    static textField(key, label, value, help = '') {
        return { key, label, value, type: 'text', help };
    }
    /**
     * Define a choice control and normalize its value/label pairs.
     * @param {string} key Stable setting key used in saved controls.
     * @param {string} label Control label.
     * @param {*} value Default setting value.
     * @param {Array} choices Allowed values or value/label pairs.
     * @param {string} help Plain-language compatibility guidance.
     * @returns {Object} Select control descriptor with normalized choices.
     */
    static selectField(key, label, value, choices, help = '') {
        return {
            key,
            label,
            value,
            type: 'select',
            choices: choices.map((c, i) => (Array.isArray(c) ? c : [i, c])),
            help
        };
    }
    /**
     * Group related controls under a human-readable Advanced heading.
     * @param {string} title Group heading.
     * @param {Object[]} fields Related control descriptors.
     * @returns {Object} Heading and grouped control descriptors.
     */
    static controlGroup(title, fields) {
        return { title, fields };
    }
    /** Recording channel, gain, range, pacing and clock-correction controls. */
    static inputFields = [
        SettingsRegistry.selectField(
            'channel',
            'Recording channel',
            'left',
            [
                ['left', 'Left / mono'],
                ['right', 'Right'],
                ['mix', 'Mix channels']
            ],
            'Choose the channel carrying the signal. Mixing can cancel signals recorded with opposite phase.'
        ),
        SettingsRegistry.numberField(
            'inputGain',
            'Input gain (dB)',
            0,
            -40,
            40,
            1,
            'Increase a quiet recording; avoid clipping.'
        ),
        SettingsRegistry.booleanField('invertInput', 'Invert sample polarity', false),
        SettingsRegistry.numberField(
            'rxPpm',
            'Recording clock correction (ppm)',
            0,
            -5000,
            5000,
            1,
            'Correct a known sample-clock error before decoding.'
        ),
        SettingsRegistry.numberField(
            'frequencyShift',
            'Shift the whole signal (Hz)',
            0,
            -3000,
            3000,
            1,
            'Moves the recorded tones. Useful when a receiver expects fixed audio frequencies.'
        ),
        SettingsRegistry.numberField(
            'startSeconds',
            'Start at (seconds)',
            0,
            0,
            1800,
            0.01,
            'Skip leading material; decoding starts with fresh modem state.'
        ),
        SettingsRegistry.numberField('endSeconds', 'Stop at (seconds; 0 = end)', 0, 0, 1800, 0.01),
        SettingsRegistry.booleanField(
            'paced',
            'Decode alongside playback',
            false,
            'Fast decoding is the default. This option waits for the recording clock and plays the audio.'
        )
    ];
    /** Shared text-modem tuning controls. */
    static tuning = [
        SettingsRegistry.numberField('frequency', 'Signal center / tone frequency (Hz)', 1500, 0, 4000),
        SettingsRegistry.selectField('sideband', 'Signal orientation', 'USB', [
            ['USB', 'Normal / upper sideband'],
            ['LSB', 'Lower sideband']
        ]),
        SettingsRegistry.booleanField('afc', 'Follow small pitch changes (AFC)', true),
        SettingsRegistry.booleanField('reverse', 'Reverse tone order', false),
        SettingsRegistry.booleanField('sql', 'Ignore signals below the threshold', false),
        SettingsRegistry.numberField('squelch', 'Signal threshold', 3, 0, 100),
        SettingsRegistry.numberField('lowCutoff', 'Low frequency limit (Hz)', 0, 0, 500),
        SettingsRegistry.numberField('highCutoff', 'High frequency limit (Hz)', 4000, 3500, 4000)
    ];
    /** Morse timing and receive controls. */
    static cw = [
        SettingsRegistry.numberField('cwSpeed', 'Morse speed (words/minute)', 18, 5, 100),
        SettingsRegistry.numberField('cwBandwidth', 'Receive filter width (Hz)', 150, 20, 1000),
        SettingsRegistry.booleanField('cwTrack', 'Follow changing Morse speed', true),
        SettingsRegistry.booleanField('cwMatched', 'Use matched receive filter', false),
        SettingsRegistry.numberField('cwRange', 'Speed tracking range (words/minute)', 10, 1, 40),
        SettingsRegistry.numberField('cwMin', 'Minimum tracked speed', 5, 5, 50),
        SettingsRegistry.numberField('cwMax', 'Maximum tracked speed', 50, 5, 100),
        SettingsRegistry.selectField('cwFilter', 'Receive filter', 2, ['40 Hz', '70 Hz', '100 Hz']),
        SettingsRegistry.booleanField('cwSom', 'Use alternative Morse detector', false)
    ];
    /** Teletype compatibility and decoding controls. */
    static rtty = [
        SettingsRegistry.selectField('rttyShift', 'Distance between tones', 3, [
            '23 Hz',
            '85 Hz',
            '160 Hz',
            '170 Hz',
            '182 Hz',
            '200 Hz',
            '240 Hz',
            '350 Hz',
            '425 Hz',
            '850 Hz',
            'Custom'
        ]),
        SettingsRegistry.numberField('rttyCustomShift', 'Custom tone distance (Hz)', 450, 1, 2000),
        SettingsRegistry.selectField('rttyBaud', 'Symbol speed', 1, [
            '45',
            '45.45',
            '50',
            '56',
            '75',
            '100',
            '110',
            '150',
            '200',
            '300'
        ]),
        SettingsRegistry.selectField('rttyBits', 'Character encoding', 0, [
            '5-bit Baudot',
            '7-bit ASCII',
            '8-bit ASCII'
        ]),
        SettingsRegistry.selectField('rttyParity', 'Parity check', 0, ['None', 'Even', 'Odd', 'Zero', 'One']),
        SettingsRegistry.selectField('rttyStop', 'Stop bits', 1, ['1', '1.5', '2']),
        SettingsRegistry.selectField('rttyAfcSpeed', 'Pitch tracking speed', 1, ['Slow', 'Normal', 'Fast']),
        SettingsRegistry.booleanField('lowercase', 'Display received text in lower case', false)
    ];
    /** Slow-scan picture synchronization, detection and manual-correction controls. */
    static sstv = [
        SettingsRegistry.booleanField('sstvAfc', 'Follow small pitch changes (AFC)', true),
        SettingsRegistry.booleanField('sstvLms', 'Adaptive noise filter (LMS)', false),
        SettingsRegistry.selectField('sstvBpf', 'Band-pass filter', 1, ['Off', 'Wide', 'Narrow', 'Very narrow']),
        SettingsRegistry.selectField('sstvDemod', 'Tone detector', 2, [
            [2, 'Hilbert (usual)'],
            [0, 'Phase-locked loop (PLL)'],
            [1, 'Zero crossings']
        ]),
        SettingsRegistry.selectField('sstvSense', 'Sync sensitivity', 1, [
            [0, 'Low'],
            [1, 'Normal'],
            [2, 'High'],
            [3, 'Very high']
        ]),
        SettingsRegistry.booleanField('sstvStop', 'Stop automatically at image end', true),
        SettingsRegistry.booleanField('sstvSync', 'Align image lines automatically', true),
        SettingsRegistry.booleanField(
            'sstvSlant',
            'Correct clock slant automatically',
            false,
            'Try this for a gradually leaning picture. If it introduces horizontal jumps, turn it off and decode again, then use Straighten picture below.'
        ),
        SettingsRegistry.booleanField('sstvLock', 'Lock the selected picture format', false),
        SettingsRegistry.booleanField('sstvDiff', 'Differentiate the input signal', false),
        SettingsRegistry.booleanField('sstvFsk', 'Read sender identification (FSK ID)', true),
        SettingsRegistry.selectField('fftGain', 'Signal display gain', 0, ['Normal', 'Higher', 'High', 'Maximum']),
        SettingsRegistry.numberField(
            'slantPpm',
            'Straighten picture (ppm)',
            0,
            -20000,
            20000,
            1,
            'Redraw from retained signal after decoding.'
        ),
        SettingsRegistry.numberField(
            'phasePixels',
            'Shift picture start (pixels)',
            0,
            -8192,
            8192,
            0.1,
            'Horizontal phase measured against a complete scan line, including synchronization.'
        )
    ];
    /** Weather-fax start, phasing and manual reception controls. */
    static fax = [
        SettingsRegistry.selectField('wefaxLpm', 'Scan speed (lines/minute)', 1, ['240', '120', '90', '60']),
        SettingsRegistry.booleanField('faxAfc', 'Follow carrier pitch (AFC)', true),
        SettingsRegistry.numberField('faxFrequency', 'Carrier frequency (Hz)', 1900, 1500, 2300),
        SettingsRegistry.booleanField(
            'faxManual',
            'Recording starts inside the picture',
            false,
            'Skip start and phasing sequences for partial recordings.'
        ),
        SettingsRegistry.booleanField('faxAuto', 'Detect start and phasing', true)
    ];
    /** HAMDRM transport and file-recovery controls. */
    static digital = [
        SettingsRegistry.selectField('drmMode', 'Signal robustness', 2, ['A', 'B', 'E']),
        SettingsRegistry.selectField('drmBandwidth', 'Audio bandwidth', 1, ['2.2 kHz', '2.5 kHz']),
        SettingsRegistry.selectField('drmQam', 'Data modulation', 1, ['4-QAM', '16-QAM', '64-QAM']),
        SettingsRegistry.selectField('drmProtection', 'Channel protection', 0, ['High', 'Normal']),
        SettingsRegistry.selectField('drmInterleave', 'Spread data across time', 0, [
            'Long interleaving',
            'Short interleaving'
        ]),
        SettingsRegistry.selectField(
            'rs',
            'File recovery protection',
            2,
            ['None', 'RS1', 'RS2', 'RS3', 'RS4'],
            'Higher protection adds more recovery data and audio duration.'
        ),
        SettingsRegistry.textField('callsign', 'Sender callsign', 'NOCALL'),
        SettingsRegistry.selectField('imageEncoding', 'Picture file encoding', 'png', [
            ['png', 'PNG'],
            ['jpeg', 'JPEG'],
            ['jp2', 'JPEG 2000']
        ]),
        SettingsRegistry.numberField('jpegQuality', 'JPEG quality', 0.9, 0.1, 1, 0.05),
        SettingsRegistry.numberField(
            'jp2Ratio',
            'JPEG 2000 compression ratio',
            8,
            1,
            100,
            1,
            '1 is lossless; larger values create smaller files.'
        )
    ];
    /** Packet-radio modulation, framing and receiver controls. */
    static packet = [
        SettingsRegistry.numberField('packetMark', 'Mark tone (Hz)', 1200, 100, 10000),
        SettingsRegistry.numberField('packetSpace', 'Space tone (Hz)', 2200, 100, 10000),
        SettingsRegistry.numberField('packetBaud', 'Bits per second', 1200, 50, 38400),
        SettingsRegistry.textField(
            'packetProfiles',
            'Decoder profile',
            '',
            'Leave empty for Dire Wolf’s mode default; e.g. A or A+.'
        ),
        SettingsRegistry.selectField('packetFix', 'Repair damaged packet bits', 0, [
            'None',
            'Single bit',
            'Adjacent double',
            'Adjacent triple',
            'Two separated bits'
        ]),
        SettingsRegistry.booleanField(
            'packetPassall',
            'Include packets with failed checksums',
            false,
            'These packets are not verified and can contain errors.'
        ),
        SettingsRegistry.selectField('packetV26', '2400-bit phase mapping', 2, [
            [1, 'Alternative A'],
            [2, 'MFJ compatible (B)']
        ]),
        SettingsRegistry.selectField('packetFec', 'Transmit framing', 0, ['AX.25', 'FX.25', 'IL2P']),
        SettingsRegistry.selectField('packetFx', 'FX.25 parity strength', 1, [
            [1, 'Automatic'],
            [16, '16 bytes'],
            [32, '32 bytes'],
            [64, '64 bytes']
        ]),
        SettingsRegistry.booleanField('packetMaxFec', 'Use maximum IL2P protection', true),
        SettingsRegistry.booleanField('packetInvert', 'Invert IL2P output polarity', false),
        SettingsRegistry.numberField('packetDelay', 'Leading synchronization (ms)', 300, 10, 3000),
        SettingsRegistry.numberField('packetTail', 'Ending synchronization (ms)', 100, 10, 3000)
    ];
    /** FT timing and search controls. */
    static weak = [
        SettingsRegistry.numberField('frequency', 'Lowest transmit tone (Hz)', 1000, 100, 3500),
        SettingsRegistry.numberField('ftOffset', 'Transmit start within slot (seconds)', 0.5, 0, 2, 0.01),
        SettingsRegistry.numberField('ftLow', 'Search below (Hz)', 200, 0, 3500),
        SettingsRegistry.numberField('ftHigh', 'Search up to (Hz)', 3000, 100, 4000),
        SettingsRegistry.numberField('ftCandidates', 'Candidate signals to examine', 120, 1, 500),
        SettingsRegistry.numberField('ftScore', 'Minimum synchronization score', 10, 0, 100),
        SettingsRegistry.numberField('ftIterations', 'Error-correction iterations', 25, 1, 100),
        SettingsRegistry.numberField(
            'ftSlotOffset',
            'First slot starts at (seconds)',
            0,
            0,
            15,
            0.01,
            'Align long recordings with their 15-second FT8 or 7.5-second FT4 slots.'
        )
    ];
    /** Sound-message compatibility and detector controls. */
    static sound = [
        SettingsRegistry.numberField('ggPayload', 'Fixed message length (0 = variable)', 0, 0, 140),
        SettingsRegistry.booleanField('ggDss', 'Scramble payload with DSS', false),
        SettingsRegistry.numberField('ggThreshold', 'Sound-marker threshold', 3, 0.1, 100, 0.1),
        SettingsRegistry.selectField('ggFrame', 'Samples per analysis frame', 1024, [
            [256, '256'],
            [512, '512'],
            [1024, '1024'],
            [2048, '2048']
        ]),
        SettingsRegistry.numberField('ggFreq', 'First tone bin (-1 = preset)', -1, -1, 1000),
        SettingsRegistry.numberField('ggVolume', 'Generated signal level (%)', 25, 1, 100)
    ];
    /** Pager and signaling compatibility controls. */
    static signaling = [
        SettingsRegistry.selectField('pagerMode', 'Pager message interpretation', 0, [
            'Standard',
            'Numbers',
            'Letters',
            'Skyper',
            'Automatic'
        ]),
        SettingsRegistry.booleanField('pagerInvert', 'Invert pager input', false),
        SettingsRegistry.selectField('pagerPolarity', 'Pager polarity', 0, [
            'Automatic',
            'Normal only',
            'Inverted only'
        ]),
        SettingsRegistry.numberField('pagerCorrection', 'Pager bit correction', 2, 0, 2),
        SettingsRegistry.booleanField('pagerPartial', 'Show incomplete pager messages', false),
        SettingsRegistry.booleanField('pagerPrune', 'Discard unlikely pager text', false),
        SettingsRegistry.booleanField('pagerEmpty', 'Discard empty messages', false),
        SettingsRegistry.numberField('pagerAddress', 'Pager address / capcode', 123456, 0, 2097151),
        SettingsRegistry.numberField('pagerFunction', 'Pager message function', 3, 0, 3),
        SettingsRegistry.numberField('signalDuration', 'Tone duration (ms)', 100, 10, 5000),
        SettingsRegistry.numberField('signalGap', 'Tone gap (ms)', 50, 0, 5000),
        SettingsRegistry.numberField('mmDit', 'Morse dot length (ms)', 50, 5, 500),
        SettingsRegistry.numberField('mmGap', 'Morse gap length (ms)', 50, 5, 1000),
        SettingsRegistry.numberField('mmThreshold', 'Morse detector threshold', 500, 1, 32767),
        SettingsRegistry.booleanField('mmFixedThreshold', 'Disable automatic Morse threshold', false),
        SettingsRegistry.booleanField('mmFixedTiming', 'Disable automatic Morse timing', false)
    ];
    /** Codec2 and FreeDV speech compatibility controls. */
    static voice = [
        SettingsRegistry.booleanField('voiceSquelch', 'Mute undecoded modem noise', true),
        SettingsRegistry.numberField('voiceSnr', 'Minimum voice signal/noise (dB)', 0, -10, 30, 0.5),
        SettingsRegistry.selectField('voiceSync', 'Synchronization behavior', 1, [
            [1, 'Automatic'],
            [2, 'Keep lock until manually reset']
        ]),
        SettingsRegistry.booleanField('voiceEq', 'Enable decoder equalizer', true),
        SettingsRegistry.booleanField('voiceClip', 'Limit transmit peaks', true),
        SettingsRegistry.booleanField('voiceBpf', 'Filter transmitted voice signal', true),
        SettingsRegistry.booleanField('codecGray', 'Use Gray-coded speech bits', true),
        SettingsRegistry.booleanField('codecPost', 'Use speech post-filter', true),
        SettingsRegistry.booleanField('codecEq', '700C speech equalizer', true)
    ];
    /** Raw-radio representation and sensor detector controls. */
    static sensor = [
        SettingsRegistry.selectField('sensorInput', 'Recording representation', 'cu8', [
            ['cu8', 'Unsigned 8-bit I/Q (.cu8)'],
            ['cs16', 'Signed 16-bit I/Q (.cs16)'],
            ['cf32', 'Float 32-bit I/Q (.cf32)'],
            ['pulses', 'Pulse/gap durations (.json / .ook)'],
            ['am', 'Signed 16-bit AM envelope (.am)'],
            ['fm', 'Signed 16-bit FM baseband (.fm)']
        ]),
        SettingsRegistry.numberField('sensorRate', 'Radio sample rate (samples/sec)', 250000, 8000, 4000000),
        SettingsRegistry.selectField('sensorModulation', 'Pulse modulation', 0, [
            'On/off carrier (OOK)',
            'Two-frequency carrier (FSK)'
        ]),
        SettingsRegistry.selectField('sensorDetector', 'Frequency pulse detector', 2, ['Original', 'New', 'Automatic']),
        SettingsRegistry.numberField('sensorLevel', 'Fixed high level (dB; 0 = automatic)', 0, -60, 0, 0.5),
        SettingsRegistry.numberField('sensorMin', 'Minimum high level (dB)', -12, -60, 0, 0.5),
        SettingsRegistry.numberField('sensorSnr', 'Minimum level separation (dB)', 9, 1, 40, 0.5),
        SettingsRegistry.booleanField('sensorDisabled', 'Try normally disabled protocols', false)
    ];
    /**
     * Return all control groups relevant to a format and encode/decode direction.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @param {string} direction Encode/decode direction determining available controls.
     * @returns {Object[]} Relevant control groups and descriptors.
     */
    static groupsFor(format, direction = 'decode') {
        if (!format) return [];
        const e = format.engine,
            f = format.family === 'Hellschreiber' ? 'HELL' : format.family?.toUpperCase();
        const groups = e === 'fldigi' ? SettingsRegistry.modemGroups(format, f) : [];
        if (direction === 'decode' && e === 'fldigi' && ['THOR', 'IFKP', 'FSQ'].includes(f))
            groups.push(SettingsRegistry.modemPictureCorrectionGroup());
        groups.push(...SettingsRegistry.engineGroups(format));
        groups.unshift(...SettingsRegistry.directionGroups(format, direction));
        return groups;
    }
    /** Choose shared and family-specific controls for a fldigi mode. */
    static modemGroups(format, family) {
        const groups = family === 'DTMF' ? [] : [SettingsRegistry.controlGroup('Signal tuning', SettingsRegistry.tuning)];
        groups.push(...SettingsRegistry.familyControlGroups(format, family));
        if (format.imageTx) groups.push(SettingsRegistry.pictureTransmitGroup());
        groups.push(SettingsRegistry.identityGroup());
        return groups;
    }
    /** Select the compatibility controls defined for one fldigi family. */
    static familyControlGroups(format, family) {
        switch (family) {
            case 'CW':
                return [SettingsRegistry.controlGroup('Morse code', SettingsRegistry.cw)];
            case 'RTTY':
                return [SettingsRegistry.controlGroup('Teletype compatibility', SettingsRegistry.rtty)];
            case 'PSK':
                return [SettingsRegistry.phaseShiftGroup()];
            case 'DTMF':
                return [SettingsRegistry.keypadToneGroup()];
            case 'HELL':
                return [SettingsRegistry.hellGroup(format)];
            case 'OLIVIA':
            case 'CONTESTIA':
                return SettingsRegistry.multiToneGroups(format, family);
            case 'MT63':
                return [SettingsRegistry.mt63Group()];
            case 'DOMINOEX':
                return [SettingsRegistry.dominoExGroup()];
            case 'IFKP':
                return [SettingsRegistry.ifkpGroup()];
            case 'FSQ':
                return [SettingsRegistry.fsqGroup()];
            default:
                return [];
        }
    }
    /** Build pitch-search controls for phase-shift modes. */
    static phaseShiftGroup() {
        return SettingsRegistry.controlGroup('Phase-shift receiver', [
            SettingsRegistry.numberField('pskSearchRange', 'Pitch search range (Hz)', 50, 10, 500),
            SettingsRegistry.booleanField('showChannels', 'Search multiple text channels', true),
            SettingsRegistry.numberField('channelSquelch', 'Other-channel signal threshold (dB)', -3, -30, 30)
        ]);
    }
    /** Build DTMF tone and receive-threshold controls. */
    static keypadToneGroup() {
        return SettingsRegistry.controlGroup('Keypad tones', [
            SettingsRegistry.numberField('dtmfToneMs', 'Tone length (ms)', 50, 40, 2000),
            SettingsRegistry.numberField('dtmfGapMs', 'Gap between tones (ms)', 50, 30, 2000),
            SettingsRegistry.numberField('squelch', 'Receive threshold', 3, 0, 100)
        ]);
    }
    /** Build printed-text controls for Hellschreiber modes. */
    static hellGroup(format) {
        return SettingsRegistry.controlGroup('Printed text / Hellschreiber', [
            SettingsRegistry.selectField('hellAgc', 'Level adjustment', 2, [
                [1, 'Fast'],
                [2, 'Normal'],
                [3, 'Slow']
            ]),
            SettingsRegistry.numberField('hellWidth', 'Printed character width', 2, 1, 4),
            SettingsRegistry.numberField('hellHeight', 'Printed character height', 20, 14, 42),
            SettingsRegistry.numberField(
                'hellBandwidth',
                'Receive bandwidth (Hz)',
                SettingsRegistry.hellBandwidthDefault(format),
                20,
                3000,
                1,
                'Each Hellschreiber mode starts with its native receive bandwidth; change it to tune the filter.'
            ),
            SettingsRegistry.booleanField('hellBlackboard', 'Light text on dark background', false)
        ]);
    }
    /** Return the default receive bandwidth shipped for a Hellschreiber mode. */
    static hellBandwidthDefault(format) {
        const widths = {
            FELDHELL: 245,
            SLOWHELL: 30,
            HELLX5: 1225,
            HELLX9: 2205,
            FSKH245: 250,
            FSKH105: 120,
            HELL80: 450
        };
        return widths[format?.nativeName || format?.name] ?? 245;
    }
    /** Expose native-style phase and clock adjustments for retained modem pictures. */
    static modemPictureCorrectionGroup() {
        return SettingsRegistry.controlGroup('Received picture correction', [
            SettingsRegistry.numberField('picturePhasePixels', 'Shift picture start (channel pixels)', 0, -8192, 8192, 1,
                'Shift the retained scan stream across color channels and rows. Positive values move the picture start later; unavailable pixels remain black.'),
            SettingsRegistry.numberField('pictureSlantPpm', 'Straighten picture (ppm)', 0, -20000, 20000, 1,
                'Correct a leaning image after decoding, without rerunning the recording. Reset both corrections to zero to restore the raw image.')
        ]);
    }
    /** Build optional custom-format and shared weak-signal controls for Olivia or Contestia. */
    static multiToneGroups(format, family) {
        const prefix = family === 'OLIVIA' ? 'olivia' : 'contestia',
            groups = [];
        if (format.name === family) {
            groups.push(
                SettingsRegistry.controlGroup('Custom multi-tone format', [
                    SettingsRegistry.selectField(prefix + 'Bandwidth', 'Bandwidth (Hz)', 2, ['125', '250', '500', '1000', '2000']),
                    SettingsRegistry.selectField(prefix + 'Tones', 'Number of tones', 2, ['2', '4', '8', '16', '32', '64'])
                ])
            );
        }
        groups.push(
            SettingsRegistry.controlGroup('Weak-signal text recovery', [
                SettingsRegistry.numberField(prefix + 'Integration', 'Integration / decoding depth', 4, 1, 8),
                SettingsRegistry.numberField(prefix + 'Margin', 'Sync search margin', 8, 1, 32)
            ])
        );
        return groups;
    }
    /** Build extended-integration controls for MT63. */
    static mt63Group() {
        return SettingsRegistry.controlGroup('MT63 compatibility', [
            SettingsRegistry.booleanField('mt63Integration', 'Long receive integration', false),
            SettingsRegistry.booleanField('mt638bit', 'Allow 8-bit characters', true)
        ]);
    }
    /** Build error-correction and filtering controls for DominoEX. */
    static dominoExGroup() {
        return SettingsRegistry.controlGroup('DominoEX compatibility', [
            SettingsRegistry.booleanField('dominoFec', 'Use forward error correction', false),
            SettingsRegistry.booleanField('dominoFilter', 'Use receive filter', true),
            SettingsRegistry.numberField('dominoBandwidth', 'Receive bandwidth multiplier', 2, 1, 2)
        ]);
    }
    /** Build speed and callsign controls for IFKP. */
    static ifkpGroup() {
        return SettingsRegistry.controlGroup('IFKP compatibility', [
            SettingsRegistry.selectField('ifkpBaud', 'Speed', 1, ['Half', 'Normal', 'Double']),
            SettingsRegistry.booleanField('ifkpLowercase', 'Sender callsign in lower case', true)
        ]);
    }
    /** Build symbol-speed, peak-search and callsign controls for FSQ. */
    static fsqGroup() {
        return SettingsRegistry.controlGroup('FSQ compatibility', [
            SettingsRegistry.selectField('fsqBaud', 'Symbol speed', 4.5, [
                [1.5, '1.5 baud'],
                [2, '2 baud'],
                [3, '3 baud'],
                [4.5, '4.5 baud'],
                [6, '6 baud']
            ]),
            SettingsRegistry.numberField('fsqMovingAverage', 'Moving average length', 4, 1, 15),
            SettingsRegistry.numberField('fsqPeakHits', 'Tone peak confirmations', 3, 3, 6),
            SettingsRegistry.booleanField('fsqLowercase', 'Sender callsign in lower case', false)
        ]);
    }
    /** Build sender identity and output clock controls shared by fldigi modes. */
    static identityGroup() {
        return SettingsRegistry.controlGroup('Identity & output', [
            SettingsRegistry.textField('callsign', 'Sender callsign', ''),
            SettingsRegistry.numberField('txOffset', 'Transmit tone offset (Hz)', 0, -500, 500),
            SettingsRegistry.numberField('txPpm', 'Output clock correction (ppm)', 0, -5000, 5000)
        ]);
    }
    /** Build the optional picture-transmission controls for image-capable modems. */
    static pictureTransmitGroup() {
        return SettingsRegistry.controlGroup('Picture transmission', [
            SettingsRegistry.selectField('imageColor', 'Color', 'color', [
                ['color', 'Color'],
                ['gray', 'Grayscale']
            ]),
            SettingsRegistry.numberField('imageWidth', 'MFSK picture width', 320, 1, 2000),
            SettingsRegistry.selectField('imageSpp', 'MFSK picture speed', 8, [
                [8, 'Normal (X1)'],
                [4, 'Twice as fast (X2)'],
                [2, 'Four times as fast (X4)']
            ]),
            SettingsRegistry.selectField('imageSize', 'THOR / IFKP picture size', 3, [
                [0, '59 × 74'],
                [1, '120 × 150'],
                [2, '240 × 300'],
                [3, '160 × 120'],
                [4, '320 × 240'],
                [5, '640 × 480']
            ]),
            SettingsRegistry.selectField('fsqImageSize', 'FSQ picture size / color', 1, [
                [0, '160 × 120 color'],
                [1, '320 × 240 color'],
                [2, '640 × 480 grayscale'],
                [3, '640 × 480 color'],
                [4, '240 × 300 color'],
                [5, '240 × 300 grayscale'],
                [6, '120 × 150 color'],
                [7, '120 × 150 grayscale']
            ])
        ]);
    }
    /** Build engine-specific control groups in their established order. */
    static engineGroups(format) {
        const groups = [];
        switch (format.engine) {
            case 'sstv':
            case 'pictures-auto':
                groups.push(
                    SettingsRegistry.controlGroup('Slow-scan reception', SettingsRegistry.sstv),
                    SettingsRegistry.controlGroup('Picture sender', [
                        SettingsRegistry.textField('callsign', 'Optional sender identification', '')
                    ])
                );
                if (format.engine === 'sstv') break;
                groups.push(SettingsRegistry.controlGroup('Weather fax', SettingsRegistry.fax));
                break;
            case 'fax':
                groups.push(SettingsRegistry.controlGroup('Weather fax', SettingsRegistry.fax));
                break;
            case 'drm':
                groups.push(SettingsRegistry.controlGroup('Digital transfer compatibility', SettingsRegistry.digital));
                break;
            case 'packet':
                groups.push(SettingsRegistry.controlGroup('Packet modem', SettingsRegistry.packet));
                groups.push(SettingsRegistry.controlGroup('Packet meaning', [SettingsRegistry.booleanField('aprsInterpret', 'Explain APRS locations and messages', false)]));
                if (format.aprs) groups.push(SettingsRegistry.controlGroup('Location to send', [
                    SettingsRegistry.selectField('aprsPayload', 'Content of the message box', 'position', [['position', 'Location comment'], ['raw', 'Complete raw packet']]),
                    SettingsRegistry.textField('aprsSender', 'Sender callsign', 'N0CALL'),
                    SettingsRegistry.numberField('aprsLatitude', 'Latitude (degrees; south is negative)', 42, -90, 90, 0.0001),
                    SettingsRegistry.numberField('aprsLongitude', 'Longitude (degrees; west is negative)', -71, -180, 180, 0.0001),
                    SettingsRegistry.numberField('aprsAltitude', 'Altitude (meters)', 0, -1000, 100000),
                    SettingsRegistry.booleanField('aprsCompressed', 'Use compressed position format', false)
                ]));
                break;
            case 'weak':
                groups.push(SettingsRegistry.controlGroup('Timed weak-signal messages', SettingsRegistry.weak));
                break;
            case 'sound':
                groups.push(SettingsRegistry.controlGroup('Sound-message compatibility', SettingsRegistry.sound));
                break;
            case 'signaling':
                groups.push(SettingsRegistry.controlGroup('Pager & signaling options', SettingsRegistry.signaling));
                break;
            case 'voice':
                groups.push(...SettingsRegistry.voiceGroups(format));
                break;
            case 'sensor':
                groups.push(SettingsRegistry.controlGroup('Raw radio input', SettingsRegistry.sensor));
                break;
        }
        groups.push(...AdditionalFormats.groups(format, SettingsRegistry));
        return groups;
    }
    /** Build speech and data-link controls for the selected digital-voice mode. */
    static voiceGroups(format) {
        const groups = [SettingsRegistry.controlGroup('Speech & digital voice', SettingsRegistry.voice)];
        if (format.data && format.mode !== 9) {
            groups.push(
                SettingsRegistry.controlGroup('Burst synchronization', [
                    SettingsRegistry.numberField('voiceLow', 'Lower tuning offset limit (Hz)', -100, -500, 0),
                    SettingsRegistry.numberField('voiceHigh', 'Upper tuning offset limit (Hz)', 100, 0, 500)
                ])
            );
        }
        if (format.mode === 9) {
            groups.push(
                SettingsRegistry.controlGroup('FSK packet compatibility', [
                    SettingsRegistry.selectField('voiceFskM', 'Number of tones', 2, [
                        [2, '2 tones'],
                        [4, '4 tones']
                    ]),
                    SettingsRegistry.selectField('voiceFskBaud', 'Symbol rate', 100, [
                        [50, '50 baud'],
                        [100, '100 baud'],
                        [200, '200 baud'],
                        [400, '400 baud'],
                        [800, '800 baud']
                    ]),
                    SettingsRegistry.numberField('voiceFskTone', 'First tone (Hz)', 1000, 100, 3500),
                    SettingsRegistry.numberField('voiceFskSpacing', 'Tone spacing (Hz)', 200, 50, 1000),
                    SettingsRegistry.selectField('voiceFskCode', 'Error-correction code', 'H_256_512_4', [
                        ['H_256_512_4', '256 / 512'],
                        ['H_128_256_5', '128 / 256'],
                        ['HRA_112_112', '112 / 224']
                    ])
                ])
            );
        }
        return groups;
    }
    /** Add direction-specific recording controls ahead of engine controls. */
    static directionGroups(format, direction) {
        if (direction === 'decode' && format.engine !== 'sensor') {
            return [SettingsRegistry.controlGroup('Recording & input', SettingsRegistry.inputFields)];
        }
        if (direction === 'encode' && format.engine === 'voice' && !format.data) {
            return [SettingsRegistry.controlGroup('Speech recording', [SettingsRegistry.inputFields[0]])];
        }
        return [];
    }
    /**
     * Build control defaults and apply compatibility overrides from the selected preset.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @returns {Object} Complete defaults with preset overrides.
     */
    static defaultsFor(format) {
        const out = { ...modemDefaults };
        for (const g of SettingsRegistry.groupsFor(format, 'decode'))
            for (const field of g.fields) out[field.key] = field.value;
        if (format?.family === 'CW') out.frequency = 700;
        if (format?.engine === 'fldigi' && format.name === 'OFDM3500') out.frequency = 2250;
        if (format?.engine === 'packet') {
            if (format.name.includes('300')) {
                out.packetMark = 1600;
                out.packetSpace = 1800;
                out.packetBaud = 300;
            }
            if (format.nativeType === 3 || format.nativeType === 4) {
                out.packetMark = 1800;
                out.packetSpace = 1800;
                out.packetBaud = format.baud;
            }
            if (format.nativeType === 2 || format.nativeType === 8) {
                out.packetBaud = 9600;
                out.packetMark = 0;
                out.packetSpace = 0;
            }
        }
        if (format?.family === 'FSQ') out.fsqBaud = 3;
        if (format?.engine === 'sound' && format.mode >= 6) out.ggPayload = 16;
        Object.assign(out, format?.presetSettings || {});
        return out;
    }
    /**
     * Clamp numeric values and validate choices while retaining compatible saved controls.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @param {Object} values Saved or edited controls before validation.
     * @returns {Object} Validated controls with incompatible values discarded.
     */
    static validateSettings(format, values) {
        const defaults = SettingsRegistry.defaultsFor(format),
            out = { ...defaults };
        for (const g of SettingsRegistry.groupsFor(format, 'decode'))
            for (const field of g.fields) {
                let v = values[field.key];
                if (v === undefined) continue;
                if (field.type === 'checkbox') {
                    if (typeof v === 'boolean') out[field.key] = v;
                } else if (field.type === 'number') {
                    v = Number(v);
                    if (Number.isFinite(v)) out[field.key] = Math.max(field.min, Math.min(field.max, v));
                } else if (field.type === 'select') {
                    const match = field.choices.find(([key]) => String(key) === String(v));
                    if (match) out[field.key] = match[0];
                } else out[field.key] = String(v).slice(0, 128);
            }
        return out;
    }
    /** Saved-control schema version used for one-time migration. */
    static settingsVersion = 5;
    /**
     * Migrate older saved settings once, then validate them against the current format.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @param {Object} values Saved or edited controls before validation.
     * @param {number} version Saved-setting schema version.
     * @returns {Object} Migrated and validated saved controls.
     */
    static restoreSettings(format, values, version = 1) {
        const out = SettingsRegistry.validateSettings(format, values);
        // Version 1 saved every default, including the unsafe automatic slant setting.
        // Update those former defaults once; version 2 honors subsequent opt-ins.
        if (version < 2 && ['sstv', 'pictures-auto'].includes(format.engine)) {
            if (values.sstvSlant === true) out.sstvSlant = false;
            if (values.sstvBpf === 0) out.sstvBpf = 1;
        }
        if (version < 3 && format.engine === 'fldigi' && format.name === 'OFDM3500' && values.frequency === 1500)
            out.frequency = 2250;
        if (format.family === 'Hellschreiber') {
            const modeWidth = SettingsRegistry.hellBandwidthDefault(format);
            if (version < 4 && Number(values.hellBandwidth) === 245) out.hellBandwidth = modeWidth;
            if (version === 4 && !values.hellBandwidthCustom) out.hellBandwidth = modeWidth;
            delete out.hellBandwidthCustom;
        }
        return out;
    }
}
export const inputFields = SettingsRegistry.inputFields;
export const groupsFor = SettingsRegistry.groupsFor.bind(SettingsRegistry);
export const defaultsFor = SettingsRegistry.defaultsFor.bind(SettingsRegistry);
export const validateSettings = SettingsRegistry.validateSettings.bind(SettingsRegistry);
export const settingsVersion = SettingsRegistry.settingsVersion;
export const restoreSettings = SettingsRegistry.restoreSettings.bind(SettingsRegistry);
