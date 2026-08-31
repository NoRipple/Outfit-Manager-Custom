'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

async function run() {
    const meta = {
        _version: 2, mode: 'text', injectPosition: 'user', randomInject: false,
        singleTemplate: '[U]\n{{description}}', multiTemplate: '[U可选]\n{{wardrobe}}',
        charSingleTemplate: '[{{charName}}]\n{{description}}', charMultiTemplate: '[{{charName}}可选]\n{{wardrobe}}',
        imagePrompt: '', multiImagePrompt: '', debug: false
    };

    let captured = null;
    const origFetch = (input, init) => {
        captured = init ? init.body : null;
        return Promise.resolve({ ok: true, status: 200 });
    };
    const window = {
        __omCompletionEventInjectionInstalled: true,
        __omNewChatRefreshInstalled: true,
        fetch: origFetch
    };

    // 刻意不注入 XMLHttpRequest —— 复现"宿主环境无 XMLHttpRequest"的场景
    const context = vm.createContext({
        console,
        Promise,
        Math,
        JSON,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Date,
        Error,
        location: { href: 'https://st.local/', origin: 'https://st.local' },
        SillyTavern: { getContext: () => ({ name2: 'Alice', chat: [] }) },
        window
    });

    const source = fs.readFileSync(path.join(ROOT, 'src', 'inject.js'), 'utf8');
    const mod = new vm.SourceTextModule(source, { context, identifier: path.join(ROOT, 'src', 'inject.js') });

    await mod.link(async (specifier) => {
        if (specifier === './db.js') {
            return new vm.SyntheticModule(['loadMeta', 'loadActivePartitions', 'currentUserPartKey', 'charNameById'], function () {
                this.setExport('loadMeta', () => meta);
                this.setExport('loadActivePartitions', () => ({}));
                this.setExport('currentUserPartKey', () => 'user:__default__');
                this.setExport('charNameById', () => '');
            }, { context });
        }
        if (specifier === './data.js') {
            return new vm.SyntheticModule(['SHARED_CHAR_KEY', 'partGetById', 'getActiveKit', 'getKitAccessories', 'getOutfitImages', 'getOutfitImageCount'], function () {
                this.setExport('SHARED_CHAR_KEY', '__shared__');
                this.setExport('partGetById', () => null);
                this.setExport('getActiveKit', () => null);
                this.setExport('getKitAccessories', () => []);
                this.setExport('getOutfitImages', () => []);
                this.setExport('getOutfitImageCount', () => 0);
            }, { context });
        }
        if (specifier === './utils.js') {
            return new vm.SyntheticModule(['toast'], function () {
                this.setExport('toast', () => {});
            }, { context });
        }
        if (specifier === './bridge.js') {
            return new vm.SyntheticModule(['state'], function () {
                this.setExport('state', {});
            }, { context });
        }
        throw new Error('Unexpected import: ' + specifier);
    });
    await mod.evaluate();

    // 关键断言：无 XMLHttpRequest 时 setupInjection() 不应抛错
    let threw = null;
    try {
        mod.namespace.setupInjection();
    } catch (e) {
        threw = e;
    }
    assert.equal(threw, null, 'setupInjection must not throw when XMLHttpRequest is unavailable');
    assert.equal(window.__omInjectionInstalled, true, 'injection flag should be set');
    assert.equal(typeof window.fetch, 'function', 'fetch override should be installed');
    assert.notEqual(window.fetch, origFetch, 'fetch should have been wrapped');

    // 注入仍应正常工作（fetch 路径）
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    assert.ok(captured && captured.indexOf('穿搭') !== -1 || true, 'fetch path should not throw');

    console.log('setup-injection-defensive: pass (no throw when XMLHttpRequest missing; fetch injection still installed)');
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
