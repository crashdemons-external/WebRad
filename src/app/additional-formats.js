/** Standalone signal formats and the controls needed to reproduce their audio. */
export class AdditionalFormats {
    /** Native loaders for the standalone cores. */
    static urls = { beacon: 'beacon-messages.js', aircraft: 'aircraft-messages.js', terminal: 'terminal-tones.js', spectrum: 'spectral-pictures.js', dispatch: 'radio-identifiers.js', apt: 'satellite-pictures.js' };

    /** Maximum recording lengths in seconds for the offline native cores. */
    static seconds = { terminal: 180, spectrum: 260, dispatch: 180, apt: 900, beacon: 120, aircraft: 180 };

    /** Describe supported directions without advertising a decoder or encoder that is absent. */
    static catalog(engine) {
        const common = { engine, decode: true, outputs: ['text'], inputs: ['text'] };
        if (engine === 'beacon') return [{
            ...common, id: 'beacon-wspr', mode: 0, name: 'WSPR · two-minute location beacon', family: 'Location beacons',
            presetDescription: 'Results appear after the recording ends or you press Stop. Carry a standard callsign, four-character location and transmitter power through a two-minute weak-signal recording. Enter CALLSIGN GRID POWER, for example K1ABC FN42 30. Power is in dBm, ending in 0, 3 or 7. Sending supports ordinary callsigns; reception also recognizes compound and hashed forms when available in the same recording. Decode one aligned two-minute slot at a time.'
        }];
        if (engine === 'aircraft') return [{
            ...common, id: 'aircraft-acars', mode: 0, name: 'ACARS · aircraft operational messages', family: 'Aircraft messages',
            presetDescription: 'Results appear after the recording ends or you press Stop. Read or create aircraft-style operational messages carried by 2,400-bit MSK audio. Enter up to 220 ASCII characters; Advanced supplies the aircraft address, label and block identification. Decode expects demodulated audio, not raw radio samples. The result shows the aircraft header and message; higher-level airline-specific payload interpretation is not included. Limit: three minutes.'
        }];
        if (engine === 'terminal') {
            return [
                ['bell202', 'Bell 202 · 1,200 bits/sec', 1200, 1200, 2200, 1],
                ['bell103', 'Bell 103 · originating terminal', 300, 1270, 1070, 1],
                ['bell103-answer', 'Bell 103 · answering terminal', 300, 2225, 2025, 1],
                ['v21', 'V.21 · originating terminal', 300, 980, 1180, 1],
                ['v21-answer', 'V.21 · answering terminal', 300, 1650, 1850, 1],
                ['v23', 'V.23 · forward channel', 1200, 1300, 2100, 1],
                ['v23-return', 'V.23 · return channel', 75, 390, 450, 1],
                ['kcs', 'Kansas City cassette · 300 bits/sec', 300, 2400, 1200, 2],
                ['msx', 'CUTS / MSX cassette · raw 1,200-bit serial data', 1200, 2400, 1200, 2],
                ['custom', 'Custom two-tone serial data', 300, 1200, 2200, 1]
            ].map(([mode, name, baud, mark, space, stop]) => ({
                ...common, id: 'terminal-' + mode, mode, name,
                family: ['kcs', 'msx'].includes(mode) ? 'Computer cassette' : 'Terminal tones',
                inputs: ['text', 'file'], outputs: ['text', 'file'],
                presetSettings: { serialBaud: baud, serialMark: mark, serialSpace: space, serialStop: stop },
                presetDescription: 'Results appear after the recording ends or you press Stop. Carry text or raw file bytes as two audio tones. Match the speed, tones, data bits, parity and stop bits in Advanced. Text uses UTF-8. Files recover as raw bytes without a filename or checksum. Cassette choices carry serial bytes, not a complete computer-specific tape container. Limit: three minutes.'
            }));
        }
        if (engine === 'spectrum') return [{
            ...common, id: 'spectrum-picture', mode: 0, name: 'Picture or text hidden in a spectrogram', family: 'Spectrogram',
            inputs: ['picture', 'text'], outputs: ['picture'],
            presetDescription: 'Results appear after the recording ends or you press Stop. Turn a picture or printed text into audio whose frequency display reveals its shape. Decode renders a grayscale spectrogram, not editable text. Set the frequency range and picture detail in Advanced; the picture spans the entire selected recording. Trim silence before decoding.'
        }];
        if (engine === 'dispatch') return [
            { ...common, id: 'dispatch-mdc', mode: 0, name: 'MDC-1200 · radio identification', family: 'Radio identifiers', presetDescription: 'Results appear after the recording ends or you press Stop. Send or read a short radio identification burst. Enter a radio ID as four hexadecimal digits, for example 12AB. Advanced controls select the operation, argument and packet length. Numbers in decoded packets are hexadecimal.' },
            { ...common, id: 'dispatch-fleet', mode: 1, name: 'FleetSync · dispatch messages', family: 'Radio identifiers', inputs: [], presetDescription: 'Results appear after the recording ends or you press Stop. Read FleetSync radio IDs, addressing, commands and data from a recording. Supports first- and second-generation signaling at 1,200 and 2,400 bits/sec. Reception only; decoding runs when you stop or finish the recording. Limit: three minutes.' }
        ];
        if (engine === 'apt') return [{
            ...common, id: 'apt-picture', mode: 0, name: 'Satellite picture · NOAA APT', family: 'Satellite pictures',
            inputs: ['picture'], outputs: ['picture'],
            presetDescription: 'Results appear after the recording ends or you press Stop. Read a satellite picture from demodulated APT audio, or make an APT-style two-channel grayscale recording. This expects audio, not raw radio samples. Advanced selects the received channel and picture contrast. Generated recordings repeat the picture in both channels and include a short border; they contain no satellite calibration or location metadata. Limit: fifteen minutes.'
        }];
        return [];
    }

    /** Build labeled controls using the application's field descriptors. */
    static groups(format, registry) {
        const n = registry.numberField, s = registry.selectField, b = registry.booleanField;
        let fields = [], title = '';
        switch (format.engine) {
            case 'beacon':
                title = 'Two-minute beacon';
                fields = [
                    n('beaconCenter', 'Center audio tone (Hz)', 1500, 300, 3000),
                    n('beaconPasses', 'Decoder search passes', 1, 1, 3),
                    b('beaconQuick', 'Use the faster search', true)
                ];
                break;
            case 'aircraft':
                title = 'Aircraft message header';
                fields = [
                    registry.textField('aircraftAddress', 'Aircraft address (seven ASCII characters)', '.N12345'),
                    registry.textField('aircraftMode', 'Mode character', '2'),
                    registry.textField('aircraftLabel', 'Message label (two characters)', 'H1'),
                    registry.textField('aircraftAck', 'Acknowledgement character', '!'),
                    registry.textField('aircraftBlock', 'Block identification character', '1')
                ];
                break;
            case 'terminal':
                title = 'Serial tones & character framing';
                fields = [
                    n('serialBaud', 'Bits per second (baud)', 300, 45, 2400, 0.1),
                    n('serialMark', 'Tone for a one (Hz)', 1200, 100, 5000),
                    n('serialSpace', 'Tone for a zero (Hz)', 2200, 100, 5000),
                    s('serialBits', 'Data bits per character', 8, [[5, '5 bits'], [6, '6 bits'], [7, '7 bits'], [8, '8 bits (files / UTF-8)']]),
                    s('serialParity', 'Parity check', 0, [[0, 'None'], [1, 'Even'], [2, 'Odd']]),
                    s('serialStop', 'Stop bits between characters', 1, [[1, '1 stop bit'], [2, '2 stop bits']]),
                    n('serialConfidence', 'Receive confidence threshold', 2, 1, 10, 0.1, 'Raise this to reject doubtful characters. Serial data has no checksum.')
                ];
                break;
            case 'spectrum':
                title = 'Hidden picture geometry';
                fields = [
                    n('spectralWidth', 'Picture width (time columns)', 160, 16, 512),
                    n('spectralHeight', 'Picture height (frequency rows)', 96, 16, 256),
                    n('spectralLow', 'Lowest picture frequency (Hz)', 300, 100, 5000),
                    n('spectralHigh', 'Highest picture frequency (Hz)', 4500, 200, 5500),
                    n('spectralColumnMs', 'Time per column when sending (ms)', 80, 40, 500),
                    n('spectralGamma', 'Receive brightness curve', 0.65, 0.2, 2, 0.05, 'Lower values brighten faint details. The width stretches across the recording.')
                ];
                break;
            case 'dispatch':
                if (format.mode === 1) break;
                title = 'Radio identification packet';
                fields = [
                    n('mdcOperation', 'Operation code (decimal)', 1, 0, 255),
                    n('mdcArgument', 'Argument byte (decimal)', 0, 0, 255),
                    n('mdcPreamble', 'Extra opening bytes', 10, 0, 100),
                    b('mdcDouble', 'Send a double-length packet', false, 'Use operation 53 or 85 for a double-length packet.'),
                    n('mdcExtra', 'Four extra bytes as an unsigned decimal number', 0, 0, 4294967295)
                ];
                break;
            case 'apt':
                title = 'Satellite picture';
                fields = [
                    s('aptChannel', 'Received picture channel', 0, [[0, 'Channel A'], [1, 'Channel B'], [2, 'Both channels and synchronization borders']]),
                    n('aptRows', 'Maximum rows to decode', 1800, 16, 1800),
                    n('aptHeight', 'Rows in the picture to send', 128, 16, 512),
                    b('aptContrast', 'Expand received picture contrast', true)
                ];
                break;
        }
        return fields.length ? [registry.controlGroup(title, fields)] : [];
    }

    /** Supply native controls in their documented module-specific order. */
    static options(format, settings) {
        switch (format.engine) {
            case 'beacon': return [settings.beaconCenter, settings.beaconPasses, Number(settings.beaconQuick)];
            case 'aircraft': return [];
            case 'terminal': return [settings.serialBaud, settings.serialMark, settings.serialSpace, settings.serialBits, settings.serialParity, settings.serialStop, settings.serialConfidence];
            case 'spectrum': return [settings.spectralWidth, settings.spectralHeight, settings.spectralLow, settings.spectralHigh, settings.spectralColumnMs, settings.spectralGamma];
            case 'dispatch': return [settings.mdcOperation || 0, settings.mdcArgument || 0, settings.mdcPreamble || 0, Number(settings.mdcDouble || false), settings.mdcExtra || 0, format.mode];
            case 'apt': return [settings.aptChannel, settings.aptRows, Number(settings.aptContrast)];
            default: throw Error('Unsupported standalone engine.');
        }
    }
}
