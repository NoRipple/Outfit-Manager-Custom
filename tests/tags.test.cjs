'use strict';

// 多维标签数据层测试：node --experimental-vm-modules tests/tags.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

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
    assert.deepEqual(JSON.parse(JSON.stringify(D.TAG_GROUP_KEYS)), ['scene', 'garment', 'impression']);
    assert.equal(D.TAG_GROUPS.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(D.emptyTags())), { scene: [], garment: [], impression: [] });

    // ── 2. normalizeTagList：trim / 合并空格 / 去重 / 非字符串过滤 / 限长 ──
    assert.deepEqual(
        JSON.parse(JSON.stringify(D.normalizeTagList(['  通勤 ', '通勤', '', 'a   b', null, 3, 'x'.repeat(40)]))),
        ['通勤', 'a b', 'x'.repeat(24)]
    );
    assert.deepEqual(JSON.parse(JSON.stringify(D.normalizeTagList('not-array'))), []);

    // ── 3. normalizeTags：坏输入降级为空三组 ──
    assert.deepEqual(JSON.parse(JSON.stringify(D.normalizeTags(null))), { scene: [], garment: [], impression: [] });
    assert.deepEqual(
        JSON.parse(JSON.stringify(D.normalizeTags({ scene: ['雨天', '雨天'], garment: ['风衣'], unknown: ['x'] }))),
        { scene: ['雨天'], garment: ['风衣'], impression: [] }
    );

    // ── 4. splitLegacySceneTag：多种分隔符 ──
    assert.deepEqual(JSON.parse(JSON.stringify(D.splitLegacySceneTag('外出 / 家居、约会，睡前'))), ['外出', '家居', '约会', '睡前']);
    assert.deepEqual(JSON.parse(JSON.stringify(D.splitLegacySceneTag('   '))), []);
    assert.deepEqual(JSON.parse(JSON.stringify(D.splitLegacySceneTag(undefined))), []);

    // ── 5. ensureOutfitTags：旧 sceneTag 迁移进 tags.scene ──
    const legacy = { id: 'o1', sceneTag: '外出 / 家居' };
    D.ensureOutfitTags(legacy);
    assert.deepEqual(JSON.parse(JSON.stringify(legacy.tags.scene)), ['外出', '家居']);
    assert.equal(legacy.sceneTag, '外出 / 家居');

    // 已有 tags 时不覆盖，并回写 sceneTag
    const withTags = { sceneTag: '旧的', tags: { scene: ['通勤'], garment: ['衬衫'], impression: ['干练'] } };
    D.ensureOutfitTags(withTags);
    assert.deepEqual(JSON.parse(JSON.stringify(withTags.tags.scene)), ['通勤']);
    assert.equal(withTags.sceneTag, '通勤');

    // 空 outfit 也不炸
    const empty = {};
    D.ensureOutfitTags(empty);
    assert.deepEqual(JSON.parse(JSON.stringify(empty.tags)), { scene: [], garment: [], impression: [] });
    assert.equal(empty.sceneTag, '');

    // ── 6. getOutfitTags 不污染原对象，setOutfitTags 同步 sceneTag ──
    const o2 = { id: 'o2' };
    const got = D.getOutfitTags(o2);
    got.scene.push('不该写回');
    assert.deepEqual(JSON.parse(JSON.stringify(D.getOutfitTags(o2).scene)), []);
    D.setOutfitTags(o2, { scene: ['约会', '晚餐'], garment: ['连衣裙'], impression: ['性感'] });
    assert.equal(o2.sceneTag, '约会 / 晚餐');

    // ── 7. addOutfitTag / removeOutfitTag / outfitHasTags ──
    D.addOutfitTag(o2, 'garment', '高跟鞋');
    D.addOutfitTag(o2, 'garment', '高跟鞋'); // 重复添加不重复入列
    assert.deepEqual(JSON.parse(JSON.stringify(D.getOutfitTags(o2).garment)), ['连衣裙', '高跟鞋']);
    D.addOutfitTag(o2, 'bogus', 'x'); // 非法组名不改变结构
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(o2.tags))).sort(), ['garment', 'impression', 'scene']);
    D.removeOutfitTag(o2, 'garment', '连衣裙');
    assert.deepEqual(JSON.parse(JSON.stringify(D.getOutfitTags(o2).garment)), ['高跟鞋']);
    assert.equal(D.outfitHasTags(o2), true);
    assert.equal(D.outfitHasTags({}), false);
    assert.equal(D.outfitHasTags({ sceneTag: '仅旧字段' }), false, 'outfitHasTags 只看 tags');

    // ── 8. outfitTagText 拼平所有组 ──
    assert.equal(D.outfitTagText(o2, '|'), '约会|晚餐|高跟鞋|性感');

    // ── 9. collectTagsByGroup：跨 partition 去重 ──
    const p1 = { outfits: [{ tags: { scene: ['通勤'], garment: ['衬衫'], impression: [] } }, { sceneTag: '通勤 / 雨天' }] };
    const p2 = { outfits: [{ tags: { scene: ['雨天'], garment: ['衬衫', '外套'], impression: ['干练'] } }] };
    const collected = D.collectTagsByGroup([p1, p2]);
    assert.deepEqual(JSON.parse(JSON.stringify(collected.scene)), ['通勤', '雨天']);
    assert.deepEqual(JSON.parse(JSON.stringify(collected.garment)), ['衬衫', '外套']);
    assert.deepEqual(JSON.parse(JSON.stringify(collected.impression)), ['干练']);

    // ── 10. ensurePartDefaults 会就地迁移 outfit 标签 ──
    const part = D.defPartition();
    part.outfits.push({ id: 'x1', sceneTag: '通勤 / 雨天', kits: [] });
    D.ensurePartDefaults(part);
    assert.deepEqual(JSON.parse(JSON.stringify(part.outfits[0].tags.scene)), ['通勤', '雨天']);

    // ── 11. AI prompt 默认值要求输出三组标签 + 旧 prompt 自动升级 ──
    const meta = D.defMeta();
    assert.ok(meta.apiVision.prompt.indexOf('tags') !== -1, '默认 prompt 必须要求 tags');
    assert.ok(meta.apiVision.prompt.indexOf('"scene"') !== -1);
    assert.ok(meta.apiVision.prompt.indexOf('"garment"') !== -1);
    assert.ok(meta.apiVision.prompt.indexOf('"impression"') !== -1);

    const oldCfg = { prompt: D.LEGACY_VISION_PROMPT };
    D.upgradeLegacyVisionPrompt(oldCfg);
    assert.equal(oldCfg.prompt, D.VISION_PROMPT_DEFAULT);

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
