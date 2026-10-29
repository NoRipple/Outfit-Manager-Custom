// 正文穿搭标记解析测试
// 跑法：node --experimental-vm-modules tests/msg-tag.test.cjs
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

function stubModule(context, name, exportsMap) {
    return new vm.SyntheticModule(Object.keys(exportsMap), function () {
        const self = this;
        Object.keys(exportsMap).forEach(function (k) { self.setExport(k, exportsMap[k]); });
    }, { context, identifier: name });
}

async function loadMsgTag() {
    const context = vm.createContext({
        console,
        JSON,
        Math,
        Date,
        Promise,
        setTimeout,
        clearTimeout,
        NodeFilter: { SHOW_TEXT: 4 },
        document: {
            readyState: 'complete',
            addEventListener: function () {},
            querySelectorAll: function () { return []; },
            getElementById: function () { return null; },
            createElement: function () { return { setAttribute: function () {}, appendChild: function () {}, addEventListener: function () {} }; },
            createDocumentFragment: function () { return { appendChild: function () {} }; },
            createTextNode: function () { return {}; },
            createTreeWalker: function () { return { nextNode: function () { return null; } }; }
        },
        window: {},
        import: function () { return Promise.resolve({}); }
    });

    const dataMod = stubModule(context, 'data.js', {
        SHARED_CHAR_KEY: '__shared__',
        getOutfitThumb: function () { return ''; },
        getOutfitImages: function () { return []; },
        getOutfitTags: function () { return { scene: [], garment: [], impression: [] }; },
        garmentItemText: function (g) { return String(g); }
    });
    const dbMod = stubModule(context, 'db.js', {
        loadMeta: function () { return { charIndex: [] }; },
        loadPartition: function () { return null; },
        charNameById: function () { return ''; }
    });
    const utilsMod = stubModule(context, 'utils.js', {
        esc: function (s) { return s == null ? '' : String(s); }
    });
    const bridgeMod = stubModule(context, 'bridge.js', { fn: {} });

    const src = read('src/msg-tag.js');
    const mod = new vm.SourceTextModule(src, { context, identifier: 'msg-tag.js' });
    await mod.link(function (spec) {
        if (spec === './data.js') return dataMod;
        if (spec === './db.js') return dbMod;
        if (spec === './utils.js') return utilsMod;
        if (spec === './bridge.js') return bridgeMod;
        throw new Error('未预期的依赖：' + spec);
    });
    await mod.evaluate();
    return mod.namespace;
}

async function run() {
    const ns = await loadMsgTag();

    // 1. 单条：名称/角色
    let r = ns.parseEntries('通勤白衬衫/雪乃');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, '通勤白衬衫');
    assert.strictEqual(r[0].owner, '雪乃');

    // 2. 多条用 + 分隔
    r = ns.parseEntries('通勤白衬衫/雪乃+夜色长裙/雪乃');
    assert.strictEqual(r.length, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r[1])), { name: '夜色长裙', owner: '雪乃' });

    // 3. 不写角色
    r = ns.parseEntries('通勤白衬衫');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r[0])), { name: '通勤白衬衫', owner: '' });

    // 4. 混合：一条有角色、一条没有
    r = ns.parseEntries('通勤白衬衫/雪乃+夜色长裙');
    assert.strictEqual(r[0].owner, '雪乃');
    assert.strictEqual(r[1].owner, '');

    // 5. 空格与空段容错
    r = ns.parseEntries('  通勤白衬衫 / 雪乃 + + 夜色长裙/ 雪乃 ');
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].name, '通勤白衬衫');
    assert.strictEqual(r[0].owner, '雪乃');
    assert.strictEqual(r[1].name, '夜色长裙');

    // 6. 空串
    assert.strictEqual(ns.parseEntries('').length, 0);
    assert.strictEqual(ns.parseEntries(null).length, 0);

    console.log('msg-tag: 全部断言通过');
}

run().catch(function (err) { console.error(err); process.exitCode = 1; });
