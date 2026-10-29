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
        imagePolicy: 'auto',
        modelImageSupport: {},
        debug: false
    };

    const OUTFIT2 = {
        id: 'o2',
        name: '蓝色连衣裙',
        description: '蓝色棉麻连衣裙，裙摆到小腿。',
        images: ['/api/plugins/outfit-manager/images/def.jpg'],
        tags: { scene: ['日常'], garment: [{ base: '连衣裙', subs: ['蓝色'] }], impression: ['清爽'] }
    };
    let stubOutfits = [OUTFIT];

    let captured = null;
    let rejectImagesOnce = false;
    const okResponse = () => ({ ok: true, status: 200, clone: () => ({ text: () => Promise.resolve('') }) });
    const badResponse = (msg) => ({
        ok: false,
        status: 400,
        clone: () => ({ text: () => Promise.resolve(msg) }),
        text: () => Promise.resolve(msg)
    });
    const window = {
        __omCompletionEventInjectionInstalled: true,
        __omNewChatRefreshInstalled: true,
        fetch: (input, init) => {
            const body = init ? init.body : null;
            if (rejectImagesOnce && body && body.indexOf('"image_url"') !== -1) {
                rejectImagesOnce = false;
                captured = body;
                return Promise.resolve(badResponse('{"error":{"message":"Unsupported image_url format"}}'));
            }
            captured = body;
            return Promise.resolve(okResponse());
        }
    };

    const context = vm.createContext({
        console, Promise, Math, JSON, Object, Array, String, Number, Boolean, Date, Error, URL, setTimeout, clearTimeout,
        location: { href: 'https://st.local/', origin: 'https://st.local' },
        SillyTavern: { getContext: () => ({ name2: 'Alice', chat: [] }) },
        window
    });

    const source = fs.readFileSync(path.join(ROOT, 'src', 'inject.js'), 'utf8');
    const mod = new vm.SourceTextModule(source, { context, identifier: path.join(ROOT, 'src', 'inject.js') });

    await mod.link(async (specifier) => {
        if (specifier === './db.js') {
            return new vm.SyntheticModule(['loadMeta', 'saveMeta', 'loadActivePartitions', 'currentUserPartKey', 'charNameById', 'resolveImageForExternal'], function () {
                this.setExport('loadMeta', () => meta);
                this.setExport('saveMeta', (m) => { Object.assign(meta, m); });
                this.setExport('loadActivePartitions', () => ({
                    'char:__shared__': { outfits: stubOutfits, activeIds: stubOutfits.map(o => o.id), categories: [], accessories: [], accCategories: [] }
                }));
                this.setExport('currentUserPartKey', () => 'user:__default__');
                this.setExport('charNameById', () => '');
                this.setExport('resolveImageForExternal', (u, cb) => cb('data:image/jpeg;base64,AAA' + String(u).slice(-8)));
            }, { context });
        }
        if (specifier === './data.js') {
            return new vm.SyntheticModule(['SHARED_CHAR_KEY', 'partGetById', 'getActiveKit', 'getKitAccessories', 'getOutfitImages', 'getOutfitImageCount', 'getOutfitTags', 'garmentItemText', 'MARKER_TEMPLATE_DEFAULT'], function () {
                this.setExport('SHARED_CHAR_KEY', '__shared__');
                this.setExport('MARKER_TEMPLATE_DEFAULT', '【穿搭标注】用 <Outfit-Manager-Custom>{{example}}</Outfit-Manager-Custom> 标注；可用：{{list}}。');
                this.setExport('partGetById', (part, id) => stubOutfits.find(o => o.id === id) || null);
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
            return new vm.SyntheticModule(['state'], function () { this.setExport('state', { resolvedImages: {} }); }, { context });
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
    assert.ok(tagTextImg.indexOf('data:image/jpeg;base64,') !== -1, '标签+文字+图片：图片必须是 data URL（接口只认 data:/http(s)）');
    assert.equal(tagTextImg.indexOf('"/api/plugins/outfit-manager/images/'), -1, '标签+文字+图片：不应把相对路径直接发给接口');

    // ── 旧配置兼容：没有 injectMode 时按 tag_text 处理（不炸、不注入图片） ──
    delete meta.injectMode;
    captured = null;
    const legacyBody = JSON.stringify({ messages: [{ role: 'user', content: '旧配置：D' }] });
    await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body: legacyBody });
    assert.ok(captured.indexOf('【场景：通勤】') !== -1, '旧配置：应默认带标签');
    assert.equal(captured.indexOf('image_url'), -1, '旧配置：默认不注入图片');

    // ── 正文穿搭标记提示（markerEnabled） ──
    meta.injectMode = 'tag_text';
    meta.markerEnabled = true;
    const withMark = await injectOnce('tag_text', 'E');
    assert.ok(withMark.indexOf('<Outfit-Manager-Custom>') !== -1, '标记提示：应包含正文标记说明');
    assert.ok(withMark.indexOf('测试穿搭') !== -1, '标记提示：应列出可用穿搭名称');
    assert.ok(withMark.indexOf('Alice') !== -1, '标记提示：应带上衣柜主人名');

    meta.markerEnabled = false;
    const noMark = await injectOnce('tag_text', 'F');
    assert.equal(noMark.indexOf('<Outfit-Manager-Custom>'), -1, '标记提示：关闭后不应包含标记说明');
    delete meta.markerEnabled;

    // ── 图片能力：不按模型名猜（deepseek-v4.1-flash 这类多模态模型必须能收到图） ──
    meta.injectMode = 'tag_text_image';
    captured = null;
    const mmBody = JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: '多模态模型：G' }] });
    await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body: mmBody });
    assert.ok(captured, '多模态：应捕获请求体');
    assert.ok(captured.indexOf('image_url') !== -1, '多模态：未学过拒绝时应当照常带图');

    // ── 已学到该模型不收图片：直接跳过图片 ──
    meta.modelImageSupport = { 'deepseek-v4.1-flash': false };
    captured = null;
    await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body: mmBody });
    assert.equal(captured.indexOf('image_url'), -1, '已学习：该模型不应再塞图片');
    assert.ok(captured.indexOf('【场景：通勤】') !== -1, '已学习：仍应带标签');

    // ── 手动「从不带图」 ──
    meta.modelImageSupport = {};
    meta.imagePolicy = 'never';
    captured = null;
    await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body: mmBody });
    assert.equal(captured.indexOf('image_url'), -1, '策略 never：不应带图');

    // ── 实测学习：接口拒绝图片时，自动去掉图片重发一次，并记住该模型 ──
    meta.imagePolicy = 'auto';
    meta.modelImageSupport = {};
    rejectImagesOnce = true;
    captured = null;
    const res = await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body: mmBody });
    assert.equal(res.ok, true, '学习：重发后应拿到成功响应');
    assert.ok(captured, '学习：重发应捕获请求体');
    assert.equal(captured.indexOf('image_url'), -1, '学习：重发的请求体不应包含图片');
    assert.equal(meta.modelImageSupport['deepseek-v4.1-flash'], false, '学习：应记住该模型不接受图片');

    // 跳过上一楼已穿：识别最后一条 AI 回复 + 判断穿搭是否被提到
    const ns = mod.namespace;
    assert.equal(ns.lastAssistantText({ messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: '我穿着测试穿搭出门了' }] }), '我穿着测试穿搭出门了', '跳过：应取最后一条 assistant 正文');
    assert.equal(ns.lastAssistantText({ messages: [{ role: 'assistant', content: '第一楼' }, { role: 'user', content: '第二楼用户' }] }), '第一楼', '跳过：只看 assistant，用户消息不算');
    assert.equal(ns.outfitMentioned('我穿着测试穿搭出门了', OUTFIT), true, '跳过：名字被提到应命中');
    assert.equal(ns.outfitMentioned('她换上了另一件裙子', OUTFIT), false, '跳过：没提到不应命中');
    assert.equal(ns.outfitMentioned('穿搭', OUTFIT), false, '跳过：名字太短（<3 字）不参与判断，避免误杀');
    assert.equal(ns.outfitMentioned('', OUTFIT), false, '跳过：空正文不应命中');

    // 跳过上一楼已穿（集成）：两套激活，上一楼提到 A → 只发 B
    stubOutfits = [OUTFIT, OUTFIT2];
    meta.injectMode = 'tag_text';
    meta.skipSentOutfits = true;
    captured = null;
    await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [
        { role: 'user', content: '今天穿什么' },
        { role: 'assistant', content: '她换上了测试穿搭就出门了。' },
        { role: 'user', content: '继续' }
    ] }) });
    assert.ok(captured.indexOf('蓝色棉麻连衣裙') !== -1, '跳过：未被提到的穿搭应照常发送');
    assert.equal(captured.indexOf('白色衬衫配米色长裤'), -1, '跳过：上一楼已提到的穿搭不应再发');

    // 全部都被提到时保留，避免一条服装信息都没有
    captured = null;
    await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [
        { role: 'assistant', content: '她先穿测试穿搭，后来换了蓝色连衣裙。' },
        { role: 'user', content: '继续' }
    ] }) });
    assert.ok(captured.indexOf('白色衬衫配米色长裤') !== -1 && captured.indexOf('蓝色棉麻连衣裙') !== -1, '跳过：全被提到时应保留原样');

    // 开关关闭时不做跳过
    meta.skipSentOutfits = false;
    captured = null;
    await window.fetch('https://st.local/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [
        { role: 'assistant', content: '她换上了测试穿搭就出门了。' },
        { role: 'user', content: '继续' }
    ] }) });
    assert.ok(captured.indexOf('白色衬衫配米色长裤') !== -1, '跳过关闭：已提到也照常发送');
    stubOutfits = [OUTFIT];
    meta.skipSentOutfits = true;

    console.log('inject-mode: pass (tag / tag_text / tag_text_image / 旧配置默认 / 标记提示 / 多模态照常带图 / 已学习跳过 / never 策略 / 拒绝后自动重发)');
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
