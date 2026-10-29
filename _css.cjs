const fs = require('fs');
const P = 'D:/WorkSpace/RolePlay/酒馆插件开发/Outfit-Manager-main/src/styles.js';
let s = fs.readFileSync(P, 'utf8');
const startMark = '/* ── 当前生效穿搭浮窗（左下角） ── */';
const endMark = "'.om-act-compact .om-act-thumb{width:40px;height:56px;},'";
const a = s.indexOf(startMark);
const b = s.indexOf(endMark);
if (a < 0 || b < 0) throw new Error('markers not found');
const bEnd = b + endMark.length;
const block = [
"/* ── 当前生效穿搭浮窗（左下角 · 画报风：图像为主，文字压在底部渐变上） ── */",
"'.om-active-win{position:fixed;left:12px;bottom:12px;z-index:2147483000;',",
"'width:408px;max-height:min(82vh,760px);display:flex;flex-direction:column;',",
"'background:var(--SmartThemeBlurTintColor,rgba(22,21,26,.97));',",
"'backdrop-filter:blur(14px) saturate(125%);border:1px solid rgba(127,127,127,.2);border-radius:16px;',",
"'box-shadow:0 20px 52px rgba(0,0,0,.46);color:var(--SmartThemeBodyColor,#e8e8ec);',",
"'font-size:.86em;overflow:hidden;}',",
"'.om-act-head{display:flex;align-items:center;gap:9px;padding:11px 14px;',",
"'border-bottom:1px solid rgba(127,127,127,.15);flex:0 0 auto;}',",
"'.om-act-title{font-weight:600;font-size:.95em;display:flex;align-items:center;gap:7px;letter-spacing:.02em;}',",
"'.om-act-title i{color:var(--SmartThemeQuoteColor,#7c6daf);}',",
"'.om-act-count{margin-left:auto;font-size:.68em;letter-spacing:.18em;text-transform:uppercase;opacity:.5;}',",
"'.om-act-close{background:none;border:none;color:inherit;opacity:.45;cursor:pointer;',",
"'padding:2px 4px;font-size:.95em;line-height:1;}',",
"'.om-act-close:hover{opacity:1;color:#e57373;}',",
"'.om-act-body{overflow-y:auto;padding:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}',",
"'.om-act-card{position:relative;aspect-ratio:3/4;border-radius:13px;overflow:hidden;cursor:pointer;',",
"'background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.16);',",
"'transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;}',",
"'.om-act-card:hover{transform:translateY(-2px);border-color:rgba(127,127,127,.34);box-shadow:0 14px 28px rgba(0,0,0,.44);}',",
"'.om-act-pic{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;',",
"'transition:transform .55s cubic-bezier(.2,.7,.2,1);}',",
"'.om-act-card:hover .om-act-pic{transform:scale(1.05);}',",
"'.om-act-noimg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.28;font-size:1.9em;}',",
"'.om-act-idx{position:absolute;top:7px;left:10px;font-family:Georgia,\"Times New Roman\",serif;font-style:italic;',",
"'font-size:1.4em;line-height:1;color:rgba(255,255,255,.85);text-shadow:0 1px 10px rgba(0,0,0,.65);pointer-events:none;}',",
"'.om-act-info{position:absolute;left:0;right:0;bottom:0;padding:38px 11px 11px;display:flex;flex-direction:column;gap:3px;',",
"'background:linear-gradient(to top,rgba(9,9,13,.92) 0%,rgba(9,9,13,.74) 44%,rgba(9,9,13,0) 100%);pointer-events:none;}',",
"'.om-act-owner{font-size:.63em;letter-spacing:.17em;text-transform:uppercase;font-weight:600;',",
"'color:rgba(255,255,255,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',",
"'.om-act-name{font-family:Georgia,\"Times New Roman\",\"Songti SC\",serif;font-size:1.03em;font-weight:600;line-height:1.3;',",
"'color:#fff;text-shadow:0 1px 12px rgba(0,0,0,.6);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',",
"'.om-act-tags{font-size:.67em;line-height:1.4;color:rgba(255,255,255,.58);',",
"'display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;}',",
"'.om-act-card-worn{border-color:rgba(124,109,175,.92);',",
"'box-shadow:0 0 0 1px rgba(124,109,175,.55),0 12px 32px rgba(124,109,175,.3);}',",
"'.om-act-wornmark{position:absolute;top:8px;right:8px;width:19px;height:19px;border-radius:50%;',",
"'background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;font-size:9px;display:flex;align-items:center;',",
"'justify-content:center;box-shadow:0 2px 9px rgba(0,0,0,.5);}',",
"'.om-act-worn{font-size:.65em;font-weight:700;letter-spacing:.05em;color:#fff;',",
"'background:var(--SmartThemeQuoteColor,#7c6daf);border-radius:6px;padding:2px 7px;align-self:flex-start;',",
"'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;margin-bottom:2px;}',",
"'.om-act-empty{grid-column:1/-1;padding:30px 12px;text-align:center;opacity:.6;line-height:1.75;}',",
"'.om-act-empty span{font-size:.86em;opacity:.8;}',",
"'.om-active-win.om-act-compact{width:64px;}',",
"'.om-act-compact .om-act-title-txt,.om-act-compact .om-act-count,.om-act-compact .om-act-info,.om-act-compact .om-act-idx{display:none;}',",
"'.om-act-compact .om-act-head{padding:9px 6px;justify-content:center;gap:4px;}',",
"'.om-act-compact .om-act-close{padding:0 2px;font-size:.82em;}',",
"'.om-act-compact .om-act-body{display:flex;flex-direction:column;padding:7px;gap:8px;}',",
"'.om-act-compact .om-act-card{aspect-ratio:2/3;border-radius:8px;}',"
].join('\n            ');
s = s.slice(0, a) + block + s.slice(bEnd);
fs.writeFileSync(P, s);
console.log('css replaced');
