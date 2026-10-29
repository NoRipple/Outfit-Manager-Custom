// ── 穿搭管理器 · API 调用 ──────────────────────────────────
// Vision API、模型选择、批量描述生成

import { load, save, loadMeta, loadCurrent, saveCurrent, loadPartition, savePartition, currentPartKey, resolveImageForExternal } from './db.js';
import { getById, partGetById, partGetAccById, normalizeTags, TAG_GROUP_KEYS, TAG_GROUPS, TAG_PROMPT_DEFAULT, setOutfitTags, outfitHasTags } from './data.js';
import { toast, getPopupLayer, esc } from './utils.js';

// ── 标签生成指令（追加在用户 prompt 之后，用户改 prompt 也不会丢）──
var TAG_INSTRUCTION = [
    '',
    '另外请在 JSON 里加一个 tags 字段，给这套穿搭打三组标签（每组 0-4 个词，每个词 2-6 个汉字，只写词不要整句，没有就给空数组）：',
    '- tags.scene：场景/时机，例如 通勤、约会、雨天、居家、睡前、运动、宴会',
    '- tags.garment：主要单品，例如 衬衫、百褶裙、风衣、高跟鞋、针织衫',
    '- tags.impression：气质观感，例如 清纯、干练、性感、慵懒、甜美、帅气',
    'tags 结构示例：{"scene":["通勤"],"garment":["衬衫","百褶裙"],"impression":["干练"]}'
].join('\n');

function withTagInstruction(prompt) {
    var p = prompt || '';
    if (p.indexOf('tags.scene') !== -1) return p;
    return p + '\n' + TAG_INSTRUCTION;
}

function hasTagContent(tags) {
    if (!tags || typeof tags !== 'object') return false;
    for (var i = 0; i < TAG_GROUP_KEYS.length; i++) {
        var list = tags[TAG_GROUP_KEYS[i]];
        if (Array.isArray(list) && list.length > 0) return true;
    }
    return false;
}

// 把 AI 返回的标签写回 outfit：overwrite=true 整体覆盖，否则只补缺失的
function applyParsedTags(o, parsedTags, overwrite) {
    if (!o || !hasTagContent(parsedTags)) return;
    if (overwrite) { setOutfitTags(o, parsedTags); return; }
    var cur = normalizeTags(o.tags);
    var changed = false;
    TAG_GROUP_KEYS.forEach(function (k) {
        (parsedTags[k] || []).forEach(function (t) {
            if (cur[k].indexOf(t) === -1) { cur[k].push(t); changed = true; }
        });
    });
    if (changed) setOutfitTags(o, cur);
}

// ── 端点规范化 ─────────────────────────────────────────
export function normalizeEndpoint(raw, path) {
    try {
        var u = raw.replace(/\/+$/, '');
        if (u.match(/\/v\d+$/)) u = u.replace(/\/v\d+$/, '');
        if (u.match(/\/v\d+\/.*$/)) u = u.replace(/\/v\d+\/.*$/, '');
        return u + path;
    } catch (e) { return raw + path; }
}

// ── 获取模型列表 ─────────────────────────────────────────
export function fetchModelList(apiCfg, cb) {
    var url = normalizeEndpoint(apiCfg.endpoint, '/v1/models');
    fetch(url, {
        headers: { 'Authorization': 'Bearer ' + apiCfg.key, 'X-OM-Internal': '1' }
    }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status); });
        return r.json();
    }).then(function (data) {
        var models = [];
        if (data && data.data) {
            var list = Array.isArray(data.data) ? data.data : [];
            list.forEach(function (m) {
                var id = m.id || m.name || '';
                if (id) models.push(id);
            });
        }
        models.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
        cb(null, models);
    }).catch(function (e) { cb(e.message || String(e)); });
}

// ── 模型选择弹窗 ─────────────────────────────────────────
export function openModelPicker(apiCfg, onSelect) {
    toast('正在获取模型列表…');
    fetchModelList(apiCfg, function (err, models) {
        if (err) { toast('获取失败：' + err, true); return; }
        if (!models || models.length === 0) { toast('未找到可用模型', true); return; }

        var _mp = getPopupLayer();
        var listHtml = models.map(function (m) {
            return '<div class="om-model-item" data-m="' + esc(m) + '" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(127,127,127,.08);font-size:.88em;transition:.12s;">' + esc(m) + '</div>';
        }).join('');

        var modal = document.createElement('div');
        modal.className = 'om-modal';
        modal.innerHTML = '<div class="om-modal-box" style="max-height:70vh;"><div class="om-modal-title">选择模型</div>' +
            '<input id="om-model-search" type="text" placeholder="搜索模型…" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.2);background:rgba(127,127,127,.08);color:inherit;font-size:.88em;font-family:inherit;" />' +
            '<div style="max-height:50vh;overflow-y:auto;border:1px solid rgba(127,127,127,.12);border-radius:8px;">' + listHtml + '</div>' +
            '<button id="om-model-cancel" class="om-modal-cancel">取消</button></div>';
        _mp.appendChild(modal);

        modal.addEventListener('click', function (e) { if (e.target === modal) _mp.removeChild(modal); });
        modal.querySelector('#om-model-cancel').addEventListener('click', function () { _mp.removeChild(modal); });

        modal.querySelector('#om-model-search').addEventListener('input', function () {
            var q = this.value.toLowerCase();
            modal.querySelectorAll('.om-model-item').forEach(function (item) {
                item.style.display = item.dataset.m.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
            });
        });
        setTimeout(function () { modal.querySelector('#om-model-search').focus(); }, 50);

        modal.querySelectorAll('.om-model-item').forEach(function (item) {
            item.addEventListener('mouseenter', function () { item.style.background = 'rgba(127,127,127,.12)'; });
            item.addEventListener('mouseleave', function () { item.style.background = ''; });
            item.addEventListener('click', function () {
                onSelect(item.dataset.m);
                if (modal.parentNode) _mp.removeChild(modal);
            });
        });
    });
}

// ── 解析 AI 返回的 JSON（容错：处理 markdown 代码块、提取 JSON）
function parseAIResponse(raw) {
    if (!raw || !raw.trim()) return null;
    var s = raw.trim();
    // 去掉 markdown 代码块
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    // 尝试直接解析
    try { var obj = JSON.parse(s); if (obj && typeof obj === 'object') return cleanParsed(obj); } catch (e) {}
    // 尝试提取第一个 { ... }
    var m = s.match(/\{[\s\S]*\}/);
    if (m) { try { var obj2 = JSON.parse(m[0]); if (obj2 && typeof obj2 === 'object') return cleanParsed(obj2); } catch (e2) {} }
    // JSON 解析全部失败：尝试把首行当 name，其余当 description
    var lines = s.split(/\n+/).filter(function (l) { return l.trim(); });
    if (lines.length >= 2 && lines[0].length <= 20) {
        return { name: lines[0].trim(), description: lines.slice(1).join('\n').trim() };
    }
    return null;
}

// 清理 AI 返回的 JSON：如果 description 开头就是 name，去掉重复
function cleanParsed(obj) {
    if (obj.name && obj.description) {
        var n = obj.name.trim();
        var d = obj.description.trim();
        // description 开头是 name（可能后面跟换行、逗号、句号、冒号等）
        if (d.indexOf(n) === 0) {
            d = d.slice(n.length).replace(/^[\s,，.。:：\-—\n]+/, '').trim();
            if (d) obj.description = d;
        }
    }
    if (obj.tags !== undefined) obj.tags = normalizeTags(obj.tags);
    return obj;
}

function getCategoryName(catObj) {
    return catObj && typeof catObj === 'object' ? (catObj.name || '') : (catObj || '');
}

function getCategoryChildren(catObj) {
    return catObj && typeof catObj === 'object' && Array.isArray(catObj.children) ? catObj.children : [];
}

function buildClassificationPrompt(categories) {
    var lines = [];
    (categories || []).forEach(function (catObj) {
        var name = getCategoryName(catObj);
        if (!name) return;
        var children = getCategoryChildren(catObj).filter(function (sc) { return !!sc; });
        lines.push('- ' + name + (children.length ? '：' + children.join(' / ') : ''));
    });
    return [
        '你是穿搭图片分类助手。请只根据图片判断它最适合放进哪个现有分类。',
        '只能从下面列出的现有分类和子分类中选择，不能新增、改写、翻译或猜造分类。',
        'category 必须是非空的现有父分类，禁止返回空字符串、null、无分类、未分类或 unknown。',
        '即使不确定，也必须选择最接近的父分类；只有 subCategory 可以为空字符串。',
        '只回复 JSON，不要代码块：{"category":"现有父分类","subCategory":"现有子分类或空字符串","confidence":0.0}',
        '',
        '现有分类：',
        lines.join('\n')
    ].join('\n');
}

function buildCombinedDescriptionPrompt(descriptionPrompt, categories) {
    var lines = [];
    (categories || []).forEach(function (catObj) {
        var name = getCategoryName(catObj);
        if (!name) return;
        var children = getCategoryChildren(catObj).filter(function (sc) { return !!sc; });
        lines.push('- ' + name + (children.length ? '：' + children.join(' / ') : ''));
    });
    return [
        '请根据图片同时完成【穿搭描述】和【现有分类判断】。',
        '',
        '穿搭描述要求：',
        descriptionPrompt || '生成穿搭名称和服装描述。',
        '',
        '分类要求：只能从下面列出的现有分类和子分类中选择，不能新增、改写、翻译或猜造分类。category 必须是非空的现有父分类，禁止返回空字符串、null、无分类、未分类或 unknown。即使不确定，也必须选择最接近的父分类；只有 subCategory 可以为空字符串。',
        '',
        '只回复 JSON，不要代码块：{"name":"穿搭名称6字以内","description":"服装描述","category":"现有父分类","subCategory":"现有子分类或空字符串","confidence":0.0}',
        '',
        '现有分类：',
        lines.join('\n')
    ].join('\n');
}

function getDefaultClassification(categories) {
    var cats = categories || [];
    for (var i = 0; i < cats.length; i++) {
        var name = getCategoryName(cats[i]);
        if (name) return { category: name, subCategory: '', confidence: 0 };
    }
    return { category: '', subCategory: '', confidence: 0 };
}

function normalizeClassificationFallback(categories, fallback) {
    fallback = fallback || {};
    var wantedCat = (fallback.category || '').trim();
    var wantedSub = (fallback.subCategory || '').trim();
    var cats = categories || [];
    for (var i = 0; i < cats.length; i++) {
        var name = getCategoryName(cats[i]);
        if (name !== wantedCat) continue;
        var result = { category: name, subCategory: '', confidence: 0 };
        if (wantedSub && getCategoryChildren(cats[i]).indexOf(wantedSub) !== -1) result.subCategory = wantedSub;
        return result;
    }
    return getDefaultClassification(categories);
}

function validateClassificationResult(parsed, categories, fallback) {
    var result = normalizeClassificationFallback(categories, fallback);
    if (!parsed || typeof parsed !== 'object') return result;

    var confidence = Number(parsed.confidence);
    if (!isFinite(confidence)) confidence = 0.5;
    if (confidence > 1) confidence = confidence / 100;
    if (confidence < 0) confidence = 0;
    if (confidence > 1) confidence = 1;

    var wantedCat = (parsed.category || parsed.cat || '').trim();
    var wantedSub = (parsed.subCategory || parsed.subcategory || parsed.sub || '').trim();
    if (!wantedCat && !wantedSub) return result;

    var cats = categories || [];
    var foundCat = null;
    for (var i = 0; i < cats.length; i++) {
        if (getCategoryName(cats[i]) === wantedCat) { foundCat = cats[i]; break; }
    }

    if (!foundCat && wantedSub) {
        for (var j = 0; j < cats.length; j++) {
            if (getCategoryChildren(cats[j]).indexOf(wantedSub) !== -1) {
                foundCat = cats[j];
                wantedCat = getCategoryName(cats[j]);
                break;
            }
        }
    }

    if (!foundCat) return result;
    result.category = wantedCat;
    result.confidence = confidence;

    var subs = getCategoryChildren(foundCat);
    if (wantedSub && subs.indexOf(wantedSub) !== -1) result.subCategory = wantedSub;
    else result.subCategory = '';
    return result;
}

// ── 单次 Vision API 调用 ─────────────────────────────────
export function callVisionAPI(apiCfg, image, systemPrompt, cb) {
    var url = normalizeEndpoint(apiCfg.endpoint, '/v1/chat/completions');
    // image 传 null 时走纯文本请求（标签分析可以只靠名称和描述）
    var content = [];
    if (image && image.dataUrl) {
        var imgContent = image.dataUrl.indexOf('data:') === 0 ? image.dataUrl : 'data:image/jpeg;base64,' + image.dataUrl;
        content.push({ type: 'image_url', image_url: { url: imgContent } });
    }
    content.push({ type: 'text', text: systemPrompt || '请描述图中服装' });
    var body = {
        model: apiCfg.model,
        messages: [{ role: 'user', content: content }],
        max_tokens: 4096
    };
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiCfg.key, 'X-OM-Internal': '1' },
        body: JSON.stringify(body)
    }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ': ' + t.slice(0, 200)); });
        return r.json();
    }).then(function (data) {
        var text = '';
        if (data.choices && data.choices[0]) {
            var msg = data.choices[0].message;
            if (msg) {
                if (typeof msg.content === 'string') text = msg.content;
                else if (Array.isArray(msg.content)) {
                    var parts = msg.content.filter(function (p) { return p.type === 'text'; });
                    if (parts) text = parts.map(function (p) { return p.text || ''; }).join('');
                }
            }
        }
        cb(null, text.trim());
    }).catch(function (e) { cb(e.message || String(e)); });
}

// ── 图片自动分类：只允许命中现有穿搭分类 ──────────────────
export function classifyOutfitImage(apiCfg, image, categories, fallback, cb) {
    if (!apiCfg || !apiCfg.endpoint || !apiCfg.key || !apiCfg.model) {
        cb(null, fallback || { category: '', subCategory: '' });
        return;
    }
    if (!Array.isArray(categories) || categories.length === 0) {
        cb(null, fallback || { category: '', subCategory: '' });
        return;
    }
    callVisionAPI(apiCfg, image, buildClassificationPrompt(categories), function (err, text) {
        if (err) { cb(err, fallback || { category: '', subCategory: '' }); return; }
        var parsed = parseAIResponse(text);
        cb(null, validateClassificationResult(parsed, categories, fallback));
    });
}

function getClassificationFallback(categories, outfit) {
    return normalizeClassificationFallback(categories, outfit || {});
}

// ── 批量自动分类（后台队列）──────────────────────────────
export function batchClassifyOutfits(outfitIds, options, progressCb, doneCb) {
    if (typeof options === 'function') {
        doneCb = progressCb;
        progressCb = options;
        options = {};
    }
    options = options || {};
    var meta = loadMeta();
    var apiCfg = meta.apiVision;
    if (!apiCfg || !apiCfg.endpoint || !apiCfg.key || !apiCfg.model) {
        doneCb('请先在设置中配置描述API', 0, []);
        return;
    }
    var sourcePartKey = options.sourcePartKey || currentPartKey();
    var srcPart = loadPartition(sourcePartKey);
    var categories = srcPart.categories || [];
    if (!Array.isArray(categories) || categories.length === 0) {
        doneCb('还没有分类，无法自动分类', 0, []);
        return;
    }
    var seen = {};
    var queue = [];
    (outfitIds || []).forEach(function (id) {
        if (!id || seen[id]) return;
        seen[id] = true;
        var o = partGetById(srcPart, id);
        if (!o || !o.imageData) return;
        queue.push({
            id: id,
            name: o.name || '穿搭',
            dataUrl: o.imageData,
            fallback: getClassificationFallback(categories, o)
        });
    });
    if (queue.length === 0) { doneCb(null, 0, []); return; }

    var resolveCount = 0;
    queue.forEach(function (item) {
        resolveImageForExternal(item.dataUrl, function (resolved) {
            item.dataUrl = resolved;
            resolveCount++;
            if (resolveCount >= queue.length) runBatch();
        });
    });

    function runBatch() {
        var done = 0, errors = [], running = 0, idx = 0;
        var total = queue.length;
        var concurrency = 2;

        function processNext() {
            while (running < concurrency && idx < queue.length) {
                (function (item) {
                    running++;
                    classifyOutfitImage(apiCfg, item, categories, item.fallback, function (err, cls) {
                        running--;
                        done++;
                        if (err) {
                            errors.push({ name: item.name, error: err });
                        } else {
                            var cp = loadPartition(sourcePartKey);
                            var o = partGetById(cp, item.id);
                            if (!o) {
                                errors.push({ name: item.name, error: '未找到穿搭数据' });
                            } else {
                                o.category = cls && cls.category ? cls.category : '';
                                o.subCategory = cls && cls.subCategory ? cls.subCategory : '';
                                savePartition(sourcePartKey, cp);
                            }
                        }
                        var label = '✅ ' + item.name;
                        if (errors.length > 0 && errors[errors.length - 1].name === item.name) {
                            label = '❌ ' + item.name;
                        }
                        if (progressCb) progressCb(done, total, label);
                        if (done >= total) doneCb(null, done, errors);
                        else processNext();
                    });
                })(queue[idx]);
                idx++;
            }
        }
        processNext();
    }
}

// ── 批量生成描述（并发队列）─────────────────────────────
export function batchGenerateDescriptions(outfitIds, options, progressCb, doneCb) {
    options = options || {};
    var meta = loadMeta();
    var apiCfg = meta.apiVision;
    // 固定源分包 key：后台运行时用户可能切换视角/预设，
    // 回调必须写回启动时的分包，不能跟随 currentPartKey() 漂移
    var sourcePartKey = currentPartKey();
    var srcPart = loadPartition(sourcePartKey);
    var categories = srcPart.categories || [];
    var queue = [];
    var overwriteDescription = options.overwriteDescription !== undefined ? !!options.overwriteDescription : !!apiCfg.overwrite;
    outfitIds.forEach(function (id) {
        var o = partGetById(srcPart, id);
        if (!o || !o.imageData) return;
        var skipDescription = !!(o.description && o.description.trim() && !overwriteDescription);
        if (skipDescription && !options.autoClassify && outfitHasTags(o)) return;
        queue.push({
            id: id,
            name: o.name,
            dataUrl: o.imageData,
            skipDescription: skipDescription,
            fallbackClass: getClassificationFallback(categories, o)
        });
    });
    if (queue.length === 0) { doneCb(null, 0, []); return; }

    // server 模式下先批量 resolve 图片 URL → base64
    var resolveCount = 0;
    function resolveQueue(cb) {
        queue.forEach(function (item) {
            resolveImageForExternal(item.dataUrl, function (resolved) {
                item.dataUrl = resolved;
                resolveCount++;
                if (resolveCount >= queue.length) cb();
            });
        });
    }

    resolveQueue(function () {
        var done = 0, errors = [], running = 0, idx = 0;
        var total = queue.length;
        var concurrency = 3;
        var prompt = options.autoClassify ? buildCombinedDescriptionPrompt(apiCfg.prompt, categories) : apiCfg.prompt;
        prompt = withTagInstruction(prompt);
        var stats = {
            descTarget: queue.filter(function (item) { return !item.skipDescription; }).length,
            descSuccess: 0,
            classTarget: options.autoClassify ? queue.length : 0,
            classSuccess: 0
        };

        function processNext() {
            while (running < concurrency && idx < queue.length) {
                (function (item) {
                    running++;
                    callVisionAPI(apiCfg, item, prompt, function (err, text) {
                        running--;
                        done++;
                        if (err) {
                            errors.push({ name: item.name, error: err });
                        } else if (!text || !text.trim()) {
                            errors.push({ name: item.name, error: 'API 返回了空内容' });
                        } else {
                            var parsed = parseAIResponse(text);
                            // 用固定的 sourcePartKey 读写，不受用户切换视角影响
                            var cp = loadPartition(sourcePartKey);
                            var o = partGetById(cp, item.id);
                            if (!o) { errors.push({ name: item.name, error: '未找到穿搭数据' }); }
                            else {
                                if (!item.skipDescription && parsed && parsed.description) {
                                    o.description = parsed.description;
                                    if (options.autoName && parsed.name && parsed.name.trim()) o.name = parsed.name.trim();
                                    stats.descSuccess++;
                                } else if (!item.skipDescription) {
                                    o.description = text;
                                    stats.descSuccess++;
                                }
                                if (options.autoClassify) {
                                    var cls = validateClassificationResult(parsed, categories, item.fallbackClass);
                                    o.category = cls.category || '';
                                    o.subCategory = cls.subCategory || '';
                                    stats.classSuccess++;
                                }
                                applyParsedTags(o, parsed && parsed.tags, overwriteDescription);
                                savePartition(sourcePartKey, cp);
                            }
                        }
                        if (progressCb) progressCb(done, total, errors.length > 0 && errors[errors.length - 1].name === item.name ? '❌ ' + item.name : '✅ ' + item.name);
                        if (done >= total) { doneCb(null, done, errors, stats); }
                        else { processNext(); }
                    });
                })(queue[idx]);
                idx++;
            }
        }
        processNext();
    });
}

// ── 批量生成单品描述（并发队列）──────────────────────────
export function batchGenerateAccDescriptions(accIds, options, progressCb, doneCb) {
    options = options || {};
    var meta = loadMeta();
    var apiCfg = meta.apiVision;
    var sourcePartKey = currentPartKey();
    var srcPart = loadPartition(sourcePartKey);
    var queue = [];
    var overwriteDescription = options.overwriteDescription !== undefined ? !!options.overwriteDescription : !!apiCfg.overwrite;
    accIds.forEach(function (id) {
        var a = partGetAccById(srcPart, id);
        if (!a || !a.imageData) return;
        if (a.description && a.description.trim() && !overwriteDescription) return;
        queue.push({ id: id, name: a.name, category: a.category || '单品', dataUrl: a.imageData });
    });
    if (queue.length === 0) { doneCb(null, 0, []); return; }

    var resolveCount = 0;
    queue.forEach(function (item) {
        resolveImageForExternal(item.dataUrl, function (resolved) {
            item.dataUrl = resolved;
            resolveCount++;
            if (resolveCount >= queue.length) runBatch();
        });
    });

    function runBatch() {
        var done = 0, errors = [], running = 0, idx = 0;
        var total = queue.length;
        var concurrency = 3;

        function processNext() {
            while (running < concurrency && idx < queue.length) {
                (function (item) {
                    running++;
                    var prompt = (apiCfg.accPrompt || apiCfg.prompt || '')
                        .replace(/\{\{accCategory\}\}/g, item.category || '单品');
                    callVisionAPI(apiCfg, item, prompt, function (err, text) {
                        running--;
                        done++;
                        if (err) {
                            errors.push({ name: item.name, error: err });
                        } else if (!text || !text.trim()) {
                            errors.push({ name: item.name, error: 'API 返回了空内容' });
                        } else {
                            var parsed = parseAIResponse(text);
                            var cp = loadPartition(sourcePartKey);
                            var acc = partGetAccById(cp, item.id);
                            if (!acc) { errors.push({ name: item.name, error: '未找到单品数据' }); }
                            else {
                                if (parsed && parsed.description) {
                                    acc.description = parsed.description;
                                    if (options.autoName && parsed.name && parsed.name.trim()) acc.name = parsed.name.trim();
                                } else {
                                    acc.description = text;
                                }
                                savePartition(sourcePartKey, cp);
                            }
                        }
                        if (progressCb) progressCb(done, total, errors.length > 0 && errors[errors.length - 1].name === item.name ? '❌ ' + item.name : '✅ ' + item.name);
                        if (done >= total) { doneCb(null, done, errors); }
                        else { processNext(); }
                    });
                })(queue[idx]);
                idx++;
            }
        }
        processNext();
    }
}

// ── 单套描述生成（返回结构化数据）───────────────────────
export function generateSingleDescription(outfit, cb) {
    var meta = loadMeta();
    var apiCfg = meta.apiVision;
    if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { cb('请先在设置中配置描述API'); return; }
    if (!outfit.imageData) { cb('该穿搭没有图片'); return; }
    // server 模式下图片可能是后端 URL，外部 AI 无法访问，需要先 resolve 为 base64
    resolveImageForExternal(outfit.imageData, function (resolvedUrl) {
        callVisionAPI(apiCfg, { name: outfit.name, dataUrl: resolvedUrl }, withTagInstruction(apiCfg.prompt), function (err, text) {
            if (err) { cb(err); return; }
            var parsed = parseAIResponse(text);
            if (parsed && parsed.description) {
                cb(null, { name: parsed.name || '', description: parsed.description, tags: parsed.tags || null });
            } else {
                cb(null, { name: '', description: text, tags: null });
            }
        });
    });
}

// ── 单个单品描述生成（返回结构化数据）────────────────────
export function generateSingleAccDescription(acc, cb) {
    var meta = loadMeta();
    var apiCfg = meta.apiVision;
    if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { cb('请先在设置中配置描述API'); return; }
    if (!acc.imageData) { cb('该单品没有图片'); return; }
    var prompt = (apiCfg.accPrompt || apiCfg.prompt || '')
        .replace(/\{\{accCategory\}\}/g, acc.category || '单品');
    resolveImageForExternal(acc.imageData, function (resolvedUrl) {
        callVisionAPI(apiCfg, { name: acc.name || '', dataUrl: resolvedUrl }, prompt, function (err, text) {
            if (err) { cb(err); return; }
            var parsed = parseAIResponse(text);
            if (parsed && parsed.description) {
                cb(null, { name: parsed.name || '', description: parsed.description });
            } else {
                cb(null, { name: '', description: text });
            }
        });
    });
}

// ══ 标签分析（独立接口：只产出 tags，不动描述）═══════════

// 当前生效的标签分析提示词（设置里可改，留空用默认）
function getTagPrompt() {
    var m = loadMeta();
    var p = (m && m.apiVision && m.apiVision.tagPrompt) || '';
    return p.trim() ? p : TAG_PROMPT_DEFAULT;
}

// 拼给 AI 的穿搭上下文
function buildTagContext(outfit) {
    var lines = [];
    if (outfit.name) lines.push('穿搭名称：' + outfit.name);
    var cat = [outfit.category, outfit.subCategory].filter(Boolean).join(' / ');
    if (cat) lines.push('分类：' + cat);
    if (outfit.description) lines.push('描述：' + outfit.description);
    var cur = normalizeTags(outfit.tags);
    var curText = TAG_GROUP_KEYS.map(function (k) { return k + '：' + (cur[k].length ? cur[k].join('、') : '无'); }).join('；');
    lines.push('已有标签（可参考，也可补充或纠正）：' + curText);
    return lines.join('\n');
}

// 从 AI 回复里抠出 tags（容忍只返回 {"scene":..} 的写法）
function parseTagsOnly(text) {
    if (!text || !String(text).trim()) return null;
    var parsed = parseAIResponse(text);
    if (parsed && parsed.tags) return normalizeTags(parsed.tags);
    var s = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
        var o = JSON.parse(s);
        if (o && o.tags) return normalizeTags(o.tags);
        if (o && (o.scene || o.garment || o.impression)) return normalizeTags(o);
    } catch (e) { }
    return null;
}

// ── 单套标签生成 ──────────────────────────────────────
export function generateSingleTags(outfit, cb) {
    var meta = loadMeta();
    var apiCfg = meta.apiVision;
    if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { cb('请先在设置中配置描述API'); return; }
    var prompt = getTagPrompt() + '\n\n【待分析穿搭】\n' + buildTagContext(outfit);
    function run(image) {
        callVisionAPI(apiCfg, image, prompt, function (err, text) {
            if (err) { cb(err); return; }
            var tags = parseTagsOnly(text);
            if (!tags) { cb('AI 返回的内容里没有解析出标签'); return; }
            cb(null, tags);
        });
    }
    if (outfit.imageData) {
        resolveImageForExternal(outfit.imageData, function (resolvedUrl) { run({ name: outfit.name || '', dataUrl: resolvedUrl }); });
    } else {
        run(null);
    }
}

// ── 批量标签生成 ──────────────────────────────────────
export function batchGenerateTags(outfitIds, options, progressCb, doneCb) {
    var meta = loadMeta();
    var apiCfg = meta.apiVision;
    if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { doneCb('请先在设置中配置描述API'); return; }
    options = options || {};
    var sourcePartKey = currentPartKey();
    var snapshot = loadPartition(sourcePartKey);
    var queue = [];
    (outfitIds || []).forEach(function (id) {
        var o = partGetById(snapshot, id);
        if (!o) return;
        if (options.skipTagged && outfitHasTags(o)) return;
        queue.push({ id: id, name: o.name || '' });
    });
    var total = queue.length;
    if (!total) { doneCb(null, 0, [], { target: 0, success: 0 }); return; }
    var stats = { target: total, success: 0 };
    var errors = [];
    var done = 0, idx = 0;
    var CONCURRENCY = 2;
    function processNext() {
        if (idx >= queue.length) return;
        var item = queue[idx]; idx++;
        var cur = partGetById(loadPartition(sourcePartKey), item.id);
        if (!cur) {
            done++;
            if (progressCb) progressCb(done, total, '❌ ' + item.name);
            if (done >= total) doneCb(null, done, errors, stats); else processNext();
            return;
        }
        generateSingleTags(cur, function (err, tags) {
            if (err) { errors.push({ name: item.name, error: err }); }
            else {
                var cp = loadPartition(sourcePartKey);
                var o = partGetById(cp, item.id);
                if (o) { applyParsedTags(o, tags, options.overwrite); savePartition(sourcePartKey, cp); stats.success++; }
            }
            done++;
            if (progressCb) progressCb(done, total, err ? '❌ ' + item.name : '✅ ' + item.name);
            if (done >= total) doneCb(null, done, errors, stats); else processNext();
        });
    }
    for (var c = 0; c < Math.min(CONCURRENCY, total); c++) processNext();
}
