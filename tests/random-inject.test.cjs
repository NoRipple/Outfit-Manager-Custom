'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

async function run() {
    // ── 共享可变数据 ──
    const sharedPart = {
        outfits: [
            { id: 'o1', description: '西装外套', sceneTag: 'office', kits: [] },
            { id: 'o2', description: '休闲T恤', sceneTag: 'home', kits: [] },
            { id: 'o3', description: '晚礼服', sceneTag: 'party', kits: [] },
            { id: 'o4', description: '运动服', sceneTag: 'sport', kits: [] },
            { id: 'o5', description: '风衣', sceneTag: 'street', kits: [] }
        ],
        activeIds: ['o1', 'o2', 'o3', 'o4', 'o5']
    };

    const meta = {
        _version: 2,
        mode: 'text',
        injectPosition: 'user',
        randomInject: true,
        randomInjectCount: 2,
        singleTemplate: '[User]\n{{description}}',
        multiTemplate: '[User可选]\n{{wardrobe}}',
        charSingleTemplate: '[{{charName}}当前穿着]\n{{description}}',
        charMultiTemplate: '[{{charName}}的可选穿搭]\n{{wardrobe}}',
        imagePrompt: '',
        multiImagePrompt: '',
        debug: false
    };

    let capturedBody = null;
    const origFetch = (input, init) => {
        capturedBody = init ? init.body : null;
        return Promise.resolve({ ok: true, status: 200 });
    };

    const window = {
        __omCompletionEventInjectionInstalled: true,
        fetch: origFetch
    };
    class XHR { send() {} }

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
        SillyTavern: { getContext: () => ({ name2: 'Alice' }) },
        window,
        XMLHttpRequest: XHR
    });

    const source = fs.readFileSync(path.join(ROOT, 'src', 'inject.js'), 'utf8');
    const mod = new vm.SourceTextModule(source, { context, identifier: path.join(ROOT, 'src', 'inject.js') });

    await mod.link(async (specifier) => {
        if (specifier === './db.js') {
            return new vm.SyntheticModule(['loadMeta', 'loadActivePartitions', 'currentUserPartKey', 'charNameById'], function () {
                this.setExport('loadMeta', () => meta);
                this.setExport('loadActivePartitions', () => ({ 'char:__shared__': sharedPart }));
                this.setExport('currentUserPartKey', () => 'user:__default__');
                this.setExport('charNameById', () => '');
            }, { context });
        }
        if (specifier === './data.js') {
            return new vm.SyntheticModule(['SHARED_CHAR_KEY', 'partGetById', 'getActiveKit', 'getKitAccessories', 'getOutfitImages', 'getOutfitImageCount'], function () {
                this.setExport('SHARED_CHAR_KEY', '__shared__');
                this.setExport('partGetById', (part, id) => (part.outfits || []).find((o) => o.id === id) || null);
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

    mod.namespace.setupInjection();

    const body = JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] });
    const countBlocks = (s) => (s.match(/\[穿搭\d\]/g) || []).length;
    const descsIn = (s) => (['西装外套', '休闲T恤', '晚礼服', '运动服', '风衣'].filter((d) => s.indexOf(d) !== -1));

    // 第 1 次注入：随机选取 randomInjectCount=2 套，生成缓存切片
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    const first = capturedBody;
    assert.ok(first, 'first injection should produce a body');
    assert.equal(countBlocks(first), 2, 'first injection should pick exactly 2 outfits');
    assert.equal(descsIn(first).length, 2, 'first injection should contain exactly 2 distinct outfits');

    // 第 2 次注入：复用缓存，应产出与第 1 次完全一致的内容
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    const second = capturedBody;
    assert.equal(second, first, 'subsequent injection must reuse the cached random slice');

    // 激活列表变化（sig 变化）→ 重新生成缓存切片
    sharedPart.activeIds = ['o3', 'o4'];
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    const regenerated = capturedBody;
    assert.equal(countBlocks(regenerated), 2, 'regenerated slice should pick 2 (both of the new active set)');
    assert.ok(descsIn(regenerated).indexOf('晚礼服') !== -1 && descsIn(regenerated).indexOf('运动服') !== -1,
        'regenerated slice should come from the new active set');

    // 关闭随机注入 → 注入全部激活穿搭，缓存被清空
    meta.randomInject = false;
    sharedPart.activeIds = ['o1', 'o2', 'o3'];
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    const full = capturedBody;
    assert.equal(countBlocks(full), 3, 'when disabled, all active shared outfits are injected');

    console.log('random-inject: pass (slice on first / cache reuse / regenerate on change / disable → full)');
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
