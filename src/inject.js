// ── 穿搭管理器 · 注入核心 v2 ────────────────────────────────
// fetch/XHR 拦截 + 穿搭信息注入到 AI 请求
// v2: 使用 loadMeta() + loadActivePartitions() 代替旧 load() 全量读取

import { loadMeta, saveMeta, loadActivePartitions, currentUserPartKey, charNameById, resolveImageForExternal } from './db.js';
import { SHARED_CHAR_KEY, MARKER_TEMPLATE_DEFAULT, partGetById, getActiveKit, getKitAccessories, getOutfitImages, getOutfitImageCount, getOutfitTags, garmentItemText } from './data.js';
import { toast } from './utils.js';
import { state } from './bridge.js';

var BAIBAOKU_SAVE_GENERATE_PATH = '/api/plugins/baibaoku/v1/chats/save-generate';
var RECENT_INJECTED_BODY_TTL = 2 * 60 * 1000;
var recentInjectedBodies = [];

// 随机注入缓存（仅通用衣柜）：首次注入随机选取若干项生成缓存切片，后续注入复用
// { sig: activeIds.join(','), outfits: [...] }；sig 变化时重新生成
var sharedRandomCache = null;

// 三组标签 → 注入用短串：【场景：通勤 / 约会】【服装：衬衫、百褶裙】【气质：干练】
function buildTagLine(o) {
    var t = getOutfitTags(o);
    var parts = [];
    if (t.scene.length) parts.push('【场景：' + t.scene.join(' / ') + '】');
    if (t.garment.length) parts.push('【服装：' + t.garment.map(function (g) { return garmentItemText(g, '、'); }).join('、') + '】');
    if (t.impression.length) parts.push('【气质：' + t.impression.join('、') + '】');
    if (!parts.length && o && o.sceneTag && o.sceneTag.trim()) parts.push('【场景：' + o.sceneTag.trim() + '】');
    return parts.join('');
}

// 图片能力：不猜模型名（同名系列里既有纯文本也有多模态），改为「手动策略 + 实测学习」
// meta.imagePolicy: 'auto'（默认，遇到 400 自动学会并重发）/ 'always'（始终带图）/ 'never'（从不带图）
// meta.modelImageSupport: { '模型名': false } —— 被接口实际拒绝过的模型，下次直接跳过图片
var imageDowngradeToasted = false;
function modelRejectsImages(meta, modelName) {
    var policy = (meta && meta.imagePolicy) || 'auto';
    if (policy === 'never') return true;
    if (policy === 'always') return false;
    var map = (meta && meta.modelImageSupport) || {};
    return map[modelName] === false;
}

function bodyHasImages(bodyStr) {
    return typeof bodyStr === 'string' && bodyStr.indexOf('"image_url"') !== -1;
}

// 把请求体里所有 image_url 块去掉，content 只剩一段文字时压成字符串
function stripImagesFromBody(bodyStr) {
    try {
        var payload = JSON.parse(bodyStr);
        var fixMessages = function (list) {
            if (!Array.isArray(list)) return;
            list.forEach(function (m) {
                if (!m || !Array.isArray(m.content)) return;
                m.content = m.content.filter(function (b) { return !(b && b.type === 'image_url'); });
                if (m.content.length === 1 && m.content[0] && m.content[0].type === 'text') {
                    m.content = m.content[0].text;
                }
            });
        };
        fixMessages(payload.messages);
        if (payload && payload.data && Array.isArray(payload.data.messages)) fixMessages(payload.data.messages);
        return JSON.stringify(payload);
    } catch (e) {
        return bodyStr;
    }
}

// 接口是不是在抱怨图片
function looksLikeImageRejection(text) {
    if (!text) return false;
    var t = String(text).toLowerCase();
    var aboutImage = t.indexOf('image') !== -1 || t.indexOf('vision') !== -1 || t.indexOf('multimodal') !== -1;
    var rejected = t.indexOf('unsupported') !== -1 || t.indexOf('invalid') !== -1 ||
        t.indexOf('not support') !== -1 || t.indexOf('unknown variant') !== -1 || t.indexOf('not accept') !== -1;
    return aboutImage && rejected;
}

function rememberNoImageSupport(modelName) {
    if (!modelName) return;
    try {
        var meta = loadMeta();
        if (!meta.modelImageSupport || typeof meta.modelImageSupport !== 'object') meta.modelImageSupport = {};
        if (meta.modelImageSupport[modelName] === false) return;
        meta.modelImageSupport[modelName] = false;
        saveMeta(meta);
        toast('模型「' + modelName + '」不接受图片输入，已自动改为只发文字（下次会直接跳过图片）。');
    } catch (e) {}
}

// 让 AI 在回复末尾标注本楼用到的穿搭（正文标记格式）
// 文案取自 meta.markerTemplate（可在设置里改），占位符：{{example}} {{list}}
function buildMarkerHint(owners) {
    var list = [];
    var samplePairs = [];
    owners.forEach(function (ow) {
        var names = (ow.outfits || []).slice(0, 12).map(function (o) { return (o.name || '').trim(); }).filter(Boolean);
        if (!names.length) return;
        list.push(ow.name + ' → ' + names.join('、'));
        // 示例取前两个衣柜，各配一套，示范「多套用 + 连接」
        if (samplePairs.length < 2) samplePairs.push(names[0] + '/' + ow.name);
    });
    if (!list.length) return '';
    var sample = samplePairs.join('+') || '穿搭名称/角色';
    var tpl = '';
    try { tpl = String(loadMeta().markerTemplate || '').trim(); } catch (e) {}
    if (!tpl) tpl = MARKER_TEMPLATE_DEFAULT;
    var text = tpl.split('{{example}}').join(sample).split('{{list}}').join(list.join('；'));
    // 模板里没写占位符时，至少把清单补在末尾，避免 AI 拿不到可用名单
    if (text.indexOf('{{') === -1 && text.indexOf(list[0]) === -1) text += '可用：' + list.join('；') + '。';
    return '\n\n' + text;
}

// ── 判断「上一楼是否已经穿过」 ────────────────────────────
function contentToText(c) {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
        return c.map(function (part) {
            if (!part) return '';
            if (typeof part === 'string') return part;
            return typeof part.text === 'string' ? part.text : '';
        }).join('\n');
    }
    return '';
}

// ── 上次注入记录：判断「上一楼末尾插件发的那段说明」里有没有这套穿搭 ──
// 聊天身份：同一个聊天内才做去重，换聊天/换角色卡不串
function chatScopeKey() {
    try {
        var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
        if (ctx) return String(ctx.chatId || '') + '|' + String(ctx.name2 || '');
    } catch (e) {}
    return 'default';
}

// 取本聊天上一次注入的记录（其他聊天的忽略）
function getLastInjected(meta) {
    var last = meta && meta.lastInject;
    if (!last || typeof last !== 'object') return null;
    if (String(last.key || '') !== chatScopeKey()) return null;
    return last;
}

// 记住这一轮实际发出去的穿搭与文字，供下一轮比对
function rememberLastInjected(outfits, text) {
    try {
        var m = loadMeta();
        m.lastInject = {
            key: chatScopeKey(),
            ids: (outfits || []).map(function (o) { return o.id; }),
            names: (outfits || []).map(function (o) { return String((o && o.name) || ''); }),
            text: String(text || '').slice(0, 8000),
            ts: Date.now()
        };
        saveMeta(m);
    } catch (e) {}
}

// 这套穿搭是不是已经出现在上一楼那段说明里
function wasSentLastRound(last, o) {
    if (!last || !o) return false;
    if (Array.isArray(last.ids) && last.ids.length) return last.ids.indexOf(o.id) !== -1;
    // 没记 id 时退化为比对原文（名字或整段标签）
    var t = String(last.text || '');
    if (!t) return false;
    var name = String(o.name || '').trim();
    if (name.length >= 3 && t.indexOf(name) !== -1) return true;
    var tl = buildTagLine(o);
    return !!(tl && t.indexOf(tl) !== -1);
}

// 从列表中随机抽取 n 项（Fisher-Yates 部分洗牌），返回新数组，不修改入参
function pickRandomOutfits(outs, n) {
    if (!outs || outs.length === 0) return [];
    var pool = outs.slice();
    var count = Math.min(n, pool.length);
    for (var i = 0; i < count; i++) {
        var j = i + Math.floor(Math.random() * (pool.length - i));
        var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, count);
}

// 手动/事件刷新随机切片：清空缓存，下一次注入重新随机抽取
export function clearRandomInjectCache() {
    sharedRandomCache = null;
}

// 获取注入用的图片URL列表（server模式下优先用预解析的base64）
function getInjectImageUrls(outfit) {
    var imgs = getOutfitImages(outfit);
    if (!imgs || imgs.length === 0) return [];
    // 检查预解析缓存
    if (state.resolvedImages && state.resolvedImages[outfit.id]) {
        var cached = state.resolvedImages[outfit.id];
        if (cached.urls && cached.dataUrls && cached.urls.length === imgs.length) {
            var same = true;
            for (var i = 0; i < imgs.length; i++) {
                if (cached.urls[i] !== imgs[i]) { same = false; break; }
            }
            if (same) return cached.dataUrls;
        }
    }
    // 兜底：接口只认 http(s):// 或 data:image/，相对路径会被判成 Unsupported image_url format
    var base = '';
    try { base = location.origin || ''; } catch (e) {}
    return imgs.map(function (u) {
        if (typeof u !== 'string') return u;
        if (u.indexOf('data:image/') === 0) return u;
        if (u.indexOf('http://') === 0 || u.indexOf('https://') === 0) return u;
        if (u.charAt(0) === '/' && base) return base + u;
        return u;
    });
}

// ── 图片预热：注入前把 server 图片解析成 data URL（同步注入拿不到异步结果）──
var imageWarmInFlight = null;
function warmActiveImages() {
    if (imageWarmInFlight) return imageWarmInFlight;
    var jobs = [];
    try {
        var parts = loadActivePartitions();
        for (var pk in parts) {
            (function (part) {
                if (!part || !part.outfits || !part.activeIds) return;
                part.activeIds.forEach(function (id) {
                    var o = partGetById(part, id);
                    if (!o) return;
                    var imgs = getOutfitImages(o);
                    if (!imgs.length) return;
                    var cached = state.resolvedImages && state.resolvedImages[o.id];
                    if (cached && cached.urls && cached.urls.length === imgs.length) {
                        var same = true;
                        for (var i = 0; i < imgs.length; i++) {
                            if (cached.urls[i] !== imgs[i]) { same = false; break; }
                        }
                        if (same) return;
                    }
                    jobs.push(new Promise(function (resolve) {
                        var resolved = new Array(imgs.length);
                        var pending = imgs.length;
                        var finish = function () {
                            state.resolvedImages[o.id] = { urls: imgs.slice(), dataUrls: resolved.slice() };
                            resolve();
                        };
                        imgs.forEach(function (u, i) {
                            if (typeof u === 'string' && u.indexOf('/api/plugins/outfit-manager/images/') === 0) {
                                resolveImageForExternal(u, function (d) {
                                    resolved[i] = (typeof d === 'string' && d.indexOf('data:image/') === 0) ? d : u;
                                    if (--pending === 0) finish();
                                });
                            } else {
                                resolved[i] = u;
                                if (--pending === 0) finish();
                            }
                        });
                    }));
                });
            })(parts[pk]);
        }
    } catch (e) {}
    var all = Promise.all(jobs);
    imageWarmInFlight = all.then(function () { imageWarmInFlight = null; }, function () { imageWarmInFlight = null; });
    // 最多等 4 秒，超时就按现有缓存继续，别把聊天卡住
    return Promise.race([imageWarmInFlight, new Promise(function (r) { if (typeof setTimeout === 'function') setTimeout(r, 4000); })]);
}

// ── 文本注入 ─────────────────────────────────────────────
// position: 'system' | 'context' | 'user'
function injectText(p, text, position) {
    if (!p.messages || !Array.isArray(p.messages)) {
        if (typeof p.prompt === 'string') p.prompt = text + '\n\n' + p.prompt;
        return;
    }

    if (position === 'user') {
        for (var j = p.messages.length - 1; j >= 0; j--) {
            if (p.messages[j].role === 'user') {
                var c = p.messages[j].content;
                if (typeof c === 'string') p.messages[j].content = c + '\n\n' + text;
                else if (Array.isArray(c)) c.push({ type: 'text', text: '\n\n' + text });
                break;
            }
        }
    } else if (position === 'context') {
        var lastUserIdx = -1;
        for (var k = p.messages.length - 1; k >= 0; k--) {
            if (p.messages[k].role === 'user') { lastUserIdx = k; break; }
        }
        var sysMsg = { role: 'system', content: text };
        if (lastUserIdx > 0) p.messages.splice(lastUserIdx, 0, sysMsg);
        else if (lastUserIdx === 0) p.messages.unshift(sysMsg);
        else p.messages.push(sysMsg);
    } else {
        var si = -1; for (var i = 0; i < p.messages.length; i++) { if (p.messages[i].role === 'system') { si = i; break; } }
        if (si !== -1) {
            var sm = p.messages[si];
            if (typeof sm.content === 'string') sm.content += '\n\n' + text;
            else if (Array.isArray(sm.content)) sm.content.push({ type: 'text', text: '\n\n' + text });
        } else { p.messages.unshift({ role: 'system', content: text }); }
    }
}

// ── 图片注入（旧接口，保留兼容）─────────────────────────
function injectImages(p, imgs) {
    if (!p.messages || !Array.isArray(p.messages)) return;
    for (var j = p.messages.length - 1; j >= 0; j--) {
        if (p.messages[j].role === 'user') {
            var c = p.messages[j].content;
            var blocks = imgs.map(function (img) { return { type: 'image_url', image_url: { url: img } }; });
            if (typeof c === 'string') p.messages[j].content = [{ type: 'text', text: c }].concat(blocks);
            else if (Array.isArray(c)) blocks.forEach(function (b) { c.push(b); });
            break;
        }
    }
}

// ── 按owner交错注入 文字标签+图片 ────────────────────────
function injectImageBlocks(p, ownerImageGroups, imgPrompt, multiImgPrompt) {
    if (!p.messages || !Array.isArray(p.messages)) return;
    for (var j = p.messages.length - 1; j >= 0; j--) {
        if (p.messages[j].role === 'user') {
            var c = p.messages[j].content;
            if (typeof c === 'string') {
                c = [{ type: 'text', text: c }];
                p.messages[j].content = c;
            }

            if (ownerImageGroups.length > 1) {
                c.push({ type: 'text', text: '\n\n=== 穿搭图片参考 ===' });
            }

            var hasMulti = false;
            ownerImageGroups.forEach(function (grp) {
                if (grp.isMulti) {
                    hasMulti = true;
                    c.push({ type: 'text', text: '\n[' + grp.name + '的可选穿搭 - 共' + grp.outfits.length + '套]' });
                    grp.outfits.forEach(function (o, i) {
                        var urls = getInjectImageUrls(o);
                        if (urls.length === 0) return;
                        c.push({ type: 'text', text: '\n(穿搭' + (i + 1) + ')' + (buildTagLine(o) ? ' ' + buildTagLine(o) : '') + '：' });
                        urls.forEach(function (url) {
                            c.push({ type: 'image_url', image_url: { url: url } });
                        });
                    });
                } else {
                    var o = grp.outfits[0];
                    var urls = getInjectImageUrls(o);
                    if (urls.length === 0) return;
                    c.push({ type: 'text', text: '\n[' + grp.name + '当前穿着]' });
                    urls.forEach(function (url) {
                        c.push({ type: 'image_url', image_url: { url: url } });
                    });
                }
            });

            var prompt = hasMulti ? multiImgPrompt : imgPrompt;
            if (prompt) {
                c.push({ type: 'text', text: '\n' + prompt });
            }

            if (ownerImageGroups.length > 1) {
                c.push({ type: 'text', text: '\n=== 穿搭图片结束 ===' });
            }
            break;
        }
    }
}

// ── 请求体注入逻辑（v2：基于 meta + activePartitions）──
function markPayloadInjected(p) {
    try {
        Object.defineProperty(p, '__omInjected', { value: true, configurable: true });
    } catch (e) {}
}

function cleanupRecentInjectedBodies(now) {
    var t = now || Date.now();
    recentInjectedBodies = recentInjectedBodies.filter(function (item) {
        return item && (t - item.at) < RECENT_INJECTED_BODY_TTL;
    });
}

function rememberInjectedBody(p) {
    try {
        cleanupRecentInjectedBodies();
        recentInjectedBodies.push({ body: JSON.stringify(p), at: Date.now() });
        if (recentInjectedBodies.length > 20) recentInjectedBodies.shift();
    } catch (e) {}
}

function wasRecentlyInjectedBody(bodyStr) {
    cleanupRecentInjectedBodies();
    for (var i = 0; i < recentInjectedBodies.length; i++) {
        if (recentInjectedBodies[i].body === bodyStr) return true;
    }
    return false;
}

function getFetchUrl(input) {
    try {
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.href;
        if (input && typeof input.url === 'string') return input.url;
    } catch (e) {}
    return '';
}

function isBaibaokuSaveGenerateRequest(input) {
    try {
        var rawUrl = getFetchUrl(input);
        if (!rawUrl) return false;
        var url = new URL(rawUrl, location.href);
        return url.origin === location.origin && url.pathname === BAIBAOKU_SAVE_GENERATE_PATH;
    } catch (e) {
        return false;
    }
}

// 是否"真正的聊天请求体"：必须含 messages 数组，且至少一条消息具备 role + content（字符串或多模态数组）
function isChatPayload(p) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.messages)) return false;
    for (var i = 0; i < p.messages.length; i++) {
        var m = p.messages[i];
        if (m && typeof m === 'object' && typeof m.role === 'string' &&
            (typeof m.content === 'string' || Array.isArray(m.content))) {
            return true;
        }
    }
    return false;
}

// 聊天 API 端点特征：OpenAI 系 /chat/completions、Anthropic /v1/messages、Gemini :generateContent
var CHAT_URL_HINTS = ['/chat/completions', '/v1/messages', ':generateContent'];
function isChatLikeUrl(rawUrl) {
    try {
        if (!rawUrl) return false;
        var url = new URL(rawUrl, typeof location !== 'undefined' ? location.href : undefined);
        var p = url.pathname + url.search;
        for (var i = 0; i < CHAT_URL_HINTS.length; i++) {
            if (p.indexOf(CHAT_URL_HINTS[i]) !== -1) return true;
        }
    } catch (e) {}
    return false;
}

function tryInjectPayload(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    if (p.__omInjected) return false;
    // 只注入真正的聊天请求（messages 数组，role+content 结构）；不再处理裸 prompt 请求体
    if (!isChatPayload(p)) return false;

    var meta = loadMeta();
    if (meta.injectEnabled === false) return null;  // 注入总开关：关闭时跳过注入
    var pos = meta.injectPosition || 'user';
    var injectMode = meta.injectMode || 'tag_text';
    var useImg = (injectMode === 'tag_text_image');
    var useText = (injectMode === 'tag_text' || injectMode === 'tag_text_image');
    var tagOnly = (injectMode === 'tag');

    // 图片能力：只看手动策略和实测学习结果，不按模型名猜
    if (useImg && modelRejectsImages(meta, p.model)) {
        useImg = false;
        if (!imageDowngradeToasted) {
            imageDowngradeToasted = true;
            toast('模型「' + p.model + '」之前拒绝过图片输入，本次改为「标签 + 文字」发送。设置 → 发送内容 → 图片策略 可改回「始终带图」。');
        }
    }

    // 获取所有有激活穿搭的 partition（已预加载，同步读取）
    var activeParts = loadActivePartitions();
    // activeParts = { 'user:p_xxx': {outfits,categories,activeIds}, 'char:c_xxx': {...}, ... }

    if (Object.keys(activeParts).length === 0) return null;

    // 收集所有 owner 及其激活穿搭
    var owners = [];

    // ── User 穿搭 ──
    var curUserPK = currentUserPartKey();
    if (activeParts[curUserPK]) {
        var userPart = activeParts[curUserPK];
        var userOutfits = [];
        (userPart.activeIds || []).forEach(function (id) {
            var o = partGetById(userPart, id);
            if (o) userOutfits.push(o);
        });
        if (userOutfits.length > 0) {
            owners.push({
                name: 'User',
                outfits: userOutfits,
                partition: userPart,
                tplSingle: meta.singleTemplate,
                tplMulti: meta.multiTemplate
            });
        }
    }

    // ── 角色衣柜：通用 vs 单人互斥 ──
    var sharedOutfits = [];
    var sharedPartKey = 'char:' + SHARED_CHAR_KEY;
    var sharedPart = activeParts[sharedPartKey];
    if (sharedPart) {
        (sharedPart.activeIds || []).forEach(function (id) {
            var o = partGetById(sharedPart, id);
            if (o) sharedOutfits.push(o);
        });
    }

    // 随机注入（仅通用衣柜）：开启后首次注入随机选取若干项并缓存，后续注入复用缓存
    var injectSharedOutfits = sharedOutfits;
    if (sharedOutfits.length > 0 && meta.randomInject) {
        var randSig = (sharedPart.activeIds || []).join(',');
        if (sharedRandomCache && sharedRandomCache.sig === randSig && sharedRandomCache.outfits.length > 0) {
            injectSharedOutfits = sharedRandomCache.outfits;
        } else {
            var randCount = (typeof meta.randomInjectCount === 'number' && meta.randomInjectCount > 0)
                ? Math.floor(meta.randomInjectCount) : 1;
            injectSharedOutfits = pickRandomOutfits(sharedOutfits, randCount);
            sharedRandomCache = { sig: randSig, outfits: injectSharedOutfits };
        }
    } else {
        // 关闭随机注入或通用衣柜无激活时，清空缓存
        sharedRandomCache = null;
    }

    if (injectSharedOutfits.length > 0) {
        // 通用衣柜有激活 → 用当前角色卡名字注入，忽略所有单人衣柜
        var charName2 = '';
        try { charName2 = SillyTavern.getContext().name2 || ''; } catch (e) {}
        if (charName2) {
            owners.push({
                name: charName2,
                outfits: injectSharedOutfits,
                partition: activeParts[sharedPartKey],
                tplSingle: meta.charSingleTemplate,
                tplMulti: meta.charMultiTemplate
            });
        }
    } else {
        // 通用衣柜无激活 → 遍历各角色 partition
        for (var pk in activeParts) {
            // 跳过 user:* 和 shared
            if (pk.indexOf('char:') !== 0) continue;
            if (pk === sharedPartKey) continue;

            var charPart = activeParts[pk];
            var charOutfits = [];
            (charPart.activeIds || []).forEach(function (id) {
                var o = partGetById(charPart, id);
                if (o) charOutfits.push(o);
            });
            if (charOutfits.length > 0) {
                // 从 partKey 提取 charId，查角色名
                var charId = pk.substring(5); // 'char:'.length = 5
                var ownerName = charNameById(charId) || charId;
                owners.push({
                    name: ownerName,
                    outfits: charOutfits,
                    partition: charPart,
                    tplSingle: meta.charSingleTemplate,
                    tplMulti: meta.charMultiTemplate
                });
            }
        }
    }

    if (owners.length === 0) return null;

    // ── 上一楼末尾已经发过的那段穿搭说明，不再重复发送 ──
    // 判定依据：插件自己记录的上一次注入（meta.lastInject：发出去的穿搭 id + 那段原文）
    if (meta.skipSentOutfits !== false) {
        var lastInject = getLastInjected(meta);
        if (lastInject) {
            var beforeN = 0, afterN = 0;
            owners.forEach(function (ow) { beforeN += (ow.outfits || []).length; });
            var keptOwners = [];
            owners.forEach(function (ow) {
                var list = (ow.outfits || []).filter(function (o) { return !wasSentLastRound(lastInject, o); });
                afterN += list.length;
                if (!list.length) return;
                var copy = {};
                for (var k in ow) copy[k] = ow[k];
                copy.outfits = list;
                keptOwners.push(copy);
            });
            // 全部都被判为「已经发过」时保留原样：宁可重复一次，也不能一条服装信息都不发
            if (afterN > 0 && afterN < beforeN) owners = keptOwners;
        }
    }

    // ── 组装注入内容（v2 + 单品支持）──
    var allTextParts = [];
    var ownerImageGroups = [];

    // 单品描述拼接辅助：按单品 category 排序后拼接
    function buildAccText(partition, outfit) {
        var kit = getActiveKit(outfit);
        if (!kit) return '';
        var accs = getKitAccessories(partition, kit);
        var disabled = Array.isArray(kit.disabledAccIds) ? kit.disabledAccIds : [];
        if (disabled.length > 0) {
            accs = accs.filter(function (acc) { return disabled.indexOf(acc.id) === -1; });
        }
        if (accs.length === 0) return '';
        // 按 category 字母排序保证注入顺序固定
        accs.sort(function (a, b) {
            var ca = (a.category || '').toLowerCase();
            var cb = (b.category || '').toLowerCase();
            if (ca < cb) return -1;
            if (ca > cb) return 1;
            return 0;
        });
        var lines = accs.map(function (acc) {
            var label = acc.category ? acc.category : '单品';
            var desc = (acc.description && acc.description.trim()) ? acc.description.trim() : '';
            return desc ? '[' + label + '] ' + desc : '';
        }).filter(function (l) { return l !== ''; });
        return lines.length > 0 ? '\n' + lines.join('\n') : '';
    }

    owners.forEach(function (ow) {
        var active = ow.outfits;
        var isMulti = active.length > 1;

        if (isMulti) {
            var lines = active.map(function (o, i) {
                var scene = buildTagLine(o);
                var desc = (o.description && o.description.trim()) ? o.description.trim() : '';
                var accText = buildAccText(ow.partition, o);
                return '[穿搭' + (i + 1) + '] ' + scene + (desc ? '\n' + desc : '') + accText;
            });
            if (tagOnly) {
                // 仅标签：只发「[穿搭N] 【场景…】【服装…】【气质…】」，不发描述与单品细节
                allTextParts.push(active.map(function (o, i) {
                    return '[穿搭' + (i + 1) + '] ' + buildTagLine(o);
                }).join('\n'));
            }
            if (useText) {
                var wt = (ow.tplMulti || '[服装信息]\n{{charName}}的穿搭：\n{{wardrobe}}')
                    .replace(/\{\{charName\}\}/g, ow.name)
                    .replace('{{wardrobe}}', lines.join('\n\n'));
                allTextParts.push(wt);
            }
            if (useImg) {
                var imgOutfits = active.filter(function (o) { return getOutfitImageCount(o) > 0; });
                if (imgOutfits.length > 0) ownerImageGroups.push({ name: ow.name, outfits: imgOutfits, isMulti: true });
            }
        } else {
            var o = active[0];
            if (tagOnly) allTextParts.push('[' + ow.name + '当前穿着] ' + buildTagLine(o));
            if (useText) {
                var desc2 = (o.description && o.description.trim()) ? o.description.trim() : '';
                var accText2 = buildAccText(ow.partition, o);
                var tagLine2 = buildTagLine(o);
                if (tagLine2 || desc2 || accText2) {
                    // 标签永远带在前面（单套模式下以前漏了标签）
                    var fullDesc = (tagLine2 ? tagLine2 + '\n' : '') + desc2 + accText2;
                    var st = (ow.tplSingle || '[服装信息]\n{{charName}}当前穿着：\n{{description}}')
                        .replace(/\{\{charName\}\}/g, ow.name)
                        .replace('{{description}}', fullDesc);
                    allTextParts.push(st);
                }
            }
            if (useImg && getOutfitImageCount(o) > 0) { ownerImageGroups.push({ name: ow.name, outfits: [o], isMulti: false }); }
        }
    });

    var injected = false;
    var markerHint = (meta.markerEnabled !== false) ? buildMarkerHint(owners) : '';

    if (allTextParts.length > 0) {
        var mergedText;
        if (allTextParts.length === 1) {
            mergedText = allTextParts[0];
        } else {
            mergedText = '=== 当前场景服装信息（必须严格遵守，不可自行编造服装）===\n\n' + allTextParts.join('\n\n---\n\n') + '\n\n=== 服装信息结束 ===';
        }
        if (markerHint) mergedText += markerHint;
        injectText(p, mergedText, pos);
        injected = true;
    } else if (markerHint) {
        injectText(p, markerHint.replace(/^\n+/, ''), pos);
        injected = true;
    }

    if (injected) {
        var sentOutfits = [];
        owners.forEach(function (ow) {
            (ow.outfits || []).forEach(function (o) { sentOutfits.push(o); });
        });
        rememberLastInjected(sentOutfits, mergedText || markerHint || '');
    }

    if (ownerImageGroups.length > 0) {
        var imgPrompt = meta.imagePrompt || '';
        var multiImgPrompt = meta.multiImagePrompt || '';
        injectImageBlocks(p, ownerImageGroups, imgPrompt, multiImgPrompt);
        injected = true;
    }

    if (meta.debug) {
        var summary = owners.map(function (ow) { return ow.name + ':' + ow.outfits.length + '套'; }).join(' + ');
        toast('👗 ' + summary + ' [' + injectMode + '|' + pos + ']');
    }

    if (injected) markPayloadInjected(p);
    return injected;
}

function tryInjectBody(bodyStr, options) {
    if (wasRecentlyInjectedBody(bodyStr)) return null;

    var p; try { p = JSON.parse(bodyStr); } catch (e) { return null; }
    if (tryInjectPayload(p)) return JSON.stringify(p);

    if (options && options.baibaokuSaveGenerate && p && p.generate && typeof p.generate === 'object') {
        var nestedBody = '';
        try { nestedBody = JSON.stringify(p.generate); } catch (e) {}
        if (nestedBody && wasRecentlyInjectedBody(nestedBody)) return null;
        if (tryInjectPayload(p.generate)) return JSON.stringify(p);
    }

    return null;
}

function registerCompletionEventInjection() {
    if (window.__omCompletionEventInjectionInstalled) return;
    window.__omCompletionEventInjectionInstalled = true;

    import('/script.js').then(function (mod) {
        var eventSource = mod && mod.eventSource;
        var eventTypes = mod && mod.event_types;
        var eventName = eventTypes && eventTypes.CHAT_COMPLETION_SETTINGS_READY;
        if (!eventSource || !eventName || typeof eventSource.on !== 'function') return;

        var handler = function (payload) {
            try {
                if (tryInjectPayload(payload)) rememberInjectedBody(payload);
            } catch (e) {}
        };

        eventSource.on(eventName, handler);
        if (typeof eventSource.makeFirst === 'function') {
            eventSource.makeFirst(eventName, handler);
        }
    }).catch(function () {
        window.__omCompletionEventInjectionInstalled = false;
    });
}

// 新建聊天时自动刷新随机切片（仅"新建/切到空聊天"，切换旧聊天不刷新）
function registerNewChatRefresh() {
    if (window.__omNewChatRefreshInstalled) return;
    window.__omNewChatRefreshInstalled = true;

    import('/script.js').then(function (mod) {
        var eventSource = mod && mod.eventSource;
        var eventTypes = mod && mod.event_types;
        var eventName = eventTypes && eventTypes.CHAT_CHANGED;
        if (!eventSource || !eventName || typeof eventSource.on !== 'function') return;

        var handler = function () {
            try {
                var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
                var chat = ctx && ctx.chat;
                // 新聊天 = 切换后当前聊天为空（无消息）；旧聊天切换不刷新
                if (!chat || chat.length === 0) clearRandomInjectCache();
            } catch (e) {}
        };

        eventSource.on(eventName, handler);
        if (typeof eventSource.makeFirst === 'function') {
            eventSource.makeFirst(eventName, handler);
        }
    }).catch(function () {
        window.__omNewChatRefreshInstalled = false;
    });
}

// ── 安装拦截器 ─────────────────────────────────────────
export function setupInjection() {
    // 防止重复安装（热重载等场景）
    if (window.__omInjectionInstalled) return;
    window.__omInjectionInstalled = true;

    // 事件注册依赖动态 import('/script.js')，失败不应中断插件初始化
    try {
        registerCompletionEventInjection();
    } catch (e) {}
    try {
        registerNewChatRefresh();
    } catch (e) {}

    var origFetch = window.fetch;
    window.fetch = function (input, init) {
        try {
            // 跳过插件内部的 API 调用
            if (init && init.headers && init.headers['X-OM-Internal']) {
                return origFetch.apply(this, arguments);
            }
            if (init && init.body && typeof init.body === 'string') {
                // 只拦截真正的聊天请求：URL 命中聊天端点特征，或百宝库回写路径（嵌套聊天体）
                var isBaibao = isBaibaokuSaveGenerateRequest(input);
                if (isBaibao || isChatLikeUrl(getFetchUrl(input))) {
                    var self = this;
                    var rawInput = input;
                    var rawInit = init;
                    // 要发图就先等图片解析成 data URL（接口只认 data:/http(s)）
                    var wantImg = false;
                    try {
                        var mm = loadMeta();
                        wantImg = (mm.injectMode || 'tag_text') === 'tag_text_image' && !modelRejectsImages(mm, '');
                    } catch (e3) {}
                    var pre = wantImg ? warmActiveImages() : Promise.resolve();
                    return pre.then(function () {
                        var nb = tryInjectBody(rawInit.body, { baibaokuSaveGenerate: isBaibao });
                        if (!nb) return origFetch.call(self, rawInput, rawInit);
                        var nextInit = Object.assign({}, rawInit, { body: nb });
                        var req = origFetch.call(self, rawInput, nextInit);
                        // 实测学习：接口拒绝图片 → 记住该模型，并用去掉图片的请求体重发一次
                        if (!bodyHasImages(nb)) return req;
                        var modelName = '';
                        try { modelName = JSON.parse(nb).model || ''; } catch (e2) {}
                        return req.then(function (res) {
                            if (!res || res.ok) return res;
                            return res.clone().text().then(function (txt) {
                                if (!looksLikeImageRejection(txt)) return res;
                                rememberNoImageSupport(modelName);
                                return origFetch.call(self, rawInput, Object.assign({}, rawInit, { body: stripImagesFromBody(nb) }));
                            }).catch(function () { return res; });
                        });
                    }).catch(function () { return origFetch.call(self, rawInput, rawInit); });
                }
            }
        } catch (e) {}
        return origFetch.apply(this, arguments);
    };

    // XHR 拦截：记录 open 的 URL，仅在聊天类 URL 上注入；XMLHttpRequest 不可用时跳过
    if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype && typeof XMLHttpRequest.prototype.open === 'function' && typeof XMLHttpRequest.prototype.send === 'function') {
        var origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            try { this.__omLastUrl = url; } catch (e) {}
            return origOpen.apply(this, arguments);
        };
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
            try {
                if (body && typeof body === 'string' && isChatLikeUrl(this.__omLastUrl)) {
                    var nb = tryInjectBody(body);
                    if (nb) return origSend.call(this, nb);
                }
            } catch (e) {}
            return origSend.apply(this, arguments);
        };
    }
}

// 供测试使用：判断上一楼是否已经穿过某套穿搭
export { getLastInjected, wasSentLastRound, chatScopeKey, rememberLastInjected };
