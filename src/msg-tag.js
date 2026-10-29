// ── 穿搭管理器 · 正文穿搭标记 ──────────────────────────────
// AI 正文里写 <Outfit-Manager-Custom>穿搭名称1/角色1+穿搭名称2/角色2</Outfit-Manager-Custom>
// 插件把这段标记从正文里抹掉，并记下"这一楼穿了哪几套"，
// 然后在左下角「当前生效穿搭」浮窗里给对应的卡片打上「本楼穿着」标识。

import { loadMeta, loadPartition, charNameById } from './db.js';
import { SHARED_CHAR_KEY } from './data.js';
import { fn } from './bridge.js';

var MARK = 'Outfit-Manager-Custom';
// 开标签与闭标签都容忍（个别模型会把闭合标签写成同名开标签），也容忍标签里多出的空格
var TAG_RE = new RegExp('<' + MARK + '\\s*>([\\s\\S]*?)<\\/?' + MARK + '\\s*>', 'gi');
var MARK_LOWER = '<' + MARK.toLowerCase();

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
    var all = allPartitions();
    var pools = all;
    if (entry.owner) {
        var filtered = all.filter(function (p) {
            var lab = ownerOf(p.partKey);
            return lab === entry.owner || p.partKey === entry.owner;
        });
        // 对不上衣柜时退回全量：AI 可能写的是角色名，而不是衣柜名
        if (filtered.length) pools = filtered;
    }
    var i, j;
    for (i = 0; i < pools.length; i++) {
        var outfits = pools[i].part.outfits || [];
        for (j = 0; j < outfits.length; j++) {
            if (nameMatches(outfits[j], entry.name)) {
                return { outfit: outfits[j], owner: entry.owner || ownerOf(pools[i].partKey) };
            }
        }
    }
    // 退一步：包含匹配（应对 AI 少写/多写几个字）
    for (i = 0; i < pools.length; i++) {
        var os = pools[i].part.outfits || [];
        for (j = 0; j < os.length; j++) {
            var n = String(os[j].name || '');
            if (n && (n.indexOf(entry.name) !== -1 || entry.name.indexOf(n) !== -1)) {
                return { outfit: os[j], owner: entry.owner || ownerOf(pools[i].partKey) };
            }
        }
    }
    return null;
}

// ── 本楼穿着记录 ─────────────────────────────────────────
// outfitId → { owner, name }
var _worn = {};
var _wornMesId = null;

function getWorn() { return _worn; }

function resetWorn() {
    _worn = {};
    _wornMesId = null;
}

function mesIdOf(el) {
    var v = el && el.getAttribute ? el.getAttribute('mesid') : null;
    var id = parseInt(v, 10);
    return isNaN(id) ? -1 : id;
}

// 从正文里抹掉标记文本，并把命中的穿搭收集到 collected
function stripInTextNodes(root, collected) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var targets = [];
    var n;
    while ((n = walker.nextNode())) {
        if (n.nodeValue && n.nodeValue.toLowerCase().indexOf(MARK_LOWER) !== -1) {
            var p = n.parentNode;
            if (p && p.closest && (p.closest('pre') || p.closest('code'))) continue;
            targets.push(n);
        }
    }
    var found = false;
    targets.forEach(function (node) {
        var text = node.nodeValue;
        var frag = document.createDocumentFragment();
        var last = 0, m;
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(text))) {
            found = true;
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            parseEntries(m[1]).forEach(function (entry) {
                var hit = resolveEntry(entry);
                if (hit) collected.push(hit);
            });
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });
    return found;
}

function decorateMessage(el) {
    if (!el || el.nodeType !== 1) return false;
    // 优先只看正文区；找不到就用整条消息兜底
    var mesText = el.querySelector('.mes_text') || el;
    var raw = mesText.textContent || '';
    if (raw.toLowerCase().indexOf(MARK_LOWER) === -1) return false;
    var collected = [];
    stripInTextNodes(mesText, collected);
    // 抹掉后正文里不再有标记 → 天然幂等
    mesText.setAttribute('data-om-len', String(mesText.textContent.length));
    if (!collected.length) return false;
    var id = mesIdOf(el);
    // 老楼层的标记不覆盖新楼层
    if (_wornMesId !== null && id !== -1 && id < _wornMesId) return false;
    _wornMesId = id;
    _worn = {};
    collected.forEach(function (hit) {
        _worn[hit.outfit.id] = { owner: hit.owner, name: hit.outfit.name || '' };
    });
    return true;
}

function decorateAll() {
    var nodes = document.querySelectorAll('#chat .mes');
    if (!nodes.length) nodes = document.querySelectorAll('#chat');
    var changed = false;
    for (var i = 0; i < nodes.length; i++) {
        if (decorateMessage(nodes[i])) changed = true;
    }
    // 最新一楼没有标记 → 上一楼的"本楼穿着"作废
    if (nodes.length) {
        var lastId = mesIdOf(nodes[nodes.length - 1]);
        if (lastId !== -1 && _wornMesId !== null && lastId > _wornMesId) {
            resetWorn();
            changed = true;
        }
    }
    if (changed && fn.refreshActiveWindow) fn.refreshActiveWindow();
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
                if (et.CHAT_CHANGED) es.on(et.CHAT_CHANGED, function () {
                    resetWorn();
                    setTimeout(decorateAll, 200);
                });
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

export { decorateAll, parseEntries, getWorn, resetWorn };
