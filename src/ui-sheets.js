// ── 穿搭管理器 · 弹出面板 ──────────────────────────────────
// 操作菜单、编辑面板、预设、设置、分类管理、Lightbox、导入导出、批量描述

import { load, save, loadMeta, saveMeta, loadCurrent, saveCurrent, loadPartition, savePartition, currentPartKey, syncActivePartitions, charNameById, isServerMode, uploadImage } from './db.js';
import { def, getCharData, getViewOutfits, getViewCategories, getViewActiveIds, setViewActiveIds, getById, getViewById, isActive, getCatNames, getSubCats, findCatObj, hasSubCats, partGetById, partIsActive, partGetAccById, cleanAccIdFromKits, getActiveKit, getKitAccessories, ensureOutfitKits, getOutfitImages, getOutfitPrimaryImage, SHARED_CHAR_KEY, SHARED_CHAR_LABEL, TAG_GROUPS, TAG_GROUP_KEYS, emptyTags, getOutfitTags, setOutfitTags, normalizeTagList, normalizeTags, collectTagsByGroup, collectGarmentSuggestions, noteTagTreeUsage, ensureTagTree, garmentItemText, flattenGarmentTags, addOutfitGarmentSub } from './data.js';
import { genId, esc, toast, getPopupLayer, compressImage } from './utils.js';
import { generateSingleDescription, generateSingleAccDescription, generateSingleTags, batchGenerateDescriptions, openModelPicker, normalizeEndpoint } from './api.js';
import { state, fn } from './bridge.js';

function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('image/') === 0) return true;
    return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name || '');
}

function getPickedImageFiles(fileList) {
    return Array.from(fileList || []).filter(isImageFile);
}

function openImageSourcePicker(title, onAlbum, onFile) {
    var _mp = getPopupLayer();
    var modal = document.createElement('div');
    modal.className = 'om-modal';
    modal.innerHTML = '<div class="om-modal-box">' +
        '<div class="om-modal-title">' + esc(title || '导入图片') + '</div>' +
        '<button class="om-modal-btn" id="om-imgsrc-album"><i class="fa-solid fa-image" style="margin-right:8px;color:var(--SmartThemeQuoteColor,#7c6daf)"></i>从相册选择</button>' +
        '<button class="om-modal-btn" id="om-imgsrc-file"><i class="fa-solid fa-folder-open" style="margin-right:8px;color:var(--SmartThemeQuoteColor,#7c6daf)"></i>从文件选择</button>' +
        '<button class="om-modal-cancel" id="om-imgsrc-cancel">取消</button>' +
        '</div>';
    _mp.appendChild(modal);

    function close() {
        if (modal.parentNode) _mp.removeChild(modal);
    }
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#om-imgsrc-cancel').addEventListener('click', close);
    modal.querySelector('#om-imgsrc-album').addEventListener('click', function () {
        close();
        if (onAlbum) onAlbum();
    });
    modal.querySelector('#om-imgsrc-file').addEventListener('click', function () {
        close();
        if (onFile) onFile();
    });
}

// ── 长按操作菜单 Bottom Sheet ─────────────────────────────
function openContextMenu(outfit, imgOutfits) {
    if (!outfit) return;
    var part = loadCurrent();
    var isOn = partIsActive(part, outfit.id);

    var sheet = createSheet([
        '<div class="om-ctx-outfit-name"><i class="fa-solid fa-shirt" style="margin-right:6px;opacity:.5;"></i>' + esc(outfit.name) + '</div>',
        isOn
            ? '<div class="om-ctx-item" id="om-ctx-wear"><i class="fa-solid fa-circle-xmark"></i>取消选择</div>'
            : '<div class="om-ctx-item" id="om-ctx-wear"><i class="fa-solid fa-circle-check"></i>选择穿搭</div>',
        '<div class="om-ctx-item" id="om-ctx-fav"><i class="fa-' + (outfit.favorite ? 'solid' : 'regular') + ' fa-star"></i>' + (outfit.favorite ? '取消收藏' : '收藏服装') + '</div>',
        getOutfitImages(outfit).length > 0 ? '<div class="om-ctx-item" id="om-ctx-view"><i class="fa-solid fa-expand"></i>查看大图</div>' : '',
        '<div class="om-ctx-item" id="om-ctx-edit"><i class="fa-solid fa-pen"></i>编辑</div>',
        '<div class="om-ctx-item" id="om-ctx-move"><i class="fa-solid fa-arrow-right-arrow-left"></i>移动到…</div>',
        getOutfitImages(outfit).length > 0 ? '<div class="om-ctx-item" id="om-ctx-aidesc"><i class="fa-solid fa-wand-magic-sparkles"></i>AI 生成描述</div>' : '',
        '<div class="om-ctx-item" id="om-ctx-aitags"><i class="fa-solid fa-tags"></i>AI 生成标签</div>',
        '<div class="om-ctx-item danger" id="om-ctx-del"><i class="fa-solid fa-trash"></i>删除</div>',
    ].join(''));

    var wearEl = sheet.querySelector('#om-ctx-wear');
    if (wearEl) wearEl.addEventListener('click', function () {
        closeSheet(sheet);
        var curP = loadCurrent();
        var aids = curP.activeIds || [];
        var idx = aids.indexOf(outfit.id);
        if (idx !== -1) aids.splice(idx, 1); else aids.push(outfit.id);
        curP.activeIds = aids;

        // 通用衣柜 ↔ 单人衣柜互斥（和 ui-main.js 卡片点击逻辑一致）
        var m = loadMeta();
        if (m.currentView === 'char' && idx === -1) {
            // idx === -1 说明是新增激活（不是取消）
            if (m.currentChar === SHARED_CHAR_KEY) {
                // 在通用衣柜激活 → 清空所有单人衣柜
                (m.charIndex || []).forEach(function (ci) {
                    if (ci.id !== SHARED_CHAR_KEY) {
                        var cp = loadPartition(ci.partKey);
                        if (cp.activeIds && cp.activeIds.length > 0) {
                            cp.activeIds = [];
                            savePartition(ci.partKey, cp);
                            syncActivePartitions(ci.partKey, []);
                        }
                    }
                });
            } else {
                // 在单人衣柜激活 → 清空通用衣柜
                var sharedPK = 'char:' + SHARED_CHAR_KEY;
                var sp = loadPartition(sharedPK);
                if (sp.activeIds && sp.activeIds.length > 0) {
                    sp.activeIds = [];
                    savePartition(sharedPK, sp);
                    syncActivePartitions(sharedPK, []);
                }
            }
        }

        saveCurrent(curP);
        syncActivePartitions(currentPartKey(), aids);
        fn.updateBtn(); fn.renderBottomStatus(); fn.renderGrid();
        if (fn.preResolveActiveImages) fn.preResolveActiveImages();
        fn.closeDetailPanel();
    });

    var favEl = sheet.querySelector('#om-ctx-fav');
    if (favEl) favEl.addEventListener('click', function () {
        closeSheet(sheet);
        var curP = loadCurrent();
        var o = partGetById(curP, outfit.id);
        if (!o) return;
        o.favorite = !o.favorite;
        saveCurrent(curP);
        fn.renderGrid();
        toast(o.favorite ? '已收藏：' + (o.name || '') : '已取消收藏');
    });

    var viewEl = sheet.querySelector('#om-ctx-view');
    if (viewEl) viewEl.addEventListener('click', function () {
        closeSheet(sheet);
        openLightbox(imgOutfits, outfit.id);
    });

    var editEl = sheet.querySelector('#om-ctx-edit');
    if (editEl) editEl.addEventListener('click', function () {
        closeSheet(sheet);
        openEditSheet(outfit, outfit.category || '');
    });

    var moveEl = sheet.querySelector('#om-ctx-move');
    if (moveEl) moveEl.addEventListener('click', function () {
        closeSheet(sheet);
        fn.openMoveToPanel([outfit.id], function () {
            fn.renderViewbar(); fn.renderCatbar(); fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn();
            fn.closeDetailPanel();
        });
    });

    var aidescEl = sheet.querySelector('#om-ctx-aidesc');
    if (aidescEl) aidescEl.addEventListener('click', function () {
        var m = loadMeta();
        if (!m.apiVision.endpoint || !m.apiVision.key || !m.apiVision.model) {
            toast('请先在设置中配置"描述生成 API"', true); closeSheet(sheet); return;
        }
        aidescEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>生成中...';
        aidescEl.style.pointerEvents = 'none';
        generateSingleDescription(outfit, function (err, result) {
            closeSheet(sheet);
            if (err) { toast('生成失败：' + err, true); return; }
            var curP = loadCurrent();
            var o = partGetById(curP, outfit.id);
            if (o) {
                if (result.description) o.description = result.description;
                if (result.name && result.name.trim()) o.name = result.name.trim();
                if (result.tags) setOutfitTags(o, result.tags);
                saveCurrent(curP);
            }
            toast('✅ 已生成：' + (o ? o.name : outfit.name));
            fn.renderGrid();
        });
    });

    var aitagsEl = sheet.querySelector('#om-ctx-aitags');
    if (aitagsEl) aitagsEl.addEventListener('click', function () {
        var m = loadMeta();
        if (!m.apiVision.endpoint || !m.apiVision.key || !m.apiVision.model) {
            toast('请先在设置中配置"描述生成 API"', true); closeSheet(sheet); return;
        }
        aitagsEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>分析中...';
        aitagsEl.style.pointerEvents = 'none';
        generateSingleTags(outfit, function (err, tags) {
            closeSheet(sheet);
            if (err) { toast('生成失败：' + err, true); return; }
            var curP = loadCurrent();
            var o = partGetById(curP, outfit.id);
            if (o) {
                setOutfitTags(o, tags);
                var _m2 = loadMeta(); noteTagTreeUsage(_m2, tags); saveMeta(_m2);
                saveCurrent(curP);
            }
            toast('✅ 已生成标签：' + (o ? o.name : outfit.name));
            fn.renderGrid();
        });
    });

    var delEl = sheet.querySelector('#om-ctx-del');
    if (delEl) delEl.addEventListener('click', function () {
        closeSheet(sheet);
        if (!confirm('确定删除「' + outfit.name + '」？')) return;
        var curP = loadCurrent();
        curP.outfits = curP.outfits.filter(function (o) { return o.id !== outfit.id; });
        var ai = (curP.activeIds || []).indexOf(outfit.id);
        if (ai !== -1) curP.activeIds.splice(ai, 1);
        saveCurrent(curP);
        syncActivePartitions(currentPartKey(), curP.activeIds);
        fn.updateBtn(); fn.renderBottomStatus(); fn.renderGrid(); toast('已删除');
    });
}

// ── 编辑 Bottom Sheet ─────────────────────────────────────
// 收集标签建议（按组，返回字符串数组）；garment 组返回「单品名」列表
function getAllTagSuggestions(d, group) {
    var g = TAG_GROUP_KEYS.indexOf(group) !== -1 ? group : 'scene';
    var found = [];
    getAllOutfitLists(d).forEach(function (list) {
        list.forEach(function (o) {
            var tags = getOutfitTags(o);
            var arr = g === 'garment' ? tags.garment.map(function (it) { return it.base; }) : tags[g];
            (arr || []).forEach(function (t) { if (found.indexOf(t) === -1) found.push(t); });
        });
    });
    // 按 tagOrder 排序：先按记忆顺序排，新标签追加到末尾
    var order = (d && d.tagOrder) || [];
    var sorted = [];
    order.forEach(function (t) { if (found.indexOf(t) !== -1) sorted.push(t); });
    found.forEach(function (t) { if (sorted.indexOf(t) === -1) sorted.push(t); });
    return sorted;
}

// ── 标签管理面板（三组切换 / 搜索 / 拖拽排序 / 删除）────────
function openTagPanel(initialGroup) {
    var d = load();
    var activeGroup = TAG_GROUP_KEYS.indexOf(initialGroup) !== -1 ? initialGroup : 'scene';
    var allOutfits = [];
    function reloadOutfits(src) {
        allOutfits = [];
        getAllOutfitLists(src).forEach(function (l) { allOutfits = allOutfits.concat(l); });
    }
    reloadOutfits(d);

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-tags"></i>标签管理</div>',
        '<div class="om-tagpanel-tabs" id="om-tag-tabs">' + TAG_GROUPS.map(function (g) {
            return '<button type="button" class="om-tagpanel-tab" data-g="' + g.key + '">' + esc(g.label) + '</button>';
        }).join('') + '</div>',
        '<input type="text" class="om-tagpanel-search" id="om-tag-search" placeholder="搜索标签…" autocomplete="off" />',
        '<div class="om-tagpanel-list" id="om-tag-list"></div>',
        '<div class="om-tagpanel-tip">标签跟着穿搭走：只有穿搭里用过的标签才会出现在这里；拖动可调整建议顺序。</div>'
    ].join(''));

    var listEl = sheet.querySelector('#om-tag-list');
    var searchInp = sheet.querySelector('#om-tag-search');
    var tabsEl = sheet.querySelector('#om-tag-tabs');
    var dragFrom = null;

    function sortByOrder(found) {
        var order = (d && d.tagOrder) || [];
        found.sort(function (a, b) {
            var ia = order.indexOf(a), ib = order.indexOf(b);
            if (ia === -1 && ib === -1) return 0;
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });
        return found;
    }

    function tagList(group) {
        var found = [];
        allOutfits.forEach(function (o) {
            getOutfitTags(o)[group].forEach(function (t) { if (found.indexOf(t) === -1) found.push(t); });
        });
        return sortByOrder(found);
    }

    function countTag(group, tag) {
        var n = 0;
        allOutfits.forEach(function (o) {
            if (getOutfitTags(o)[group].indexOf(tag) !== -1) n++;
        });
        return n;
    }

    // ── 服装组：单品 + 二级词 ──
    function garmentEntries() {
        var bases = [];
        allOutfits.forEach(function (o) {
            getOutfitTags(o).garment.forEach(function (g) { if (bases.indexOf(g.base) === -1) bases.push(g.base); });
        });
        sortByOrder(bases);
        return bases.map(function (b) {
            var baseCount = 0, subCounts = {};
            allOutfits.forEach(function (o) {
                getOutfitTags(o).garment.forEach(function (g) {
                    if (g.base !== b) return;
                    baseCount++;
                    (g.subs || []).forEach(function (s) { subCounts[s] = (subCounts[s] || 0) + 1; });
                });
            });
            return {
                base: b, count: baseCount,
                subs: Object.keys(subCounts).map(function (s) { return { name: s, count: subCounts[s] }; })
            };
        });
    }

    function renderTabs() {
        tabsEl.querySelectorAll('.om-tagpanel-tab').forEach(function (b) {
            b.classList.toggle('active', b.dataset.g === activeGroup);
        });
        var cur = null;
        TAG_GROUPS.forEach(function (g) { if (g.key === activeGroup) cur = g; });
        if (cur) searchInp.placeholder = '搜索「' + cur.label + '」标签…';
    }

    function persistOrder(ordered) {
        var dd = load();
        var order = Array.isArray(dd.tagOrder) ? dd.tagOrder.slice() : [];
        var pos = [];
        ordered.forEach(function (t) { var i = order.indexOf(t); if (i !== -1) pos.push(i); });
        var at = pos.length ? Math.min.apply(null, pos) : order.length;
        order = order.filter(function (t) { return ordered.indexOf(t) === -1; });
        if (at > order.length) at = order.length;
        Array.prototype.splice.apply(order, [at, 0].concat(ordered));
        dd.tagOrder = order;
        save(dd);
        d.tagOrder = order;
    }

    // 从字典里摘掉一个词
    function treeRemove(group, base, sub) {
        var m = loadMeta();
        var tree = ensureTagTree(m);
        if (group === 'garment' && base) {
            if (sub) {
                var arr = tree.garment[base];
                if (Array.isArray(arr)) {
                    var i = arr.indexOf(sub);
                    if (i !== -1) arr.splice(i, 1);
                }
            } else if (tree.garment[base]) {
                delete tree.garment[base];
            }
            saveMeta(m);
        }
    }

    function delTag(tag) {
        if (!window.confirm('从所有穿搭里删除标签「' + tag + '」？\n穿搭本身不会被删除。')) return;
        var dd = load();
        var g = activeGroup;
        function strip(o) {
            var t = getOutfitTags(o);
            var i = t[g].indexOf(tag);
            if (i === -1) return;
            t[g].splice(i, 1);
            setOutfitTags(o, t);
        }
        (dd.outfits || []).forEach(strip);
        if (dd.chars) { for (var cn in dd.chars) ((dd.chars[cn] || {}).outfits || []).forEach(strip); }
        if (dd.tagOrder) { var oi = dd.tagOrder.indexOf(tag); if (oi !== -1) dd.tagOrder.splice(oi, 1); }
        save(dd);
        treeRemove(g, g === 'garment' ? tag : null, null);
        d = dd;
        reloadOutfits(dd);
        renderList();
        toast('已删除标签「' + tag + '」');
    }

    function delBase(base) {
        if (!window.confirm('从所有穿搭里删除单品「' + base + '」（连同它的二级词）？')) return;
        var dd = load();
        function strip(o) {
            var t = getOutfitTags(o);
            var before = t.garment.length;
            t.garment = t.garment.filter(function (g) { return g.base !== base; });
            if (t.garment.length !== before) setOutfitTags(o, t);
        }
        (dd.outfits || []).forEach(strip);
        if (dd.chars) { for (var cn in dd.chars) ((dd.chars[cn] || {}).outfits || []).forEach(strip); }
        if (dd.tagOrder) { var oi = dd.tagOrder.indexOf(base); if (oi !== -1) dd.tagOrder.splice(oi, 1); }
        save(dd);
        treeRemove('garment', base, null);
        d = dd;
        reloadOutfits(dd);
        renderList();
        toast('已删除单品「' + base + '」');
    }

    function delSub(base, sub) {
        if (!window.confirm('从所有穿搭里删除二级词「' + sub + '」（' + base + ' 的）？')) return;
        var dd = load();
        function strip(o) {
            var t = getOutfitTags(o);
            var changed = false;
            t.garment.forEach(function (g) {
                if (g.base !== base) return;
                var i = g.subs.indexOf(sub);
                if (i !== -1) { g.subs.splice(i, 1); changed = true; }
            });
            if (changed) setOutfitTags(o, t);
        }
        (dd.outfits || []).forEach(strip);
        if (dd.chars) { for (var cn in dd.chars) ((dd.chars[cn] || {}).outfits || []).forEach(strip); }
        save(dd);
        treeRemove('garment', base, sub);
        d = dd;
        reloadOutfits(dd);
        renderList();
        toast('已删除二级词「' + sub + '」');
    }

    function bindDrag(fullTags) {
        listEl.querySelectorAll('.om-tagpanel-item').forEach(function (item) {
            item.addEventListener('dragstart', function (e) {
                dragFrom = fullTags.indexOf(item.dataset.tag);
                item.classList.add('dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', item.dataset.tag); } catch (_) { }
                }
            });
            item.addEventListener('dragend', function () {
                item.classList.remove('dragging');
                dragFrom = null;
            });
            item.addEventListener('dragover', function (e) {
                if (dragFrom === null) return;
                e.preventDefault();
                item.classList.add('drag-over');
            });
            item.addEventListener('dragleave', function () { item.classList.remove('drag-over'); });
            item.addEventListener('drop', function (e) {
                e.preventDefault();
                item.classList.remove('drag-over');
                var to = fullTags.indexOf(item.dataset.tag);
                if (dragFrom === null || to === -1 || dragFrom === to) return;
                var next = fullTags.slice();
                var moved = next.splice(dragFrom, 1)[0];
                next.splice(to, 0, moved);
                dragFrom = null;
                persistOrder(next);
                renderList();
            });
        });
    }

    function bindListEvents() {
        listEl.querySelectorAll('.om-tagpanel-del').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (btn.dataset.base) { delBase(btn.dataset.base); return; }
                var item = btn.closest('.om-tagpanel-item');
                if (item) delTag(item.dataset.tag);
            });
        });
        listEl.querySelectorAll('.om-tagpanel-subdel').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                delSub(btn.dataset.base, btn.dataset.sub);
            });
        });
    }

    function renderList() {
        var q = (searchInp.value || '').trim().toLowerCase();
        if (activeGroup === 'garment') {
            var entries = garmentEntries();
            var shown = q ? entries.filter(function (en) {
                if (en.base.toLowerCase().indexOf(q) !== -1) return true;
                return en.subs.some(function (s) { return s.name.toLowerCase().indexOf(q) !== -1; });
            }) : entries;
            if (!shown.length) {
                listEl.innerHTML = '<div class="om-tagpanel-empty">' + (q ? '没有匹配的标签' : '这个分组还没有标签') + '</div>';
                return;
            }
            listEl.innerHTML = shown.map(function (en) {
                var subsHtml = en.subs.map(function (s) {
                    return '<span class="om-tagpanel-sub" data-base="' + esc(en.base) + '" data-sub="' + esc(s.name) + '">' +
                        esc(s.name) + '<b>' + s.count + '</b>' +
                        '<button type="button" class="om-tagpanel-subdel" data-base="' + esc(en.base) + '" data-sub="' + esc(s.name) + '" title="删除这个二级词"><i class="fa-solid fa-xmark"></i></button>' +
                        '</span>';
                }).join('');
                return '<div class="om-tagpanel-item om-tagpanel-garment" data-base="' + esc(en.base) + '">' +
                    '<div class="om-tagpanel-garm-head">' +
                    '<span class="om-tagpanel-name">' + esc(en.base) + '</span>' +
                    '<span class="om-tagpanel-count">' + en.count + '</span>' +
                    '<button type="button" class="om-tagpanel-del" data-base="' + esc(en.base) + '" title="从所有穿搭中删除此单品"><i class="fa-solid fa-trash"></i></button>' +
                    '</div>' +
                    (subsHtml ? '<div class="om-tagpanel-subs">' + subsHtml + '</div>' : '') +
                    '</div>';
            }).join('');
            bindListEvents();
            return;
        }
        var tags = tagList(activeGroup);
        var shownTags = q ? tags.filter(function (t) { return t.toLowerCase().indexOf(q) !== -1; }) : tags;
        if (!shownTags.length) {
            listEl.innerHTML = '<div class="om-tagpanel-empty">' + (q ? '没有匹配的标签' : '这个分组还没有标签') + '</div>';
            return;
        }
        listEl.innerHTML = shownTags.map(function (tag) {
            return '<div class="om-tagpanel-item" data-tag="' + esc(tag) + '" draggable="' + (q ? 'false' : 'true') + '">' +
                '<i class="fa-solid fa-grip-vertical om-tagpanel-grip"></i>' +
                '<span class="om-tagpanel-name">' + esc(tag) + '</span>' +
                '<span class="om-tagpanel-count">' + countTag(activeGroup, tag) + '</span>' +
                '<button type="button" class="om-tagpanel-del" title="从所有穿搭中删除此标签"><i class="fa-solid fa-trash"></i></button>' +
                '</div>';
        }).join('');
        if (!q) bindDrag(tags);
        bindListEvents();
    }

    tabsEl.querySelectorAll('.om-tagpanel-tab').forEach(function (b) {
        b.addEventListener('click', function () {
            activeGroup = b.dataset.g;
            searchInp.value = '';
            renderTabs();
            renderList();
        });
    });
    searchInp.addEventListener('input', function () { renderList(); });

    renderTabs();
    renderList();
}

function clearKitDraftIfOutfit(outfitId) {
    if (state.kitFocusPartKey === currentPartKey() && state.kitFocusOutfitId === outfitId) {
        state.kitFocusPartKey = null;
        state.kitFocusOutfitId = null;
        state.kitDraftAccIds = [];
        state.kitDraftSourceKitId = null;
        state.kitDraftDirty = false;
    }
}

function buildEditKitManageHtml(outfit, part) {
    if (!outfit) return '';
    ensureOutfitKits(outfit);
    var kits = outfit.kits || [];
    var body = '';
    if (kits.length === 0) {
        body = '<div class="om-kit-empty">暂无套装</div>';
    } else {
        body = (outfit.activeKitId ? '<button class="om-btn om-btn-outline om-kit-deactivate" data-kit-action="deactivate"><i class="fa-solid fa-circle-minus"></i> 取消当前套装</button>' : '') +
        kits.map(function (kit) {
            var isActiveKit = outfit.activeKitId === kit.id;
            var accs = getKitAccessories(part, kit);
            var accHtml = accs.length === 0
                ? '<div class="om-kit-empty small">无单品</div>'
                : '<div class="om-edit-kit-accs">' + accs.map(function (acc) {
                    return '<button class="om-edit-kit-acc" data-kit-action="remove-acc" data-kit-id="' + esc(kit.id) + '" data-acc-id="' + esc(acc.id) + '" title="从套装移除">' + esc(acc.name) + '<i class="fa-solid fa-xmark"></i></button>';
                }).join('') + '</div>';
            return '<div class="om-edit-kit-row' + (isActiveKit ? ' active' : '') + '" data-kit-id="' + esc(kit.id) + '">' +
                '<div class="om-edit-kit-main">' +
                '<div class="om-edit-kit-name">' + esc(kit.name || '未命名套装') + (isActiveKit ? '<span class="om-edit-kit-active">当前</span>' : '') + '</div>' +
                '<div class="om-edit-kit-count">' + accs.length + ' 个单品</div>' +
                accHtml +
                '</div>' +
                '<div class="om-edit-kit-actions">' +
                (!isActiveKit ? '<button class="om-btn-sm" data-kit-action="activate" data-kit-id="' + esc(kit.id) + '" title="设为当前"><i class="fa-solid fa-circle-check"></i></button>' : '') +
                '<button class="om-btn-sm" data-kit-action="rename" data-kit-id="' + esc(kit.id) + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="om-btn-sm danger" data-kit-action="delete" data-kit-id="' + esc(kit.id) + '" title="删除"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
                '</div>';
        }).join('');
    }
    return '<div class="om-field" id="om-kit-manage-holder"><label>套装 / 单品 <span class="om-hint">当前穿搭</span></label>' + body + '</div>';
}

function buildEditImagesAreaHtml(imgs) {
    if (!imgs || imgs.length === 0) {
        return '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传，可多选</span></div>';
    }
    var thumbs = imgs.map(function (src, k) {
        return '<div class="om-img-thumb' + (k === 0 ? ' primary' : '') + '" data-idx="' + k + '">' +
            '<img src="' + src + '" alt="' + (k + 1) + '" />' +
            '<span class="om-img-thumb-no">' + (k === 0 ? '主图' : (k + 1)) + '</span>' +
            '<button class="om-img-thumb-del" data-idx="' + k + '" title="删除"><i class="fa-solid fa-xmark"></i></button>' +
            (k !== 0 ? '<button class="om-img-thumb-cover" data-idx="' + k + '" title="设为主图"><i class="fa-solid fa-star"></i></button>' : '') +
            '</div>';
    }).join('');
    return '<div class="om-imgs-grid">' + thumbs + '<button class="om-img-thumb om-img-add" id="om-img-add" title="添加图片"><i class="fa-solid fa-plus"></i></button></div>';
}

function buildShowcaseHtml(outfit, part) {
    if (!outfit) return '';
    ensureOutfitKits(outfit);
    var activeKit = getActiveKit(outfit);
    var kitAccs = activeKit ? getKitAccessories(part, activeKit) : [];
    if (!activeKit || kitAccs.length === 0) return '';
    var mainImg = getOutfitPrimaryImage(outfit);
    var mainHtml = mainImg
        ? '<img class="om-showcase-main-img" src="' + mainImg + '" alt="' + esc(outfit.name || '穿搭') + '" />'
        : '<div class="om-imgph om-showcase-ph"><i class="fa-regular fa-image"></i><span>主体图片</span></div>';
    var accImgs = kitAccs.map(function (acc) {
        return acc.imageData
            ? '<img class="om-showcase-acc-img" src="' + acc.imageData + '" title="' + esc(acc.name) + '" alt="' + esc(acc.name) + '" />'
            : '<div class="om-showcase-acc-ph" title="' + esc(acc.name) + '">' + esc(acc.name) + '</div>';
    }).join('');
    return '<div class="om-field" id="om-showcase-field"><label>套装预览 <span class="om-hint">主体 + 单品</span></label>' +
        '<div class="om-showcase-wrap"><div class="om-showcase">' +
        '<div class="om-showcase-main">' + mainHtml + '</div>' +
        '<div class="om-showcase-accs">' + accImgs + '</div>' +
        '</div></div></div>';
}


// ── 三组标签编辑器（编辑面板内联）────────────────────────
function buildTagEditorHtml() {
    return TAG_GROUPS.map(function (g) {
        var body;
        if (g.key === 'garment') {
            body = '<div class="om-garm-list" data-g="garment"></div>' +
                '<div class="om-tagg-add"><input type="text" class="om-tagg-input" data-g="garment" placeholder="输入单品后回车（如 高领衫）" autocomplete="off" /><button type="button" class="om-tagg-addbtn" data-g="garment" title="添加单品"><i class="fa-solid fa-plus"></i></button></div>' +
                '<div class="om-tagg-sug" data-g="garment"></div>';
        } else {
            body = '<div class="om-tagg-chips" data-g="' + g.key + '"></div>' +
                '<div class="om-tagg-add"><input type="text" class="om-tagg-input" data-g="' + g.key + '" placeholder="输入标签后回车" autocomplete="off" /><button type="button" class="om-tagg-addbtn" data-g="' + g.key + '" title="添加"><i class="fa-solid fa-plus"></i></button></div>' +
                '<div class="om-tagg-sug" data-g="' + g.key + '"></div>';
        }
        return '<div class="om-tagg" data-g="' + g.key + '">' +
            '<div class="om-tagg-head"><span class="om-tagg-label">' + esc(g.label) + '</span><span class="om-tagg-hint">' + esc(g.hint) + '</span></div>' +
            body +
            '</div>';
    }).join('');
}

// 跨分区收集所有 outfit 列表（通用衣柜 + 各角色）
function getAllOutfitLists(d) {
    var lists = [(d && d.outfits) || []];
    if (d && d.chars) {
        for (var cn in d.chars) lists.push(((d.chars[cn] || {}).outfits) || []);
    }
    return lists;
}

// 绑定标签编辑器，返回 { get() → 规范化 tags 对象, set(raw) }
function bindTagEditor(sheet, initialTags, suggestions) {
    var root = sheet.querySelector('#om-tageditor');
    var values = normalizeTags(initialTags);

    // 服装建议：{ bases:[], subsByBase:{} }（也兼容旧的字符串数组）
    var gSug = suggestions && suggestions.garment;
    var gBases = Array.isArray(gSug) ? gSug.slice() : ((gSug && gSug.bases) || []).slice();
    var gSubs = (gSug && gSug.subsByBase) || {};

    function findItem(base) {
        for (var i = 0; i < values.garment.length; i++) if (values.garment[i].base === base) return values.garment[i];
        return null;
    }

    // ── 普通组（scene / impression）芯片与建议 ──
    function chipsHtml(g) {
        if (!values[g].length) return '<span class="om-tagg-none">未选择</span>';
        return values[g].map(function (t) {
            return '<span class="om-tagg-chip">' + esc(t) +
                '<button type="button" class="om-tagg-del" data-g="' + g + '" data-tag="' + esc(t) + '"><i class="fa-solid fa-xmark"></i></button></span>';
        }).join('');
    }
    function sugHtml(g, filter) {
        var q = (filter || '').trim().toLowerCase();
        var list = ((suggestions && suggestions[g]) || []).filter(function (t) {
            if (values[g].indexOf(t) !== -1) return false;
            return !q || t.toLowerCase().indexOf(q) !== -1;
        });
        if (!list.length) return '';
        return list.slice(0, 30).map(function (t) {
            return '<button type="button" class="om-tagg-sugbtn" data-g="' + g + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
        }).join('');
    }
    function refresh(g) {
        if (g === 'garment') { refreshGarment(); return; }
        var chipsEl = sheet.querySelector('.om-tagg-chips[data-g="' + g + '"]');
        var sugEl = sheet.querySelector('.om-tagg-sug[data-g="' + g + '"]');
        var inp = sheet.querySelector('.om-tagg-input[data-g="' + g + '"]');
        if (chipsEl) chipsEl.innerHTML = chipsHtml(g);
        if (sugEl) sugEl.innerHTML = sugHtml(g, inp ? inp.value : '');
    }

    // ── 服装组：单品卡片 + 二级词 ──
    function garmentCardsHtml() {
        if (!values.garment.length) return '<span class="om-tagg-none">未选择单品</span>';
        return values.garment.map(function (it) {
            var subs = it.subs.map(function (s) {
                return '<span class="om-garm-sub">' + esc(s) +
                    '<button type="button" class="om-garm-subdel" data-base="' + esc(it.base) + '" data-sub="' + esc(s) + '"><i class="fa-solid fa-xmark"></i></button></span>';
            }).join('');
            return '<div class="om-garm-card" data-base="' + esc(it.base) + '">' +
                '<div class="om-garm-top"><span class="om-garm-base">' + esc(it.base) + '</span>' +
                '<span class="om-garm-subs">' + subs + '</span>' +
                '<button type="button" class="om-garm-del" data-base="' + esc(it.base) + '" title="移除单品"><i class="fa-solid fa-xmark"></i></button></div>' +
                '<div class="om-garm-addsub"><input type="text" class="om-garm-subinput" data-base="' + esc(it.base) + '" placeholder="+ 颜色/材质/款式后回车" autocomplete="off" /><button type="button" class="om-garm-subadd" data-base="' + esc(it.base) + '"><i class="fa-solid fa-plus"></i></button></div>' +
                '<div class="om-garm-subsug" data-base="' + esc(it.base) + '"></div>' +
                '</div>';
        }).join('');
    }
    function garmentSugHtml(g) {
        var q = (g.querySelector('.om-tagg-input[data-g="garment"]') || { value: '' }).value.trim().toLowerCase();
        var list = gBases.filter(function (b) {
            if (findItem(b)) return false;
            return !q || b.toLowerCase().indexOf(q) !== -1;
        });
        return list.slice(0, 30).map(function (b) {
            return '<button type="button" class="om-tagg-sugbtn" data-g="garment" data-tag="' + esc(b) + '">' + esc(b) + '</button>';
        }).join('');
    }
    function subSugHtml(card, base) {
        var inp = card.querySelector('.om-garm-subinput');
        var q = (inp ? inp.value : '').trim().toLowerCase();
        var item = findItem(base);
        var have = item ? item.subs : [];
        var pool = (gSubs[base] || []).filter(function (s) {
            if (have.indexOf(s) !== -1) return false;
            return !q || s.toLowerCase().indexOf(q) !== -1;
        });
        return pool.slice(0, 20).map(function (s) {
            return '<button type="button" class="om-garm-sugbtn" data-base="' + esc(base) + '" data-sub="' + esc(s) + '">' + esc(s) + '</button>';
        }).join('');
    }
    function refreshGarment() {
        var listEl = sheet.querySelector('.om-garm-list[data-g="garment"]');
        var sugEl = sheet.querySelector('.om-tagg-sug[data-g="garment"]');
        if (listEl) listEl.innerHTML = garmentCardsHtml();
        if (sugEl) sugEl.innerHTML = garmentSugHtml(sheet);
        sheet.querySelectorAll('.om-garm-card').forEach(function (card) {
            var box = card.querySelector('.om-garm-subsug');
            if (box) box.innerHTML = subSugHtml(card, card.dataset.base);
        });
    }

    function addPlainTag(g, raw) {
        if (TAG_GROUP_KEYS.indexOf(g) === -1) return false;
        var one = normalizeTagList([raw]);
        if (!one.length) return false;
        if (values[g].indexOf(one[0]) === -1) values[g].push(one[0]);
        refresh(g);
        return true;
    }
    function addGarmentBase(raw) {
        var one = normalizeTagList([raw]);
        if (!one.length) return false;
        if (!findItem(one[0]) && values.garment.length < 40) values.garment.push({ base: one[0], subs: [] });
        refreshGarment();
        return true;
    }
    function addGarmentSub(base, raw) {
        var one = normalizeTagList([raw]);
        var item = findItem(base);
        if (!one.length || !item) return false;
        if (item.subs.indexOf(one[0]) === -1 && item.subs.length < 12) item.subs.push(one[0]);
        refreshGarment();
        return true;
    }

    root.addEventListener('click', function (e) {
        var del = e.target.closest('.om-tagg-del');
        if (del) {
            var g1 = del.dataset.g;
            var i = values[g1].indexOf(del.dataset.tag);
            if (i !== -1) values[g1].splice(i, 1);
            refresh(g1);
            return;
        }
        var gdel = e.target.closest('.om-garm-del');
        if (gdel) {
            values.garment = values.garment.filter(function (it) { return it.base !== gdel.dataset.base; });
            refreshGarment();
            return;
        }
        var sdel = e.target.closest('.om-garm-subdel');
        if (sdel) {
            var it1 = findItem(sdel.dataset.base);
            if (it1) {
                var si = it1.subs.indexOf(sdel.dataset.sub);
                if (si !== -1) it1.subs.splice(si, 1);
            }
            refreshGarment();
            return;
        }
        var gsug = e.target.closest('.om-garm-sugbtn');
        if (gsug) { addGarmentSub(gsug.dataset.base, gsug.dataset.sub); return; }
        var sug = e.target.closest('.om-tagg-sugbtn');
        if (sug) {
            if (sug.dataset.g === 'garment') addGarmentBase(sug.dataset.tag);
            else addPlainTag(sug.dataset.g, sug.dataset.tag);
            return;
        }
        var gadd = e.target.closest('.om-garm-subadd');
        if (gadd) {
            var card0 = gadd.closest('.om-garm-card');
            var inp0 = card0 ? card0.querySelector('.om-garm-subinput') : null;
            if (addGarmentSub(gadd.dataset.base, inp0 ? inp0.value : '') && inp0) inp0.value = '';
            return;
        }
        var addBtn = e.target.closest('.om-tagg-addbtn');
        if (addBtn) {
            var g2 = addBtn.dataset.g;
            var inp2 = sheet.querySelector('.om-tagg-input[data-g="' + g2 + '"]');
            var val = inp2 ? inp2.value : '';
            var ok = g2 === 'garment' ? addGarmentBase(val) : addPlainTag(g2, val);
            if (ok && inp2) inp2.value = '';
        }
    });

    root.querySelectorAll('.om-tagg-input').forEach(function (inp) {
        inp.addEventListener('input', function () { refresh(inp.dataset.g); });
        inp.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            var ok = inp.dataset.g === 'garment' ? addGarmentBase(inp.value) : addPlainTag(inp.dataset.g, inp.value);
            if (ok) inp.value = '';
            refresh(inp.dataset.g);
        });
    });

    root.addEventListener('input', function (e) {
        var si = e.target.closest ? e.target.closest('.om-garm-subinput') : null;
        if (!si) return;
        var card = si.closest('.om-garm-card');
        var box = card ? card.querySelector('.om-garm-subsug') : null;
        if (box) box.innerHTML = subSugHtml(card, si.dataset.base);
    });
    root.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var si = e.target.closest ? e.target.closest('.om-garm-subinput') : null;
        if (!si) return;
        e.preventDefault();
        if (addGarmentSub(si.dataset.base, si.value)) si.value = '';
    });

    TAG_GROUP_KEYS.forEach(refresh);

    return {
        get: function () { return normalizeTags(values); },
        set: function (raw) {
            values = normalizeTags(raw);
            TAG_GROUP_KEYS.forEach(refresh);
        }
    };
}


function openEditSheet(outfit, defaultCat, defaultSubCat) {
    var d = load(); // still need for tag suggestions (cross-partition)
    var curPart = loadCurrent();
    if (outfit) {
        outfit = partGetById(curPart, outfit.id) || outfit;
        ensureOutfitKits(outfit);
    }
    var editImgs = outfit ? getOutfitImages(outfit).slice() : [];
    var viewCats = curPart.categories || [];
    var catNames = getCatNames(viewCats);
    var catOpts = '<option value="">无分类</option>' +
        catNames.map(function (c) { return '<option value="' + esc(c) + '"' + (outfit && outfit.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');

    // 当前选中的父分类
    var curParent = outfit ? (outfit.category || '') : (defaultCat || '');
    var curSub = outfit ? (outfit.subCategory || '') : (defaultSubCat || '');
    var subCats = curParent ? getSubCats(viewCats, curParent) : [];
    var subDisplay = subCats.length > 0 ? '' : 'display:none;';
    var subOpts = '<option value="">无子分类</option>' +
        subCats.map(function (sc) { return '<option value="' + esc(sc) + '"' + (sc === curSub ? ' selected' : '') + '>' + esc(sc) + '</option>'; }).join('');
    var kitManageHtml = outfit ? buildEditKitManageHtml(outfit, curPart) : '';
    var imageAreaHtml = buildEditImagesAreaHtml(editImgs);
    var showcaseHtml = buildShowcaseHtml(outfit, curPart);

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-' + (outfit ? 'pen' : 'plus') + '"></i>' + (outfit ? '编辑穿搭' : '添加穿搭') + '</div>',
        '<div class="om-field"><label>穿搭名称 *</label><input type="text" id="om-dn" placeholder="如：白色蕾丝连衣裙" value="' + esc(outfit ? outfit.name : '') + '" /></div>',
        '<div class="om-field"><label>分类</label><div class="om-frow"><select id="om-dcat">' + catOpts + '</select><button class="om-btn om-btn-outline" id="om-dnewcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
        '<div class="om-field" id="om-subcat-field" style="' + subDisplay + '"><label>子分类</label><div class="om-frow"><select id="om-dsubcat">' + subOpts + '</select><button class="om-btn om-btn-outline" id="om-dnewsubcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
        '<div class="om-field"><label>文字描述 <span class="om-hint">AI 注入用，越详细越好</span></label><textarea id="om-ddesc" rows="4" placeholder="如：白色蕾丝镂空连衣裙，领口略低，裙摆及膝……">' + esc(outfit ? outfit.description || '' : '') + '</textarea>' +
        '<button class="om-btn om-btn-outline" id="om-daidesc" style="font-size:.78em;margin-top:5px;align-self:flex-start"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述</button></div>',
        '<div class="om-field"><label>标签 <span class="om-hint">三组都能多选；智能注入和 AI 选穿搭都靠它</span></label>',
        '<div class="om-tageditor" id="om-tageditor">' + buildTagEditorHtml(outfit) + '</div>',
        '<div class="om-frow" style="margin-top:6px;gap:6px">' +
        '<button class="om-btn om-btn-outline" id="om-daitags" style="font-size:.78em"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成标签</button>' +
        '<button class="om-btn om-btn-outline" id="om-tag-expand" style="font-size:.78em"><i class="fa-solid fa-tags"></i> 标签管理</button>' +
        '</div>',
        '</div>',
        '<div class="om-field"><label>参考图片 <span class="om-hint">可选，自动压缩，可多张</span></label>',
        '<div class="om-imgarea om-imgs" id="om-dimgarea">' + imageAreaHtml + '</div>',
        '<input type="file" id="om-dfile-album" accept="image/*" multiple style="display:none" />',
        '<input type="file" id="om-dfile-any" multiple style="display:none" />',
        '<div class="om-img-actions"><button class="om-btn om-btn-outline" id="om-dpick" style="font-size:.8em"><i class="fa-solid fa-image"></i> 导入图片</button>' +
        (!outfit ? '<button class="om-btn om-btn-outline" id="om-dbatch" style="font-size:.8em"><i class="fa-solid fa-images"></i> 批量导入</button>' : '') +
        (editImgs.length ? '<button class="om-btn om-btn-danger" id="om-dclr" style="font-size:.8em">删除全部</button>' : '') + '</div></div>',
        '<input type="file" id="om-dbatchfile-album" accept="image/*" multiple style="display:none" />',
        '<input type="file" id="om-dbatchfile-any" multiple style="display:none" />',
        '<div id="om-showcase-holder">' + showcaseHtml + '</div>',
        kitManageHtml,
        '<div class="om-edit-foot"><button class="om-btn om-btn-outline" id="om-dcancel">取消</button><button class="om-btn om-btn-safe" id="om-dsave">保存</button></div>',
    ].join(''));

    function findKitById(target, kitId) {
        ensureOutfitKits(target);
        for (var ki = 0; ki < target.kits.length; ki++) {
            if (target.kits[ki].id === kitId) return target.kits[ki];
        }
        return null;
    }

    function refreshKitManageHolder() {
        if (!outfit) return;
        var p = loadCurrent();
        var target = partGetById(p, outfit.id);
        var holder = sheet.querySelector('#om-kit-manage-holder');
        if (!target || !holder) return;
        ensureOutfitKits(target);
        holder.outerHTML = buildEditKitManageHtml(target, p);
        bindKitManageEvents();
    }

    function refreshImagesArea() {
        var area = sheet.querySelector('#om-dimgarea');
        if (!area) return;
        area.innerHTML = buildEditImagesAreaHtml(editImgs);
        bindImagesEvents();
    }
    function refreshShowcase() {
        var holder = sheet.querySelector('#om-showcase-holder');
        if (!holder) return;
        var p = loadCurrent();
        var target = outfit ? (partGetById(p, outfit.id) || outfit) : null;
        holder.innerHTML = buildShowcaseHtml(target, p);
    }

    function updateKitManage(mutator) {
        if (!outfit) return;
        var p = loadCurrent();
        var target = partGetById(p, outfit.id);
        if (!target) { toast('穿搭不存在', true); return; }
        ensureOutfitKits(target);
        var changed = mutator(target, p);
        if (changed === false) return;
        ensureOutfitKits(target);
        saveCurrent(p);
        fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn();
        refreshKitManageHolder();
        refreshShowcase();
    }

    function bindKitManageEvents() {
        var holder = sheet.querySelector('#om-kit-manage-holder');
        if (!holder) return;
        holder.querySelectorAll('[data-kit-action]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var action = btn.dataset.kitAction;
                var kitId = btn.dataset.kitId;
                if (action === 'deactivate') {
                    updateKitManage(function (target) {
                        target.activeKitId = null;
                        clearKitDraftIfOutfit(target.id);
                        toast('已取消套装');
                    });
                } else if (action === 'activate') {
                    updateKitManage(function (target) {
                        if (!findKitById(target, kitId)) return false;
                        target.activeKitId = kitId;
                        clearKitDraftIfOutfit(target.id);
                        toast('已切换套装');
                    });
                } else if (action === 'rename') {
                    updateKitManage(function (target) {
                        var kit = findKitById(target, kitId);
                        if (!kit) return false;
                        var nm = prompt('套装名称：', kit.name || '');
                        if (nm === null) return false;
                        nm = nm.trim();
                        if (!nm) { toast('名称不能为空', true); return false; }
                        kit.name = nm;
                        toast('已重命名');
                    });
                } else if (action === 'delete') {
                    updateKitManage(function (target) {
                        var kit = findKitById(target, kitId);
                        if (!kit) return false;
                        if (!confirm('删除套装「' + (kit.name || '未命名套装') + '」？')) return false;
                        target.kits = target.kits.filter(function (k) { return k.id !== kitId; });
                        if (target.activeKitId === kitId) target.activeKitId = target.kits[0] ? target.kits[0].id : null;
                        clearKitDraftIfOutfit(target.id);
                        toast('已删除套装');
                    });
                } else if (action === 'remove-acc') {
                    var accId = btn.dataset.accId;
                    updateKitManage(function (target) {
                        var kit = findKitById(target, kitId);
                        if (!kit) return false;
                        kit.accIds = (kit.accIds || []).filter(function (id) { return id !== accId; });
                        kit.disabledAccIds = (kit.disabledAccIds || []).filter(function (id) { return id !== accId; });
                        if (target.activeKitId === kitId) clearKitDraftIfOutfit(target.id);
                        toast('已从套装移除单品');
                    });
                }
            });
        });
    }
    bindKitManageEvents();

    // 设置默认分类
    if (defaultCat) {
        var sel = sheet.querySelector('#om-dcat'); if (sel) sel.value = defaultCat;
    }

    // 父分类切换时联动子分类下拉
    sheet.querySelector('#om-dcat').addEventListener('change', function () {
        var parentVal = this.value;
        var subField = sheet.querySelector('#om-subcat-field');
        var subSel = sheet.querySelector('#om-dsubcat');
        if (!parentVal) {
            subField.style.display = 'none';
            subSel.innerHTML = '<option value="">无子分类</option>';
            return;
        }
        var dd = load();
        var subs = getSubCats(getViewCategories(dd), parentVal);
        if (subs.length === 0) {
            subField.style.display = 'none';
            subSel.innerHTML = '<option value="">无子分类</option>';
        } else {
            subField.style.display = '';
            subSel.innerHTML = '<option value="">无子分类</option>' +
                subs.map(function (sc) { return '<option value="' + esc(sc) + '">' + esc(sc) + '</option>'; }).join('');
        }
    });

    // 三组标签编辑器
    var _tagLists = getAllOutfitLists(d).map(function (list) { return { outfits: list }; });
    var tagSuggestions = collectTagsByGroup(_tagLists);
    tagSuggestions.garment = collectGarmentSuggestions(_tagLists, ensureTagTree(loadMeta()));
    var tagEditor = bindTagEditor(sheet, outfit ? getOutfitTags(outfit) : emptyTags(), tagSuggestions);

    // 标签管理面板按钮
    sheet.querySelector('#om-tag-expand').addEventListener('click', function () {
        openTagPanel();
    });

    // 图片处理（多图）
    var albumInp = sheet.querySelector('#om-dfile-album');
    var fileInp = sheet.querySelector('#om-dfile-any');
    var imgArea = sheet.querySelector('#om-dimgarea');
    function setImgs(arr) {
        editImgs = arr || [];
        refreshImagesArea();
    }
    function handleFiles(files) {
        var imgs = getPickedImageFiles(files);
        if (!imgs.length) { toast('请选择图片文件', true); return; }
        var pending = imgs.length;
        var added = new Array(imgs.length);
        var failed = 0;
        imgs.forEach(function (f, i) {
            var r = new FileReader();
            r.onload = function (e) {
                compressImage(e.target.result, function (c) {
                    if (c) added[i] = c; else failed++;
                    pending--;
                    if (pending === 0) {
                        var flat = [];
                        for (var k = 0; k < added.length; k++) { if (added[k]) flat.push(added[k]); }
                        editImgs = editImgs.concat(flat);
                        setImgs(editImgs);
                        if (flat.length) toast('已添加 ' + flat.length + ' 张图片' + (failed ? '，失败 ' + failed : ''));
                        else toast('图片处理失败', true);
                    }
                });
            };
            r.readAsDataURL(f);
        });
    }
    function bindImageInput(inp) {
        if (!inp) return;
        inp.addEventListener('change', function () {
            handleFiles(inp.files);
            inp.value = '';
        });
    }
    function openImagePicker() {
        openImageSourcePicker('导入图片', function () { albumInp.click(); }, function () { fileInp.click(); });
    }
    function bindImagesEvents() {
        var add = sheet.querySelector('#om-img-add');
        if (add) add.addEventListener('click', openImagePicker);
        sheet.querySelectorAll('.om-img-thumb-del').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(btn.dataset.idx, 10);
                if (isNaN(idx)) return;
                editImgs.splice(idx, 1);
                setImgs(editImgs);
            });
        });
        sheet.querySelectorAll('.om-img-thumb-cover').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(btn.dataset.idx, 10);
                if (isNaN(idx) || idx <= 0) return;
                var img = editImgs.splice(idx, 1)[0];
                editImgs.unshift(img);
                setImgs(editImgs);
            });
        });
    }
    bindImagesEvents();
    sheet.querySelector('#om-dpick').addEventListener('click', openImagePicker);
    bindImageInput(albumInp);
    bindImageInput(fileInp);
    imgArea.addEventListener('click', function (e) { if (e.target.closest('.om-img-thumb')) return; openImagePicker(); });
    imgArea.addEventListener('dragover', function (e) { e.preventDefault(); imgArea.classList.add('drag'); });
    imgArea.addEventListener('dragleave', function () { imgArea.classList.remove('drag'); });
    imgArea.addEventListener('drop', function (e) { e.preventDefault(); imgArea.classList.remove('drag'); if (e.dataTransfer) handleFiles(e.dataTransfer.files); });
    var clr = sheet.querySelector('#om-dclr'); if (clr) clr.addEventListener('click', function () { setImgs([]); });

    // 批量导入按钮
    var batchBtn = sheet.querySelector('#om-dbatch');
    var batchAlbumInp = sheet.querySelector('#om-dbatchfile-album');
    var batchFileInp = sheet.querySelector('#om-dbatchfile-any');
    if (batchBtn) batchBtn.addEventListener('click', function () {
        openImageSourcePicker('批量导入', function () { batchAlbumInp.click(); }, function () { batchFileInp.click(); });
    });
    function bindBatchImageInput(inp) {
        if (!inp) return;
        inp.addEventListener('change', function () {
            var files = getPickedImageFiles(inp.files);
            if (files.length === 0) { toast('未选择图片', true); inp.value = ''; return; }
            closeSheet(sheet);
            fn.openBatchImportModal(files);
            inp.value = '';
        });
    }
    bindBatchImageInput(batchAlbumInp);
    bindBatchImageInput(batchFileInp);

    // AI 生成描述按钮
    sheet.querySelector('#om-daidesc').addEventListener('click', function () {
        var imgData = editImgs[0];
        if (!imgData) { toast('请先上传图片', true); return; }
        var dd = load();
        if (!dd.apiVision.endpoint || !dd.apiVision.key || !dd.apiVision.model) { toast('请先在设置中配置"描述生成 API"', true); return; }
        var btn = sheet.querySelector('#om-daidesc');
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
        var tmpOutfit = { name: sheet.querySelector('#om-dn').value || '穿搭', imageData: imgData };
        generateSingleDescription(tmpOutfit, function (err, result) {
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述';
            if (err) { toast('生成失败：' + err, true); return; }
            if (result.description) sheet.querySelector('#om-ddesc').value = result.description;
            if (result.tags) tagEditor.set(result.tags);
            var nameInp = sheet.querySelector('#om-dn');
            if (result.name && (!nameInp.value.trim() || nameInp.value.trim() === '穿搭')) nameInp.value = result.name;
            toast('✅ 已生成');
        });
    });

    // AI 生成标签按钮（只出标签，不改描述）
    sheet.querySelector('#om-daitags').addEventListener('click', function () {
        var dd = load();
        if (!dd.apiVision.endpoint || !dd.apiVision.key || !dd.apiVision.model) { toast('请先在设置中配置"描述生成 API"', true); return; }
        var btn = sheet.querySelector('#om-daitags');
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 分析中...';
        var subSel = sheet.querySelector('#om-dsubcat');
        var tmpOutfit = {
            name: sheet.querySelector('#om-dn').value || '',
            category: sheet.querySelector('#om-dcat').value || '',
            subCategory: subSel ? (subSel.value || '') : '',
            description: sheet.querySelector('#om-ddesc').value || '',
            tags: tagEditor.get(),
            imageData: editImgs[0] || null
        };
        generateSingleTags(tmpOutfit, function (err, tags) {
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成标签';
            if (err) { toast('生成失败：' + err, true); return; }
            tagEditor.set(tags);
            toast('✅ 标签已生成');
        });
    });

    sheet.querySelector('#om-dnewcat').addEventListener('click', function () {
        var name = prompt('新分类名称：'); if (!name || !name.trim()) return; name = name.trim();
        var dd = load(); var vc = getViewCategories(dd);
        var names = getCatNames(vc);
        if (names.indexOf(name) === -1) { vc.push({ name: name, children: [] }); save(dd); fn.renderCatbar(); }
        var sel = sheet.querySelector('#om-dcat'); var ex = false;
        for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === name) { ex = true; break; } }
        if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel.appendChild(opt); }
        sel.value = name;
        // 触发联动
        sel.dispatchEvent(new Event('change'));
        toast('分类「' + name + '」已添加');
    });

    // 新建子分类
    sheet.querySelector('#om-dnewsubcat').addEventListener('click', function () {
        var parentVal = sheet.querySelector('#om-dcat').value;
        if (!parentVal) { toast('请先选择父分类', true); return; }
        var scName = prompt('新子分类名称（属于「' + parentVal + '」）：'); if (!scName || !scName.trim()) return; scName = scName.trim();
        var dd = load(); var vc = getViewCategories(dd);
        var catObj = findCatObj(vc, parentVal);
        if (catObj) {
            if (!catObj.children) catObj.children = [];
            if (catObj.children.indexOf(scName) === -1) { catObj.children.push(scName); save(dd); fn.renderCatbar(); }
        }
        var subSel = sheet.querySelector('#om-dsubcat'); var ex2 = false;
        for (var j = 0; j < subSel.options.length; j++) { if (subSel.options[j].value === scName) { ex2 = true; break; } }
        if (!ex2) { var opt2 = document.createElement('option'); opt2.value = scName; opt2.textContent = scName; subSel.appendChild(opt2); }
        subSel.value = scName;
        sheet.querySelector('#om-subcat-field').style.display = '';
        toast('子分类「' + scName + '」已添加');
    });

    sheet.querySelector('#om-dcancel').addEventListener('click', function () { closeSheet(sheet); });
    sheet.querySelector('#om-dsave').addEventListener('click', function () {
        var name = sheet.querySelector('#om-dn').value.trim();
        if (!name) { toast('请输入穿搭名称', true); return; }
        var cat = sheet.querySelector('#om-dcat').value;
        var subCat = sheet.querySelector('#om-dsubcat').value;
        var desc = sheet.querySelector('#om-ddesc').value.trim();
        var tags = tagEditor.get();
        var curP = loadCurrent();
        if (outfit) {
            // 编辑已有穿搭 - 在当前 partition 中查找
            for (var i = 0; i < curP.outfits.length; i++) {
                if (curP.outfits[i].id === outfit.id) {
                    Object.assign(curP.outfits[i], { name: name, category: cat, subCategory: subCat, description: desc, images: editImgs.slice(), imageData: editImgs[0] || null });
                    setOutfitTags(curP.outfits[i], tags);
                    break;
                }
            }
        } else {
            // 新增穿搭 - 放入当前 partition
            var newOutfit = { id: genId(), name: name, category: cat, subCategory: subCat, description: desc, tags: tags, images: editImgs.slice(), imageData: editImgs[0] || null, kits: [], activeKitId: null, createdAt: Date.now() };
            setOutfitTags(newOutfit, tags);
            curP.outfits.unshift(newOutfit);
        }
        var _tagMeta = loadMeta(); noteTagTreeUsage(_tagMeta, tags); saveMeta(_tagMeta);
        saveCurrent(curP); closeSheet(sheet); toast('✨ 已保存：' + name); fn.renderCatbar(); fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn();
    });
}

// ── 预设 Bottom Sheet ─────────────────────────────────────
function openPresetsSheet() {
    var d = load();
    var activePresetId = d.activePresetId || null;
    var presetListHtml = (!d.presets || d.presets.length === 0)
        ? '<div class="om-empty"><i class="fa-solid fa-bookmark"></i><span>还没有预设</span></div>'
        : d.presets.map(function (p, idx) {
            var isCurrent = (activePresetId && p.id === activePresetId);
            var outfitCount = (p.outfits || []).length;
            var accCount = (p.accessories || []).length;
            var countText = outfitCount + ' 套穿搭' + (accCount > 0 ? ' / ' + accCount + ' 件单品' : '');
            return '<div class="om-preset-item' + (isCurrent ? ' current' : '') + '" data-idx="' + idx + '">' +
                '<div class="om-preset-name">' + esc(p.name) + (isCurrent ? ' <span style="font-size:.7em;opacity:.5;font-weight:400">（当前）</span>' : '') + '</div>' +
                '<div class="om-preset-count">包含 ' + esc(countText) + '</div>' +
                '<button class="om-btn-sm om-preset-ren" data-idx="' + idx + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="om-btn-sm om-preset-del" data-idx="' + idx + '" title="删除"><i class="fa-solid fa-trash"></i></button>' +
                '</div>';
        }).join('');

    // 保存区：如果有当前预设，显示"覆盖保存"按钮
    var currentPreset = null;
    if (activePresetId && d.presets) {
        for (var pi = 0; pi < d.presets.length; pi++) {
            if (d.presets[pi].id === activePresetId) { currentPreset = d.presets[pi]; break; }
        }
    }
    var saveSection = '';
    if (currentPreset) {
        saveSection =
            '<div class="om-sec-title">保存</div>' +
            '<div class="om-btn-row" style="margin-bottom:10px">' +
            '<button class="om-btn om-btn-safe" id="om-preset-overwrite" style="flex:1"><i class="fa-solid fa-floppy-disk"></i> 保存到「' + esc(currentPreset.name) + '」</button>' +
            '</div>' +
            '<div class="om-divider"></div>' +
            '<div class="om-sec-title">另存为新预设</div>' +
            '<div class="om-cat-add-row"><input type="text" id="om-preset-name-inp" placeholder="新预设名称…" /><button class="om-btn om-btn-outline" id="om-preset-save">保存</button></div>';
    } else {
        saveSection =
            '<div class="om-sec-title">保存当前状态为预设</div>' +
            '<div class="om-hint" style="margin-bottom:8px">将当前所有穿搭数据 + 分类一起打包保存</div>' +
            '<div class="om-cat-add-row"><input type="text" id="om-preset-name-inp" placeholder="预设名称…" /><button class="om-btn om-btn-safe" id="om-preset-save">保存</button></div>';
    }

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-bookmark"></i>预设管理</div>',
        '<div class="om-sec-title">已保存的预设 <span class="om-hint">点击名称加载</span></div>',
        presetListHtml,
        '<div class="om-divider"></div>',
        saveSection,
        '<div class="om-divider"></div>',
        '<div class="om-sec-title">空白预设</div>',
        '<button class="om-btn om-btn-outline" id="om-preset-empty" style="width:100%"><i class="fa-regular fa-square-plus"></i> 新建空白预设</button>',
    ].join(''));

    // 覆盖保存到当前预设
    var overwriteBtn = sheet.querySelector('#om-preset-overwrite');
    if (overwriteBtn) overwriteBtn.addEventListener('click', function () {
        var dd = load();
        for (var i = 0; i < dd.presets.length; i++) {
            if (dd.presets[i].id === activePresetId) {
                dd.presets[i].outfits = JSON.parse(JSON.stringify(dd.outfits));
                dd.presets[i].categories = JSON.parse(JSON.stringify(dd.categories));
                dd.presets[i].activeIds = JSON.parse(JSON.stringify(dd.activeIds));
                dd.presets[i].accessories = JSON.parse(JSON.stringify(dd.accessories || []));
                dd.presets[i].accCategories = JSON.parse(JSON.stringify(dd.accCategories || []));
                dd.presets[i].updatedAt = Date.now();
                break;
            }
        }
        save(dd); closeSheet(sheet); toast('✅ 已保存到「' + currentPreset.name + '」'); openPresetsSheet();
    });

    // 保存为新预设
    var inp = sheet.querySelector('#om-preset-name-inp');
    sheet.querySelector('#om-preset-save').addEventListener('click', function () {
        var name = inp.value.trim(); if (!name) { toast('请输入预设名称', true); return; }
        var dd = load();
        if (!Array.isArray(dd.presets)) dd.presets = [];
        var newId = genId();
        dd.presets.push({ id: newId, name: name, createdAt: Date.now(), outfits: JSON.parse(JSON.stringify(dd.outfits)), categories: JSON.parse(JSON.stringify(dd.categories)), activeIds: JSON.parse(JSON.stringify(dd.activeIds)), accessories: JSON.parse(JSON.stringify(dd.accessories || [])), accCategories: JSON.parse(JSON.stringify(dd.accCategories || [])) });
        save(dd); dd = load(); dd.activePresetId = newId; save(dd); inp.value = ''; closeSheet(sheet); toast('✨ 预设「' + name + '」已保存'); openPresetsSheet();
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sheet.querySelector('#om-preset-save').click(); });

    var emptyBtn = sheet.querySelector('#om-preset-empty');
    if (emptyBtn) emptyBtn.addEventListener('click', function () {
        var dd = load();
        if (!Array.isArray(dd.presets)) dd.presets = [];
        var base = '空白预设';
        var names = dd.presets.map(function (p) { return p && p.name; });
        var defaultName = base;
        var n = 2;
        while (names.indexOf(defaultName) !== -1) { defaultName = base + ' ' + n; n++; }
        var name = prompt('空白预设名称：', defaultName);
        if (name === null) return;
        name = name.trim();
        if (!name) { toast('请输入预设名称', true); return; }
        if (!confirm('创建并加载「' + name + '」？这会清空当前衣柜内容和分类。')) return;
        var newId = genId();
        dd.presets.push({
            id: newId,
            name: name,
            createdAt: Date.now(),
            outfits: [],
            categories: [],
            activeIds: [],
            accessories: [],
            accCategories: []
        });
        dd.outfits = [];
        dd.categories = [];
        dd.activeIds = [];
        dd.accessories = [];
        dd.accCategories = [];
        dd.activePresetId = newId;
        save(dd);
        closeSheet(sheet);
        fn.renderViewbar();
        fn.renderCatbar();
        fn.renderAccCatbar();
        fn.renderGrid();
        fn.renderBottomStatus();
        fn.updateBtn();
        toast('✨ 已创建空白预设「' + name + '」');
    });

    // 加载预设
    sheet.querySelectorAll('.om-preset-item').forEach(function (item) {
        item.addEventListener('click', function (e) {
            if (e.target.closest('.om-preset-ren') || e.target.closest('.om-preset-del')) return;
            var dd = load(); var p = dd.presets[parseInt(item.dataset.idx)]; if (!p) return;
            if (!confirm('加载预设「' + p.name + '」？这将覆盖当前所有穿搭数据。')) return;
            dd.outfits = JSON.parse(JSON.stringify(p.outfits || []));
            dd.categories = JSON.parse(JSON.stringify(p.categories || []));
            dd.activeIds = JSON.parse(JSON.stringify(p.activeIds || []));
            dd.accessories = JSON.parse(JSON.stringify(p.accessories || []));
            dd.accCategories = JSON.parse(JSON.stringify(p.accCategories || []));
            dd.activePresetId = p.id;
            save(dd); closeSheet(sheet); fn.renderCatbar(); fn.renderAccCatbar(); fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn(); toast('✅ 已加载「' + p.name + '」');
        });
    });
    sheet.querySelectorAll('.om-preset-ren').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var dd = load(); var p = dd.presets[parseInt(btn.dataset.idx)]; if (!p) return;
            var nw = prompt('重命名：', p.name); if (!nw || !nw.trim()) return;
            p.name = nw.trim(); save(dd); closeSheet(sheet); openPresetsSheet(); toast('已重命名');
        });
    });
    sheet.querySelectorAll('.om-preset-del').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var dd = load(); var p = dd.presets[parseInt(btn.dataset.idx)]; if (!p) return;
            if (!confirm('删除预设「' + p.name + '」？')) return;
            if (p.id === activePresetId) { dd.activePresetId = null; }
            dd.presets.splice(parseInt(btn.dataset.idx), 1); save(dd); closeSheet(sheet); openPresetsSheet(); toast('已删除');
        });
    });
}

// ── 设置 Bottom Sheet ─────────────────────────────────────
function getSettingsDataStats() {
    var meta = loadMeta();
    var keys = ['user:__default__'];
    (meta.presets || []).forEach(function (p) { if (p && p.partKey && keys.indexOf(p.partKey) === -1) keys.push(p.partKey); });
    (meta.charIndex || []).forEach(function (ci) { if (ci && ci.partKey && keys.indexOf(ci.partKey) === -1) keys.push(ci.partKey); });

    var outfits = 0, accessories = 0, images = 0;
    keys.forEach(function (pk) {
        var part = loadPartition(pk);
        var os = part.outfits || [];
        var accs = part.accessories || [];
        outfits += os.length;
        accessories += accs.length;
        images += os.filter(function (o) { return !!o.imageData; }).length;
        images += accs.filter(function (a) { return !!a.imageData; }).length;
    });
    return {
        outfits: outfits,
        accessories: accessories,
        images: images,
        presets: (meta.presets || []).length,
        storage: isServerMode() ? '服务器存储' : '本地存储'
    };
}

function buildPromptTemplateOptions(apiVision) {
    var list = apiVision.promptTemplates || [];
    if (list.length === 0) return '<option value="">暂无模板</option>';
    return '<option value="">选择模板…</option>' + list.map(function (tpl) {
        return '<option value="' + esc(tpl.id) + '"' + (apiVision.activePromptTemplateId === tpl.id ? ' selected' : '') + '>' + esc(tpl.name || '未命名模板') + '</option>';
    }).join('');
}

function openSettingsSheet() {
    var d = load();
    var stats = getSettingsDataStats();

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-sliders"></i>设置</div>',

        '<div class="om-sec-title">发送内容</div>',
        '<div class="om-setting-row om-row-inline"><label>启用注入 <span class="om-hint">关闭后暂停把穿搭信息注入给 AI</span></label><input type="checkbox" class="om-chk" id="om-inject-enabled"' + (d.injectEnabled !== false ? ' checked' : '') + ' /></div>',
        '<div class="om-setting-row"><label>发送给 AI 的内容类型 <span class="om-hint">标签始终会发送，区别在文字和图片</span></label><select id="om-inject-mode">',
        '<option value="tag_text_image"' + (d.injectMode === 'tag_text_image' ? ' selected' : '') + '>标签 + 文字 + 图片</option>',
        '<option value="tag_text"' + (d.injectMode === 'tag_text' || !d.injectMode ? ' selected' : '') + '>标签 + 文字</option>',
        '<option value="tag"' + (d.injectMode === 'tag' ? ' selected' : '') + '>仅标签</option>',
        '</select></div>',
        '<div class="om-setting-row"><label>图片策略 <span class="om-hint">聊天模型能不能看图不确定时保持「自动」：发图被接口拒绝会自动改成只发文字并记住这个模型</span></label><select id="om-image-policy">' +
        '<option value="auto"' + (d.imagePolicy === 'auto' || !d.imagePolicy ? ' selected' : '') + '>自动（推荐）</option>' +
        '<option value="always"' + (d.imagePolicy === 'always' ? ' selected' : '') + '>始终带图</option>' +
        '<option value="never"' + (d.imagePolicy === 'never' ? ' selected' : '') + '>从不带图</option>' +
        '</select></div>',
        '<div class="om-setting-row om-row-inline"><label>要求 AI 标注本楼穿搭 <span class="om-hint">在注入内容里附名称清单，让 AI 回复末尾输出 &lt;Outfit-Manager-Custom&gt;名称/角色+…&lt;/Outfit-Manager-Custom&gt;，插件会把它渲染成可点卡片</span></label><input type="checkbox" class="om-chk" id="om-marker-enabled"' + (d.markerEnabled !== false ? ' checked' : '') + ' /></div>',

        '<div class="om-setting-row"><label>注入位置 <span class="om-hint">Gemini/DeepSeek 建议选\"用户消息\"</span></label><select id="om-inject-pos">',
        '<option value="system"' + (d.injectPosition === 'system' ? ' selected' : '') + '>系统提示末尾</option>',
        '<option value="context"' + (d.injectPosition === 'context' ? ' selected' : '') + '>上下文末尾</option>',
        '<option value="user"' + (d.injectPosition === 'user' || !d.injectPosition ? ' selected' : '') + '>用户消息末尾（推荐）</option>',
        '</select></div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">随机注入 <span class="om-hint">（仅对通用衣柜生效）</span></div>',
        '<div class="om-setting-row om-row-inline"><label>开启随机注入 <span class="om-hint">开启后，每次会话首次注入会从通用衣柜随机选取若干套穿搭，之后复用同一批</span></label><input type="checkbox" class="om-chk" id="om-random-inject"' + (d.randomInject ? ' checked' : '') + ' /></div>',
        '<div class="om-setting-row"><label>随机注入数量 <span class="om-hint">每次随机选取的穿搭套数</span></label><input type="number" id="om-random-inject-count" min="1" max="20" value="' + (d.randomInjectCount || 3) + '" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit" /></div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">单套模式模板 <span class="om-hint">（User选了1套时生效）</span></div>',
        '<div class="om-hint" style="margin-bottom:6px">{{description}} → 替换为穿搭的文字描述</div>',
        '<div class="om-setting-row"><textarea id="om-tpl-single" rows="3">' + esc(d.singleTemplate) + '</textarea></div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">衣柜模式模板 <span class="om-hint">（User选了多套时生效）</span></div>',
        '<div class="om-hint" style="margin-bottom:6px">{{wardrobe}} → 替换为所有已选穿搭的列表</div>',
        '<div class="om-setting-row"><textarea id="om-tpl-multi" rows="5">' + esc(d.multiTemplate) + '</textarea></div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">角色单套模板 <span class="om-hint">（角色选了1套时生效）</span></div>',
        '<div class="om-hint" style="margin-bottom:6px">{{charName}} → 角色名 / {{description}} → 描述</div>',
        '<div class="om-setting-row"><textarea id="om-tpl-char-single" rows="3">' + esc(d.charSingleTemplate || '【{{charName}}的穿搭】\n{{description}}') + '</textarea></div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">角色衣柜模板 <span class="om-hint">（角色选了多套时生效）</span></div>',
        '<div class="om-hint" style="margin-bottom:6px">{{charName}} → 角色名 / {{wardrobe}} → 穿搭列表</div>',
        '<div class="om-setting-row"><textarea id="om-tpl-char-multi" rows="5">' + esc(d.charMultiTemplate || '【{{charName}}的穿搭】\n{{wardrobe}}') + '</textarea></div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">图片模式补充提示</div>',
        '<div class="om-setting-row"><label>单套+图片</label><textarea id="om-imgprompt" rows="2">' + esc(d.imagePrompt) + '</textarea></div>',
        '<div class="om-setting-row" style="margin-top:6px"><label>衣柜+图片</label><textarea id="om-multi-imgprompt" rows="2">' + esc(d.multiImagePrompt) + '</textarea></div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title"><i class="fa-solid fa-wand-magic-sparkles" style="margin-right:4px"></i>描述生成 API <span class="om-hint">（用于批量生成穿搭文字描述，需要 Vision 模型）</span></div>',
        '<div class="om-setting-row"><label>API 地址</label><input type="text" id="om-api-v-endpoint" placeholder="https://api.openai.com 或中转站地址" value="' + esc(d.apiVision.endpoint) + '" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit" /></div>',
        '<div class="om-setting-row"><label>API Key</label><input type="password" id="om-api-v-key" placeholder="sk-..." value="' + esc(d.apiVision.key) + '" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit" /></div>',
        '<div class="om-setting-row"><label>模型名称</label><div style="display:flex;gap:6px;align-items:center"><input type="text" id="om-api-v-model" placeholder="gpt-4o / gemini-2.0-flash / claude-sonnet-4-20250514" value="' + esc(d.apiVision.model) + '" style="flex:1;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;box-sizing:border-box;font-family:inherit" /><button class="om-btn om-btn-outline" id="om-api-v-model-fetch" style="font-size:.75em;white-space:nowrap;padding:7px 10px;flex-shrink:0"><i class="fa-solid fa-rotate"></i> 拉取</button></div></div>',
        '<div class="om-setting-row"><label>描述生成 Prompt</label><textarea id="om-api-v-prompt" rows="3" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">' + esc(d.apiVision.prompt) + '</textarea></div>',
        '<div class="om-setting-row"><label>单品描述 Prompt <span class="om-hint">{{accCategory}} = 单品分类名</span></label><textarea id="om-api-v-acc-prompt" rows="3" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">' + esc(d.apiVision.accPrompt || '') + '</textarea></div>',
        '<div class="om-setting-row"><label>标签分析 Prompt <span class="om-hint">决定三个大类里放什么词、怎么放</span></label><textarea id="om-api-v-tag-prompt" rows="5" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">' + esc(d.apiVision.tagPrompt || '') + '</textarea></div>',
        '<div class="om-setting-row"><label>Prompt 模板</label><select id="om-api-v-template" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit">' + buildPromptTemplateOptions(d.apiVision) + '</select></div>',
        '<div class="om-btn-row" style="margin-top:6px"><button class="om-btn om-btn-outline" id="om-api-v-template-save" style="font-size:.78em;flex:1 1 110px"><i class="fa-solid fa-floppy-disk"></i> 保存当前</button><button class="om-btn om-btn-outline" id="om-api-v-template-ren" style="font-size:.78em;flex:1 1 90px"><i class="fa-solid fa-pen"></i> 重命名</button><button class="om-btn om-btn-outline" id="om-api-v-template-del" style="font-size:.78em;flex:1 1 90px"><i class="fa-solid fa-trash"></i> 删除</button></div>',
        '<div class="om-setting-row om-row-inline"><label>覆盖已有描述</label><input type="checkbox" class="om-chk" id="om-api-v-overwrite"' + (d.apiVision.overwrite ? ' checked' : '') + ' /></div>',
        '<div class="om-setting-row om-row-inline"><label>通过酒馆代理发送 <span class="om-hint">本地大模型服务（如 127.0.0.1:3425）报 Failed to fetch 时打开，走酒馆自带的反向代理绕过 CORS</span></label><input type="checkbox" class="om-chk" id="om-api-v-proxy"' + (d.apiVision.useProxy ? ' checked' : '') + ' /></div>',
        '<div class="om-btn-row" style="margin-top:6px"><button class="om-btn om-btn-outline" id="om-api-v-test" style="font-size:.8em"><i class="fa-solid fa-flask-vial"></i> 测试连接</button></div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">分类管理</div>',
        '<div class="om-setting-row" style="gap:7px">',
        '<button class="om-btn om-btn-outline" id="om-open-cats" style="width:100%;text-align:left"><i class="fa-solid fa-tags" style="margin-right:7px"></i>穿搭分类管理…</button>',
        '<button class="om-btn om-btn-outline" id="om-open-acc-cats" style="width:100%;text-align:left"><i class="fa-solid fa-gem" style="margin-right:7px"></i>单品分类管理…</button>',
        '</div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">数据</div>',
        '<div class="om-storage-info">' + stats.outfits + ' 套穿搭 / ' + stats.accessories + ' 件单品 / ' + stats.images + ' 张图片 / ' + stats.presets + ' 个预设 / ' + stats.storage + '</div>',
        '<div class="om-btn-row" style="margin-top:8px">',
        '<button class="om-btn om-btn-outline" id="om-exp"><i class="fa-solid fa-download"></i> 导出</button>',
        '<button class="om-btn om-btn-outline" id="om-imp"><i class="fa-solid fa-upload"></i> 导入</button>',
        '<button class="om-btn om-btn-danger" id="om-clear">清空穿搭</button>',
        '</div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">悬浮球</div>',
        '<div class="om-setting-row om-row-inline"><label>显示悬浮球</label><input type="checkbox" class="om-chk" id="om-show-ball"' + (d.showBall !== false ? ' checked' : '') + ' /></div>',
        '<div class="om-sec-title">悬浮球自定义</div>',
        '<div class="om-field"><label>自定义图片 <span class="om-hint">支持 gif 动图、透明底 png</span></label>' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<div id="om-fab-preview" style="width:48px;height:48px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        (d.fabImage ? '<img src="' + d.fabImage + '" style="width:100%;height:100%;object-fit:contain;" />' : '<div style="width:100%;height:100%;border-radius:50%;background:var(--SmartThemeQuoteColor,#7c6daf);display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-shirt" style="color:#fff;font-size:1.1em;"></i></div>') +
        '</div>' +
        '<div style="display:flex;gap:6px;flex:1;flex-wrap:wrap;">' +
        '<button class="om-btn om-btn-outline" id="om-fab-pick" style="font-size:.8em;flex:1 1 120px;"><i class="fa-solid fa-image"></i> 选择图片</button>' +
        '<button class="om-btn om-btn-outline" id="om-fab-reset" style="font-size:.8em;flex:1 1 120px;' + (d.fabImage ? '' : 'opacity:.35;pointer-events:none;') + '"><i class="fa-solid fa-rotate-left"></i> 恢复默认</button>' +
        '</div>' +
        '<input type="file" id="om-fab-file" accept="image/*" style="display:none" />' +
        '</div></div>',
        '<div class="om-field"><label>悬浮球大小：<span id="om-fab-size-val">' + (d.fabSize || 38) + 'px</span></label>' +
        '<input type="range" id="om-fab-size" min="28" max="64" value="' + (d.fabSize || 38) + '" style="width:100%;accent-color:var(--SmartThemeQuoteColor,#7c6daf);" /></div>',
        '<div class="om-divider"></div>',
        '<div class="om-sec-title">调试</div>',
        '<div class="om-setting-row om-row-inline"><label>注入时显示 Toast 提示</label><input type="checkbox" class="om-chk" id="om-debug"' + (d.debug ? ' checked' : '') + ' /></div>',
    ].join(''));

    sheet.querySelector('#om-inject-mode').addEventListener('change', function () { var m = loadMeta(); m.injectMode = this.value; saveMeta(m); });
    sheet.querySelector('#om-marker-enabled').addEventListener('change', function () { var m = loadMeta(); m.markerEnabled = this.checked; saveMeta(m); });
    sheet.querySelector('#om-image-policy').addEventListener('change', function () { var m = loadMeta(); m.imagePolicy = this.value; saveMeta(m); });
    sheet.querySelector('#om-inject-enabled').addEventListener('change', function () {
        var m = loadMeta(); m.injectEnabled = this.checked; saveMeta(m);
        // 同步重建悬浮球，刷新注入快捷开关状态
        var oldFab = document.getElementById('om-fab-main'); if (oldFab && oldFab.parentNode) oldFab.parentNode.removeChild(oldFab);
        if (m.showBall !== false && fn.injectFab) fn.injectFab();
    });
    sheet.querySelector('#om-inject-pos').addEventListener('change', function () { var m = loadMeta(); m.injectPosition = this.value; saveMeta(m); });
    sheet.querySelector('#om-random-inject').addEventListener('change', function () {
        var m = loadMeta(); m.randomInject = this.checked; saveMeta(m);
        // 重建悬浮球以显示/隐藏刷新按钮
        var oldFab = document.getElementById('om-fab-main'); if (oldFab && oldFab.parentNode) oldFab.parentNode.removeChild(oldFab);
        if (m.showBall !== false && fn.injectFab) fn.injectFab();
    });
    sheet.querySelector('#om-random-inject-count').addEventListener('change', function () {
        var m = loadMeta();
        var v = parseInt(this.value);
        if (!(v > 0)) { v = 1; }
        m.randomInjectCount = v;
        this.value = v;
        saveMeta(m);
    });
    sheet.querySelector('#om-tpl-single').addEventListener('input', function () { var m = loadMeta(); m.singleTemplate = this.value; saveMeta(m); });
    sheet.querySelector('#om-tpl-multi').addEventListener('input', function () { var m = loadMeta(); m.multiTemplate = this.value; saveMeta(m); });
    sheet.querySelector('#om-tpl-char-single').addEventListener('input', function () { var m = loadMeta(); m.charSingleTemplate = this.value; saveMeta(m); });
    sheet.querySelector('#om-tpl-char-multi').addEventListener('input', function () { var m = loadMeta(); m.charMultiTemplate = this.value; saveMeta(m); });
    sheet.querySelector('#om-imgprompt').addEventListener('input', function () { var m = loadMeta(); m.imagePrompt = this.value; saveMeta(m); });
    sheet.querySelector('#om-multi-imgprompt').addEventListener('input', function () { var m = loadMeta(); m.multiImagePrompt = this.value; saveMeta(m); });

    // API Vision 配置
    sheet.querySelector('#om-api-v-endpoint').addEventListener('input', function () { var m = loadMeta(); m.apiVision.endpoint = this.value.trim(); saveMeta(m); });
    sheet.querySelector('#om-api-v-key').addEventListener('input', function () { var m = loadMeta(); m.apiVision.key = this.value.trim(); saveMeta(m); });
    sheet.querySelector('#om-api-v-model').addEventListener('input', function () { var m = loadMeta(); m.apiVision.model = this.value.trim(); saveMeta(m); });
    sheet.querySelector('#om-api-v-prompt').addEventListener('input', function () { var m = loadMeta(); m.apiVision.prompt = this.value; saveMeta(m); });
    sheet.querySelector('#om-api-v-acc-prompt').addEventListener('input', function () { var m = loadMeta(); m.apiVision.accPrompt = this.value; saveMeta(m); });
    sheet.querySelector('#om-api-v-tag-prompt').addEventListener('input', function () { var m = loadMeta(); m.apiVision.tagPrompt = this.value; saveMeta(m); });
    sheet.querySelector('#om-api-v-overwrite').addEventListener('change', function () { var m = loadMeta(); m.apiVision.overwrite = this.checked; saveMeta(m); });
    sheet.querySelector('#om-api-v-proxy').addEventListener('change', function () { var m = loadMeta(); m.apiVision.useProxy = this.checked; saveMeta(m); });

    function refreshPromptTemplateSelect() {
        var m = loadMeta();
        var sel = sheet.querySelector('#om-api-v-template');
        if (sel) sel.innerHTML = buildPromptTemplateOptions(m.apiVision);
    }
    function findPromptTemplate(apiVision, id) {
        var list = apiVision.promptTemplates || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) return list[i];
        }
        return null;
    }
    sheet.querySelector('#om-api-v-template').addEventListener('change', function () {
        var id = this.value;
        if (!id) return;
        var m = loadMeta();
        var tpl = findPromptTemplate(m.apiVision, id);
        if (!tpl) { toast('模板不存在', true); refreshPromptTemplateSelect(); return; }
        m.apiVision.prompt = tpl.prompt || '';
        m.apiVision.accPrompt = tpl.accPrompt || '';
        if (tpl.tagPrompt) m.apiVision.tagPrompt = tpl.tagPrompt;
        m.apiVision.activePromptTemplateId = tpl.id;
        saveMeta(m);
        sheet.querySelector('#om-api-v-prompt').value = m.apiVision.prompt;
        sheet.querySelector('#om-api-v-acc-prompt').value = m.apiVision.accPrompt;
        sheet.querySelector('#om-api-v-tag-prompt').value = m.apiVision.tagPrompt || '';
        toast('已切换到模板「' + (tpl.name || '未命名模板') + '」');
    });
    sheet.querySelector('#om-api-v-template-save').addEventListener('click', function () {
        var m = loadMeta();
        if (!Array.isArray(m.apiVision.promptTemplates)) m.apiVision.promptTemplates = [];
        var defaultName = '模板' + (m.apiVision.promptTemplates.length + 1);
        var name = prompt('模板名称：', defaultName);
        if (!name || !name.trim()) return;
        var tpl = {
            id: 'pt_' + genId(),
            name: name.trim(),
            prompt: sheet.querySelector('#om-api-v-prompt').value,
            accPrompt: sheet.querySelector('#om-api-v-acc-prompt').value,
            tagPrompt: sheet.querySelector('#om-api-v-tag-prompt').value
        };
        m.apiVision.prompt = tpl.prompt;
        m.apiVision.accPrompt = tpl.accPrompt;
        m.apiVision.tagPrompt = tpl.tagPrompt;
        m.apiVision.promptTemplates.push(tpl);
        m.apiVision.activePromptTemplateId = tpl.id;
        saveMeta(m);
        refreshPromptTemplateSelect();
        toast('已保存 Prompt 模板');
    });
    sheet.querySelector('#om-api-v-template-ren').addEventListener('click', function () {
        var m = loadMeta();
        var id = sheet.querySelector('#om-api-v-template').value || m.apiVision.activePromptTemplateId;
        var tpl = findPromptTemplate(m.apiVision, id);
        if (!tpl) { toast('请先选择模板', true); return; }
        var name = prompt('重命名模板：', tpl.name || '未命名模板');
        if (!name || !name.trim()) return;
        tpl.name = name.trim();
        saveMeta(m);
        refreshPromptTemplateSelect();
        toast('已重命名模板');
    });
    sheet.querySelector('#om-api-v-template-del').addEventListener('click', function () {
        var m = loadMeta();
        var id = sheet.querySelector('#om-api-v-template').value || m.apiVision.activePromptTemplateId;
        var tpl = findPromptTemplate(m.apiVision, id);
        if (!tpl) { toast('请先选择模板', true); return; }
        if (!confirm('删除 Prompt 模板「' + (tpl.name || '未命名模板') + '」？\n当前 Prompt 内容不会被清空。')) return;
        m.apiVision.promptTemplates = (m.apiVision.promptTemplates || []).filter(function (t) { return t.id !== id; });
        if (m.apiVision.activePromptTemplateId === id) m.apiVision.activePromptTemplateId = null;
        saveMeta(m);
        refreshPromptTemplateSelect();
        toast('已删除模板');
    });

    sheet.querySelector('#om-api-v-test').addEventListener('click', function () {
        var m = loadMeta();
        if (!m.apiVision.endpoint || !m.apiVision.key || !m.apiVision.model) { toast('请先填写 API 地址、Key 和模型名称', true); return; }
        toast('正在测试...');
        fetch(normalizeEndpoint(m.apiVision.endpoint, '/v1/chat/completions'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + m.apiVision.key },
            body: JSON.stringify({ model: m.apiVision.model, messages: [{ role: 'user', content: '回复OK' }], max_tokens: 10 })
        }).then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status); });
            return r.json();
        }).then(function () { toast('✅ 描述 API 连接成功！'); })
        .catch(function (e) { toast('❌ 连接失败：' + e.message, true); });
    });
    // Vision 模型拉取按钮
    var vModelFetch = sheet.querySelector('#om-api-v-model-fetch');
    if (vModelFetch) vModelFetch.addEventListener('click', function () {
        var m = loadMeta();
        if (!m.apiVision.endpoint || !m.apiVision.key) { toast('请先填写 API 地址和 Key', true); return; }
        openModelPicker(m.apiVision, function (model) {
            var m2 = loadMeta(); m2.apiVision.model = model; saveMeta(m2);
            var inp = sheet.querySelector('#om-api-v-model'); if (inp) inp.value = model;
        });
    });

    sheet.querySelector('#om-show-ball').addEventListener('change', function () {
        var m = loadMeta(); m.showBall = this.checked; saveMeta(m);
        var oldFab = document.getElementById('om-fab-main'); if (oldFab) oldFab.parentNode.removeChild(oldFab);
        if (m.showBall && fn.injectFab) fn.injectFab();
    });

    // 悬浮球自定义
    var fabFileInp = sheet.querySelector('#om-fab-file');
    var fabResetBtn = sheet.querySelector('#om-fab-reset');
    function updateFabPreview(imgSrc) {
        var prev = sheet.querySelector('#om-fab-preview');
        if (imgSrc) {
            prev.innerHTML = '<img src="' + imgSrc + '" style="width:100%;height:100%;object-fit:contain;" />';
            fabResetBtn.style.opacity = ''; fabResetBtn.style.pointerEvents = '';
        } else {
            prev.innerHTML = '<div style="width:100%;height:100%;border-radius:50%;background:var(--SmartThemeQuoteColor,#7c6daf);display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-shirt" style="color:#fff;font-size:1.1em;"></i></div>';
            fabResetBtn.style.opacity = '.35'; fabResetBtn.style.pointerEvents = 'none';
        }
    }
    function refreshFab() {
        var oldFab = document.getElementById('om-fab-main'); if (oldFab) oldFab.parentNode.removeChild(oldFab);
        var m = loadMeta(); if (m.showBall !== false && fn.injectFab) fn.injectFab();
    }
    sheet.querySelector('#om-fab-pick').addEventListener('click', function () { fabFileInp.click(); });
    fabFileInp.addEventListener('change', function () {
        var file = fabFileInp.files[0]; if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            var dataUrl = e.target.result;
            // 不压缩：保留透明底 PNG 和 GIF 动画
            var m = loadMeta(); m.fabImage = dataUrl; saveMeta(m);
            updateFabPreview(dataUrl);
            refreshFab();
            toast('✨ 悬浮球已更新');
        };
        reader.readAsDataURL(file);
    });
    fabResetBtn.addEventListener('click', function () {
        var m = loadMeta(); m.fabImage = ''; saveMeta(m);
        updateFabPreview('');
        refreshFab();
        toast('悬浮球已恢复默认');
    });
    sheet.querySelector('#om-fab-size').addEventListener('input', function () {
        sheet.querySelector('#om-fab-size-val').textContent = this.value + 'px';
        var m = loadMeta(); m.fabSize = parseInt(this.value); saveMeta(m);
        refreshFab();
    });
    sheet.querySelector('#om-debug').addEventListener('change', function () { var m = loadMeta(); m.debug = this.checked; saveMeta(m); });
    sheet.querySelector('#om-exp').addEventListener('click', function () { fn.exportData(); });
    sheet.querySelector('#om-imp').addEventListener('click', function () { fn.importData(); });
    sheet.querySelector('#om-clear').addEventListener('click', function () {
        var meta = loadMeta();
        var label = meta.currentView === 'char' && meta.currentChar
            ? '「' + (meta.currentChar === SHARED_CHAR_KEY ? SHARED_CHAR_LABEL : charNameById(meta.currentChar)) + '」的穿搭'
            : 'User 的穿搭';
        if (!confirm('确定清空' + label + '？（其他数据不受影响）')) return;
        var curP = loadCurrent();
        curP.outfits = []; curP.categories = []; curP.activeIds = [];
        saveCurrent(curP);
        syncActivePartitions(currentPartKey(), []);
        closeSheet(sheet); fn.renderCatbar(); fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn(); toast('已清空');
    });
    sheet.querySelector('#om-open-cats').addEventListener('click', function () {
        closeSheet(sheet); openCatsSheet(false);
    });
    sheet.querySelector('#om-open-acc-cats').addEventListener('click', function () {
        closeSheet(sheet); openCatsSheet(true);
    });
}

// ── 分类管理 Bottom Sheet ─────────────────────────────────
function openCatsSheet(isAcc) {
    isAcc = !!isAcc;
    var cats = [];
    var catNames = [];
    var viewOutfits = [];
    var viewLabel = '';
    var itemLabel = isAcc ? '单品' : '穿搭';
    var itemUnit = isAcc ? '个' : '套';
    // 折叠状态（面板内部管理，每次打开默认全部折叠）
    var expanded = {};

    function loadCatData() {
        if (isAcc) {
            var p = loadCurrent();
            if (!Array.isArray(p.accCategories)) p.accCategories = [];
            if (!Array.isArray(p.accessories)) p.accessories = [];
            return { raw: p, cats: p.accCategories, items: p.accessories };
        }
        var d = load();
        return { raw: d, cats: getViewCategories(d), items: getViewOutfits(d) };
    }

    function saveCatData(raw, nextCats) {
        if (isAcc) {
            raw.accCategories = nextCats;
            saveCurrent(raw);
            fn.renderAccCatbar();
        } else {
            save(raw);
            fn.renderCatbar();
        }
        fn.renderGrid();
    }

    function refreshLocalData() {
        var data = loadCatData();
        cats = data.cats;
        catNames = getCatNames(cats);
        viewOutfits = data.items;
        if (isAcc) {
            viewLabel = '单品';
        } else {
            var d = data.raw;
            viewLabel = d.currentView === 'char' && d.currentChar ? (d.currentChar === SHARED_CHAR_KEY ? SHARED_CHAR_LABEL : d.currentChar) + '的' : 'User的';
        }
    }

    refreshLocalData();

    function buildList() {
        var listHTML = '';
        if (catNames.length === 0) {
            return '<div class="om-empty"><i class="fa-solid fa-tags"></i><span>还没有分类</span></div>';
        }
        cats.forEach(function (catObj, idx) {
            var catName = typeof catObj === 'object' ? catObj.name : catObj;
            var children = typeof catObj === 'object' ? (catObj.children || []) : [];
            var n = viewOutfits.filter(function (o) { return o.category === catName; }).length;
            var isExpanded = !!expanded[idx];
            var chevron = children.length > 0
                ? '<i class="fa-solid fa-chevron-' + (isExpanded ? 'down' : 'right') + ' om-cat-chevron"></i>'
                : '<span class="om-cat-chevron-placeholder"></span>';
            listHTML += '<div class="om-cat-item om-cat-parent" data-idx="' + idx + '">' +
                chevron +
                '<span class="om-cat-name" style="font-weight:600">' + esc(catName) + '</span><span class="om-cat-count">' + n + itemUnit + '</span>' +
                '<button class="om-btn-sm om-cat-addsub" data-idx="' + idx + '" title="添加子分类"><i class="fa-solid fa-plus"></i></button>' +
                '<button class="om-btn-sm om-cat-ren" data-idx="' + idx + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="om-btn-sm om-cat-del" data-idx="' + idx + '" title="删除"><i class="fa-solid fa-trash"></i></button></div>';
            // 子分类（仅展开时显示）
            if (isExpanded) {
                children.forEach(function (sc, si) {
                    var sn = viewOutfits.filter(function (o) { return o.category === catName && o.subCategory === sc; }).length;
                    listHTML += '<div class="om-cat-item om-cat-child" style="padding-left:32px;opacity:.85"><span class="om-cat-name"><i class="fa-solid fa-turn-up fa-rotate-90" style="font-size:.6em;opacity:.3;margin-right:6px"></i>' + esc(sc) + '</span><span class="om-cat-count">' + sn + itemUnit + '</span>' +
                        '<button class="om-btn-sm om-subcat-ren" data-pidx="' + idx + '" data-sidx="' + si + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                        '<button class="om-btn-sm om-subcat-del" data-pidx="' + idx + '" data-sidx="' + si + '" title="删除"><i class="fa-solid fa-trash"></i></button></div>';
                });
            }
        });
        return listHTML;
    }

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-tags"></i>' + esc(viewLabel) + '分类管理</div>',
        '<div id="om-cats-list">' + buildList() + '</div>',
        '<div class="om-divider"></div>',
        '<div class="om-cat-add-row"><input type="text" id="om-newcat" placeholder="新分类名称…" /><button class="om-btn om-btn-safe" id="om-newadd">添加</button></div>',
    ].join(''));

    function rebindEvents() {
        var listEl = sheet.querySelector('#om-cats-list');
        if (!listEl) return;
        listEl.innerHTML = buildList();

        // 点击父分类行折叠/展开
        listEl.querySelectorAll('.om-cat-parent').forEach(function (row) {
            row.addEventListener('click', function (e) {
                // 不拦截按钮点击
                if (e.target.closest('.om-btn-sm')) return;
                var idx = parseInt(row.dataset.idx);
                var catObj = cats[idx];
                var children = typeof catObj === 'object' ? (catObj.children || []) : [];
                if (children.length === 0) return; // 无子分类不响应
                expanded[idx] = !expanded[idx];
                rebindEvents();
            });

            // 有子分类的父行显示 pointer
            var idx2 = parseInt(row.dataset.idx);
            var catObj2 = cats[idx2];
            var children2 = typeof catObj2 === 'object' ? (catObj2.children || []) : [];
            if (children2.length > 0) row.style.cursor = 'pointer';
        });

        // 添加子分类
        listEl.querySelectorAll('.om-cat-addsub').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats;
                var idx = parseInt(btn.dataset.idx);
                var catObj = vc[idx]; if (!catObj || typeof catObj !== 'object') return;
                var scName = prompt('为「' + catObj.name + '」添加子分类：'); if (!scName || !scName.trim()) return; scName = scName.trim();
                if (!catObj.children) catObj.children = [];
                if (catObj.children.indexOf(scName) !== -1) { toast('子分类已存在', true); return; }
                catObj.children.push(scName); saveCatData(data.raw, vc);
                // 更新本地引用并展开
                refreshLocalData();
                expanded[idx] = true;
                rebindEvents();
                toast('子分类「' + scName + '」已添加');
            });
        });

        // 父分类重命名
        listEl.querySelectorAll('.om-cat-ren').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats; var vo = data.items;
                var idx = parseInt(btn.dataset.idx);
                var catObj = vc[idx]; if (!catObj) return;
                var old = typeof catObj === 'object' ? catObj.name : catObj;
                var nw = prompt('重命名（原：' + old + '）：', old); if (!nw || !nw.trim() || nw.trim() === old) return;
                nw = nw.trim();
                if (typeof catObj === 'object') catObj.name = nw; else vc[idx] = { name: nw, children: [] };
                vo.forEach(function (o) { if (o.category === old) o.category = nw; });
                saveCatData(data.raw, vc);
                refreshLocalData();
                rebindEvents();
                toast('已重命名');
            });
        });

        // 父分类删除
        listEl.querySelectorAll('.om-cat-del').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats; var vo = data.items;
                var idx = parseInt(btn.dataset.idx);
                var catObj = vc[idx]; if (!catObj) return;
                var catName = typeof catObj === 'object' ? catObj.name : catObj;
                if (!confirm('删除分类「' + catName + '」及其所有子分类？（' + itemLabel + '不会被删除）')) return;
                vc.splice(idx, 1);
                vo.forEach(function (o) { if (o.category === catName) { o.category = ''; o.subCategory = ''; } });
                if (isAcc) {
                    if (state.accCat === catName) { state.accCat = '__all__'; state.accDrillParent = null; state.accSubCat = null; }
                } else if (state.curCat === catName) {
                    state.curCat = '__all__'; state.catDrillParent = null; state.curSubCat = null;
                }
                saveCatData(data.raw, vc);
                refreshLocalData();
                // 移除已删除索引的展开状态
                delete expanded[idx];
                rebindEvents();
                toast('已删除');
            });
        });

        // 子分类重命名
        listEl.querySelectorAll('.om-subcat-ren').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats; var vo = data.items;
                var pidx = parseInt(btn.dataset.pidx); var sidx = parseInt(btn.dataset.sidx);
                var catObj = vc[pidx]; if (!catObj || typeof catObj !== 'object') return;
                var old = catObj.children[sidx];
                var nw = prompt('重命名子分类（原：' + old + '）：', old); if (!nw || !nw.trim() || nw.trim() === old) return;
                nw = nw.trim(); catObj.children[sidx] = nw;
                vo.forEach(function (o) { if (o.category === catObj.name && o.subCategory === old) o.subCategory = nw; });
                saveCatData(data.raw, vc);
                refreshLocalData();
                rebindEvents();
                toast('已重命名');
            });
        });

        // 子分类删除
        listEl.querySelectorAll('.om-subcat-del').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats; var vo = data.items;
                var pidx = parseInt(btn.dataset.pidx); var sidx = parseInt(btn.dataset.sidx);
                var catObj = vc[pidx]; if (!catObj || typeof catObj !== 'object') return;
                var scName = catObj.children[sidx];
                if (!confirm('删除子分类「' + scName + '」？（' + itemLabel + '不会被删除）')) return;
                catObj.children.splice(sidx, 1);
                vo.forEach(function (o) { if (o.category === catObj.name && o.subCategory === scName) o.subCategory = ''; });
                saveCatData(data.raw, vc);
                refreshLocalData();
                rebindEvents();
                toast('已删除');
            });
        });
    }

    rebindEvents();

    var inp = sheet.querySelector('#om-newcat');
    sheet.querySelector('#om-newadd').addEventListener('click', function () {
        var name = inp.value.trim(); if (!name) return;
        var data = loadCatData(); var vc = data.cats;
        var names = getCatNames(vc);
        if (names.indexOf(name) !== -1) { toast('分类已存在', true); return; }
        vc.push({ name: name, children: [] }); saveCatData(data.raw, vc);
        refreshLocalData();
        inp.value = '';
        rebindEvents();
        toast('分类「' + name + '」已添加');
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sheet.querySelector('#om-newadd').click(); });
}

// ── Bottom Sheet 通用创建/关闭 ───────────────────────────
function createSheet(contentHtml) {
    var ov = document.createElement('div');
    ov.className = 'om-sheet-overlay';
    ov.innerHTML = '<div class="om-sheet"><div class="om-sheet-handle"></div><div class="om-sheet-content">' + contentHtml + '</div></div>';
    getPopupLayer().appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSheet(ov); });
    return ov;
}

function closeSheet(ov) {
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
}

// ── 全屏 Lightbox ─────────────────────────────────────────
function openLightbox(outfits, startId) {
    if (!outfits || outfits.length === 0) return;
    // 扁平化：每套穿搭的每张图作为一个条目（单品单图也兼容）
    var items = [];
    outfits.forEach(function (o) {
        var imgs = getOutfitImages(o);
        imgs.forEach(function (img, k) {
            var label = imgs.length > 1 ? ((o.name || '') + ' (' + (k + 1) + '/' + imgs.length + ')') : (o.name || '');
            items.push({ name: label, imageData: img, outfitId: o.id });
        });
    });
    if (items.length === 0) return;
    var idx = 0;
    for (var i = 0; i < items.length; i++) { if (items[i].outfitId === startId) { idx = i; break; } }

    var lb = document.createElement('div');
    lb.id = 'om-lightbox';
    lb.className = 'om-lightbox';
    lb.style.cssText = 'position:fixed !important;inset:0 !important;z-index:2147483600 !important;pointer-events:auto !important;background:rgba(0,0,0,.92) !important;display:flex !important;align-items:center !important;justify-content:center !important;';

    function render() {
        var it = items[idx];
        lb.innerHTML =
            '<button class="om-lb-close" id="om-lb-close"><i class="fa-solid fa-xmark"></i></button>' +
            '<div class="om-lb-name">' + esc(it.name) + '</div>' +
            (items.length > 1 ? '<button class="om-lb-nav om-lb-prev" id="om-lb-prev"><i class="fa-solid fa-chevron-left"></i></button>' : '') +
            '<img class="om-lb-img" src="' + it.imageData + '" draggable="false" />' +
            (items.length > 1 ? '<button class="om-lb-nav om-lb-next" id="om-lb-next"><i class="fa-solid fa-chevron-right"></i></button>' : '') +
            (items.length > 1 ? '<div class="om-lb-counter">' + (idx + 1) + ' / ' + items.length + '</div>' : '');
        lb.querySelector('#om-lb-close').addEventListener('click', closeLb);
        var prev = lb.querySelector('#om-lb-prev'); var next = lb.querySelector('#om-lb-next');
        if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx - 1 + items.length) % items.length; render(); });
        if (next) next.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx + 1) % items.length; render(); });
    }
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
    function closeLb() { if (lb.parentNode) lb.parentNode.removeChild(lb); document.removeEventListener('keydown', keyH); }
    function keyH(e) {
        if (e.key === 'Escape') closeLb();
        else if (e.key === 'ArrowLeft' && items.length > 1) { idx = (idx - 1 + items.length) % items.length; render(); }
        else if (e.key === 'ArrowRight' && items.length > 1) { idx = (idx + 1) % items.length; render(); }
    }
    document.addEventListener('keydown', keyH);
    render();
    // 挂到 body 上：挂进插件弹层会被对话区盖住
    document.body.appendChild(lb);
    lb.style.setProperty('pointer-events', 'auto', 'important');
}

// ── 单品操作菜单 ─────────────────────────────────────────
function openAccContextMenu(acc) {
    if (!acc) return;
    var selected = fn.draftHasAcc ? fn.draftHasAcc(acc.id) : false;
    var sheet = createSheet([
        '<div class="om-ctx-outfit-name"><i class="fa-solid fa-gem" style="margin-right:6px;opacity:.5;"></i>' + esc(acc.name) + '</div>',
        selected
            ? '<div class="om-ctx-item" id="om-accctx-wear"><i class="fa-solid fa-circle-xmark"></i>取消选择</div>'
            : '<div class="om-ctx-item" id="om-accctx-wear"><i class="fa-solid fa-circle-check"></i>选择单品</div>',
        acc.imageData ? '<div class="om-ctx-item" id="om-accctx-view"><i class="fa-solid fa-expand"></i>查看大图</div>' : '',
        '<div class="om-ctx-item" id="om-accctx-edit"><i class="fa-solid fa-pen"></i>编辑</div>',
        '<div class="om-ctx-item" id="om-accctx-move"><i class="fa-solid fa-arrow-right-arrow-left"></i>移动到…</div>',
        acc.imageData ? '<div class="om-ctx-item" id="om-accctx-aidesc"><i class="fa-solid fa-wand-magic-sparkles"></i>AI 生成描述</div>' : '',
        '<div class="om-ctx-item danger" id="om-accctx-del"><i class="fa-solid fa-trash"></i>删除</div>',
    ].join(''));

    var wearEl = sheet.querySelector('#om-accctx-wear');
    if (wearEl) wearEl.addEventListener('click', function () {
        closeSheet(sheet);
        if (fn.toggleDraftAcc) fn.toggleDraftAcc(acc.id);
    });

    var editEl = sheet.querySelector('#om-accctx-edit');
    if (editEl) editEl.addEventListener('click', function () {
        closeSheet(sheet);
        openAccEditSheet(acc, acc.category || '');
    });

    var viewEl = sheet.querySelector('#om-accctx-view');
    if (viewEl) viewEl.addEventListener('click', function () {
        closeSheet(sheet);
        openLightbox([acc], acc.id);
    });

    var aiEl = sheet.querySelector('#om-accctx-aidesc');
    if (aiEl) aiEl.addEventListener('click', function () {
        var m = loadMeta();
        if (!m.apiVision.endpoint || !m.apiVision.key || !m.apiVision.model) {
            toast('请先在设置中配置"描述生成 API"', true); closeSheet(sheet); return;
        }
        closeSheet(sheet);
        toast('正在生成单品描述...');
        generateSingleAccDescription(acc, function (err, result) {
            if (err) { toast('生成失败：' + err, true); return; }
            var curP = loadCurrent();
            var target = partGetAccById(curP, acc.id);
            if (!target) { toast('未找到单品数据', true); return; }
            if (result.description) target.description = result.description;
            if (result.name && result.name.trim()) target.name = result.name.trim();
            saveCurrent(curP);
            fn.renderGrid();
            toast('✅ 已生成：' + target.name);
        });
    });

    var moveEl = sheet.querySelector('#om-accctx-move');
    if (moveEl) moveEl.addEventListener('click', function () {
        closeSheet(sheet);
        if (fn.openAccMoveToPanel) {
            fn.openAccMoveToPanel([acc.id], function () {
                fn.renderAccCatbar();
                fn.renderGrid();
                fn.renderBottomStatus();
            });
        }
    });

    var delEl = sheet.querySelector('#om-accctx-del');
    if (delEl) delEl.addEventListener('click', function () {
        closeSheet(sheet);
        if (!confirm('确定删除单品「' + acc.name + '」？\n引用此单品的套装方案将自动移除该单品。')) return;
        var curP = loadCurrent();
        curP.accessories = (curP.accessories || []).filter(function (a) { return a.id !== acc.id; });
        cleanAccIdFromKits(curP, acc.id);
        if (state.kitFocusPartKey === currentPartKey()) {
            state.kitDraftAccIds = (state.kitDraftAccIds || []).filter(function (id) { return id !== acc.id; });
        }
        saveCurrent(curP);
        fn.renderAccCatbar(); fn.renderGrid(); fn.renderBottomStatus(); toast('已删除');
    });
}

// ── 单品批量导入弹窗 ─────────────────────────────────────
function openAccBatchImportModal(files, defaultCat, defaultSubCat) {
    files = (files || []).filter(function (f) { return f && f.type && f.type.indexOf('image') === 0; });
    if (files.length === 0) { toast('未选择图片', true); return; }

    var targetPartKey = currentPartKey();
    var curP = loadPartition(targetPartKey);
    var meta = loadMeta();
    var cats = curP.accCategories || [];
    var catNames = getCatNames(cats);
    var catOpts = '<option value="">无分类</option>' +
        catNames.map(function (c) { return '<option value="' + esc(c) + '"' + (c === defaultCat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var subCats = defaultCat ? getSubCats(cats, defaultCat) : [];
    var subOpts = '<option value="">无子分类</option>' +
        subCats.map(function (sc) { return '<option value="' + esc(sc) + '"' + (sc === defaultSubCat ? ' selected' : '') + '>' + esc(sc) + '</option>'; }).join('');
    var hasApi = !!(meta.apiVision.endpoint && meta.apiVision.key && meta.apiVision.model);

    var modal = document.createElement('div');
    modal.className = 'om-modal';
    modal.style.setProperty('z-index', '2147483647', 'important');
    modal.innerHTML = '<div class="om-modal-box" style="background:' + (state.darkMode ? '#1e1e24' : '#ececef') + ';color:' + (state.darkMode ? '#eee' : '#111') + ';max-height:80vh">' +
        '<div class="om-modal-title"><i class="fa-solid fa-images" style="margin-right:6px;color:var(--SmartThemeQuoteColor,#7c6daf)"></i>批量导入单品</div>' +
        '<div style="font-size:.82em;opacity:.7;margin-bottom:8px">已选择 ' + files.length + ' 张图片，将自动压缩</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;max-height:120px;overflow-y:auto;margin-bottom:10px" id="om-acc-bimport-preview"></div>' +
        '<div class="om-field" style="margin-bottom:8px"><label style="font-size:.82em;font-weight:600">导入到分类</label><select id="om-acc-bimport-cat" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit">' + catOpts + '</select></div>' +
        '<div class="om-field" id="om-acc-bimport-sub-field" style="margin-bottom:8px;' + (defaultCat ? '' : 'display:none;') + '"><label style="font-size:.82em;font-weight:600">导入到子分类</label><select id="om-acc-bimport-sub" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit">' + subOpts + '</select></div>' +
        (hasApi ? '<label style="display:flex;align-items:center;gap:6px;font-size:.82em;cursor:pointer;margin-bottom:6px"><input type="checkbox" id="om-acc-bimport-ai" checked /> 导入后自动 AI 生成描述和名称</label>' : '<div style="font-size:.78em;opacity:.4;margin-bottom:6px">配置"描述生成 API"后可自动生成描述和名称</div>') +
        '<div id="om-acc-bimport-hint" style="display:none;color:#e57373;font-size:.78em;margin-bottom:8px">请先选择单品分类，再生成 AI 描述和名称</div>' +
        '<div id="om-acc-bimport-status" style="display:none;margin:8px 0;font-size:.82em"></div>' +
        '<div class="om-btn-row" style="margin-top:6px" id="om-acc-bimport-actions">' +
        '<button class="om-btn om-btn-safe" id="om-acc-bimport-start"><i class="fa-solid fa-file-import"></i> 开始导入</button>' +
        '<button class="om-btn om-btn-outline" id="om-acc-bimport-close">取消</button></div></div>';

    var _mp = getPopupLayer();
    modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
    _mp.appendChild(modal);

    modal.addEventListener('click', function (e) { if (e.target === modal && !modal.dataset.running) _mp.removeChild(modal); });
    modal.querySelector('#om-acc-bimport-close').addEventListener('click', function () { if (!modal.dataset.running) _mp.removeChild(modal); });

    var previewEl = modal.querySelector('#om-acc-bimport-preview');
    files.forEach(function (f) {
        var thumb = document.createElement('div');
        thumb.style.cssText = 'width:52px;height:52px;border-radius:6px;overflow:hidden;background:rgba(127,127,127,.1);flex-shrink:0;';
        var reader = new FileReader();
        reader.onload = function (e) { thumb.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover" />'; };
        reader.readAsDataURL(f);
        previewEl.appendChild(thumb);
    });

    modal.querySelector('#om-acc-bimport-cat').addEventListener('change', function () {
        var parentVal = this.value;
        var subField = modal.querySelector('#om-acc-bimport-sub-field');
        var subSel = modal.querySelector('#om-acc-bimport-sub');
        var hint = modal.querySelector('#om-acc-bimport-hint');
        if (hint) hint.style.display = 'none';
        if (!parentVal) {
            subField.style.display = 'none';
            subSel.innerHTML = '<option value="">无子分类</option>';
            return;
        }
        var cp = loadPartition(targetPartKey);
        var subs = getSubCats(cp.accCategories || [], parentVal);
        subSel.innerHTML = '<option value="">无子分类</option>' +
            subs.map(function (sc) { return '<option value="' + esc(sc) + '">' + esc(sc) + '</option>'; }).join('');
        subField.style.display = '';
    });

    modal.querySelector('#om-acc-bimport-start').addEventListener('click', function () {
        var cat = modal.querySelector('#om-acc-bimport-cat').value;
        var subCat = modal.querySelector('#om-acc-bimport-sub') ? modal.querySelector('#om-acc-bimport-sub').value || '' : '';
        var useAI = hasApi && modal.querySelector('#om-acc-bimport-ai') && modal.querySelector('#om-acc-bimport-ai').checked;
        var hintEl = modal.querySelector('#om-acc-bimport-hint');
        if (useAI && !cat) {
            if (hintEl) hintEl.style.display = 'block';
            return;
        }
        if (hintEl) hintEl.style.display = 'none';

        modal.dataset.running = '1';
        modal.querySelector('#om-acc-bimport-start').disabled = true;
        modal.querySelector('#om-acc-bimport-start').textContent = '导入中...';
        modal.querySelector('#om-acc-bimport-close').textContent = '请等待...';
        var statusEl = modal.querySelector('#om-acc-bimport-status');
        statusEl.style.display = 'block';

        var baseCount = (loadPartition(targetPartKey).accessories || []).length;
        var importedAccs = [];
        var newIds = [];

        function prepareImageForStorage(compressed, idx, cb) {
            if (!isServerMode()) { cb(null, compressed); return; }
            statusEl.textContent = '上传中... ' + (idx + 1) + '/' + files.length;
            uploadImage(compressed, function (err, imageData) {
                if (err || !imageData || imageData.indexOf('data:image/') === 0) {
                    cb('图片上传失败/后端写入失败');
                    return;
                }
                cb(null, imageData);
            });
        }

        function showImportFailure(msg) {
            var text = msg || '保存失败/空间不足/后端写入失败';
            delete modal.dataset.running;
            statusEl.innerHTML = '<div style="color:#e57373">' + esc(text) + '</div>';
            toast(text, true);
            modal.querySelector('#om-acc-bimport-start').disabled = false;
            modal.querySelector('#om-acc-bimport-start').textContent = '重新导入';
            modal.querySelector('#om-acc-bimport-close').textContent = '取消';
        }

        function verifyImportedIds(ids) {
            var savedPart = loadPartition(targetPartKey);
            var accs = savedPart.accessories || [];
            for (var v = 0; v < ids.length; v++) {
                var found = false;
                for (var a = 0; a < accs.length; a++) {
                    if (accs[a].id === ids[v]) { found = true; break; }
                }
                if (!found) return false;
            }
            return true;
        }

        function finishImport() {
            var importedList = importedAccs.filter(function (a) { return !!a; });
            var idList = newIds.filter(function (id) { return !!id; });
            if (importedList.length === 0) {
                showImportFailure('图片读取或上传失败');
                return;
            }
            var p = loadPartition(targetPartKey);
            if (!Array.isArray(p.accessories)) p.accessories = [];
            p.accessories = importedList.concat(p.accessories);
            savePartition(targetPartKey, p);
            if (!verifyImportedIds(idList)) {
                showImportFailure('保存失败/空间不足/后端写入失败');
                return;
            }
            fn.renderAccCatbar(); fn.renderGrid();
            statusEl.innerHTML = '<div style="color:#4caf50;font-weight:600">已导入 ' + importedList.length + ' 个单品</div>';
            if (useAI && fn.openAccBatchDescModal) {
                _mp.removeChild(modal);
                fn.openAccBatchDescModal(idList);
            } else {
                delete modal.dataset.running;
                modal.querySelector('#om-acc-bimport-actions').innerHTML = '<button class="om-btn om-btn-safe" id="om-acc-bimport-done">完成</button>';
                modal.querySelector('#om-acc-bimport-done').addEventListener('click', function () { _mp.removeChild(modal); });
            }
        }

        function processNext(idx) {
            if (idx >= files.length) { finishImport(); return; }
            statusEl.textContent = '压缩中... ' + (idx + 1) + '/' + files.length;
            var reader = new FileReader();
            reader.onload = function (e) {
                compressImage(e.target.result, function (compressed) {
                    prepareImageForStorage(compressed, idx, function (err, imageData) {
                        if (!err) {
                            var id = 'a_' + genId().substring(0, 8);
                            importedAccs[idx] = {
                                id: id,
                                name: '单品' + (baseCount + idx + 1),
                                category: cat,
                                subCategory: subCat,
                                description: '',
                                imageData: imageData,
                                createdAt: Date.now()
                            };
                            newIds[idx] = id;
                        }
                        processNext(idx + 1);
                    });
                });
            };
            reader.onerror = function () {
                processNext(idx + 1);
            };
            reader.readAsDataURL(files[idx]);
        }
        processNext(0);
    });
}

// ── 单品编辑弹窗 ─────────────────────────────────────────
function openAccEditSheet(acc, defaultCat) {
    var editImgData = acc ? (acc.imageData || null) : null;
    var curPart = loadCurrent();
    var accCats = curPart.accCategories || [];
    var catNames = getCatNames(accCats);
    var catOpts = '<option value="">无分类</option>' +
        catNames.map(function (c) { return '<option value="' + esc(c) + '"' + (acc && acc.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');

    var curParent = acc ? (acc.category || '') : (defaultCat || '');
    var curSub = acc ? (acc.subCategory || '') : '';
    var subCats = curParent ? getSubCats(accCats, curParent) : [];
    var subDisplay = curParent ? '' : 'display:none;';
    var subOpts = '<option value="">无子分类</option>' +
        subCats.map(function (sc) { return '<option value="' + esc(sc) + '"' + (sc === curSub ? ' selected' : '') + '>' + esc(sc) + '</option>'; }).join('');

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-' + (acc ? 'pen' : 'plus') + '"></i>' + (acc ? '编辑单品' : '添加单品') + '</div>',
        '<div class="om-field"><label>单品名称 *</label><input type="text" id="om-acc-dn" placeholder="如：黑色贝雷帽" value="' + esc(acc ? acc.name : '') + '" /></div>',
        '<div class="om-field"><label>分类 <span class="om-hint">分类名将作为注入标签</span></label><div class="om-frow"><select id="om-acc-dcat">' + catOpts + '</select><button class="om-btn om-btn-outline" id="om-acc-dnewcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
        '<div class="om-field" id="om-acc-subcat-field" style="' + subDisplay + '"><label>子分类</label><div class="om-frow"><select id="om-acc-dsubcat">' + subOpts + '</select><button class="om-btn om-btn-outline" id="om-acc-dnewsubcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
        '<div class="om-field"><label>文字描述 <span class="om-hint">AI 注入用，越详细越好</span></label><textarea id="om-acc-ddesc" rows="4" placeholder="如：黑色羊毛贝雷帽，帽檐微微偏右，帽身有一枚复古金属别针……">' + esc(acc ? acc.description || '' : '') + '</textarea>' +
        '<button class="om-btn om-btn-outline" id="om-acc-dai" style="font-size:.78em;margin-top:5px;align-self:flex-start"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述</button></div>',
        '<div class="om-field"><label>参考图片 <span class="om-hint">可选，自动压缩</span></label>',
        '<div class="om-imgarea" id="om-acc-dimgarea">' + (editImgData ? '<img src="' + editImgData + '" />' : '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传</span></div>') + '</div>',
        '<input type="file" id="om-acc-dfile-album" accept="image/*" style="display:none" />',
        '<input type="file" id="om-acc-dfile-any" style="display:none" />',
        '<div class="om-img-actions"><button class="om-btn om-btn-outline" id="om-acc-dpick" style="font-size:.8em"><i class="fa-solid fa-image"></i> 导入图片</button>' +
        (!acc ? '<button class="om-btn om-btn-outline" id="om-acc-dbatch" style="font-size:.8em"><i class="fa-solid fa-images"></i> 批量导入</button>' : '') +
        (editImgData ? '<button class="om-btn om-btn-danger" id="om-acc-dclr" style="font-size:.8em">删除图片</button>' : '') + '</div></div>',
        '<input type="file" id="om-acc-dbatchfile-album" accept="image/*" multiple style="display:none" />',
        '<input type="file" id="om-acc-dbatchfile-any" multiple style="display:none" />',
        '<div class="om-edit-foot"><button class="om-btn om-btn-outline" id="om-acc-dcancel">取消</button><button class="om-btn om-btn-safe" id="om-acc-dsave">保存</button></div>',
    ].join(''));

    // 默认分类
    if (defaultCat) {
        var sel = sheet.querySelector('#om-acc-dcat'); if (sel) sel.value = defaultCat;
    }

    // 父分类联动子分类
    sheet.querySelector('#om-acc-dcat').addEventListener('change', function () {
        var parentVal = this.value;
        var subField = sheet.querySelector('#om-acc-subcat-field');
        var subSel = sheet.querySelector('#om-acc-dsubcat');
        if (!parentVal) {
            subField.style.display = 'none';
            subSel.innerHTML = '<option value="">无子分类</option>';
            return;
        }
        // 有父分类就始终显示子分类区域（方便新建）
        subField.style.display = '';
        var cp = loadCurrent();
        var subs = getSubCats(cp.accCategories || [], parentVal);
        subSel.innerHTML = '<option value="">无子分类</option>' +
            subs.map(function (sc) { return '<option value="' + esc(sc) + '">' + esc(sc) + '</option>'; }).join('');
    });

    // 图片处理
    var albumInp = sheet.querySelector('#om-acc-dfile-album');
    var fileInp = sheet.querySelector('#om-acc-dfile-any');
    var imgArea = sheet.querySelector('#om-acc-dimgarea');
    function setImg(data) {
        editImgData = data;
        imgArea.innerHTML = data ? '<img src="' + data + '" />' : '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传</span></div>';
        var clrOld = sheet.querySelector('#om-acc-dclr'); var acts = sheet.querySelector('.om-img-actions');
        if (data && !clrOld && acts) {
            var b2 = document.createElement('button'); b2.className = 'om-btn om-btn-danger'; b2.id = 'om-acc-dclr'; b2.style.fontSize = '.8em'; b2.textContent = '删除图片';
            b2.addEventListener('click', function () { setImg(null); }); acts.appendChild(b2);
        } else if (!data && clrOld) clrOld.parentNode.removeChild(clrOld);
    }
    function handleFile(f) {
        if (!isImageFile(f)) { toast('请选择图片文件', true); return; }
        var r = new FileReader(); r.onload = function (e) { compressImage(e.target.result, function (c) { setImg(c); }); }; r.readAsDataURL(f);
    }
    function bindSingleAccImageInput(inp) {
        if (!inp) return;
        inp.addEventListener('change', function () {
            var files = getPickedImageFiles(inp.files);
            if (files[0]) handleFile(files[0]);
            else if (inp.files && inp.files.length) toast('请选择图片文件', true);
            inp.value = '';
        });
    }
    function openSingleAccImagePicker() {
        openImageSourcePicker('导入图片', function () { albumInp.click(); }, function () { fileInp.click(); });
    }
    sheet.querySelector('#om-acc-dpick').addEventListener('click', openSingleAccImagePicker);
    imgArea.addEventListener('click', openSingleAccImagePicker);
    bindSingleAccImageInput(albumInp);
    bindSingleAccImageInput(fileInp);
    imgArea.addEventListener('dragover', function (e) { e.preventDefault(); imgArea.classList.add('drag'); });
    imgArea.addEventListener('dragleave', function () { imgArea.classList.remove('drag'); });
    imgArea.addEventListener('drop', function (e) { e.preventDefault(); imgArea.classList.remove('drag'); if (e.dataTransfer) handleFile(getPickedImageFiles(e.dataTransfer.files)[0]); });
    var clr = sheet.querySelector('#om-acc-dclr'); if (clr) clr.addEventListener('click', function () { setImg(null); });

    var accAiBtn = sheet.querySelector('#om-acc-dai');
    if (accAiBtn) accAiBtn.addEventListener('click', function () {
        if (!editImgData) { toast('请先上传图片', true); return; }
        var cat = sheet.querySelector('#om-acc-dcat').value || '单品';
        var tempAcc = {
            imageData: editImgData,
            category: cat,
            name: sheet.querySelector('#om-acc-dn').value.trim() || ''
        };
        accAiBtn.disabled = true;
        accAiBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
        generateSingleAccDescription(tempAcc, function (err, result) {
            accAiBtn.disabled = false;
            accAiBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述';
            if (err) { toast('生成失败：' + err, true); return; }
            if (result.description) sheet.querySelector('#om-acc-ddesc').value = result.description;
            var nameInp = sheet.querySelector('#om-acc-dn');
            if (result.name && !nameInp.value.trim()) nameInp.value = result.name;
            toast('✨ 描述已生成');
        });
    });

    // 批量导入按钮
    var accBatchBtn = sheet.querySelector('#om-acc-dbatch');
    var accBatchAlbumInp = sheet.querySelector('#om-acc-dbatchfile-album');
    var accBatchFileInp = sheet.querySelector('#om-acc-dbatchfile-any');
    if (accBatchBtn) accBatchBtn.addEventListener('click', function () {
        openImageSourcePicker('批量导入', function () { accBatchAlbumInp.click(); }, function () { accBatchFileInp.click(); });
    });
    function bindAccBatchImageInput(inp) {
        if (!inp) return;
        inp.addEventListener('change', function () {
            var files = getPickedImageFiles(inp.files);
            if (files.length === 0) { toast('未选择图片', true); inp.value = ''; return; }
            var cat = sheet.querySelector('#om-acc-dcat').value || '';
            var subCat = sheet.querySelector('#om-acc-dsubcat') ? sheet.querySelector('#om-acc-dsubcat').value || '' : '';
            closeSheet(sheet);
            openAccBatchImportModal(files, cat, subCat);
            inp.value = '';
        });
    }
    bindAccBatchImageInput(accBatchAlbumInp);
    bindAccBatchImageInput(accBatchFileInp);

    // 新建分类
    sheet.querySelector('#om-acc-dnewcat').addEventListener('click', function () {
        var name = prompt('新单品分类名称：'); if (!name || !name.trim()) return; name = name.trim();
        var cp = loadCurrent();
        if (!Array.isArray(cp.accCategories)) cp.accCategories = [];
        var names = getCatNames(cp.accCategories);
        if (names.indexOf(name) === -1) { cp.accCategories.push({ name: name, children: [] }); saveCurrent(cp); fn.renderAccCatbar(); }
        var sel = sheet.querySelector('#om-acc-dcat');
        var ex = false; for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === name) { ex = true; break; } }
        if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel.appendChild(opt); }
        sel.value = name;
        sel.dispatchEvent(new Event('change'));
        toast('分类「' + name + '」已添加');
    });

    // 新建子分类
    sheet.querySelector('#om-acc-dnewsubcat').addEventListener('click', function () {
        var parentVal = sheet.querySelector('#om-acc-dcat').value;
        if (!parentVal) { toast('请先选择父分类', true); return; }
        var scName = prompt('新子分类名称（属于「' + parentVal + '」）：'); if (!scName || !scName.trim()) return; scName = scName.trim();
        var cp = loadCurrent();
        var catObj = findCatObj(cp.accCategories || [], parentVal);
        if (catObj) {
            if (!catObj.children) catObj.children = [];
            if (catObj.children.indexOf(scName) === -1) { catObj.children.push(scName); saveCurrent(cp); fn.renderAccCatbar(); }
        }
        var subSel = sheet.querySelector('#om-acc-dsubcat');
        var ex2 = false; for (var j = 0; j < subSel.options.length; j++) { if (subSel.options[j].value === scName) { ex2 = true; break; } }
        if (!ex2) { var opt2 = document.createElement('option'); opt2.value = scName; opt2.textContent = scName; subSel.appendChild(opt2); }
        subSel.value = scName;
        sheet.querySelector('#om-acc-subcat-field').style.display = '';
        toast('子分类「' + scName + '」已添加');
    });

    sheet.querySelector('#om-acc-dcancel').addEventListener('click', function () { closeSheet(sheet); });
    sheet.querySelector('#om-acc-dsave').addEventListener('click', function () {
        var name = sheet.querySelector('#om-acc-dn').value.trim();
        if (!name) { toast('请输入单品名称', true); return; }
        var cat = sheet.querySelector('#om-acc-dcat').value;
        var subCat = sheet.querySelector('#om-acc-dsubcat').value;
        var desc = sheet.querySelector('#om-acc-ddesc').value.trim();
        var curP = loadCurrent();
        if (!Array.isArray(curP.accessories)) curP.accessories = [];
        if (acc) {
            for (var i = 0; i < curP.accessories.length; i++) {
                if (curP.accessories[i].id === acc.id) {
                    Object.assign(curP.accessories[i], { name: name, category: cat, subCategory: subCat, description: desc, imageData: editImgData });
                    break;
                }
            }
        } else {
            curP.accessories.unshift({ id: 'a_' + genId().substring(0, 8), name: name, category: cat, subCategory: subCat, description: desc, imageData: editImgData, createdAt: Date.now() });
        }
        saveCurrent(curP); closeSheet(sheet); toast('✨ 已保存：' + name); fn.renderAccCatbar(); fn.renderGrid();
    });
}

// ── 注册到共享桥 ─────────────────────────────────────────
export { openContextMenu, openEditSheet, openPresetsSheet, openSettingsSheet, openCatsSheet };
export { openAccContextMenu, openAccEditSheet };
export { createSheet, closeSheet, openLightbox, getAllTagSuggestions };

export function registerSheetsFn() {
    fn.openContextMenu = openContextMenu;
    fn.openEditSheet = openEditSheet;
    fn.openAccContextMenu = openAccContextMenu;
    fn.openAccEditSheet = openAccEditSheet;
    fn.openPresetsSheet = openPresetsSheet;
    fn.openSettingsSheet = openSettingsSheet;
    fn.openCatsSheet = openCatsSheet;
    fn.openLightbox = openLightbox;
    fn.createSheet = createSheet;
    fn.closeSheet = closeSheet;
}
