// ── 穿搭管理器 · 当前生效穿搭浮窗 ─────────────────────────
// 魔法棒（扩展菜单）按钮 → 固定在左下角的窗口，列出正在注入的穿搭
// 每张卡片显示：缩略图 + 角色名 + 穿搭名 + 标签

import { loadMeta, loadActivePartitions, charNameById, onDataSaved } from './db.js';
import { SHARED_CHAR_KEY, partGetById, getOutfitThumb, getOutfitImages, getOutfitTags, garmentItemText } from './data.js';
import { esc } from './utils.js';
import { fn } from './bridge.js';
import { getWorn } from './msg-tag.js';
import { pickRandomSlice, getRandomInjectCount } from './inject.js';

var WIN_ID = 'om-active-win';
var BTN_ID = 'om-active-ext-btn';
var OWNER_PREFIX = 'om-owner:';
var CARD_MIN = 20;
var CARD_MAX = 120;

// 角色名：单人衣柜取 charIndex 里的名字；通用衣柜 / 用户衣柜用中文称呼
function ownerLabel(partKey) {
    if (partKey.indexOf(OWNER_PREFIX) === 0) return partKey.slice(OWNER_PREFIX.length);
    if (partKey === 'char:' + SHARED_CHAR_KEY) return '通用';
    if (partKey.indexOf('char:') === 0) {
        var cid = partKey.slice(5);
        var nm = charNameById(cid);
        return nm && nm !== SHARED_CHAR_KEY ? nm : '角色';
    }
    if (partKey.indexOf('user:') === 0) {
        var userName = charNameById(partKey.slice(5));
        return userName && userName !== SHARED_CHAR_KEY ? userName : '我';
    }
    return '衣柜';
}

// 汇总当前真正参与注入的穿搭（与 inject.js 的读取逻辑 + 随机抽签规则保持一致）
// 随机注入开启时：按「下一轮注入会抽到的」那几套来算，而不是全部激活项；
// 抽签规则（每个衣柜各自抽 randomInjectCount 套、候选不足时全发）直接复用 inject.js 的纯函数。
// 抽签是实时计算的，所以手动「刷新随机切片」后浮窗会跟着变；未开启随机注入 → 显示全部激活。
var _sentFiltered = false;
var _randLimited = false;   // 随机注入开启、且确实发生了「从更多套里抽几套」
var _injectOff = false;     // 注入总开关关闭
var _randEmpty = false;     // 随机注入开启，但一个可注入的衣柜都没有
var _randCountForRender = 0;

function collectActive() {
    var items = [];
    var parts = loadActivePartitions();
    _sentFiltered = false;
    _randLimited = false;
    _injectOff = false;
    _randEmpty = false;
    var partsEmptyOfOutfits = true;
    var meta = null;
    try { meta = loadMeta(); } catch (e) {}
    var randomOn = !!(meta && meta.randomInject);
    var injectOn = !(meta && meta.injectEnabled === false);   // 注入总开关关闭 → 什么都没进聊天
    _injectOff = !injectOn;
    var randCount = randomOn ? getRandomInjectCount(meta) : 0;
    _randCountForRender = randCount;
    for (var pk in parts) {
        var part = parts[pk];
        var ids = (part && part.activeIds) || [];
        var list = [];
        for (var i = 0; i < ids.length; i++) {
            var o = partGetById(part, ids[i]);
            if (o) list.push({ owner: ownerLabel(pk), partKey: pk, outfit: o });
        }
        if (!list.length) continue;
        partsEmptyOfOutfits = false;
        if (injectOn && randomOn) {
            // 少于等于抽取数量时，注入本来就会全发，不算「随机截断」
            if (list.length > randCount) {
                list = pickRandomSlice(list, randCount);
                _randLimited = true;
            }
        }
        for (var j = 0; j < list.length; j++) items.push(list[j]);
    }
    _sentFiltered = _randLimited;
    _randEmpty = randomOn && injectOn && partsEmptyOfOutfits;
    // 注入总开关关闭时，没有任何穿搭会进入聊天 → 浮窗默认为空
    if (!injectOn) return [];
    return items;
}

function isWinOpen() {
    var el = document.getElementById(WIN_ID);
    return !!(el && el.parentNode);
}

function ensureWindow() {
    var el = document.getElementById(WIN_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = WIN_ID;
    el.className = 'om-active-win';
    el.innerHTML =
        '<div class="om-act-head">' +
            '<span class="om-act-title"><i class="fa-solid fa-shirt"></i><span class="om-act-title-txt"> 当前生效穿搭</span></span>' +
            '<span class="om-act-ownerbar" id="om-act-ownerbar"></span>' +
            '<span class="om-act-count" id="om-act-count"></span>' +
            '<button class="om-act-close" id="om-act-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div class="om-act-body" id="om-act-body"></div>';
    document.body.appendChild(el);
    el.querySelector('#om-act-close').addEventListener('click', closeWindow);
    // 「本楼穿着」会随 AI 回复变化，但激活 / 抽签没变，数据写入通知不会触发。
    // 这里只在「浮窗开着」时比较一个小小的穿着签名（几套 id + 角色名，不做随机抽签、不碰 DOM），
    // 变了才重绘；没变化时每 1.2 秒只做几次字符串比较。
    _wornTimer = setInterval(function () {
        try {
            var w = getWorn();
            var sig = '';
            for (var k in w) sig += k + '@' + ((w[k] && w[k].owner) || '') + ';';
            if (sig === _wornSig) return;
            _wornSig = sig;
            renderBody();
        } catch (e) {}
    }, 1200);
    return el;
}
var _wornSig = '';
var _wornTimer = null;

function wornOwnerSuffix(owner) {
    if (!owner || owner === _uniformOwner) return '';
    return ' · ' + owner;
}

function tagLineText(o) {
    var t = getOutfitTags(o);
    var out = [];
    if (t.scene && t.scene.length) out.push(t.scene.join(' / '));
    if (t.garment && t.garment.length) out.push(t.garment.slice(0, 4).map(function (g) { return garmentItemText(g, ' '); }).join('、'));
    if (t.impression && t.impression.length) out.push(t.impression.slice(0, 3).join('、'));
    if (!out.length && o.sceneTag) out.push(o.sceneTag);
    return out.join(' ｜ ');
}

var _uniformOwner = '';

var CARD_H = 208;
var CARD_H_COMPACT = 104;

function cardHeight() {
    var el = document.getElementById(WIN_ID);
    return (el && el.classList.contains('om-act-compact')) ? CARD_H_COMPACT : 0;
}

function cardBg(o, thumb) {
    // 底部深色渐变压在图片上，保证任何主题下文字都可读
    var g = 'linear-gradient(to top,rgba(12,10,14,.95) 0%,rgba(12,10,14,.80) 30%,rgba(12,10,14,.22) 56%,rgba(12,10,14,0) 78%)';
    if (thumb) return g + ",url('" + String(thumb).replace(/'/g, '%27') + "')";
    return g + ',linear-gradient(135deg,#4c4657,#7d7389)';
}

function cardHtml(item, idx, H) {
    var o = item.outfit;
    var imgs = getOutfitImages(o);
    var thumb = getOutfitThumb(o) || imgs[0] || '';
    var tagText = tagLineText(o);
    var worn = getWorn()[o.id];
    var num = ('0' + (idx + 1)).slice(-2);
    var h = H || 0;
    return '<div class="om-act-card' + (worn ? ' om-act-card-worn' : '') + '" data-idx="' + idx + '"' +
        ' style="height:' + (h ? h + 'px' : 'auto') + ';background-image:' + cardBg(o, thumb) + ';">' +
        '<span class="om-act-idx">' + num + '</span>' +
        (worn ? '<span class="om-act-wornmark"><i class="fa-solid fa-check"></i></span>' : '') +
        '<div class="om-act-info" style="color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.65);">' +
            (worn ? '<div class="om-act-worn" style="font-size:10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><i class="fa-solid fa-shirt"></i> 本楼穿着</div><div class="om-act-wornwho" style="font-size:10px;color:rgba(255,255,255,.82);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(worn.owner || item.owner) + '</div>' : '') +
            (item.owner === _uniformOwner ? '' : '<div class="om-act-owner">' + esc(item.owner) + '</div>') +
            '<div class="om-act-name" style="color:#fff;">' + esc(o.name || '未命名穿搭') + '</div>' +
            (tagText ? '<div class="om-act-tags" style="color:rgba(255,255,255,.8);">' + esc(tagText) + '</div>' : '') +
        '</div>' +
    '</div>';
}

function applyCardHeights() {
    var el = document.getElementById(WIN_ID);
    if (!el) return;
    var compact = el.classList.contains('om-act-compact');
    var cards = el.querySelectorAll('.om-act-card');
    for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (compact) { c.style.height = CARD_H_COMPACT + 'px'; continue; }
        c.style.height = 'auto';
        var w = c.clientWidth || 0;
        if (w > 0) c.style.height = Math.round(w * 4 / 3) + 'px';
    }
}

var _lastItems = [];

function renderBody() {
    var el = document.getElementById(WIN_ID);
    if (!el) return;
    var body = el.querySelector('#om-act-body');
    var countEl = el.querySelector('#om-act-count');
    var items = collectActive();
    var wornMap = getWorn();
    // 本楼穿着的排在最上面
    items.sort(function (a, b) {
        var wa = wornMap[a.outfit.id] ? 1 : 0;
        var wb = wornMap[b.outfit.id] ? 1 : 0;
        return wb - wa;
    });
    // 同一个衣柜的多套穿搭：衣柜名只在标题栏显示一次，卡片里不再重复
    var owners = {};
    items.forEach(function (it) { owners[it.owner] = 1; });
    var ownerKeys = Object.keys(owners);
    _uniformOwner = ownerKeys.length === 1 ? ownerKeys[0] : '';
    var ownerBar = el.querySelector('#om-act-ownerbar');
    if (ownerBar) {
        ownerBar.textContent = _uniformOwner || '';
        ownerBar.title = _uniformOwner || '';
        ownerBar.style.display = _uniformOwner ? '' : 'none';
    }
    _lastItems = items;
    _lastSig = items.map(function (it) { return it.outfit.id; }).join(',');
    if (countEl) countEl.textContent = items.length
        ? (_sentFiltered ? '本轮 ' + items.length + ' 套（随机抽 ' + _randCountForRender + '）' : '共 ' + items.length + ' 套')
        : '';
    if (!items.length) {
        var tip;
        if (_injectOff) tip = '注入总开关已关闭，穿搭不会进入聊天。';
        else if (_randEmpty) tip = '随机注入已开启，但当前没有可注入的激活穿搭。';
        else tip = '在衣柜里激活几套后再来看看。';
        body.innerHTML = '<div class="om-act-empty">当前没有生效的穿搭。<br><span>' + esc(tip) + '</span></div>';
        return;
    }
    var _h = cardHeight();
    body.innerHTML = items.map(function (it, ix) { return cardHtml(it, ix, _h); }).join('');
    var cards = body.querySelectorAll('.om-act-card');
    for (var i = 0; i < cards.length; i++) {
        cards[i].addEventListener('click', function () {
            var idx = parseInt(this.getAttribute('data-idx'), 10);
            var it = _lastItems[idx];
            if (!it) return;
            if (fn.openLightbox) fn.openLightbox([it.outfit], it.outfit.id);
        });
    }
}

// 让浮窗避开对话区：左侧留白够就按正常宽度，不够就收成图标条
function fitToChat() {
    var el = document.getElementById(WIN_ID);
    if (!el) return;
    var chat = document.getElementById('chat');
    var leftLimit = 0;
    if (chat) {
        var r = chat.getBoundingClientRect();
        if (r.width > 0) leftLimit = r.left;
    }
    var avail = leftLimit > 0 ? leftLimit - 24 : (window.innerWidth - 300);
    if (avail >= 330) {
        el.classList.remove('om-act-compact');
        el.style.width = Math.min(408, avail) + 'px';
    } else {
        el.classList.add('om-act-compact');
        el.style.width = '';
    }
    applyCardHeights();
}

function openWindow() {
    ensureWindow();
    renderBody();
    fitToChat();
}

window.addEventListener('resize', function () { if (isWinOpen()) fitToChat(); });

function closeWindow() {
    var el = document.getElementById(WIN_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    // 窗口关掉就停掉「本楼穿着」打点，不让它在后台空转
    if (_wornTimer) { clearInterval(_wornTimer); _wornTimer = null; }
    _lastItems = [];
    _lastSig = '';
}

function toggleWindow() {
    if (isWinOpen()) closeWindow();
    else openWindow();
}

// 窗口打开时，如果换了角色 / 改了激活，自动刷新
// 事件驱动：由 db.js 的 onDataSaved 通知（不再定时轮询，避免反复重算随机切片）
// 先算签名（只比对 id 列表），确实变了才重画 DOM。
function refreshIfOpen() {
    if (!isWinOpen()) return;
    var sig = collectActive().map(function (it) { return it.outfit.id; }).join(',');
    if (sig === _lastSig) return;
    renderBody();
}
var _lastSig = '';

// 正文标记变化时：本楼穿着变了，强制重画（不走 sig 比较）
function refreshActiveWindow() {
    if (!isWinOpen()) return;
    renderBody();
}

// msg-tag.js 通过 fn.refreshActiveWindow() 通知刷新
fn.refreshActiveWindow = refreshActiveWindow;

// 数据写入（激活变更 / 刷新随机切片 / 设置开关 / 切角色）→ 浮窗打开时才重算
// 不注册定时器：没有这些动作时零开销。
try {
    onDataSaved(function () { refreshIfOpen(); });
} catch (e) {}

// ── 魔法棒菜单按钮 ───────────────────────────────────────
function findMenu() {
    var m = document.getElementById('extensionsMenu'); if (m) return m;
    m = document.getElementById('extensions_menu'); if (m) return m;
    var items = document.querySelectorAll('.list-group-item.interactable');
    for (var i = 0; i < items.length; i++) {
        var t = items[i].textContent || '';
        if (t.indexOf('CSS') !== -1 || t.indexOf('头像框') !== -1 || t.indexOf('变量管理') !== -1) return items[i].parentElement;
    }
    return null;
}

function injectActiveBtn() {
    if (document.getElementById(BTN_ID)) return;
    var menu = findMenu();
    if (!menu) return;
    var btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.className = 'list-group-item flex-container flexGap5 interactable';
    btn.title = '当前生效穿搭';
    btn.innerHTML = '<i class="fa-solid fa-shirt"></i><span>当前生效穿搭</span>';
    btn.addEventListener('click', function () { toggleWindow(); });
    menu.appendChild(btn);
}

export { toggleWindow, openWindow, closeWindow, injectActiveBtn, refreshIfOpen, refreshActiveWindow };

// 仅测试用入口（生产代码不调用）
export function __testCollectActive() { return collectActive(); }
export function __testState() { return { sentFiltered: _sentFiltered, randLimited: _randLimited, injectOff: _injectOff, randEmpty: _randEmpty }; }
