'use strict';

// 多维标签数据层测试：node --experimental-vm-modules tests/tags.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const j = (v) => JSON.parse(JSON.stringify(v));

async function loadData() {
    const context = vm.createContext({ console, JSON, Math, Date });
    const source = fs.readFileSync(path.join(ROOT, 'src', 'data.js'), 'utf8');
    const mod = new vm.SourceTextModule(source, { context, identifier: 'data.js' });
    await mod.link(() => { throw new Error('data.js 不应有外部依赖'); });
    await mod.evaluate();
    return mod.namespace;
}

async function run() {
    const D = await loadData();

    // ── 1. 三组定义 ──
    assert.deepEqual(j(D.TAG_GROUP_KEYS), ['scene', 'garment', 'impression']);
    assert.equal(D.TAG_GROUPS.length, 3);
    assert.deepEqual(j(D.emptyTags()), { scene: [], garment: [], impression: [] });

    // ── 2. normalizeTagList：trim / 合并空格 / 去重 / 非字符串过滤 / 限长 ──
    assert.deepEqual(j(D.normalizeTagList(['  通勤 ', '通勤', '', 'a   b', null, 3, 'x'.repeat(40)])), ['通勤', 'a b', 'x'.repeat(24)]);
    assert.deepEqual(j(D.normalizeTagList('not-array')), []);

    // ── 3. normalizeTags：坏输入降级；garment 兼容字符串/对象；同级合并 subs ──
    assert.deepEqual(j(D.normalizeTags(null)), { scene: [], garment: [], impression: [] });
    assert.deepEqual(
        j(D.normalizeTags({ scene: ['雨天', '雨天'], garment: ['风衣'], unknown: ['x'] })),
        { scene: ['雨天'], garment: [{ base: '风衣', subs: [] }], impression: [] }
    );
    assert.deepEqual(
        j(D.normalizeTags({ garment: [
            { base: '高领衫', subs: ['驼色', '驼色', '针织'] },
            { base: '高领衫', subs: ['红色'] },
            '百褶裙'
        ] })),
        { scene: [], garment: [{ base: '高领衫', subs: ['驼色', '针织', '红色'] }, { base: '百褶裙', subs: [] }], impression: [] }
    );

    // ── 4. splitLegacySceneTag：多种分隔符 ──
    assert.deepEqual(j(D.splitLegacySceneTag('外出 / 家居、约会，睡前')), ['外出', '家居', '约会', '睡前']);
    assert.deepEqual(j(D.splitLegacySceneTag('   ')), []);
    assert.deepEqual(j(D.splitLegacySceneTag(undefined)), []);

    // ── 5. ensureOutfitTags：旧 sceneTag 迁移进 tags.scene ──
    const legacy = { id: 'o1', sceneTag: '外出 / 家居' };
    D.ensureOutfitTags(legacy);
    assert.deepEqual(j(legacy.tags.scene), ['外出', '家居']);
    assert.equal(legacy.sceneTag, '外出 / 家居');

    const withTags = { sceneTag: '旧的', tags: { scene: ['通勤'], garment: ['衬衫'], impression: ['干练'] } };
    D.ensureOutfitTags(withTags);
    assert.deepEqual(j(withTags.tags.scene), ['通勤']);
    assert.equal(withTags.sceneTag, '通勤');

    const empty = {};
    D.ensureOutfitTags(empty);
    assert.deepEqual(j(empty.tags), { scene: [], garment: [], impression: [] });
    assert.equal(empty.sceneTag, '');

    // ── 6. getOutfitTags 不污染原对象，setOutfitTags 同步 sceneTag ──
    const o2 = { id: 'o2' };
    const got = D.getOutfitTags(o2);
    got.scene.push('不该写回');
    assert.deepEqual(j(D.getOutfitTags(o2).scene), []);
    D.setOutfitTags(o2, { scene: ['约会', '晚餐'], garment: ['连衣裙'], impression: ['性感'] });
    assert.equal(o2.sceneTag, '约会 / 晚餐');

    // ── 7. addOutfitTag / addOutfitGarmentSub / removeOutfitTag / outfitHasTags ──
    D.addOutfitTag(o2, 'garment', '高跟鞋');
    D.addOutfitTag(o2, 'garment', '高跟鞋'); // 重复添加不重复入列
    assert.deepEqual(j(D.getOutfitTags(o2).garment), [{ base: '连衣裙', subs: [] }, { base: '高跟鞋', subs: [] }]);
    D.addOutfitGarmentSub(o2, '高跟鞋', '黑色');
    D.addOutfitGarmentSub(o2, '高跟鞋', '细跟');
    D.addOutfitGarmentSub(o2, '高跟鞋', '黑色'); // 重复不加
    assert.deepEqual(j(D.getOutfitTags(o2).garment[1]), { base: '高跟鞋', subs: ['黑色', '细跟'] });
    D.addOutfitGarmentSub(o2, '新单品', '米色'); // 单品不存在时连建
    assert.deepEqual(j(D.getOutfitTags(o2).garment[2]), { base: '新单品', subs: ['米色'] });
    D.addOutfitTag(o2, 'bogus', 'x'); // 非法组名不改变结构
    assert.deepEqual(Object.keys(j(o2.tags)).sort(), ['garment', 'impression', 'scene']);
    D.removeOutfitTag(o2, 'garment', '连衣裙');
    assert.deepEqual(j(D.getOutfitTags(o2).garment.map((g) => g.base)), ['高跟鞋', '新单品']);
    assert.equal(D.outfitHasTags(o2), true);
    assert.equal(D.outfitHasTags({}), false);
    assert.equal(D.outfitHasTags({ sceneTag: '仅旧字段' }), false, 'outfitHasTags 只看 tags');

    // ── 8. 文本工具：garmentItemText / flattenGarmentTags / outfitTagText ──
    assert.equal(D.garmentItemText({ base: '高领衫', subs: ['驼色', '针织'] }, '、'), '高领衫（驼色、针织）');
    assert.equal(D.garmentItemText({ base: '高领衫', subs: [] }), '高领衫');
    assert.deepEqual(j(D.flattenGarmentTags({ garment: [{ base: '高领衫', subs: ['驼色'] }, { base: '百褶裙', subs: [] }] })), ['高领衫', '驼色', '百褶裙']);
    assert.equal(D.outfitTagText(o2, '|'), '约会|晚餐|高跟鞋|黑色|细跟|新单品|米色|性感');

    // ── 9. collectTagsByGroup / collectGarmentSuggestions / tagTree ──
    const p1 = { outfits: [{ tags: { scene: ['通勤'], garment: [{ base: '衬衫', subs: ['白色'] }], impression: [] } }, { sceneTag: '通勤 / 雨天' }] };
    const p2 = { outfits: [{ tags: { scene: ['雨天'], garment: [{ base: '衬衫', subs: ['蓝色'] }, { base: '外套', subs: [] }], impression: ['干练'] } }] };
    const collected = D.collectTagsByGroup([p1, p2]);
    assert.deepEqual(j(collected.scene), ['通勤', '雨天']);
    assert.deepEqual(j(collected.garment), ['衬衫', '外套']);
    assert.deepEqual(j(collected.impression), ['干练']);

    const gsug = D.collectGarmentSuggestions([p1, p2], { garment: { 高领衫: ['驼色'] } });
    assert.deepEqual(j(gsug.bases).sort(), ['外套', '衬衫', '高领衫'].sort());
    assert.deepEqual(j(gsug.subsByBase['衬衫']).sort(), ['白色', '蓝色'].sort());
    assert.deepEqual(j(gsug.subsByBase['高领衫']), ['驼色']);

    const meta0 = D.defMeta();
    assert.deepEqual(j(meta0.tagTree), { garment: {} });
    D.noteTagTreeUsage(meta0, { garment: [{ base: '高领衫', subs: ['驼色', '针织'] }] });
    assert.deepEqual(j(meta0.tagTree.garment['高领衫']), ['驼色', '针织']);
    D.noteTagTreeUsage(meta0, { garment: [{ base: '高领衫', subs: ['驼色', '宽松'] }] });
    assert.deepEqual(j(meta0.tagTree.garment['高领衫']), ['驼色', '针织', '宽松']);

    // ── 10. ensurePartDefaults 会就地迁移 outfit 标签 ──
    const part = D.defPartition();
    part.outfits.push({ id: 'x1', sceneTag: '通勤 / 雨天', kits: [] });
    D.ensurePartDefaults(part);
    assert.deepEqual(j(part.outfits[0].tags.scene), ['通勤', '雨天']);

    // ── 11. AI prompt 默认值要求输出三组标签 + 旧 prompt 自动升级 ──
    const meta = D.defMeta();
    assert.ok(meta.apiVision.prompt.indexOf('tags') !== -1, '默认 prompt 必须要求 tags');
    ['"scene"', '"garment"', '"impression"', '"base"', '"subs"'].forEach(function (k) {
        assert.ok(meta.apiVision.prompt.indexOf(k) !== -1, '默认 prompt 必须包含 ' + k);
    });
    assert.ok(meta.apiVision.tagPrompt, '默认必须有 tagPrompt');
    ['scene', 'garment', 'impression', 'base', 'subs'].forEach(function (g) {
        assert.ok(meta.apiVision.tagPrompt.indexOf(g) !== -1, 'tagPrompt 必须提到 ' + g);
    });

    const oldCfg = { prompt: D.LEGACY_VISION_PROMPT };
    D.upgradeLegacyVisionPrompt(oldCfg);
    assert.equal(oldCfg.prompt, D.VISION_PROMPT_DEFAULT);

    const prevCfg = { prompt: D.PREV_VISION_PROMPT_FLAT };
    D.upgradeLegacyVisionPrompt(prevCfg);
    assert.equal(prevCfg.prompt, D.VISION_PROMPT_DEFAULT, '上一版扁平 garment 默认 prompt 也要升级');

    const customCfg = { prompt: '我自己的提示词' };
    D.upgradeLegacyVisionPrompt(customCfg);
    assert.equal(customCfg.prompt, '我自己的提示词', '用户自定义 prompt 不能被覆盖');

    D.upgradeLegacyVisionPrompt(null); // 不应抛错

    console.log('✅ tags.test.cjs 全部通过');
}

run().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
