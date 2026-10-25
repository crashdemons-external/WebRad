import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { ApplicationView } from '../src/app/application-view.js';

const source = await readFile(new URL('../src/app/theme.js', import.meta.url), 'utf8');

function createTheme({ dark = false, saved = null, blocked = false, storeSettings = true } = {}) {
    const documentEvents = new Map();
    const windowEvents = new Map();
    const mediaEvents = new Map();
    const writes = [];
    const storage = new Map(saved === null ? [] : [['webrad.theme', saved]]);
    if (!storeSettings) storage.set('webrad.storage', 'off');
    const button = {
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; }
    };
    const root = { dataset: {} };
    const meta = {};
    const media = {
        matches: dark,
        addEventListener(name, handler) { mediaEvents.set(name, handler); }
    };
    const document = {
        documentElement: root,
        querySelector: () => meta,
        querySelectorAll: () => [button],
        addEventListener(name, handler) { documentEvents.set(name, handler); }
    };
    runInNewContext(source, {
        document,
        window: {
            matchMedia(query) {
                assert.equal(query, '(prefers-color-scheme: dark)');
                return media;
            },
            addEventListener(name, handler) { windowEvents.set(name, handler); }
        },
        localStorage: {
            getItem(key) {
                if (blocked) throw Error('Storage denied');
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                if (blocked) throw Error('Storage denied');
                writes.push([key, value]);
                storage.set(key, value);
            }
        }
    });
    return {
        root, meta, button, document, storage, writes,
        click() { documentEvents.get('click')({ target: { closest: () => button } }); },
        systemTheme(dark) { media.matches = dark; mediaEvents.get('change')(); },
        storageChange(key = 'webrad.theme') { windowEvents.get('storage')({ key }); },
        storageChoice(enabled) { windowEvents.get('webrad-storage-change')({ detail: { enabled } }); }
    };
}

test('browser theme is applied immediately and followed without saving a preference', () => {
    for (const dark of [false, true]) {
        const theme = createTheme({ dark });
        assert.equal(theme.root.dataset.theme, dark ? 'dark' : 'light');
        theme.systemTheme(!dark);
        assert.equal(theme.root.dataset.theme, dark ? 'light' : 'dark');
        assert.equal(theme.button.attributes['aria-pressed'], String(!dark));
        assert.deepEqual(theme.writes, []);
    }
});

test('saved choices override the browser while invalid values follow it', () => {
    for (const saved of ['light', 'dark']) {
        const theme = createTheme({ dark: saved === 'light', saved });
        assert.equal(theme.root.dataset.theme, saved);
        theme.systemTheme(saved === 'light');
        assert.equal(theme.root.dataset.theme, saved);
    }
    assert.equal(createTheme({ dark: true, saved: 'invalid' }).root.dataset.theme, 'dark');
});

test('icon clicks persist the choice, ignore later browser changes and restore after reload', () => {
    const theme = createTheme();
    theme.click();
    assert.equal(theme.root.dataset.theme, 'dark');
    assert.equal(theme.button.attributes['aria-pressed'], 'true');
    assert.equal(theme.button.title, 'Switch to light mode');
    assert.equal(theme.meta.content, '#14191c');
    assert.deepEqual(theme.writes, [['webrad.theme', 'dark']]);
    theme.systemTheme(true);
    theme.systemTheme(false);
    assert.equal(theme.root.dataset.theme, 'dark');
    assert.equal(createTheme({ saved: theme.storage.get('webrad.theme') }).root.dataset.theme, 'dark');
    theme.click();
    assert.equal(theme.root.dataset.theme, 'light');
    assert.equal(theme.storage.get('webrad.theme'), 'light');
});

test('denied storage still supports browser changes and an explicit in-memory choice', () => {
    const theme = createTheme({ dark: true, blocked: true });
    theme.systemTheme(false);
    assert.equal(theme.root.dataset.theme, 'light');
    theme.click();
    theme.systemTheme(false);
    assert.equal(theme.root.dataset.theme, 'dark');
});

test('storage opt-out keeps appearance changes in memory and saving again retains the current choice', () => {
    const theme = createTheme({ saved: 'dark', storeSettings: false });
    assert.equal(theme.root.dataset.theme, 'light', 'opt-out skips a previously saved appearance');
    theme.storage.delete('webrad.theme');
    theme.click();
    assert.equal(theme.root.dataset.theme, 'dark');
    assert.deepEqual(theme.writes, []);
    theme.storage.delete('webrad.storage');
    theme.storageChoice(true);
    assert.equal(theme.storage.get('webrad.theme'), 'dark');
    theme.storage.set('webrad.storage', 'off');
    theme.storage.delete('webrad.theme');
    theme.storageChoice(false);
    assert.equal(theme.root.dataset.theme, 'dark', 'disabling storage retains the current appearance');
    theme.click();
    assert.equal(theme.root.dataset.theme, 'light');
    assert.equal(theme.storage.has('webrad.theme'), false);
});

test('other tabs update the theme and removing the preference resumes browser tracking', () => {
    const theme = createTheme({ saved: 'light', dark: true });
    theme.storage.set('webrad.theme', 'dark');
    theme.storageChange('webrad.settings.v1');
    assert.equal(theme.root.dataset.theme, 'light');
    theme.storageChange();
    assert.equal(theme.root.dataset.theme, 'dark');
    theme.storage.clear();
    theme.storageChange(null);
    theme.systemTheme(false);
    assert.equal(theme.root.dataset.theme, 'light');
    assert.deepEqual(theme.writes, []);
});

test('re-rendered headers keep the icon-only toggle before Help, available during processing', (t) => {
    const previous = globalThis.document;
    t.after(() => {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    });
    const theme = createTheme({ dark: true });
    globalThis.document = theme.document;
    const view = new ApplicationView({ state: { direction: 'encode', busy: true } });
    const header = view.header();
    assert.match(header, /class="theme-toggle" aria-label="Dark mode" aria-pressed="true"/);
    const toggle = header.match(/<button[^>]+class="theme-toggle"[^>]*>[\s\S]*?<\/button>/)[0];
    assert.doesNotMatch(toggle, /disabled|<span/);
    assert.ok(header.indexOf('class="theme-toggle"') < header.indexOf('data-action="help"'));
    theme.click();
    assert.match(view.header(), /class="theme-toggle" aria-label="Dark mode" aria-pressed="false"/);
});

function luminance(hex) {
    const channels = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

test('audio player borders contrast with both themes and primary buttons retain readable text', async () => {
    const css = await readFile(new URL('../src/app/styles.css', import.meta.url), 'utf8');
    const themes = css.matchAll(/:root(?:\[data-theme='dark'\])? \{([^}]+)\}/g);
    let count = 0;
    for (const [, declarations] of themes) {
        const colors = Object.fromEntries([...declarations.matchAll(/--([\w-]+): (#[a-f\d]+);/gi)].map(([, key, color]) => [key, color]));
        for (const surface of ['panel', 'surface', 'surface-soft']) {
            let color = colors[surface].slice(0, 7);
            if (color === '#fff') color = '#ffffff';
            assert.ok(contrast(colors['audio-border'], color) >= 3, `${surface} audio border contrast`);
        }
        assert.ok(contrast(colors.primary, '#ffffff') >= 4.5, 'primary button text contrast');
        assert.ok(contrast(colors['modified-ink'], colors['modified-surface']) >= 4.5, 'modified setting text contrast');
        count++;
    }
    assert.equal(count, 2);
    const playerCss = await readFile(new URL('../src/app/application.css', import.meta.url), 'utf8');
    assert.match(playerCss, /\.audio-player \{[^}]*border: 1px solid var\(--audio-border\)/);
});
