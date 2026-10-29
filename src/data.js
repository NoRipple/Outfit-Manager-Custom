// ── 穿搭管理器 · 数据模型 v2 ──────────────────────────────
// meta 默认值 + partition 默认值 + 分类辅助 + partition 访问辅助

// ── 通用衣柜保留键 ─────────────────────────────────────────
export var SHARED_CHAR_KEY = '__shared__';
export var SHARED_CHAR_LABEL = '通用衣柜';

// ══════════════════════════════════════════════════════════
//  默认数据结构
// ══════════════════════════════════════════════════════════

// ── 描述生成 Prompt 默认值 ──
// 新版要求 AI 同时产出三组标签（服装组为两级：单品 + 二级词）；旧版默认 prompt 会被自动升级。
export var VISION_PROMPT_DEFAULT = '用JSON回复（不要代码块）：{"name":"穿搭名称6字以内","description":"描述服装类型颜色材质款式搭配，只写服装不写人，100-200字","tags":{"scene":["场景"],"garment":[{"base":"单品","subs":["颜色/材质/款式"]}],"impression":["气质"]}}';
export var LEGACY_VISION_PROMPT = '用JSON回复（不要代码块）：{"name":"穿搭名称6字以内","description":"描述服装类型颜色材质款式搭配，只写服装不写人，100-200字"}';
// 上一版（扁平 garment）默认 prompt，也自动升级成两级
export var PREV_VISION_PROMPT_FLAT = '用JSON回复（不要代码块）：{"name":"穿搭名称6字以内","description":"描述服装类型颜色材质款式搭配，只写服装不写人，100-200字","tags":{"scene":["场景"],"garment":["单品"],"impression":["气质"]}}';

// ── 正文穿搭标注规约（可在设置里改）──
// 占位符：{{example}} = 示例标记内容（如 墨绿雪纺短坎肩礼服/宋绮云+浅紫雪纺短坎肩礼服/王申爱）
//         {{list}}    = 当前可用的「衣柜名 → 穿搭名、穿搭名」清单
export var MARKER_TEMPLATE_DEFAULT =
    '【穿搭标注】本楼回复的最后另起一行，用 <Outfit-Manager-Custom>名称/角色</Outfit-Manager-Custom> 标出这一楼实际用到的穿搭，' +
    '多套用 + 连接，例如 <Outfit-Manager-Custom>{{example}}</Outfit-Manager-Custom>；名称必须与下面的清单完全一致，角色写衣柜主人。可用：{{list}}。';

// ── 标签分析 Prompt 默认值（独立接口，只产出 tags）──
// 用户可自行修改：往三个大类里塞什么词、怎么塞，都由这个提示词规定。
export var TAG_PROMPT_DEFAULT = [
    '你在给一套服装穿搭打标签。用户会给出穿搭名称、描述（可能还有图片、分类和已有标签）。',
    '只输出 JSON，不要代码块，不要解释，格式：',
    '{"tags":{"scene":[],"garment":[{"base":"单品","subs":["颜色/材质/款式"]}],"impression":[]}}',
    '三组的含义：',
    '- scene：场景/时机，例如 通勤、约会、雨天、居家、睡前、运动、宴会',
    '- garment：主要单品。每个单品写成 {"base":"单品名","subs":["二级词"]}，二级词是这个单品的颜色、材质、款式等特征（如 驼色、针织、宽松）；没有二级词就给空数组',
    '- impression：气质观感，例如 清纯、干练、性感、慵懒、甜美、帅气',
    '每个词 2-6 个汉字，只写词不写整句；某一组确实判断不出来就给空数组。'
].join('\n');

// 旧默认 prompt 自动升级（用户自定义过的 prompt 不动）
export function upgradeLegacyVisionPrompt(apiVision) {
    if (!apiVision || typeof apiVision !== 'object') return apiVision;
    if (apiVision.prompt === LEGACY_VISION_PROMPT || apiVision.prompt === PREV_VISION_PROMPT_FLAT) {
        apiVision.prompt = VISION_PROMPT_DEFAULT;
    }
    return apiVision;
}

// ── 注入内容类型（标签永远带；区别在文字与图片）──
export var INJECT_MODES = ['tag', 'tag_text', 'tag_text_image'];
export var INJECT_MODE_LABELS = {
    tag: '仅标签',
    tag_text: '标签 + 文字',
    tag_text_image: '标签 + 文字 + 图片'
};

// ── meta 默认值（全局设置 + 索引 + 激活追踪）──
export function defMeta() {
    return {
        _version: 2,

        // 预设索引（目录，不含 outfits）
        presets: [],
        activePresetId: null,       // null = user:__default__

        // 角色索引
        charIndex: [],              // [{ id, name, partKey }]
        charFavorites: [],          // charId 数组
        charGroups: {},             // { '组名': [charId, ...] }

        // 激活追踪（inject 预加载用）
        activePartitions: {},       // { partKey: [activeId, ...] }

        // UI 状态
        currentView: 'user',
        currentChar: '',            // 存 charId
        showBall: true,
        fabImage: '',
        fabSize: 38,
        fabPos: null,
        tagOrder: [],
        tagTree: { garment: {} },   // 二级标签字典：{ garment: { 单品: [二级词...] } }

        // 注入配置
        mode: 'text',
        injectMode: 'tag_text',     // 发送内容：tag 仅标签 / tag_text 标签+文字 / tag_text_image 标签+文字+图片
        injectEnabled: true,
        imagePolicy: 'auto',        // 图片策略：auto 实测学习 / always 始终带图 / never 从不带图
        modelImageSupport: {},      // { 模型名: false } 被接口拒绝过图片的模型
        markerEnabled: true,        // 要求 AI 在回复末尾标注本楼用到的穿搭（正文标记）
        markerTemplate: '',         // 标注规约模板（空=用 MARKER_TEMPLATE_DEFAULT），支持 {{example}} {{list}}
        skipSentOutfits: true,      // 上一楼正文已经提到过的穿搭，这一轮不再重复发送（省 token）
        injectPosition: 'user',
        // 随机注入（仅对通用衣柜生效）
        randomInject: false,
        randomInjectCount: 3,
        singleTemplate: '[User当前穿着]\n{{description}}\n（禁止编造其他服装。严禁集中罗列服装信息，服装细节必须分散融入不同的动作、触感、环境互动中，每次只带出一两个细节。）',
        multiTemplate: '[User的可选穿搭]\n{{wardrobe}}\n（禁止编造以上之外的服装。根据场景标签匹配穿搭，若回复中出现场景转换则对应切换穿搭。严禁集中罗列服装信息，服装细节必须分散融入动作、触感、环境互动中，每次只带出一两个细节。）',
        charSingleTemplate: '[{{charName}}当前穿着]\n{{description}}\n（禁止编造其他服装。严禁集中罗列服装信息，服装细节必须分散融入不同的动作、触感、环境互动中，每次只带出一两个细节。）',
        charMultiTemplate: '[{{charName}}的可选穿搭]\n{{wardrobe}}\n（禁止编造以上之外的服装。根据场景标签匹配穿搭，若回复中出现场景转换则对应切换穿搭。严禁集中罗列服装信息，服装细节必须分散融入动作、触感、环境互动中，每次只带出一两个细节。）',
        imagePrompt: '图中为角色当前穿着，禁止编造其他服装。严禁集中罗列，服装细节必须分散融入动作、触感、环境互动中，每次只带出一两个细节。',
        multiImagePrompt: '以上图片为可选穿搭，根据场景标签匹配，场景转换则切换穿搭，禁止编造其他服装。严禁集中罗列，细节分散融入动作和互动中。',
        debug: false,

        // API
        apiVision: {
            endpoint: '', key: '', model: '',
            prompt: VISION_PROMPT_DEFAULT,
            accPrompt: '用JSON回复（不要代码块）：{"name":"单品名称6字以内","description":"只描述图中的【{{accCategory}}】这一件单品，详细描述它的材质、颜色、款式、细节特征，不要描述其他服饰或整体穿搭，80-150字"}',
            tagPrompt: TAG_PROMPT_DEFAULT,
            promptTemplates: [],
            activePromptTemplateId: null,
            overwrite: false,
            useProxy: false          // 跨域请求走酒馆反向代理（本地大模型服务没开 CORS 时用）
        }
    };
}

// ── partition 默认值（outfits + 分类 + 激活选择 + 单品）──
export function defPartition() {
    return {
        outfits: [],
        categories: [],
        activeIds: [],
        accessories: [],       // 单品列表
        accCategories: []      // 单品分类（结构同 categories）
    };
}

// ══════════════════════════════════════════════════════════
//  数据规范化
// ══════════════════════════════════════════════════════════

export function ensureMetaDefaults(m) {
    var dm = defMeta();
    if (!m) return dm;
    // 旧配置迁移：以前只有 mode(text/image/both)，转成新的 injectMode
    if (m.injectMode === undefined) {
        m.injectMode = (m.mode === 'image' || m.mode === 'both') ? 'tag_text_image' : 'tag_text';
    }
    if (INJECT_MODES.indexOf(m.injectMode) === -1) m.injectMode = 'tag_text';
    for (var k in dm) { if (m[k] === undefined) m[k] = dm[k]; }
    if (!Array.isArray(m.presets)) m.presets = [];
    if (!Array.isArray(m.charIndex)) m.charIndex = [];
    if (!Array.isArray(m.charFavorites)) m.charFavorites = [];
    if (!m.charGroups || typeof m.charGroups !== 'object') m.charGroups = {};
    if (!m.activePartitions || typeof m.activePartitions !== 'object') m.activePartitions = {};
    if (!Array.isArray(m.tagOrder)) m.tagOrder = [];
    ensureTagTree(m);
    if (!m.apiVision) m.apiVision = defMeta().apiVision;
    else {
        var dv = defMeta().apiVision;
        for (var vk in dv) { if (m.apiVision[vk] === undefined) m.apiVision[vk] = dv[vk]; }
    }
    if (!Array.isArray(m.apiVision.promptTemplates)) m.apiVision.promptTemplates = [];
    if (m.apiVision.activePromptTemplateId === undefined) m.apiVision.activePromptTemplateId = null;
    upgradeLegacyVisionPrompt(m.apiVision);
    m._version = 2;
    return m;
}

export function ensurePartDefaults(p) {
    if (!p) return defPartition();
    if (!Array.isArray(p.outfits)) p.outfits = [];
    if (!Array.isArray(p.categories)) p.categories = [];
    if (!Array.isArray(p.activeIds)) p.activeIds = [];
    if (!Array.isArray(p.accessories)) p.accessories = [];
    if (!Array.isArray(p.accCategories)) p.accCategories = [];
    // 分类树形迁移
    p.categories = migrateCategories(p.categories);
    p.accCategories = migrateCategories(p.accCategories);
    // outfit kit / favorite 规范化
    p.outfits.forEach(function (o) {
        ensureOutfitKits(o);
        ensureOutfitImages(o);
        ensureOutfitTags(o);
        if (o.favorite === undefined) o.favorite = false;
    });
    return p;
}

// ══════════════════════════════════════════════════════════
//  分类迁移 + 辅助函数
// ══════════════════════════════════════════════════════════

// 扁平字符串数组 → 树形 [{name, children:[]}]
export function migrateCategories(cats) {
    if (!Array.isArray(cats) || cats.length === 0) return cats;
    if (cats[0] && typeof cats[0] === 'object' && cats[0].name !== undefined) return cats;
    return cats.map(function (c) { return { name: c, children: [] }; });
}

export function getCatNames(cats) {
    if (!Array.isArray(cats)) return [];
    return cats.map(function (c) { return typeof c === 'object' ? c.name : c; });
}

export function getSubCats(cats, parentName) {
    if (!Array.isArray(cats)) return [];
    for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        if (typeof c === 'object' && c.name === parentName) return c.children || [];
    }
    return [];
}

export function findCatObj(cats, name) {
    if (!Array.isArray(cats)) return null;
    for (var i = 0; i < cats.length; i++) {
        if (typeof cats[i] === 'object' && cats[i].name === name) return cats[i];
    }
    return null;
}

export function hasSubCats(cats, parentName) {
    return getSubCats(cats, parentName).length > 0;
}

export function outfitInCategory(o, catName) {
    return o.category === catName;
}

export function outfitInSubCategory(o, catName, subCatName) {
    return o.category === catName && o.subCategory === subCatName;
}

// ══════════════════════════════════════════════════════════
//  Partition 数据访问辅助
// ══════════════════════════════════════════════════════════

// 在 partition 内查找 outfit by id
export function partGetById(part, id) {
    if (!part || !part.outfits) return null;
    for (var i = 0; i < part.outfits.length; i++) {
        if (part.outfits[i].id === id) return part.outfits[i];
    }
    return null;
}

// 判断某 id 是否在 partition 的激活列表中
export function partIsActive(part, id) {
    if (!part || !part.activeIds) return false;
    return part.activeIds.indexOf(id) !== -1;
}

// ══════════════════════════════════════════════════════════
//  单品 (Accessory) 辅助函数
// ══════════════════════════════════════════════════════════

// 在 partition 内查找单品 by id
export function partGetAccById(part, id) {
    if (!part || !part.accessories) return null;
    for (var i = 0; i < part.accessories.length; i++) {
        if (part.accessories[i].id === id) return part.accessories[i];
    }
    return null;
}

// 确保 outfit 有合法的 kits 字段（懒补默认值）
export function ensureOutfitKits(o) {
    if (!o) return;
    if (!Array.isArray(o.kits)) o.kits = [];
    for (var i = 0; i < o.kits.length; i++) {
        var kit = o.kits[i];
        if (!kit || typeof kit !== 'object') {
            kit = {};
            o.kits[i] = kit;
        }
        if (!kit.id) kit.id = 'k_' + Date.now().toString(36) + '_' + i;
        if (!kit.name) kit.name = '套装' + (i + 1);
        if (!Array.isArray(kit.accIds)) kit.accIds = [];
        if (!Array.isArray(kit.disabledAccIds)) kit.disabledAccIds = [];
        var seen = {};
        kit.accIds = kit.accIds.filter(function (id) {
            if (!id || seen[id]) return false;
            seen[id] = true;
            return true;
        });
        var inKit = {};
        kit.accIds.forEach(function (id) { inKit[id] = true; });
        var seenDisabled = {};
        kit.disabledAccIds = kit.disabledAccIds.filter(function (id) {
            if (!id || !inKit[id] || seenDisabled[id]) return false;
            seenDisabled[id] = true;
            return true;
        });
    }
    // activeKitId 指向不存在的 kit 时置空
    if (o.activeKitId) {
        var found = false;
        for (var j = 0; j < o.kits.length; j++) {
            if (o.kits[j].id === o.activeKitId) { found = true; break; }
        }
        if (!found) o.activeKitId = null;
    }
}

// ── 多图辅助（outfit 图片由单张 imageData 扩展为 images 数组）──
// 归一化：旧数据只有 imageData，迁移为 images 数组
export function ensureOutfitImages(o) {
    if (!o) return;
    if (!Array.isArray(o.images)) {
        o.images = (typeof o.imageData === 'string' && o.imageData) ? [o.imageData] : [];
    }
}

// 返回穿搭的全部图片（优先 images，兼容旧 imageData 单图）
export function getOutfitImages(o) {
    if (!o) return [];
    if (Array.isArray(o.images) && o.images.length > 0) return o.images;
    if (typeof o.imageData === 'string' && o.imageData) return [o.imageData];
    return [];
}

// 主图 = 第一张
export function getOutfitPrimaryImage(o) {
    var imgs = getOutfitImages(o);
    return imgs.length > 0 ? imgs[0] : null;
}

export function getOutfitImageCount(o) {
    return getOutfitImages(o).length;
}

// 列表缩略图：优先 o.thumb（图库导入时生成的小图），没有就返回 null 由调用方回退原图
export function getOutfitThumb(o) {
    if (!o) return null;
    var t = typeof o.thumb === 'string' ? o.thumb.trim() : '';
    return t || null;
}

// ══════════════════════════════════════════════════════════
//  多维标签（scene 场景 / garment 服装 / impression 气质）
//  scene / impression：自由文本多选
//  garment：两级 —— 每个单品 { base, subs }，subs 是颜色/材质/款式等二级词
// ══════════════════════════════════════════════════════════

export var TAG_GROUPS = [
    { key: 'scene', label: '场景', hint: '什么时候穿：通勤 / 约会 / 雨天 / 睡前' },
    { key: 'garment', label: '服装', hint: '先加单品（高领衫），再给它加二级词（驼色 / 针织）' },
    { key: 'impression', label: '气质', hint: '什么感觉：清纯 / 干练 / 性感 / 慵懒' }
];

export var TAG_GROUP_KEYS = ['scene', 'garment', 'impression'];

var TAG_ITEM_LIMIT = 40;      // 单组标签/单品条数上限
var GARMENT_SUB_LIMIT = 12;   // 单个单品的二级词上限

export function emptyTags() {
    return { scene: [], garment: [], impression: [] };
}

// 单个标签归一化：去首尾空白、合并连续空格、去重、限长 24 字
export function normalizeTagList(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) {
        var t = list[i];
        if (typeof t !== 'string') continue;
        t = t.trim().replace(/\s+/g, ' ');
        if (!t) continue;
        if (t.length > 24) t = t.slice(0, 24);
        if (out.indexOf(t) === -1) out.push(t);
    }
    return out;
}

// ── 服装二级标签 ──────────────────────────────────────────
// 单个单品：{ base: '高领衫', subs: ['驼色', '针织'] }
// 兼容旧格式：字符串 → { base, subs: [] }；对象也可读 name/children
export function normalizeGarmentItem(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') {
        var one = normalizeTagList([raw]);
        return one.length ? { base: one[0], subs: [] } : null;
    }
    if (typeof raw !== 'object') return null;
    var base = '';
    if (typeof raw.base === 'string') base = normalizeTagList([raw.base])[0] || '';
    if (!base && typeof raw.name === 'string') base = normalizeTagList([raw.name])[0] || '';
    if (!base) return null;
    var subs = [];
    var rawSubs = Array.isArray(raw.subs) ? raw.subs : (Array.isArray(raw.children) ? raw.children : []);
    rawSubs.forEach(function (s) {
        var v = (s && typeof s === 'object') ? (s.value || s.name || s.zh || '') : s;
        var one2 = normalizeTagList([v]);
        if (one2.length && subs.indexOf(one2[0]) === -1) subs.push(one2[0]);
    });
    if (subs.length > GARMENT_SUB_LIMIT) subs = subs.slice(0, GARMENT_SUB_LIMIT);
    return { base: base, subs: subs };
}

export function normalizeGarmentList(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    list.forEach(function (raw) {
        var it = normalizeGarmentItem(raw);
        if (!it) return;
        var exist = null;
        for (var i = 0; i < out.length; i++) { if (out[i].base === it.base) { exist = out[i]; break; } }
        if (!exist) {
            if (out.length < TAG_ITEM_LIMIT) out.push(it);
            return;
        }
        it.subs.forEach(function (s) {
            if (exist.subs.indexOf(s) === -1 && exist.subs.length < GARMENT_SUB_LIMIT) exist.subs.push(s);
        });
    });
    return out;
}

// 显示文本：高领衫（驼色、针织）
export function garmentItemText(g, subSep) {
    if (!g || !g.base) return '';
    if (!g.subs || !g.subs.length) return g.base;
    return g.base + '（' + g.subs.join(subSep || '、') + '）';
}

// 自然文字（搜索/注入）：驼色针织高领衫
export function garmentPlainText(g) {
    if (!g || !g.base) return '';
    return (g.subs && g.subs.length ? g.subs.join('') : '') + g.base;
}

// 扁平化 garment 组为字符串（搜索、建议收集用）
export function flattenGarmentTags(tags) {
    var out = [];
    var list = (tags && Array.isArray(tags.garment)) ? tags.garment : [];
    list.forEach(function (g) {
        if (!g || !g.base) return;
        if (out.indexOf(g.base) === -1) out.push(g.base);
        (g.subs || []).forEach(function (s) { if (out.indexOf(s) === -1) out.push(s); });
    });
    return out;
}

// 任意来源（AI 返回 / 旧数据 / 备份）→ 合法 tags 对象
export function normalizeTags(raw) {
    var tags = emptyTags();
    if (!raw || typeof raw !== 'object') return tags;
    tags.scene = normalizeTagList(raw.scene);
    tags.garment = normalizeGarmentList(raw.garment);
    tags.impression = normalizeTagList(raw.impression);
    return tags;
}

// 旧单值 sceneTag（"外出 / 家居"）→ 场景标签数组
export function splitLegacySceneTag(s) {
    if (typeof s !== 'string' || !s.trim()) return [];
    return normalizeTagList(s.split(/[\/、,，|；;]+/));
}

// 就地规范化 outfit.tags，并把 tags.scene 同步回 sceneTag（兼容旧注入/模板）
export function ensureOutfitTags(o) {
    if (!o) return o;
    var tags = normalizeTags(o.tags);
    if (tags.scene.length === 0) {
        var legacy = splitLegacySceneTag(o.sceneTag);
        if (legacy.length) tags.scene = legacy;
    }
    o.tags = tags;
    o.sceneTag = tags.scene.join(' / ');
    return o;
}

export function getOutfitTags(o) {
    return normalizeTags(o && o.tags);
}

export function setOutfitTags(o, raw) {
    if (!o) return emptyTags();
    o.tags = normalizeTags(raw);
    o.sceneTag = o.tags.scene.join(' / ');
    return o.tags;
}

export function addOutfitTag(o, group, tag) {
    var tags = getOutfitTags(o);
    if (TAG_GROUP_KEYS.indexOf(group) === -1) return tags;
    var one = normalizeTagList([tag]);
    if (!one.length) return tags;
    if (group === 'garment') {
        var exist = null;
        for (var i = 0; i < tags.garment.length; i++) { if (tags.garment[i].base === one[0]) { exist = tags.garment[i]; break; } }
        if (!exist && tags.garment.length < TAG_ITEM_LIMIT) tags.garment.push({ base: one[0], subs: [] });
    } else if (tags[group].indexOf(one[0]) === -1) {
        tags[group].push(one[0]);
    }
    return setOutfitTags(o, tags);
}

// 给某个单品追加二级词（单品不存在则连同一起创建）
export function addOutfitGarmentSub(o, base, sub) {
    var tags = getOutfitTags(o);
    var b = normalizeTagList([base])[0] || '';
    var s = normalizeTagList([sub])[0] || '';
    if (!b || !s) return tags;
    var item = null;
    for (var i = 0; i < tags.garment.length; i++) { if (tags.garment[i].base === b) { item = tags.garment[i]; break; } }
    if (!item) {
        if (tags.garment.length >= TAG_ITEM_LIMIT) return tags;
        item = { base: b, subs: [] };
        tags.garment.push(item);
    }
    if (item.subs.indexOf(s) === -1 && item.subs.length < GARMENT_SUB_LIMIT) item.subs.push(s);
    return setOutfitTags(o, tags);
}

export function removeOutfitTag(o, group, tag) {
    var tags = getOutfitTags(o);
    if (TAG_GROUP_KEYS.indexOf(group) === -1) return tags;
    if (group === 'garment') {
        tags.garment = tags.garment.filter(function (g) { return g.base !== tag; });
    } else {
        var idx = tags[group].indexOf(tag);
        if (idx !== -1) tags[group].splice(idx, 1);
    }
    return setOutfitTags(o, tags);
}

export function outfitHasTags(o) {
    var tags = normalizeTags(o && o.tags);
    for (var i = 0; i < TAG_GROUP_KEYS.length; i++) {
        if (tags[TAG_GROUP_KEYS[i]].length > 0) return true;
    }
    return false;
}

// 扁平化所有标签文本（搜索用）
export function outfitTagText(o, sep) {
    var tags = normalizeTags(o && o.tags);
    var all = [];
    tags.scene.forEach(function (t) { all.push(t); });
    flattenGarmentTags(tags).forEach(function (t) { all.push(t); });
    tags.impression.forEach(function (t) { all.push(t); });
    return all.join(sep || ' ');
}

// 从一组 partition 里按组收集已有标签（做输入建议）；garment 收集到的是单品名
export function collectTagsByGroup(partitions) {
    var result = emptyTags();
    (partitions || []).forEach(function (p) {
        if (!p || !Array.isArray(p.outfits)) return;
        p.outfits.forEach(function (o) {
            var tags = normalizeTags(o && o.tags);
            tags.scene.forEach(function (t) { if (result.scene.indexOf(t) === -1) result.scene.push(t); });
            tags.impression.forEach(function (t) { if (result.impression.indexOf(t) === -1) result.impression.push(t); });
            tags.garment.forEach(function (g) { if (result.garment.indexOf(g.base) === -1) result.garment.push(g.base); });
        });
    });
    return result;
}

// 服装建议：所有单品名 + 每个单品的二级词（合并 meta.tagTree 字典与穿搭里用过的）
export function collectGarmentSuggestions(partitions, tagTree) {
    var bases = [];
    var subsByBase = {};
    function note(base, sub) {
        if (!base) return;
        if (bases.indexOf(base) === -1) bases.push(base);
        if (!subsByBase[base]) subsByBase[base] = [];
        if (sub && subsByBase[base].indexOf(sub) === -1) subsByBase[base].push(sub);
    }
    if (tagTree && tagTree.garment && typeof tagTree.garment === 'object') {
        Object.keys(tagTree.garment).forEach(function (b) {
            note(b, '');
            var arr = tagTree.garment[b];
            if (Array.isArray(arr)) arr.forEach(function (s) { note(b, s); });
        });
    }
    (partitions || []).forEach(function (p) {
        if (!p || !Array.isArray(p.outfits)) return;
        p.outfits.forEach(function (o) {
            normalizeTags(o && o.tags).garment.forEach(function (g) {
                note(g.base, '');
                (g.subs || []).forEach(function (s) { note(g.base, s); });
            });
        });
    });
    return { bases: bases, subsByBase: subsByBase };
}

// ── 二级标签字典（meta.tagTree）：{ garment: { 高领衫: ['驼色','针织'] } } ──
// 不是预置词表，而是从用户/图片/AI 的用法里自动长出来的关系表。
export function ensureTagTree(meta) {
    if (!meta.tagTree || typeof meta.tagTree !== 'object') meta.tagTree = { garment: {} };
    if (!meta.tagTree.garment || typeof meta.tagTree.garment !== 'object') meta.tagTree.garment = {};
    return meta.tagTree;
}

// 把一套穿搭里的 garment 关系记进字典（自动增长，不覆盖已有词）
export function noteTagTreeUsage(meta, tags) {
    if (!meta) return;
    var tree = ensureTagTree(meta);
    normalizeTags(tags).garment.forEach(function (g) {
        if (!Array.isArray(tree.garment[g.base])) tree.garment[g.base] = [];
        (g.subs || []).forEach(function (s) {
            if (tree.garment[g.base].indexOf(s) === -1 && tree.garment[g.base].length < 60) tree.garment[g.base].push(s);
        });
    });
}

// 获取 outfit 当前激活的 kit，无则返回 null
export function getActiveKit(outfit) {
    if (!outfit || !outfit.activeKitId || !Array.isArray(outfit.kits)) return null;
    for (var i = 0; i < outfit.kits.length; i++) {
        if (outfit.kits[i].id === outfit.activeKitId) return outfit.kits[i];
    }
    return null;
}

// 获取 kit 关联的单品对象列表（跳过悬空引用 + 去重）
export function getKitAccessories(part, kit) {
    if (!part || !kit || !Array.isArray(kit.accIds)) return [];
    var result = [];
    var seen = {};
    for (var i = 0; i < kit.accIds.length; i++) {
        var aid = kit.accIds[i];
        if (seen[aid]) continue;  // 去重
        seen[aid] = true;
        var acc = partGetAccById(part, aid);
        if (acc) result.push(acc);  // 跳过悬空引用
    }
    return result;
}

// 删除单品时，清理所有 outfit.kits 里的引用
export function cleanAccIdFromKits(part, accId) {
    if (!part || !part.outfits) return;
    part.outfits.forEach(function (o) {
        if (!Array.isArray(o.kits)) return;
        o.kits.forEach(function (kit) {
            if (Array.isArray(kit.accIds)) {
                var idx = kit.accIds.indexOf(accId);
                while (idx !== -1) {
                    kit.accIds.splice(idx, 1);
                    idx = kit.accIds.indexOf(accId);
                }
            }
            if (!Array.isArray(kit.disabledAccIds)) return;
            var didx = kit.disabledAccIds.indexOf(accId);
            while (didx !== -1) {
                kit.disabledAccIds.splice(didx, 1);
                didx = kit.disabledAccIds.indexOf(accId);
            }
        });
    });
}

// ══════════════════════════════════════════════════════════
//  charIndex 辅助（纯数据操作，不依赖 db.js）
// ══════════════════════════════════════════════════════════

export function findCharById(charIndex, id) {
    if (!Array.isArray(charIndex)) return null;
    for (var i = 0; i < charIndex.length; i++) {
        if (charIndex[i].id === id) return charIndex[i];
    }
    return null;
}

export function findCharByName(charIndex, name) {
    if (!Array.isArray(charIndex)) return null;
    for (var i = 0; i < charIndex.length; i++) {
        if (charIndex[i].name === name) return charIndex[i];
    }
    return null;
}

// ══════════════════════════════════════════════════════════
//  角色分组辅助（兼容层使用角色名）
// ══════════════════════════════════════════════════════════

function owns(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function validCharGroupName(name) {
    return !!name && name !== '__proto__' && name !== 'prototype' && name !== 'constructor';
}

export function renameCharGroup(d, oldName, newName) {
    var groups = d && d.charGroups;
    var target = typeof newName === 'string' ? newName.trim() : '';
    if (!groups || !owns(groups, oldName)) return { ok: false, code: 'GROUP_NOT_FOUND' };
    if (!validCharGroupName(target)) return { ok: false, code: 'GROUP_NAME_INVALID' };
    if (target === oldName) return { ok: false, code: 'GROUP_NAME_UNCHANGED' };
    if (owns(groups, target)) return { ok: false, code: 'GROUP_NAME_EXISTS' };

    // 重建对象以保留原有分组显示顺序。
    var renamed = {};
    Object.keys(groups).forEach(function (name) {
        renamed[name === oldName ? target : name] = groups[name];
    });
    d.charGroups = renamed;
    return { ok: true, oldName: oldName, newName: target };
}

export function deleteCharGroup(d, groupName, deleteMembers) {
    var groups = d && d.charGroups;
    if (!groups || !owns(groups, groupName)) return { ok: false, code: 'GROUP_NOT_FOUND', deletedNames: [] };

    var seen = Object.create(null);
    var members = [];
    (groups[groupName] || []).forEach(function (name) {
        if (typeof name !== 'string' || !name || seen[name]) return;
        seen[name] = true;
        members.push(name);
    });
    delete groups[groupName];

    if (!deleteMembers) return { ok: true, deletedNames: [], releasedNames: members };

    var existing = Object.create(null);
    (d.charNames || []).forEach(function (name) { existing[name] = true; });
    var deletedNames = members.filter(function (name) { return existing[name]; });
    var deleting = Object.create(null);
    deletedNames.forEach(function (name) {
        deleting[name] = true;
        if (d.chars) delete d.chars[name];
    });
    d.charNames = (d.charNames || []).filter(function (name) { return !deleting[name]; });
    d.charFavorites = (d.charFavorites || []).filter(function (name) { return !deleting[name]; });
    Object.keys(groups).forEach(function (name) {
        groups[name] = (groups[name] || []).filter(function (charName) { return !deleting[charName]; });
    });
    if (deleting[d.currentChar]) d.currentChar = SHARED_CHAR_KEY;

    return { ok: true, deletedNames: deletedNames, releasedNames: [] };
}

// ══════════════════════════════════════════════════════════
//  兼容旧接口（过渡期，供还没改完的模块使用）
// ══════════════════════════════════════════════════════════

// 旧版 def() — 返回完整扁平默认值
// deprecated: 仅供 load()/save() 兼容层使用
export function def() {
    var m = defMeta();
    var p = defPartition();
    var d = {};
    for (var k in m) d[k] = m[k];
    d.outfits = p.outfits;
    d.categories = p.categories;
    d.activeIds = p.activeIds;
    d.accessories = p.accessories;
    d.accCategories = p.accCategories;
    d.chars = {};
    d.charNames = [];
    return d;
}

// 旧版 ensureDefaults() — deprecated
export function ensureDefaults(d) {
    if (!d) return def();
    var dd = def();
    for (var k in dd) { if (d[k] === undefined) d[k] = dd[k]; }
    if (d.activeId && !d.activeIds) d.activeIds = [d.activeId];
    if (!Array.isArray(d.activeIds)) d.activeIds = [];
    if (!Array.isArray(d.presets)) d.presets = [];
    if (!d.chars) d.chars = {};
    if (!d.charNames) d.charNames = [];
    if (!Array.isArray(d.tagOrder)) d.tagOrder = [];
    return d;
}

// ── 旧版视角访问函数（deprecated）──
// 这些函数接收 load() 返回的伪完整对象
// 全部标记废弃，适配完成后删除

export function getCharData(d, charName) {
    if (!d.chars) d.chars = {};
    if (!d.chars[charName]) d.chars[charName] = { outfits: [], categories: [], activeIds: [] };
    return d.chars[charName];
}

export function currentOwner(d) {
    if (d.currentView === 'char' && d.currentChar) return d.currentChar;
    return 'user';
}

export function getViewOutfits(d) {
    if (d.currentView === 'char' && d.currentChar) return getCharData(d, d.currentChar).outfits;
    return d.outfits;
}

export function getViewCategories(d) {
    if (d.currentView === 'char' && d.currentChar) return getCharData(d, d.currentChar).categories;
    return d.categories;
}

export function getViewActiveIds(d) {
    if (d.currentView === 'char' && d.currentChar) return getCharData(d, d.currentChar).activeIds;
    return d.activeIds;
}

export function setViewActiveIds(d, ids) {
    if (d.currentView === 'char' && d.currentChar) { getCharData(d, d.currentChar).activeIds = ids; }
    else { d.activeIds = ids; }
}

export function getById(d, id) {
    for (var i = 0; i < d.outfits.length; i++) { if (d.outfits[i].id === id) return d.outfits[i]; }
    if (d.chars) { for (var cn in d.chars) { var co = d.chars[cn].outfits || []; for (var j = 0; j < co.length; j++) { if (co[j].id === id) return co[j]; } } }
    return null;
}

export function getViewById(d, id) {
    var list = getViewOutfits(d);
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
}

export function isActive(d, id) {
    return getViewActiveIds(d).indexOf(id) !== -1;
}
