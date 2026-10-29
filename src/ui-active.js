// ── 穿搭管理器 · 当前生效穿搭浮窗 ─────────────────────────
// 魔法棒（扩展菜单）按钮 → 固定在左下角的窗口，列出正在注入的穿搭
// 每张卡片显示：缩略图 + 角色名 + 穿搭名 + 标签

import { loadMeta, loadActivePartitions, currentUserPartKey, charNameById } from './db.js';
import { SHARED_CHAR_KEY, partGetById, getOutfitThumb, getOutfitImages, getOutfitTags, garmentItemText } from './data.js';
import { esc } from './utils.js';
import { fn } from './bridge.js';

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

// 汇总当前真正参与注入的穿搭（与 inject.js 的读取逻辑保持一致）
function collectActive() {
    var items = [];
    var parts = loadActivePartitions();
    var curUserPK = currentUserPartKey();
    for (var pk in parts) {
        var part = parts[pk];
        var ids = (part && part.activeIds) || [];
        for (var i = 0; i < ids.length; i++) {
            var o = partGetById(part, ids[i]);
            if (o) items.push({ owner: ownerLabel(pk), partKey: pk, outfit: o });
        }
    }
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
            '<span class="om-act-count" id="om-act-count"></span>' +
            '<button class="om-act-close" id="om-act-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div class="om-act-body" id="om-act-body"></div>';
    document.body.appendChild(el);
    el.querySelector('#om-act-close').addEventListener('click', closeWindow);
    return el;
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

function cardHtml(item, idx) {
    var o = item.outfit;
    var imgs = getOutfitImages(o);
    var thumb = getOutfitThumb(o) || imgs[0] || '';
    var tagText = tagLineText(o);
    return '<div class="om-act-card" data-idx="' + idx + '">' +
        '<div class="om-act-thumb">' +
            (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" />' : '<span class="om-act-noimg"><i class="fa-solid fa-shirt"></i></span>') +
        '</div>' +
        '<div class="om-act-info">' +
            '<div class="om-act-owner" title="' + esc(item.owner) + '">' + esc(item.owner) + '</div>' +
            '<div class="om-act-name" title="' + esc(o.name || '') + '">' + esc(o.name || '未命名穿搭') + '</div>' +
            (tagText ? '<div class="om-act-tags">' + esc(tagText) + '</div>' : '') +
        '</div>' +
    '</div>';
}

var _lastItems = [];

function renderBody() {
    var el = document.getElementById(WIN_ID);
    if (!el) return;
    var body = el.querySelector('#om-act-body');
    var countEl = el.querySelector('#om-act-count');
    var items = collectActive();
    _lastItems = items;
    _lastSig = items.map(function (it) { return it.outfit.id; }).join(',');
    if (countEl) countEl.textContent = items.length ? '共 ' + items.length + ' 套' : '';
    if (!items.length) {
        body.innerHTML = '<div class="om-act-empty">当前没有生效的穿搭。<br><span>在衣柜里激活几套后再来看看。</span></div>';
        return;
    }
    body.innerHTML = items.map(cardHtml).join('');
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
    if (avail >= 210) {
        el.classList.remove('om-act-compact');
        el.style.width = Math.min(272, avail) + 'px';
    } else {
        el.classList.add('om-act-compact');
        el.style.width = '';
    }
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
}

function toggleWindow() {
    if (isWinOpen()) closeWindow();
    else openWindow();
}

// 窗口打开时，如果换了角色 / 改了激活，自动刷新
function refreshIfOpen() {
    if (!isWinOpen()) return;
    var sig = collectActive().map(function (it) { return it.outfit.id; }).join(',');
    if (sig === _lastSig) return;
    renderBody();
}
var _lastSig = '';

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

export { toggleWindow, openWindow, closeWindow, injectActiveBtn, refreshIfOpen };
