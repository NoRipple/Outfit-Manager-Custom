// ── 穿搭管理器 · 共享状态桥 ──────────────────────────────
// 各模块注册回调到此处，避免循环依赖
// UI 状态变量也集中存放

export var state = {
    darkMode: false,
    curCat: '__all__',
    curSubCat: null,        // 当前子分类筛选，null=全部（在父分类下）
    catDrillParent: null,   // 分类下钻的父分类名，null=在顶级
    batchMode: false,
    batchSelected: [],
    searchOpen: false,
    searchQuery: '',
    filterOpen: false,
    filterNoCat: false,     // 筛选：未分类
    filterNoTag: false,     // 筛选：无标签
    filterNoDesc: false,    // 筛选：无描述
    detailOpen: false,
    collapsedGroups: {},
    resolvedImages: {},   // server模式下预解析的图片缓存 { outfitId: { url, dataUrl } }
    kitFocusPartKey: null,
    kitFocusOutfitId: null,
    kitDraftAccIds: [],
    kitDraftSourceKitId: null,
    kitDraftDirty: false
};

// 函数注册表：各模块把自己的函数注册进来，其他模块通过 fn.xxx() 调用
export var fn = {};

// ── 图片预解析缓存上限 ──────────────────────────────────
// state.resolvedImages 存的是 base64 data URL（单套多图可达数 MB）。以前只在「穿搭 URL 变了」时才
// 重置，删除的穿搭、换角色后的旧衣柜、批量导入产生的临时 id 都会一直挂在内存里。
// 这里统一按「最近使用」裁剪：超过 RESOLVED_IMAGE_MAX 套就从最久未用的开始丢。
export var RESOLVED_IMAGE_MAX = 120;
var _resolvedTouch = Object.create(null);
var _resolvedSeq = 0;

export function putResolvedImages(id, entry) {
    if (!id) return;
    state.resolvedImages[id] = entry;
    _resolvedTouch[id] = ++_resolvedSeq;
    trimResolvedImages();
}

export function getResolvedImages(id) {
    var e = state.resolvedImages[id];
    if (e) _resolvedTouch[id] = ++_resolvedSeq;
    return e;
}

export function dropResolvedImages(id) {
    if (state.resolvedImages[id]) delete state.resolvedImages[id];
    if (_resolvedTouch[id]) delete _resolvedTouch[id];
}

function trimResolvedImages() {
    var keys = Object.keys(state.resolvedImages);
    if (keys.length <= RESOLVED_IMAGE_MAX) return;
    keys.sort(function (a, b) { return (_resolvedTouch[a] || 0) - (_resolvedTouch[b] || 0); });
    var drop = keys.length - RESOLVED_IMAGE_MAX;
    for (var i = 0; i < drop; i++) dropResolvedImages(keys[i]);
}
