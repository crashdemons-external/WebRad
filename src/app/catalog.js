/** Standalone family/variant descriptions and compatible catalog filtering. */
export class SignalCatalog {
    /** Recognizable names and short explanations used in family selectors. */
    static familyChoices = {
        'Aircraft messages': ['ACARS', 'aircraft messages'],
        APRS: ['APRS', 'locations & messages'],
        'AX.25': ['AX.25', 'addressed radio data'],
        Codec2: ['Codec2', 'compressed speech files'],
        'Computer cassette': ['Computer cassette', 'data stored as tape audio'],
        Contestia: ['Contestia', 'text with error correction'],
        CW: ['CW', 'Morse code'],
        DominoEX: ['DominoEX', 'text using multiple tones'],
        DTMF: ['DTMF', 'telephone keypad tones'],
        FreeDV: ['FreeDV', 'digital radio speech'],
        'FreeDV data': ['FreeDV data', 'file bytes in fixed-size blocks'],
        FSQ: ['FSQ', 'text & pictures with sender ID'],
        FT: ['FT8 / FT4', 'short radio contact messages'],
        ggwave: ['ggwave', 'short messages through sound'],
        HAMDRM: ['HAMDRM', 'files & pictures with recovery'],
        Hellschreiber: ['Hellschreiber', 'text printed as an image'],
        IFKP: ['IFKP', 'keyboard text & pictures'],
        MFSK: ['MFSK', 'text & pictures using multiple tones'],
        MT63: ['MT63', 'text spread across many tones'],
        NAVTEX: ['NAVTEX', 'marine weather & safety messages'],
        'Satellite pictures': ['NOAA APT', 'satellite pictures'],
        Olivia: ['Olivia', 'text in weak or noisy signals'],
        Signaling: ['Pagers & radio codes', 'alerts, radio data & commands'],
        Pictures: ['Automatic picture detection', 'SSTV / weather fax'],
        PSK: ['PSK', 'keyboard text'],
        'Radio identifiers': ['Radio identifiers', 'radio IDs & dispatch messages'],
        RTTY: ['RTTY', 'radio teletype text'],
        SCAMP: ['SCAMP', 'text using switched tones'],
        Sensors: ['Sensors & devices', 'readings & control messages'],
        Spectrogram: ['Spectrogram', 'pictures in the frequency display'],
        SSTV: ['SSTV', 'slow-scan pictures'],
        'Terminal tones': ['Terminal modems', 'serial text & data'],
        THOR: ['THOR', 'text & pictures with error correction'],
        Throb: ['Throb', 'text using tone pulses'],
        WEFAX: ['WEFAX', 'weather fax pictures'],
        'Location beacons': ['WSPR', 'callsign, location & power beacons']
    };
    /** Standalone descriptions indexed by signal family. */
    static descriptions = {
        'TERMINAL TONES': ['Terminal messages', 'Send and read raw serial characters as two audio tones. Match the bit rate, tone frequencies and character framing.'],
        'COMPUTER CASSETTE': ['Computer cassette data', 'Store raw serial bytes as cassette-style audio. These modes do not add computer-specific tape headers or file containers.'],
        SPECTROGRAM: ['Pictures in the frequency display', 'Turn a picture or printed text into audio, or reveal hidden shapes by rendering a recording as a spectrogram.'],
        'RADIO IDENTIFIERS': ['Dispatch radio identifiers', 'Read short radio identification and dispatch messages. MDC-1200 also supports creating single and double packets.'],
        'SATELLITE PICTURES': ['Satellite picture audio', 'Read grayscale APT satellite pictures from demodulated audio, or create a matching picture recording.'],
        'LOCATION BEACONS': ['Weak-signal location beacons', 'WSPR carries a callsign, location and power in a two-minute audio slot.'],
        'AIRCRAFT MESSAGES': ['Aircraft operational messages', 'ACARS carries aircraft addressing and operational text in short audio bursts.'],
        APRS: ['Locations and packet messages', 'Interpret locations, compact Mic-E positions, weather, objects, telemetry and addressed messages in packet audio.'],
        CW: [
            'Morse code',
            'Morse code represents letters, numbers, and punctuation with short and long tones. Match the tone frequency and sending speed to the recording.'
        ],
        PSK: [
            'Phase-shift text',
            'Phase-shift keying (PSK) carries text by shifting the timing of audio waves. Sender and receiver must use the same variant and speed.'
        ],
        RTTY: [
            'Radio teletype',
            'Radio teletype (RTTY) carries text with two alternating audio tones. Match the sending speed, distance between tones, and character encoding.'
        ],
        MFSK: [
            'Multi-tone text & pictures',
            'Multiple-frequency shift keying (MFSK) carries text with a sequence of audio tones. Some variants can also transmit pictures. Sender and receiver must use the same variant.'
        ],
        OLIVIA: [
            'Weak-signal text',
            'Olivia carries text with multiple audio tones and error correction to help recover weak or noisy messages. Match the number of tones and the bandwidth, which is the range of frequencies occupied by the signal.'
        ],
        CONTESTIA: [
            'Compact multi-tone text',
            'Contestia carries text with multiple audio tones and error correction to help recover messages in noise. Match the number of tones and the bandwidth, which is the range of frequencies occupied by the signal.'
        ],
        MT63: [
            'Wideband text',
            'MT63 carries text by spreading it across many audio tones and over time to help tolerate interference. Match the bandwidth and the short or long timing variant.'
        ],
        THOR: [
            'Protected multi-tone text & pictures',
            'THOR carries text with a sequence of audio tones and error correction to help recover damaged messages. Some variants also support pictures. Sender and receiver must use the same variant.'
        ],
        DOMINOEX: [
            'Multi-tone text',
            'DominoEX carries text by changing from one audio tone to another. Match the speed variant and whether error correction is enabled.'
        ],
        HELL: [
            'Printed text',
            'Hellschreiber sends the shapes of letters as pixels, producing an image strip of printed text. Match the sending variant and receive filter width.'
        ],
        SCAMP: [
            'Text through switched tones',
            'SCAMP carries text by switching between two audio tones or by turning a tone on and off. Match the sending variant, speed, and tone frequency.'
        ],
        THROB: [
            'Text through tone pulses',
            'Throb and ThrobX carry text with pulses containing one or two audio tones. Match the Throb or ThrobX variant and sending speed.'
        ],
        IFKP: [
            'Keyboard text & pictures',
            'IFKP carries typed text and pictures with a sequence of audio tones. Match the selected sending speed and tone frequency.'
        ],
        FSQ: [
            'Text & pictures with sender ID',
            'FSQ carries typed radio messages and pictures with audio tones and sender identification. Match the text sending speed; picture headers use a fixed rate of three symbols per second.'
        ],
        DTMF: [
            'Keypad tones',
            'Dual-tone multi-frequency (DTMF) signaling represents phone keypad digits and symbols with pairs of audio tones. Decoding recovers the pressed keys.'
        ],
        NAVTEX: [
            'Navigation messages',
            'NAVTEX broadcasts weather, navigation warnings, and safety messages as text for ships. Its SITOR-B signaling repeats characters to help recover transmission errors.'
        ],
        SSTV: [
            'Slow-scan picture',
            'Slow-scan television (SSTV) represents pictures as a sequence of audio tones. The selected picture format determines the image size and scan timing. Sender and receiver must use matching formats.'
        ],
        WEFAX: [
            'Weather fax',
            'Weather fax sends grayscale pictures, such as weather charts, one line at a time using audio tones. Match the picture geometry, scan speed, and carrier tone frequency.'
        ],
        HAMDRM: [
            'Digital file transfer',
            'HAMDRM converts files or pictures into audio signals with error correction. Decoding recovers the original file bytes when enough transfer data arrives; recovery requests can ask for missing pieces.'
        ],
        PICTURES: [
            'Automatic picture detection',
            'Automatic picture detection searches a recording for slow-scan television (SSTV) picture headers and weather-fax start signals. A recording that begins partway through a picture may require a manually selected format.'
        ],
        'AX.25': [
            'Packet messages',
            'Packet radio sends addressed messages and data in short bursts. AX.25 is the amateur-radio packet format; APRS uses these packets for positions and messages. Optional error correction helps recover damaged packets. The AIS option receives ship-identification messages.'
        ],
        FT: [
            'Weak-signal messages',
            'FT8 and FT4 carry short amateur-radio contact messages in timed audio transmissions designed for weak signals. Messages can contain callsigns, locations, signal reports, or up to 13 characters of supported free text.'
        ],
        GGWAVE: [
            'Messages through sound',
            'ggwave carries short messages with sequences of audible or ultrasonic tones. Sender and receiver must use matching tone protocols and message-length settings.'
        ],
        SIGNALING: [
            'Pager alerts & signaling',
            'Pager and signaling formats carry pager messages, emergency-alert headers, phone keypad digits, radio calling codes, or device commands. Choose the specific protocol used by the recording; available generation options depend on that protocol.'
        ],
        CODEC2: [
            'Compressed speech',
            'Codec2 compresses a speech recording into a small .c2 file and turns compatible .c2 files back into playable speech. Match the speech-compression mode and bit-encoding settings.'
        ],
        FREEDV: [
            'Digital voice',
            'FreeDV converts a speech recording into audio tones for digital radio transmission, or recovers speech from a recording of those tones. Sender and receiver must use the same FreeDV mode.'
        ],
        'FREEDV DATA': [
            'Fixed-size digital packets',
            'FreeDV data modes carry fixed-size blocks of file bytes in audio signals with error correction. Payload size depends on the mode and coding settings. HAMDRM digital file transfer provides filenames and recovery of missing pieces for complete files.'
        ],
        SENSORS: [
            'Sensor & device radio packets',
            'Sensor and device protocols carry weather readings, measurements, or control messages over radio. Decode raw radio samples, amplitude or frequency measurements, or pulse/gap durations. Match the recording representation and sample rate; ordinary speaker audio does not contain equivalent radio data.'
        ]
    };
    /** Standalone selective-call, pager and signaling descriptions. */
    static signalingDescriptions = {
        FLEX: [
            'Pager messages',
            'FLEX carries pager addresses and text or numeric messages in radio transmissions. Decoding recovers the pager message and its addressing information.'
        ],
        FLEX_NEXT: [
            'Pager messages & network details',
            'FLEX_NEXT decodes FLEX pager transmissions, including messages, addresses, message fragments, and network time information. This is a receive-only FLEX decoder option.'
        ],
        GSC: [
            'Pager messages',
            'Golay Sequential Code (GSC) carries pager addresses and messages with error correction. Decode a recording of GSC paging tones to recover its messages.'
        ],
        EAS: [
            'Emergency-alert headers',
            'The Emergency Alert System (EAS) carries coded alert headers and end markers in audio tones. Decoding recovers alert information such as the event, affected locations, and duration.'
        ],
        UFSK1200: [
            'Serial data through tones',
            'UFSK1200 receives serial data carried by two alternating audio tones at 1,200 bits per second. Decoding displays readable characters and byte values for other data.'
        ],
        CLIPFSK: [
            'Telephone caller identification',
            'CLIPFSK decodes telephone caller-identification data carried in audio tones. Compatible recordings can contain the caller number, name, and call time.'
        ],
        FMSFSK: [
            'Radio status messages',
            'FMSFSK decodes status messages used by the German FMS radio reporting system. These tone messages carry coded unit identification and status information.'
        ],
        HAPN4800: [
            'Radio data packets',
            'HAPN4800 receives radio data packets at 4,800 bits per second using the HAPN signal format. Use a recording of the radio’s unfiltered received signal, also called baseband.'
        ],
        FSK9600: [
            'Radio data packets',
            'FSK9600 receives radio data packets at 9,600 bits per second using the G3RUH signal format. Use a recording of the radio’s unfiltered received signal, also called baseband; speaker audio may lose the required data.'
        ],
        DTMF: SignalCatalog.descriptions.DTMF,
        MORSE_CW: [
            'Morse code',
            'MORSE_CW decodes the short and long tones of Morse code into letters, numbers, and punctuation. Dot timing and detector threshold can be adjusted in Advanced.'
        ],
        X10: [
            'Home-control commands',
            'X10 signaling carries home-control commands that identify a house code, device, and action. Decoding recovers commands from a compatible recording of the control pulses.'
        ]
    };
    /**
     * Build a standalone signal-family title and description.
     * @returns {Object} Family title and standalone description.
     */
    static entry([title, description]) {
        return { title, description };
    }
    /**
     * Describe a signal family independently of other families or chooser context.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @returns {Object} Standalone family title and description.
     */
    static describeFamily(format) {
        const family = format.family || format.name || 'Signal';
        const key = family === 'Hellschreiber' ? 'HELL' : family.toUpperCase();
        if (SignalCatalog.descriptions[key]) return SignalCatalog.entry(SignalCatalog.descriptions[key]);
        // Future families should identify their content without assuming text support.
        const content =
            [...new Set([...(format.inputs || []), ...(format.outputs || [])])]
                .map(
                    (type) =>
                        ({
                            text: 'text',
                            picture: 'pictures',
                            file: 'file data',
                            voice: 'speech',
                            sensor: 'device data'
                        })[type] || type
                )
                .join(' and ') || 'data';
        return {
            title: family,
            description: `${family} carries ${content}. Choose the variant and settings used by the recording or receiving device.`
        };
    }
    /**
     * Describe the selected variant, including its compatibility requirements and limits.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @returns {Object} Variant title and standalone compatibility description.
     */
    static describe(format) {
        if (format.presetDescription)
            return { ...SignalCatalog.describeFamily(format), description: format.presetDescription };
        const engineDescription = SignalCatalog.describeEngine(format);
        if (engineDescription) return engineDescription;
        if (format.engine === 'fldigi' && format.name === 'OFDM3500')
            return {
                title: 'Multicarrier radio text',
                description:
                    'OFDM3500 carries text across several audio tones. The native transmitter uses a fixed 2250 Hz center; start reception at 2250 Hz and use signal shifting to correct an offset recording.'
            };
        if (format.name === 'SITORB')
            return {
                title: 'Error-protected radio text',
                description:
                    'SITOR-B carries radio text with two alternating tones and repeated characters to help recover transmission errors. It is used for marine weather and safety broadcasts. Match the tone frequency and signal orientation to the recording.'
            };
        return SignalCatalog.describeFamily(format);
    }
    /** Select a detailed description handler by engine capability. */
    static describeEngine(format) {
        if (format.codec) return SignalCatalog.describeCodec(format);
        switch (format.engine) {
            case 'packet':
                return SignalCatalog.describePacket(format);
            case 'weak':
                return SignalCatalog.describeWeakSignal(format);
            case 'signaling':
                return SignalCatalog.describeSignaling(format);
            case 'sound':
                return SignalCatalog.describeSound(format);
            case 'sstv':
                return SignalCatalog.describeSstv(format);
            case 'fax':
                return SignalCatalog.describeFax(format);
            case 'voice':
                return SignalCatalog.describeVoice(format);
            case 'sensor':
                return SignalCatalog.describeSensor(format);
            default:
                return null;
        }
    }
    /** Describe the selected packet-radio modulation, if it has a known name. */
    static describePacket(format) {
        if (format.name === 'AIS') {
            return {
                title: 'Ship identification messages',
                description:
                    'The Automatic Identification System (AIS) broadcasts ship identification, positions, and navigation data. Decode a compatible radio recording to recover ship messages. AIS is receive only in this app.'
            };
        }
        const method = {
            '1200 AFSK': 'two alternating audio tones at 1,200 bits per second',
            '300 AFSK': 'two alternating audio tones at 300 bits per second',
            '2400 QPSK': 'changes in audio wave timing at 2,400 bits per second',
            '4800 8PSK': 'changes in audio wave timing at 4,800 bits per second',
            '9600 G3RUH': 'the G3RUH baseband signal format at 9,600 bits per second'
        }[format.name];
        if (!method) return null;
        return {
            title: 'Packet messages',
            description: `${format.name} carries addressed amateur-radio packets using ${method}. The packet layout (AX.25, FX.25, or IL2P) and error-correction settings must match the sender. ${format.nativeType === 2 ? 'Use a recording of the radio’s unfiltered received signal, also called baseband; speaker audio may lose the required data.' : 'Match the tone frequency and modem settings to the recording.'}`
        };
    }
    /** Describe FT8 and FT4 slot timing and message content. */
    static describeWeakSignal(format) {
        return {
            title: 'Weak-signal messages',
            description: `${format.name} carries short amateur-radio contact messages in ${format.name === 'FT8' ? '15' : '7.5'}-second slots. Messages can contain callsigns, locations, signal reports, or up to 13 characters of supported free text. Align the recording with the slot timing for decoding.`
        };
    }
    /** Describe pager, tone-code and AFSK signaling formats. */
    static describeSignaling(format) {
        if (SignalCatalog.signalingDescriptions[format.name])
            return SignalCatalog.entry(SignalCatalog.signalingDescriptions[format.name]);
        const pager = /^POCSAG(512|1200|2400)$/.exec(format.name);
        if (pager) {
            return {
                title: 'Pager messages',
                description: `${format.name} carries pager addresses and numeric or text messages at ${Number(pager[1]).toLocaleString('en-US')} bits per second. Match the pager speed, message interpretation, and signal polarity to the recording.`
            };
        }
        if (/^(ZVEI[123]|DZVEI|PZVEI|EEA|EIA|CCIR)$/.test(format.name)) {
            return {
                title: 'Radio calling codes',
                description: `${format.name} uses sequences of audio tones to identify or call individual radios. Decoding recovers the calling code. Match the ${format.name} tone standard and timing to the recording.`
            };
        }
        if (/^AFSK(1200|2400)(_[23])?$/.test(format.name)) {
            return {
                title: 'Radio data packets',
                description: `${format.name} receives radio data packets carried by alternating audio tones at ${format.name.includes('1200') ? '1,200' : '2,400'} bits per second. Match the exact tone-format variant used by the recording.`
            };
        }
        return null;
    }
    /** Describe ggwave audio bands and fixed-payload requirements. */
    static describeSound(format) {
        const band = format.mode >= 3 && format.mode < 6 ? 'ultrasonic' : 'audible',
            settings = format.mode >= 6 ? ' and fixed message length, measured in bytes' : ' and message-length settings';
        return {
            title: 'Messages through sound',
            description: `The ggwave ${format.name} protocol carries short messages with ${band} audio tones. Match the sender’s protocol${settings}.`
        };
    }
    /** Describe the selected slow-scan picture geometry and timing. */
    static describeSstv(format) {
        return {
            title: 'Slow-scan picture',
            description: `${format.name} is a slow-scan television (SSTV) picture format that represents an image as a sequence of audio tones. ${format.name} determines the image size and scan timing; sender and receiver must use matching picture formats.`
        };
    }
    /** Describe the selected weather-fax geometry and scan speed. */
    static describeFax(format) {
        return {
            title: 'Weather fax',
            description: `${format.name} sends grayscale weather-fax pictures one line at a time with audio tones. The format sets the scan-line geometry; match the scan speed and carrier tone frequency to the recording.`
        };
    }
    /** Select a Codec2, FreeDV data or speech description. */
    static describeVoice(format) {
        if (format.data) {
            return {
                title: 'Fixed-size digital packets',
                description: `${format.name} carries file bytes in fixed-size audio packets with error correction. Match the sender’s mode and coding settings, which determine the bytes per packet. Larger files can be split into several packets after confirmation; unused space in the last packet is filled with padding bytes. Received packets are saved separately, without the original filename or automatic file reassembly.`
            };
        }
        return {
            title: 'Digital voice',
            description: `${format.name} converts speech recordings into audio tones for digital radio transmission, or recovers speech from a recording of those tones. Sender and receiver must both use ${format.name}.`
        };
    }
    /** Describe Codec2 compression and playback files. */
    static describeCodec(format) {
        return {
            title: 'Compressed speech',
            description: `${format.name} compresses speech recordings into small .c2 files and turns compatible .c2 files back into playable speech. Match the ${format.name} compression mode and bit-encoding settings.`
        };
    }
    /** Describe automatic or protocol-specific sensor input requirements. */
    static describeSensor(format) {
        if (format.mode < 0) {
            return {
                title: 'Automatic sensor & device detection',
                description:
                    'Automatic sensor detection tries enabled sensor and device radio protocols to recover structured readings or control messages. Provide raw radio samples, amplitude or frequency measurements, or pulse/gap durations with matching representation and sample rate. Ordinary speaker audio does not contain equivalent radio data.'
            };
        }
        if (format.mode >= 0) {
            const device = format.name.replace(/^\d+\s*·\s*/, '');
            return {
                title: 'Sensor & device radio packets',
                description: `Decode radio packets for ${device} into structured device data. Provide raw radio samples, amplitude or frequency measurements, or pulse/gap durations with matching representation and sample rate. Ordinary speaker audio does not contain equivalent radio data.`
            };
        }
        return null;
    }
    /**
     * Label a family using the protocols available in the filtered group.
     * @param {Object} group Signal family with its compatible variants.
     * @returns {Object} Display name, short explanation and combined option label.
     */
    static familyChoice(group) {
        let [name, summary] = SignalCatalog.familyChoices[group.family] || [group.family, group.title];
        if (group.engine === 'dispatch') {
            name = [...new Set(group.formats.map((format) => format.name.split(' · ')[0]))].join(' / ');
        }
        if (group.engine === 'packet' && group.family === 'AX.25') {
            const hasAis = group.formats.some((format) => format.name === 'AIS');
            const hasRadioData = group.formats.some((format) => format.name !== 'AIS');
            if (hasAis) {
                name = hasRadioData ? 'AX.25 / AIS' : 'AIS';
                summary = hasRadioData ? 'radio data & ship messages' : 'ship identification & locations';
            }
        }
        return { name, summary, label: name === summary ? name : `${name} — ${summary}` };
    }
    /**
     * Group compatible variants and sort families by their recognizable display names.
     * Variant order follows the catalog so each family's usual preset stays first.
     * @param {Object[]} formats Ordered native or expanded catalog entries.
     * @param {string} content Required content type for catalog filtering.
     * @param {string} direction Encode/decode direction determining available controls.
     * @returns {Object[]} Alphabetical families with automatic picture detection first.
     */
    static formatGroups(formats, content, direction) {
        const map = new Map();
        for (const f of formats) {
            if (direction === 'encode' ? !f.inputs.includes(content) : !f.outputs.includes(content)) continue;
            const key = f.engine + ':' + f.family;
            if (!map.has(key))
                map.set(key, {
                    id: key,
                    ...SignalCatalog.describeFamily(f),
                    family: f.family,
                    engine: f.engine,
                    formats: []
                });
            map.get(key).formats.push(f);
        }
        return [...map.values()]
            .map((group) => ({ ...group, ...SignalCatalog.familyChoice(group) }))
            .sort((left, right) => {
                const automaticOrder = Number(right.engine === 'pictures-auto') - Number(left.engine === 'pictures-auto');
                return automaticOrder || left.name.localeCompare(right.name, 'en', { sensitivity: 'base', numeric: true });
            });
    }
    /**
     * Match a case-insensitive search against family and variant names and descriptions.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @param {string} text Search text.
     * @returns {boolean} Whether the search appears in the family/variant description.
     */
    static matchesFormat(format, text) {
        const detail = SignalCatalog.describe(format),
            family = SignalCatalog.describeFamily(format);
        const choice = SignalCatalog.familyChoice({ ...format, title: family.title, formats: [format] });
        return `${choice.label} ${detail.title} ${detail.description} ${family.title} ${family.description} ${format.name} ${format.family}`
            .toLocaleLowerCase()
            .includes(text.toLocaleLowerCase());
    }
}
export const describeFamily = SignalCatalog.describeFamily.bind(SignalCatalog);
export const describe = SignalCatalog.describe.bind(SignalCatalog);
export const formatGroups = SignalCatalog.formatGroups.bind(SignalCatalog);
export const matchesFormat = SignalCatalog.matchesFormat.bind(SignalCatalog);
