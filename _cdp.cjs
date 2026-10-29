const http = require('http');
const { execFile } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const url = 'http://127.0.0.1:8000/';
const child = execFile(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + PORT,
  '--user-data-dir=D:/WorkSpace/RolePlay/酒馆插件开发/Outfit-Manager-main/_chrprof', url], () => {});
const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) { await sleep(500); try { list = JSON.parse(await get('/json/list')); if (list.find(t => t.type === 'page' && t.url.includes('8000'))) break; } catch (e) {} }
  const page = list.find(t => t.type === 'page' && t.url.includes('8000'));
  if (!page) { console.log('no page', JSON.stringify(list && list.map(t => t.url))); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await sleep(6000);
  const expr = `(() => {
    const styleInfo = [];
    for (const ss of document.styleSheets) {
      let rules = null; try { rules = ss.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (const r of rules) {
        const t = r.cssText || '';
        if (t.indexOf('om-act-card') !== -1 || t.indexOf('om-active-win') !== -1) styleInfo.push((ss.ownerNode && ss.ownerNode.tagName) + ' | ' + t.slice(0, 300));
      }
    }
    const host = document.createElement('div');
    host.className = 'om-active-win'; host.id = 'om-active-win';
    host.style.cssText = 'position:static;width:408px';
    host.innerHTML = '<div class="om-act-head"><span class="om-act-title">t</span><span class="om-act-ownerbar">o</span><span class="om-act-count">c</span></div>' +
      '<div class="om-act-body"><div class="om-act-card"><img class="om-act-pic" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"><span class="om-act-idx">01</span><div class="om-act-info"><div class="om-act-name">n</div><div class="om-act-tags">tg</div></div></div></div>';
    document.body.appendChild(host);
    const card = host.querySelector('.om-act-card');
    const pic = host.querySelector('.om-act-pic');
    const info = host.querySelector('.om-act-info');
    const cs = e => { const s = getComputedStyle(e); return { h: s.height, w: s.width, ar: s.aspectRatio, pos: s.position, ov: s.overflow, disp: s.display, bottom: s.bottom }; };
    return JSON.stringify({ styleRules: styleInfo.slice(0, 6), card: cs(card), pic: cs(pic), info: cs(info), sheets: document.styleSheets.length }, null, 1);
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(r.result && r.result.result ? r.result.result.value : JSON.stringify(r).slice(0, 800));
  ws.close(); child.kill();
})();
