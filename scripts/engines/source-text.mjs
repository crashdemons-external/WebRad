import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EOL } from 'node:os';

/** Text and source extraction shared by native engine preparation. */
export class SourceText {
    /** Read source with universal newlines, preserving its original character encoding. */
    static read(path, encoding = 'utf-8', fatal = true) {
        const bytes = readFileSync(path);
        const source = encoding === 'latin1' ? bytes.toString('latin1') :
            new TextDecoder(encoding === 'utf-8-sig' ? 'utf-8' : encoding,
                { fatal, ignoreBOM: encoding !== 'utf-8-sig' }).decode(bytes);
        return source.replace(/\r\n?/g, '\n');
    }

    /** Write generated text with the host's line endings. */
    static write(path, source) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, source.replace(/\r\n?/g, '\n').replaceAll('\n', EOL), 'utf8');
    }

    /** Copy headers without changing their encoding or bytes. */
    static copy(source, destination) {
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(source, destination);
    }

    /** List files in directory order, visiting each directory before its children. */
    static files(root, recursive = true) {
        const entries = readdirSync(root, { withFileTypes: true });
        const files = entries.filter((entry) => entry.isFile()).map((entry) => join(root, entry.name));
        if (recursive) {
            for (const entry of entries) {
                if (entry.isDirectory()) files.push(...SourceText.files(join(root, entry.name)));
            }
        }
        return files;
    }

    /** Find a required preparation marker instead of accepting a missing substring. */
    static index(source, marker, start = 0) {
        const index = source.indexOf(marker, start);
        if (index < 0) throw Error(`Source marker not found: ${marker}`);
        return index;
    }

    /** Replace literal markers without interpreting replacement characters as substitutions. */
    static replace(source, marker, replacement, count = Infinity) {
        const pieces = source.split(marker);
        if (pieces.length === 1 || count === 0) return source;
        const end = Math.min(count, pieces.length - 1);
        return pieces.slice(0, end + 1).join(replacement) +
            (end < pieces.length - 1 ? marker + pieces.slice(end + 1).join(marker) : '');
    }

    /** Require a unique literal marker before changing an upstream source. */
    static replaceOnce(source, marker, replacement) {
        SourceText.requireCount(source, marker, 1);
        return SourceText.replace(source, marker, replacement);
    }

    /** Validate the number of occurrences expected by a source patch. */
    static requireCount(source, marker, count) {
        if (source.split(marker).length - 1 !== count)
            throw Error(`Upstream preparation pattern changed: ${marker.slice(0, 80)}`);
    }

    /** Extract a function or switch, retaining its signature and balanced braces. */
    static function(source, signature) {
        const start = SourceText.index(source, signature);
        let end = SourceText.index(source, '{', start) + 1;
        let depth = 1;
        while (depth && end < source.length) {
            const character = source[end++];
            if (character === '{') depth++;
            else if (character === '}') depth--;
        }
        if (depth) throw Error(`Unterminated source block: ${signature}`);
        return source.slice(start, end);
    }

    /** Split configuration macros while keeping quoted strings and nested expressions intact. */
    static elements(source) {
        source = SourceText.replace(source, '\\\n', ' ');
        const elements = [];
        for (const match of source.matchAll(/ELEM_\(/g)) {
            const start = match.index + match[0].length;
            let depth = 0, quoted = false, escaped = false, last = start;
            const args = [];
            for (let index = start; index < source.length; index++) {
                const character = source[index];
                if (quoted) {
                    if (escaped) escaped = false;
                    else if (character === '\\') escaped = true;
                    else if (character === '"') quoted = false;
                } else if (character === '"') quoted = true;
                else if (character === '(') depth++;
                else if (character === ')') {
                    if (depth === 0) {
                        args.push(source.slice(last, index).trim());
                        break;
                    }
                    depth--;
                } else if (character === ',' && depth === 0) {
                    args.push(source.slice(last, index).trim());
                    last = index + 1;
                }
            }
            if (args.length === 5 && /^\w+$/.test(args[1])) elements.push(args);
        }
        return elements;
    }

    /** Extract the native modulation envelope and limiter, replacing the sound-card output. */
    static modemHelpers(root, include) {
        const base = SourceText.read(join(root, 'trx/modem.cxx'));
        const quality = base.match(/int modem::get_quality\(int mode\).*?return get_quality\(mode\);\s*}/s)[0];
        SourceText.write(join(include, 'web_modem_quality.h'), quality + '\n');
        const modulation = base.slice(SourceText.index(base, 'void modem::ModulateXmtr'));
        const envelope = modulation.slice(SourceText.index(modulation, '\tint num ='),
            SourceText.index(modulation, '\tif (progdefaults.PTTrightchannel)'));
        const level = modulation.slice(SourceText.index(modulation, '\tdouble mult ='), SourceText.index(modulation, '\n\ttry {'));
        const transmit = 'void modem::ModulateXmtr(double* buffer,int len) {\nif(!buffer||len<1)return;\ntx_sample_rate=samplerate;tx_sample_count+=len;\nconst double SIGLIMIT=0.95;\n' +
            envelope + level + '\nweb_tx_audio(buffer,len);\n}\n';
        SourceText.write(join(include, 'web_modem_transmit.h'), transmit);
        return { quality, transmit };
    }
}
