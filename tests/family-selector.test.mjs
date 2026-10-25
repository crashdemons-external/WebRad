import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatGroups, matchesFormat } from '../src/app/catalog.js';
import { WebRadApplication } from '../src/app/application.js';

const formats = JSON.parse(await readFile(new URL('../build/out/formats.json', import.meta.url))).formats;

function createApplication(t) {
    const previous = { location: globalThis.location, document: globalThis.document };
    globalThis.location = { search: '' };
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    });
    const application = new WebRadApplication();
    application.state.formats = formats;
    application.state.formatId = formats.find((format) => format.family === 'CW').id;
    return application;
}

test('text families use recognizable names in alphabetical order', () => {
    const groups = formatGroups(formats, 'text', 'encode');
    assert.deepEqual(groups.map((group) => group.name), [
        'ACARS', 'APRS', 'AX.25', 'Computer cassette', 'Contestia', 'CW', 'DominoEX', 'DTMF',
        'FSQ', 'FT8 / FT4', 'ggwave', 'Hellschreiber', 'IFKP', 'MDC-1200', 'MFSK', 'MT63',
        'NAVTEX', 'Olivia', 'Pagers & radio codes', 'PSK', 'RTTY', 'SCAMP', 'Spectrogram',
        'Terminal modems', 'THOR', 'Throb', 'WSPR'
    ]);
    assert.equal(groups.find((group) => group.family === 'CW').label, 'CW — Morse code');
    assert.equal(groups.find((group) => group.family === 'APRS').label, 'APRS — locations & messages');
    assert.equal(formatGroups(formats, 'picture', 'decode')[0].id, 'pictures-auto:Pictures');
    assert.equal(formatGroups(formats, 'picture', 'encode').find((group) => group.engine === 'apt').name, 'NOAA APT');
});

test('family reordering preserves all compatible variants, native order and catalog data', () => {
    const original = JSON.stringify(formats);
    for (const direction of ['encode', 'decode']) {
        for (const content of ['text', 'picture', 'file', 'voice', 'sensor']) {
            const expected = new Map();
            for (const format of formats) {
                if (!(direction === 'encode' ? format.inputs : format.outputs).includes(content)) continue;
                const key = `${format.engine}:${format.family}`;
                if (!expected.has(key)) expected.set(key, []);
                expected.get(key).push(format.id);
            }
            const groups = formatGroups(formats, content, direction);
            assert.equal(groups.length, expected.size, `${direction} ${content}`);
            for (const group of groups) {
                assert.deepEqual(group.formats.map((format) => format.id), expected.get(group.id), group.id);
            }
        }
    }
    assert.equal(JSON.stringify(formats), original);
});

test('mixed-family labels reflect receive-only protocols and filtered search results', () => {
    const sending = formatGroups(formats, 'text', 'encode');
    const receiving = formatGroups(formats, 'text', 'decode');
    assert.equal(sending.find((group) => group.engine === 'dispatch').name, 'MDC-1200');
    assert.equal(receiving.find((group) => group.engine === 'dispatch').name, 'MDC-1200 / FleetSync');
    assert.equal(sending.find((group) => group.family === 'AX.25').name, 'AX.25');
    assert.equal(receiving.find((group) => group.family === 'AX.25').name, 'AX.25 / AIS');
    for (const query of ['ACARS', 'WSPR', 'FT8', 'NOAA APT', 'Morse code', 'Terminal modems']) {
        assert.ok(formats.some((format) => matchesFormat(format, query)), query);
    }
    const ais = formats.filter((format) => matchesFormat(format, 'ship identification'));
    assert.equal(formatGroups(ais, 'text', 'decode').find((group) => group.engine === 'packet').name, 'AIS');
    const fleet = formats.filter((format) => matchesFormat(format, 'FleetSync'));
    assert.equal(formatGroups(fleet, 'text', 'decode').find((group) => group.engine === 'dispatch').name, 'FleetSync');
});

test('family controls retain selection and disable both selectors and exploration while busy', (t) => {
    const application = createApplication(t);
    const selected = application.current();
    let markup = application.view.formatControls();
    assert.match(markup, /<option value="fldigi:CW" selected>CW — Morse code<\/option>/);
    assert.ok(markup.includes(`<option value="${selected.id}" selected>`));
    assert.match(markup, /<button[^>]*data-action="formats"[^>]*>Explore formats<\/button>/);
    assert.match(markup, /format and variant must match/);
    application.state.busy = true;
    markup = application.view.formatControls();
    assert.match(markup, /<select id="format-family" disabled>/);
    assert.match(markup, /<select id="format-variant" disabled>/);
    assert.match(markup, /data-action="formats" disabled>/);

    application.state.busy = false;
    application.invalidate = () => {};
    application.persist = () => {};
    application.view.render = () => {};
    const target = application.selectedGroups().find((group) => group.name === 'WSPR');
    application.handleChange({ target: { id: 'format-family', value: target.id } });
    assert.equal(application.state.formatId, target.formats[0].id);
    assert.equal(application.current().engine, 'beacon');
});

test('explorer follows family order, highlights its first match and keeps native variant order', (t) => {
    const application = createApplication(t);
    const nodes = { '#format-list': {}, '#format-detail': {} };
    globalThis.document = { querySelector: (selector) => nodes[selector] || null };
    Object.assign(application.state, { direction: 'decode', chooserContent: 'text', candidate: 'missing', search: '', chooserAll: false });
    application.view.paintFormats();
    const firstFamily = application.selectedGroups()[0];
    assert.equal(application.state.candidate, firstFamily.formats[0].id);
    assert.match(nodes['#format-list'].innerHTML, /class="format-option active"[^>]*><svg[\s\S]*?<strong>ACARS<\/strong>/);
    assert.ok(nodes['#format-list'].innerHTML.indexOf('<strong>ACARS</strong>') < nodes['#format-list'].innerHTML.indexOf('<strong>APRS</strong>'));

    application.state.search = 'FleetSync';
    application.view.paintFormats();
    assert.match(nodes['#format-list'].innerHTML, /<strong>FleetSync<\/strong>/);
    assert.equal(application.current().family, 'CW', 'exploration does not change the active format');
    assert.equal(application.state.candidate, 'dispatch-fleet');

    application.state.search = 'no such signal family';
    application.view.paintFormats();
    assert.match(nodes['#format-list'].innerHTML, /No compatible formats/);
    assert.equal(nodes['#format-detail'].innerHTML, '');

    Object.assign(application.state, { search: '', chooserAll: true });
    application.view.paintFormats();
    const rows = [...nodes['#format-list'].innerHTML.matchAll(/data-candidate="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(rows, application.selectedGroups().flatMap((group) => group.formats).map((format) => format.id));
});
