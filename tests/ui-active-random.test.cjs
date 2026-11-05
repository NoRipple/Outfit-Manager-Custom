'use strict';

// 「当前生效穿搭」浮窗：随机注入开启时只应展示本轮的随机切片，而不是全部激活项
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function makeCtx(metaRef, partsRef) {
    const noop = () => {};
    const el = () => ({
        id: '', className: '', innerHTML: '', textContent: '', title: '', style: {},
        parentNode: null,
        querySelector: () => el(),
        querySelectorAll: () => [],
        appendChild: noop,
        removeChild: noop,
        addEventListener: noop,
        getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
        getAttribute: () => null,
        classList: { contains: () => false, add: noop, remove: () => false },
        setAttribute: noop
    });
    const document = {
        body: el(),
        getElementById: () => null,
        createElement: () => el(),
        querySelectorAll: () => []
    };
    const window = {
        innerWidth: 1920,
        addEventListener: noop
    };
    return vm.createContext({
        console,
        JSON,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Date,
        Math,
        Error,
        document,
        window,
        setTimeout: noop,
        setInterval: noop,
        clearTimeout: noop,
        clearInterval: noop,
        Promise,
        __metaRef: metaRef,
        __partsRef: partsRef
    });
}

async function run() {
    // 共享可变数据：context 中通过 __metaRef / __partsRef 读取，loadMeta 等桩函数实时取值
    const state = { meta: {}, parts: {} };
    const savedListeners = [];

    const context = makeCtx(state, state);

    const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui-active.js'), 'utf8');
    const mod = new vm.SourceTextModule(uiSrc, { context, identifier: path.join(ROOT, 'src', 'ui-active.js') });

    const link = async (specifier) => {
        if (specifier === './db.js') {
            return new vm.SyntheticModule(['loadMeta', 'loadActivePartitions', 'charNameById', 'onDataSaved'], function () {
                this.setExport('loadMeta', () => context.__metaRef.meta);
                this.setExport('loadActivePartitions', () => context.__partsRef.parts);
                this.setExport('charNameById', () => '');
                this.setExport('onDataSaved', (f) => { savedListeners.push(f); });
            }, { context });
        }
        if (specifier === './data.js') {
            return new vm.SyntheticModule(['SHARED_CHAR_KEY', 'partGetById', 'getOutfitThumb', 'getOutfitImages', 'getOutfitTags', 'garmentItemText'], function () {
                this.setExport('SHARED_CHAR_KEY', '__shared__');
                this.setExport('partGetById', (part, id) => (part.outfits || []).find((o) => o.id === id) || null);
                this.setExport('getOutfitThumb', () => '');
                this.setExport('getOutfitImages', () => []);
                this.setExport('getOutfitTags', () => ({ scene: [], garment: [], impression: [] }));
                this.setExport('garmentItemText', () => '');
            }, { context });
        }
        if (specifier === './utils.js') {
            return new vm.SyntheticModule(['esc'], function () {
                this.setExport('esc', (s) => String(s == null ? '' : s));
            }, { context });
        }
        if (specifier === './bridge.js') {
            return new vm.SyntheticModule(['fn'], function () {
                this.setExport('fn', {});
            }, { context });
        }
        if (specifier === './msg-tag.js') {
            return new vm.SyntheticModule(['getWorn'], function () {
                this.setExport('getWorn', () => ({}));
            }, { context });
        }
        if (specifier === './inject.js') {
            // 真实随机抽签规则（从 inject.js 取出可独立验证的实现）
            return new vm.SyntheticModule(['pickRandomSlice', 'getRandomInjectCount'], function () {
                this.setExport('pickRandomSlice', (list, count) => {
                    const n = (typeof count === 'number' && count > 0) ? Math.floor(count) : 1;
                    const arr = list || [];
                    if (arr.length === 0) return [];
                    if (arr.length <= n) return arr.slice();
                    return arr.slice(0, n);   // 测试里按前 N 套固定切片，便于断言
                });
                this.setExport('getRandomInjectCount', (meta) => (meta && meta.randomInjectCount > 0) ? Math.floor(meta.randomInjectCount) : 1);
            }, { context });
        }
        throw new Error('Unexpected import: ' + specifier);
    };

    await mod.link(link);
    await mod.evaluate();
    const ns = mod.namespace;
    assert.equal(typeof ns.__testCollectActive, 'function', 'ui-active 应导出 collectActive 测试入口');

    // 构造 1400 套激活穿搭（模拟图库）
    const big = { outfits: [], activeIds: [] };
    for (let i = 0; i < 1400; i++) {
        big.outfits.push({ id: 'g' + i, name: 'look' + i });
        big.activeIds.push('g' + i);
    }

    // ① 未开启随机注入 → 显示全部激活（1400 套）
    state.meta = { injectEnabled: true, randomInject: false, randomInjectCount: 5 };
    state.parts = { 'char:__shared__': big };
    let items = ns.__testCollectActive();
    assert.equal(items.length, 1400, '随机注入关闭时应展示全部激活穿搭');
    assert.equal(ns.__testState().sentFiltered, false, '未截断时不算「本轮」');

    // ② 开启随机注入，抽 5 套 → 只展示 5 套
    state.meta = { injectEnabled: true, randomInject: true, randomInjectCount: 5 };
    items = ns.__testCollectActive();
    assert.equal(items.length, 5, '随机注入开启时应只展示抽中的 5 套');
    assert.equal(ns.__testState().sentFiltered, true, '发生截断时标题应显示「本轮」');
    // 注意：数组来自 vm 沙箱（另一个 realm），用 JSON 比较避免原型差异
    assert.equal(JSON.stringify(items.map((it) => it.outfit.id)), JSON.stringify(['g0', 'g1', 'g2', 'g3', 'g4']), '应展示抽取切片');

    // ③ 抽 1 套
    state.meta = { injectEnabled: true, randomInject: true, randomInjectCount: 1 };
    assert.equal(ns.__testCollectActive().length, 1, '抽 1 套应只展示 1 套');

    // ④ 激活数量 ≤ 抽取数量 → 全发，不算截断
    state.parts = { 'char:__shared__': { outfits: big.outfits.slice(0, 3), activeIds: ['g0', 'g1', 'g2'] } };
    state.meta = { injectEnabled: true, randomInject: true, randomInjectCount: 5 };
    items = ns.__testCollectActive();
    assert.equal(items.length, 3, '激活数量不足抽取数时应全部展示');
    assert.equal(ns.__testState().sentFiltered, false, '没有截断时标题为「共」');

    // ⑤ 注入总开关关闭 → 默认为空（不论是否开启随机注入）
    state.parts = { 'char:__shared__': big };
    state.meta = { injectEnabled: false, randomInject: true, randomInjectCount: 5 };
    items = ns.__testCollectActive();
    assert.equal(items.length, 0, '注入关闭时浮窗应为空');
    assert.equal(ns.__testState().injectOff, true, '应标记为注入关闭');

    state.meta = { injectEnabled: false, randomInject: false, randomInjectCount: 5 };
    assert.equal(ns.__testCollectActive().length, 0, '注入关闭 + 未开随机注入时浮窗也应为空');

    // ⑥ 开启随机注入但没有激活穿搭 → 为空
    state.meta = { injectEnabled: true, randomInject: true, randomInjectCount: 5 };
    state.parts = {};
    items = ns.__testCollectActive();
    assert.equal(items.length, 0, '随机注入没有候选时应为空');
    assert.equal(ns.__testState().randEmpty, true, '应标记为随机注入无候选');

    // ⑦ 多个衣柜：每个衣柜各自抽 N 套（与注入一致）
    const charA = { outfits: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }], activeIds: ['a1', 'a2', 'a3'] };
    const charB = { outfits: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }], activeIds: ['b1', 'b2', 'b3', 'b4'] };
    state.parts = { 'char:cA': charA, 'char:cB': charB };
    state.meta = { injectEnabled: true, randomInject: true, randomInjectCount: 2 };
    items = ns.__testCollectActive();
    assert.equal(items.length, 4, '两个衣柜各抽 2 套 = 4 套');
    const ids = (arr) => JSON.stringify(arr.map((it) => it.outfit.id));
    assert.equal(ids(items.filter((it) => it.partKey === 'char:cA')), JSON.stringify(['a1', 'a2']));
    assert.equal(ids(items.filter((it) => it.partKey === 'char:cB')), JSON.stringify(['b1', 'b2']));

    // ⑧ 不依赖「上次实际发出记录」：meta.lastInject 不参与浮窗取数
    state.meta = { injectEnabled: true, randomInject: true, randomInjectCount: 2, lastInject: { key: 'x', ids: ['a3'] } };
    state.parts = { 'char:cA': charA };
    items = ns.__testCollectActive();
    assert.equal(ids(items), JSON.stringify(['a1', 'a2']), '浮窗应展示本轮抽签结果，而不是上一轮发出去的记录');

    // ⑨ 刷新改为「事件驱动」：只注册一个数据写入监听器，且通知能真正到达它（不再靠 1.5s 定时轮询）
    assert.equal(savedListeners.length, 1, '浮窗应注册且仅注册 1 个 onDataSaved 监听器');
    let notified = 0;
    savedListeners.push(() => { notified++; });
    savedListeners.forEach((f) => f({ kind: 'meta' }));
    assert.equal(notified, 1, '数据写入通知应能到达注册的监听器');
    savedListeners.pop();

    console.log('ui-active-random: pass (关闭→全部 / 1400抽5 / 抽1 / 不足全发 / 注入关→空 / 无候选→空 / 多衣柜各自抽 / 不读上一轮记录 / 事件驱动刷新)');
    console.log('注册的 onDataSaved 监听器数量 = ' + savedListeners.length);
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
