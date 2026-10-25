import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WebRadApplication } from '../src/app/application.js';
import { defaultsFor, restoreSettings, settingsVersion } from '../src/app/settings.js';

const formats = JSON.parse(await readFile(new URL('../build/out/formats.json', import.meta.url))).formats;

test('Hellschreiber modes use native receive widths and migrate the old shared default', () => {
    const widths = new Map([
        ['FELDHELL', 245],
        ['SLOWHELL', 30],
        ['HELLX5', 1225],
        ['HELLX9', 2205],
        ['FSKH245', 250],
        ['FSKH105', 120],
        ['HELL80', 450]
    ]);
    assert.equal(settingsVersion, 5);
    for (const format of formats.filter((entry) => entry.family === 'Hellschreiber')) {
        const modeWidth = widths.get(format.name);
        assert.equal(defaultsFor(format).hellBandwidth, modeWidth, `${format.name}: native default`);
        assert.equal(restoreSettings(format, { hellBandwidth: 245 }, 3).hellBandwidth, modeWidth, `${format.name}: old shared default`);
        assert.equal(restoreSettings(format, { hellBandwidth: 500 }, 3).hellBandwidth, 500, `${format.name}: old custom width`);
        assert.equal(restoreSettings(format, { hellBandwidth: 500, hellBandwidthCustom: false }, 4).hellBandwidth, modeWidth, `${format.name}: ignored v4 value`);
        assert.equal(restoreSettings(format, { hellBandwidth: 245, hellBandwidthCustom: true }, 4).hellBandwidth, 245, `${format.name}: explicit v4 value`);
    }
});

function createApplication(t, entries = []) {
    const previous = {};
    for (const key of ['location', 'localStorage', 'document', 'window', 'fetch']) previous[key] = globalThis[key];
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    });
    const storage = new Map(entries);
    const events = new Map();
    const dispatched = [];
    const order = [];
    const status = {};
    const radios = [{ value: 'local' }, { value: 'session' }];
    const dialogs = Object.fromEntries(['utility', 'advanced'].map(name => [`#${name}-dialog`, {
        innerHTML: '',
        close() { order.push(`${name}:close`); },
        showModal() { order.push(`${name}:open`); }
    }]));
    const localStorage = {
        blocked: false,
        getItem(key) {
            if (this.blocked) throw Error('Storage denied');
            return storage.get(key) ?? null;
        },
        setItem(key, value) {
            if (this.blocked) throw Error('Storage denied');
            storage.set(key, value);
        },
        removeItem(key) {
            if (this.blocked) throw Error('Storage denied');
            storage.delete(key);
        }
    };
    globalThis.location = { search: '' };
    globalThis.localStorage = localStorage;
    globalThis.document = {
        querySelector: selector => dialogs[selector] || (selector === '#storage-status' ? status : null),
        querySelectorAll: () => radios,
        addEventListener() {}
    };
    globalThis.window = {
        addEventListener: (name, handler) => events.set(name, handler),
        dispatchEvent: event => dispatched.push(event)
    };
    const application = new WebRadApplication();
    application.state.formats = formats;
    application.state.formatId = formats.find(format => format.nativeName === 'CW').id;
    application.settings();
    return { application, storage, events, dispatched, dialogs, order, status, radios, localStorage };
}

test('settings storage is enabled by default and saves Advanced controls and the input device', (t) => {
    const { application, storage, dialogs } = createApplication(t);
    application.settings().frequency += 100;
    application.state.liveDevice = 'chosen-microphone';
    assert.equal(application.state.storeSettings, true);
    assert.equal(application.persist(), true);
    const saved = JSON.parse(storage.get('webrad.settings.v1'));
    assert.equal(saved.settings[application.state.formatId].frequency, application.settings().frequency);
    assert.equal(saved.liveDevice, 'chosen-microphone');
    assert.equal(saved.version, settingsVersion);
    application.openSettings();
    assert.match(dialogs['#utility-dialog'].innerHTML, /value="local" checked/);
    assert.match(dialogs['#utility-dialog'].innerHTML, /class="link" data-action="import-settings"/);
    assert.match(dialogs['#utility-dialog'].innerHTML, /data-action="settings-advanced"/);
});

test('turning storage off removes only stored copies and retains all current Advanced selections', (t) => {
    const { application, storage, radios, dispatched, status } = createApplication(t, [
        ['webrad.theme', 'dark'], ['other-app', 'keep']
    ]);
    application.settings().frequency += 100;
    application.state.liveDevice = 'chosen-microphone';
    application.persist();
    const currentSettings = structuredClone(application.state.settings);
    application.handleChange({ target: { name: 'settings-storage', value: 'session' } });
    assert.deepEqual(application.state.settings, currentSettings);
    assert.equal(application.state.liveDevice, 'chosen-microphone');
    assert.equal(storage.has('webrad.settings.v1'), false);
    assert.equal(storage.has('webrad.theme'), false);
    assert.equal(storage.get('other-app'), 'keep');
    assert.equal(storage.get('webrad.storage'), 'off');
    assert.equal(radios[1].checked, true);
    assert.equal(dispatched[0].detail.enabled, false);
    assert.match(status.textContent, /current settings are still available/);

    application.invalidate = () => {};
    application.view.paintSources = () => {};
    application.view.paintPresetStatus = () => {};
    application.view.refreshFormatOptionLabels = () => {};
    application.updateSettingInput({ dataset: { setting: 'frequency' }, value: '1200' });
    assert.equal(application.settings().frequency, 1200, 'Advanced input changes remain usable in memory');
    assert.equal(storage.has('webrad.settings.v1'), false, 'Advanced edits do not recreate stored settings');
    application.setSettingsStorage(true);
    assert.equal(storage.has('webrad.storage'), false);
    assert.equal(JSON.parse(storage.get('webrad.settings.v1')).settings[application.state.formatId].frequency, 1200);
    assert.equal(application.settings().frequency, 1200);
});

test('startup honors opt-out before restoring or writing preferences', async (t) => {
    const format = formats.find(entry => entry.nativeName === 'CW');
    const savedSettings = { ...defaultsFor(format), frequency: 1200 };
    const { application, storage } = createApplication(t, [
        ['webrad.storage', 'off'],
        ['webrad.settings.v1', JSON.stringify({ version: settingsVersion, settings: { [format.id]: savedSettings }, liveDevice: 'old-device' })]
    ]);
    application.state.settings = {};
    application.bindEvents = () => {};
    application.view.render = () => {};
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ formats }) });
    const storedBefore = storage.get('webrad.settings.v1');
    await application.start();
    assert.equal(application.state.storeSettings, false);
    assert.equal(application.state.liveDevice, 'default');
    assert.equal(application.settings().frequency, defaultsFor(format).frequency);
    assert.equal(storage.get('webrad.settings.v1'), storedBefore, 'startup does not rewrite storage while disabled');
});

test('import and export use current in-memory settings without enabling persistence', async (t) => {
    const { application, storage } = createApplication(t, [['webrad.storage', 'off']]);
    const format = application.current();
    const imported = { ...defaultsFor(format), frequency: 1200 };
    const input = {
        files: [{ size: 100, text: async () => JSON.stringify({ version: settingsVersion, settings: { [format.id]: imported } }) }],
        click() {}
    };
    globalThis.document.createElement = () => input;
    application.view.render = () => {};
    application.notify = () => {};
    application.importSettings();
    await input.onchange();
    assert.equal(application.settings().frequency, 1200);
    assert.equal(application.state.storeSettings, false);
    assert.equal(storage.has('webrad.settings.v1'), false);
    let exported;
    application.download = blob => { exported = blob; };
    application.exportSettings();
    assert.equal(JSON.parse(await exported.text()).settings[format.id].frequency, 1200);
    assert.equal(storage.get('webrad.storage'), 'off');
});

test('Settings closes before opening the existing Advanced drawer with current controls', async (t) => {
    const { application, dialogs, order } = createApplication(t, [['webrad.storage', 'off']]);
    application.settings().frequency = 1200;
    application.openSettings();
    await application.perform('settings-advanced');
    assert.deepEqual(order, ['utility:open', 'utility:close', 'advanced:open']);
    assert.match(dialogs['#advanced-dialog'].innerHTML, /advanced-setting-frequency/);
    assert.match(dialogs['#advanced-dialog'].innerHTML, /value="1200"/);
    assert.match(dialogs['#advanced-dialog'].innerHTML, /Changed settings last only for this page/);
});

test('storage errors preserve session controls and report that the choice may not survive reload', (t) => {
    const { application, localStorage, status } = createApplication(t);
    application.settings().frequency = 1200;
    localStorage.blocked = true;
    application.setSettingsStorage(false);
    assert.equal(application.settings().frequency, 1200);
    assert.equal(application.persist(), false);
    assert.match(status.textContent, /may not be remembered after reload/);
});

test('an opt-out in another tab stops subsequent Advanced edits from writing preferences', (t) => {
    const { application, storage, events, radios } = createApplication(t);
    application.bindLifecycleEvents();
    storage.set('webrad.storage', 'off');
    events.get('storage')({ key: 'webrad.storage' });
    assert.equal(application.state.storeSettings, false);
    assert.equal(radios[1].checked, true);
    application.settings().frequency = 1200;
    assert.equal(application.persist(), false);
    assert.equal(storage.has('webrad.settings.v1'), false);
});
