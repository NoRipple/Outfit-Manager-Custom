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
        __omNewChatRefreshInstalled: true,
        fetch: origFetch
    };
    class XHR { send() {} }

    // 可控随机：randomSeq 顺序取值，取空后回退 0.5，保证切分结果可断言
    const randomSeq = [];
    const fakeMath = Object.create(Math);
    fakeMath.random = () => (randomSeq.length ? randomSeq.shift() : 0.5);

    const context = vm.createContext({
        console,
        Promise,
        Math: fakeMath,
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

    // 第 1 次注入：randomSeq=[0,0] → 确定抽到 [o1,o2]
    randomSeq.length = 0; randomSeq.push(0, 0);
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    const first = capturedBody;
    assert.ok(first, 'first injection should produce a body');
    assert.equal(countBlocks(first), 2, 'first injection should pick exactly 2 outfits');
    assert.ok(first.indexOf('西装外套') !== -1 && first.indexOf('休闲T恤') !== -1,
        'deterministic first slice should be [o1,o2] (西装外套, 休闲T恤)');

    // 第 2 次注入：缓存复用，内容应与第 1 次完全一致（不消费 randomSeq）
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    const second = capturedBody;
    assert.equal(second, first, 'subsequent injection must reuse the cached random slice');

    // clearRandomInjectCache()：清空缓存 → 换 randomSeq 后重新随机 → 切片应变化
    assert.equal(typeof mod.namespace.clearRandomInjectCache, 'function', 'clearRandomInjectCache should be exported');
    mod.namespace.clearRandomInjectCache();
    randomSeq.length = 0; randomSeq.push(0.99, 0.99);
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    const refreshed = capturedBody;
    assert.ok(refreshed !== first, 'after clearing the cache a new slice should be generated');
    assert.equal(countBlocks(refreshed), 2, 'refreshed slice should still pick 2');

    // 激活列表变化（sig 变化）→ 重新生成缓存切片
    sharedPart.activeIds = ['o3', 'o4'];
    randomSeq.length = 0; randomSeq.push(0.99, 0.99);
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

    // 注入总开关：injectEnabled=false → 完全不注入（body 保持不变）
    meta.injectEnabled = false;
    sharedPart.activeIds = ['o1', 'o2'];
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    assert.equal(capturedBody, body, 'when injectEnabled=false the request body must not be modified');
    meta.injectEnabled = true;
    await window.fetch('https://st.local/api/chat', { method: 'POST', body });
    assert.notEqual(capturedBody, body, 're-enabling injectEnabled should inject again');

    // 注入间隔：injectEvery=N 时按会话用户消息楼层注入（第 1、N+1、2N+1...轮）
    meta.injectEvery = 2;
    meta.randomInject = false;
    sharedPart.activeIds = ['o1', 'o2'];
    function makeBody(userCount) {
        var msgs = [{ role: 'system', content: 'sys' }];
        for (var i = 0; i < userCount; i++) {
            if (i > 0) msgs.push({ role: 'assistant', content: 'a' + i });
            msgs.push({ role: 'user', content: 'u' + (i + 1) });
        }
        return JSON.stringify({ messages: msgs });
    }
    var b1 = makeBody(1);
    await window.fetch('https://st.local/api/chat', { method: 'POST', body: b1 });
    assert.notEqual(capturedBody, b1, 'turn 1 (1 user msg) should inject');
    var b2 = makeBody(2);
    await window.fetch('https://st.local/api/chat', { method: 'POST', body: b2 });
    assert.equal(capturedBody, b2, 'turn 2 (2 user msgs) should be skipped');
    var b3 = makeBody(3);
    await window.fetch('https://st.local/api/chat', { method: 'POST', body: b3 });
    assert.notEqual(capturedBody, b3, 'turn 3 (3 user msgs) should inject');
    var b4 = makeBody(4);
    await window.fetch('https://st.local/api/chat', { method: 'POST', body: b4 });
    assert.equal(capturedBody, b4, 'turn 4 (4 user msgs) should be skipped');
    meta.injectEvery = 1;

    console.log('random-inject: pass (slice on first / cache reuse / clear→refresh / regenerate on change / disable → full / injectEnabled off / injectEvery floor)');
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
