// ── 穿搭管理器 · 正文穿搭标记 ──────────────────────────────
// AI 正文里写 <Outfit-Manager-Custom>穿搭名称1/角色1+穿搭名称2/角色2</Outfit-Manager-Custom>
// 插件把这段标记换成可点的穿搭卡片行；点卡片看大图。

import { loadMeta, loadPartition, charNameById } from './db.js';
import { SHARED_CHAR_KEY, getOutfitThumb, getOutfitImages, getOutfitTags, garmentItemText } from './data.js';
import { esc } from './utils.js';
import { fn } from './bridge.js';

var MARK = 'Outfit-Manager-Custom';
// 开标签与闭标签都容忍（个别模型会把闭合标签写成同名开标签）
var TAG_RE = new RegExp('<' + MARK + '>([\\s\\S]*?)<\\/?' + MARK + '>', 'gi');

// "穿搭名称1/角色1+穿搭名称2/角色2" → [{name, owner}]
function parseEntries(raw) {
    var list = [];
    String(raw || '').split('+').forEach(function (chunk) {
        var s = chunk.trim();
        if (!s) return;
        var slash = s.lastIndexOf('/');
        if (slash > 0 && slash < s.length - 1) {
            list.push({ name: s.slice(0, slash).trim(), owner: s.slice(slash + 1).trim() });
        } else {
            list.push({ name: s, owner: '' });
        }
    });
    return list;
}

function ownerOf(partKey) {
    if (partKey === 'char:' + SHARED_CHAR_KEY) return '通用';
    if (partKey.indexOf('char:') === 0) {
        var nm = charNameById(partKey.slice(5));
        return nm && nm !== SHARED_CHAR_KEY ? nm : '角色';
    }
    if (partKey.indexOf('user:') === 0) return '我';
    return '衣柜';
}

// 列出所有分包（charIndex + 当前用户分包）
function allPartitions() {
    var meta = loadMeta();
    var keys = [];
    (meta.charIndex || []).forEach(function (it) {
        if (it && it.partKey && keys.indexOf(it.partKey) === -1) keys.push(it.partKey);
    });
    var out = [];
    keys.forEach(function (pk) {
        var part = loadPartition(pk);
        if (part) out.push({ partKey: pk, part: part });
    });
    return out;
}

function nameMatches(o, name) {
    var n = String(o.name || '');
    return n === name || n.toLowerCase() === name.toLowerCase();
}

// 名称 + 角色 → 穿搭
function resolveEntry(entry) {
    var pools = allPartitions();
    if (entry.owner) {
        pools = pools.filter(function (p) {
            var lab = ownerOf(p.partKey);
            return lab === entry.owner || p.partKey === entry.owner;
        });
    }
    var i, j;
    for (i = 0; i < pools.length; i++) {
        var outfits = pools[i].part.outfits || [];
        for (j = 0; j < outfits.length; j++) {
            if (nameMatches(outfits[j], entry.name)) {
                return { outfit: outfits[j], owner: ownerOf(pools[i].partKey) };
            }
        }
    }
    // 退一步：包含匹配（应对 AI 少写/多写几个字）
    for (i = 0; i < pools.length; i++) {
        var os = pools[i].part.outfits || [];
        for (j = 0; j < os.length; j++) {
            var n = String(os[j].name || '');
            if (n && (n.indexOf(entry.name) !== -1 || entry.name.indexOf(n) !== -1)) {
                return { outfit: os[j], owner: ownerOf(pools[i].partKey) };
            }
        }
    }
    return null;
}

function chipTagText(o) {
    var t = getOutfitTags(o);
    var bits = [];
    if (t.garment && t.garment.length) bits.push(t.garment.slice(0, 3).map(function (g) { return garmentItemText(g, ' '); }).join('、'));
    if (!bits.length && o.sceneTag) bits.push(o.sceneTag);
    return bits.join(' ｜ ');
}

function buildChip(entry) {
    var hit = resolveEntry(entry);
    var el = document.createElement('span');
    if (!hit) {
        el.className = 'om-msgchip om-msgchip-miss';
        el.title = '没有找到这套穿搭';
        el.textContent = (entry.owner ? entry.owner + ' · ' : '') + entry.name + '（未找到）';
        return el;
    }
    var o = hit.outfit;
    var imgs = getOutfitImages(o);
    var thumb = getOutfitThumb(o) || imgs[0] || '';
    el.className = 'om-msgchip';
    el.title = (hit.owner !== '通用' ? hit.owner + ' · ' : '') + (o.name || '');
    el.innerHTML =
        '<span class="om-msgchip-thumb">' +
            (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" />' : '<i class="fa-solid fa-shirt"></i>') +
        '</span>' +
        '<span class="om-msgchip-text">' +
            (hit.owner && hit.owner !== '通用' ? '<span class="om-msgchip-owner">' + esc(hit.owner) + '</span>' : '') +
            '<span class="om-msgchip-name">' + esc(o.name || '未命名穿搭') + '</span>' +
            (chipTagText(o) ? '<span class="om-msgchip-tags">' + esc(chipTagText(o)) + '</span>' : '') +
        '</span>';
    el.addEventListener('click', function () {
        if (fn.openLightbox) fn.openLightbox([o], o.id);
    });
    return el;
}

function buildChipRow(entries) {
    var box = document.createElement('div');
    box.className = 'om-msgtag';
    box.setAttribute('contenteditable', 'false');
    var head = document.createElement('span');
    head.className = 'om-msgtag-head';
    head.innerHTML = '<i class="fa-solid fa-shirt"></i> 本楼穿搭';
    box.appendChild(head);
    entries.forEach(function (e) { box.appendChild(buildChip(e)); });
    return box;
}

// 只处理文本节点，避免破坏消息里的 HTML
function replaceInTextNodes(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var targets = [];
    var n;
    while ((n = walker.nextNode())) {
        if (n.nodeValue && n.nodeValue.indexOf('<' + MARK) !== -1) {
            var p = n.parentNode;
            if (p && p.closest && (p.closest('pre') || p.closest('code'))) continue;
            targets.push(n);
        }
    }
    targets.forEach(function (node) {
        var text = node.nodeValue;
        var frag = document.createDocumentFragment();
        var last = 0, m;
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(text))) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            var entries = parseEntries(m[1]);
            if (entries.length) frag.appendChild(buildChipRow(entries));
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });
}

function decorateMessage(el) {
    if (!el || el.nodeType !== 1) return;
    var mesText = el.querySelector('.mes_text');
    if (!mesText) return;
    // 已经换成卡片后，正文里就不再有原始标记 → 天然幂等
    if (!mesText.textContent || mesText.textContent.indexOf('<' + MARK) === -1) return;
    var len = String(mesText.textContent.length);
    if (mesText.getAttribute('data-om-len') === len) return;
    replaceInTextNodes(mesText);
    mesText.setAttribute('data-om-len', String(mesText.textContent.length));
}

function decorateAll() {
    var nodes = document.querySelectorAll('#chat .mes');
    for (var i = 0; i < nodes.length; i++) decorateMessage(nodes[i]);
}

var _debounce = null;
function scheduleDecorate() {
    if (_debounce) clearTimeout(_debounce);
    _debounce = setTimeout(function () { _debounce = null; decorateAll(); }, 120);
}

export function setupMessageTags() {
    var start = function () {
        decorateAll();
        try {
            import('/script.js').then(function (mod) {
                var es = mod && mod.eventSource;
                var et = mod && mod.event_types;
                if (!es || typeof es.on !== 'function' || !et) return;
                if (et.MESSAGE_RENDERED) es.on(et.MESSAGE_RENDERED, function () { scheduleDecorate(); });
                if (et.CHARACTER_MESSAGE_RENDERED) es.on(et.CHARACTER_MESSAGE_RENDERED, function () { scheduleDecorate(); });
                if (et.CHAT_CHANGED) es.on(et.CHAT_CHANGED, function () { setTimeout(decorateAll, 200); });
            });
        } catch (e) { /* 非酒馆环境忽略 */ }
        var chat = document.getElementById('chat');
        if (chat && window.MutationObserver) {
            var mo = new MutationObserver(function () { scheduleDecorate(); });
            mo.observe(chat, { childList: true, subtree: true, characterData: true });
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}

export { decorateAll, parseEntries };
