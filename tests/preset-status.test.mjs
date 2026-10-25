import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WebRadApplication } from '../src/app/application.js';
import { defaultsFor, groupsFor } from '../src/app/settings.js';

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
    application.state.formatId = formats.find(format => format.nativeName === 'CW' && format.presetSettings.cwSpeed === 5).id;
    application.settings();
    return application;
}

test('named presets keep their labels while Advanced marks control changes', (t) => {
    const application = createApplication(t);
    const view = application.view;
    const format = application.current();
    assert.equal(view.changedSettingCount(), 0);
    assert.equal(view.formatOptionName(format), format.name);
    assert.doesNotMatch(view.advancedButton(), /modified|setting-count/);

    application.settings().frequency += 100;
    assert.equal(view.changedSettingCount(), 1, 'changes outside the preset overrides also count');
    assert.equal(view.formatOptionName(format), format.name);
    for (const direction of ['encode', 'decode']) {
        application.state.direction = direction;
        assert.doesNotMatch(view.formatControls(), /preset-status|Preset adjusted|preset-modified|Modified| · modified/);
    }
    assert.match(view.advancedButton(), /advanced-button modified/);
    assert.match(view.advancedButton(), /1 changed setting"/);
    application.settings().cwSpeed += 1;
    assert.equal(view.changedSettingCount(), 2);
    assert.match(view.advancedButton(), /2 changed settings/);

    const other = formats.find(entry => entry.nativeName === 'CW' && entry.id !== format.id);
    assert.equal(view.formatOptionName(other), other.name, 'unchanged presets keep their original labels');
});

test('editing and restoring settings updates individual Advanced indicators in place', (t) => {
    const application = createApplication(t);
    const indicators = ['frequency', 'cwSpeed', 'invertInput', 'channel'].map(key => ({
        dataset: { modifiedSetting: key }, hidden: true
    }));
    const dialog = { querySelectorAll: () => indicators };
    const button = {
        disabled: true,
        classList: { toggle(name, active) { button.modified = active; } }
    };
    const nodes = { '#advanced-dialog': dialog, '.advanced-button': button };
    globalThis.document = { querySelector: selector => nodes[selector] || null };
    application.invalidate = () => {};
    application.persist = () => {};
    application.view.paintSources = () => {};
    application.view.refreshFormatOptionLabels = () => {};
    application.updateSettingInput({ dataset: { setting: 'frequency' }, value: '1200' });
    assert.deepEqual(indicators.map(indicator => indicator.hidden), [false, true, true, true]);
    assert.equal(button.modified, true);
    assert.match(button.innerHTML, /1 changed setting/);
    assert.equal(button.disabled, true, 'status updates retain the busy state');

    application.updateSettingInput({
        dataset: { setting: 'frequency' }, value: String(defaultsFor(application.current()).frequency)
    });
    assert.ok(indicators.every(indicator => indicator.hidden));
    assert.equal(button.modified, false);
    assert.doesNotMatch(button.innerHTML, /setting-count/);

    application.updateSettingInput({ dataset: { setting: 'invertInput' }, checked: true });
    application.updateSettingInput({ dataset: { setting: 'channel' }, value: 'right' });
    assert.deepEqual(indicators.map(indicator => indicator.hidden), [true, true, false, false]);
    assert.match(button.innerHTML, /2 changed settings/);
});

test('Advanced field headings mark saved changes for every control type using preset defaults', (t) => {
    const application = createApplication(t);
    const fields = groupsFor(application.current(), 'decode').flatMap(group => group.fields);
    const settings = application.settings();
    for (const key of ['cwSpeed', 'channel', 'invertInput']) {
        const field = fields.find(field => field.key === key);
        const defaultMarkup = application.view.fieldHtml(field, settings, 'advanced-setting-');
        assert.match(defaultMarkup, new RegExp(`data-modified-setting="${key}" hidden>Modified</span>`));
        settings[key] = { cwSpeed: 20, channel: 'right', invertInput: true }[key];
        const changedMarkup = application.view.fieldHtml(field, settings, 'advanced-setting-');
        assert.match(changedMarkup, new RegExp(`data-modified-setting="${key}" >Modified</span>`));
        assert.doesNotMatch(application.view.fieldHtml(field, settings), /setting-modified/);
    }

    const textFormat = formats.find(format => groupsFor(format, 'decode').some(group =>
        group.fields.some(field => field.type === 'text')
    ));
    application.state.formatId = textFormat.id;
    const textField = groupsFor(textFormat, 'decode').flatMap(group => group.fields).find(field => field.type === 'text');
    application.settings()[textField.key] = 'CHANGED';
    const markup = application.view.fieldHtml(textField, application.settings(), 'advanced-setting-');
    assert.match(markup, /<label[^>]*>[^<]*<span class="setting-modified"[^>]* >Modified<\/span><\/label>/);
});

test('Reset this format clears modification cues and saves the selected preset defaults', (t) => {
    const application = createApplication(t);
    application.settings().cwSpeed = 20;
    let saved;
    application.invalidate = () => {};
    application.persist = () => { saved = structuredClone(application.settings()); };
    application.view.render = () => {};
    application.openAdvanced = () => {};
    globalThis.document = { querySelector: () => ({ close() {} }) };
    application.resetCurrentSettings();
    assert.equal(saved.cwSpeed, 5, 'reset uses this preset rather than the usual Morse speed');
    assert.equal(application.view.changedSettingCount(), 0);
    assert.doesNotMatch(application.view.advancedButton(), /modified|setting-count/);
    assert.equal(application.view.formatOptionName(application.current()), application.current().name);
});
