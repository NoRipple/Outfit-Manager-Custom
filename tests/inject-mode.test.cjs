'use strict';

// 注入内容类型（injectMode）测试：
//   tag            仅标签
//   tag_text       标签 + 文字
//   tag_text_image 标签 + 文字 + 图片

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

const OUTFIT = {
    id: 'o1',
    name: '测试穿搭',
    description: '白色衬衫配米色长裤，腰间系细皮带。',
    images: ['/api/plugins/outfit-manager/images/abc.jpg'],
    tags: {
        scene: ['通勤'],
        garment: [{ base: '衬衫', subs: ['白色'] }],
        impression: ['干练']
    }
};

async function run() {
    const meta = {
        _version: 2,
        injectEnabled: true,
        injectMode: 'tag_text',
        injectPosition: 'user',
        randomInject: false,
        singleTemplate: '[U]\n{{description}}',
        multiTemplate: '[U可选]\n{{wardrobe}}',
        charSingleTemplate: '[{{charName}}当前穿着]\n{{description}}',
        charMultiTemplate: '[{{charName}}的可选穿搭]\n{{wardrobe}}',
        imagePrompt: '图中为角色当前穿着。',
        multiImagePrompt: '以上为可选穿搭。',
        debug: false
    };

    let captured = null;
    const window = {
        __omCompletionEventInjectionInstalled: true,
        __omNewChatRefreshInstalled: true,
        fetch: (input, init) => {
            captured = init ? init.body : null;
            return Promise.resolve({ ok: true, status: 200 });
        }
    };

    const context = vm.createContext({
        console, Promise, Math, JSON, Object, Array, String, Number, Boolean, Date, Error, URL,
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
                this.setExport('loadActivePartitions', () => ({
                    'char:__shared__': { outfits: [OUTFIT], activeIds: ['o1'], categories: [], accessories: [], accCategories: [] }
                }));
                this.setExport('currentUserPartKey', () => 'user:__default__');
                this.setExport('charNameById', () => '');
            }, { context });
        }
        if (specifier === './data.js') {
            return new vm.SyntheticModule(['SHARED_CHAR_KEY', 'partGetById', 'getActiveKit', 'getKitAccessories', 'getOutfitImages', 'getOutfitImageCount', 'getOutfitTags', 'garmentItemText'], function () {
                this.setExport('SHARED_CHAR_KEY', '__shared__');
                this.setExport('partGetById', (part, id) => (id === 'o1' ? OUTFIT : null));
                this.setExport('getActiveKit', () => null);
                this.setExport('getKitAccessories', () => []);
                this.setExport('getOutfitImages', (o) => (o && o.images) || []);
                this.setExport('getOutfitImageCount', (o) => ((o && o.images) || []).length);
                this.setExport('getOutfitTags', (o) => (o && o.tags) || { scene: [], garment: [], impression: [] });
                this.setExport('garmentItemText', (g, sep) => {
                    const subs = (g && g.subs) || [];
                    return g.base + (subs.length ? '（' + subs.join(sep || '、') + '）' : '');
                });
            }, { context });
        }
        if (specifier === './utils.js') {
            return new vm.SyntheticModule(['toast'], function () { this.setExport('toast', () => {}); }, { context });
        }
        if (specifier === './bridge.js') {
            return new vm.SyntheticModule(['state'], function () { this.setExport('state', {}); }, { context });
        }
        throw new Error('Unexpected import: ' + specifier);
    });
    await mod.evaluate();
    mod.namespace.setupInjection();

    async function injectOnce(mode, tag) {
        meta.injectMode = mode;
        captured = null;
        const body = JSON.stringify({ messages: [{ role: 'user', content: '今天出门：' + tag }] });
        await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body });
        assert.ok(captured, mode + '：注入后应捕获到请求体');
        return captured;
    }

    // ── 仅标签 ──
    const onlyTag = await injectOnce('tag', 'A');
    assert.ok(onlyTag.indexOf('【场景：通勤】') !== -1, '仅标签：应包含场景标签');
    assert.ok(onlyTag.indexOf('【服装：衬衫（白色）】') !== -1, '仅标签：应包含服装标签与二级词');
    assert.ok(onlyTag.indexOf('【气质：干练】') !== -1, '仅标签：应包含气质标签');
    assert.equal(onlyTag.indexOf('白色衬衫配米色长裤'), -1, '仅标签：不应包含描述文字');
    assert.equal(onlyTag.indexOf('image_url'), -1, '仅标签：不应注入图片');

    // ── 标签 + 文字 ──
    const tagText = await injectOnce('tag_text', 'B');
    assert.ok(tagText.indexOf('【场景：通勤】') !== -1, '标签+文字：应包含标签');
    assert.ok(tagText.indexOf('白色衬衫配米色长裤') !== -1, '标签+文字：应包含描述文字');
    assert.equal(tagText.indexOf('image_url'), -1, '标签+文字：不应注入图片');

    // ── 标签 + 文字 + 图片 ──
    const tagTextImg = await injectOnce('tag_text_image', 'C');
    assert.ok(tagTextImg.indexOf('白色衬衫配米色长裤') !== -1, '标签+文字+图片：应包含描述文字');
    assert.ok(tagTextImg.indexOf('image_url') !== -1, '标签+文字+图片：应注入图片块');
    assert.ok(tagTextImg.indexOf('abc.jpg') !== -1, '标签+文字+图片：应包含图片地址');

    // ── 旧配置兼容：没有 injectMode 时按 tag_text 处理（不炸、不注入图片） ──
    delete meta.injectMode;
    captured = null;
    const legacyBody = JSON.stringify({ messages: [{ role: 'user', content: '旧配置：D' }] });
    await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body: legacyBody });
    assert.ok(captured.indexOf('【场景：通勤】') !== -1, '旧配置：应默认带标签');
    assert.equal(captured.indexOf('image_url'), -1, '旧配置：默认不注入图片');

    console.log('inject-mode: pass (tag / tag_text / tag_text_image / 旧配置默认)');
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
