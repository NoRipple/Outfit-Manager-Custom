const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const child = execFile(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=700,900','--remote-debugging-port='+PORT,'--user-data-dir=D:/WorkSpace/RolePlay/酒馆插件开发/Outfit-Manager-main/_chrprof2','http://127.0.0.1:8000/'], ()=>{});
const get = p => new Promise((res,rej)=>http.get({host:'127.0.0.1',port:PORT,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  let list=null;
  for(let i=0;i<40;i++){await sleep(500);try{list=JSON.parse(await get('/json/list'));if(list.find(t=>t.type==='page'&&t.url.includes('8000')))break;}catch(e){}}
  const page=list.find(t=>t.type==='page'&&t.url.includes('8000'));
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0;const pend=new Map();
  const send=(m,p)=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  await send('Runtime.enable'); await sleep(14000);
  const expr = `(async()=>{
    const pr = await fetch('/api/plugins/outfit-manager/partitions/char:c_Gal00001'); if(!pr.ok) return 'HTTP '+pr.status; const jj = await pr.json(); const part = jj.data || jj;
    const ids=(part.activeIds||[]).slice(0,4);
    const items=ids.map(id=>part.outfits.find(o=>o.id===id)).filter(Boolean);
    const t=o=>{const g=o.tags||{};const s=[];if(g.scene&&g.scene.length)s.push(g.scene.join(' / '));if(g.garment&&g.garment.length)s.push(g.garment.slice(0,4).map(x=>x&&x.base?x.base:x).join('、'));if(g.impression&&g.impression.length)s.push(g.impression.slice(0,3).join('、'));return s.join(' ｜ ');};
    const bg=(thumb)=>{const g='linear-gradient(to top,rgba(12,10,14,.95) 0%,rgba(12,10,14,.80) 30%,rgba(12,10,14,.22) 56%,rgba(12,10,14,0) 78%)';return thumb?g+",url('"+thumb+"')":g+',linear-gradient(135deg,#4c4657,#7d7389)';};
    const cards=items.map((o,i)=>{const thumb=(o.thumb||(o.images&&o.images[0])||'');const worn=i===0;
      return '<div class="om-act-card'+(worn?' om-act-card-worn':'')+'" data-idx="'+i+'" style="height:208px;background-image:'+bg(thumb)+';">'
      +'<span class="om-act-idx">0'+(i+1)+'</span>'
      +(worn?'<span class="om-act-wornmark"><i class="fa-solid fa-check"></i></span>':'')
      +'<div class="om-act-info">'+(worn?'<div class="om-act-worn" style="font-size:10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><i class="fa-solid fa-shirt"></i> 本楼穿着 · AI-Costume-Gallery-CN</div>':'')
      +'<div class="om-act-name">'+(o.name||'')+'</div>'+(t(o)?'<div class="om-act-tags">'+t(o)+'</div>':'')+'</div></div>';}).join('');
    const win=document.createElement('div');
    win.className='om-active-win';win.id='om-active-win';win.style.cssText='position:absolute;left:16px;top:20px;width:408px;z-index:2147483000';
    win.innerHTML='<div class="om-act-head"><span class="om-act-title">👕<span class="om-act-title-txt"> 当前生效穿搭</span></span><span class="om-act-ownerbar">AI-COSTUME-GALLERY-CN</span><span class="om-act-count">共 '+items.length+' 套</span><button class="om-act-close">✕</button></div><div class="om-act-body">'+cards+'</div>';
    document.body.appendChild(win); window.scrollTo(0,0);
    await new Promise(r=>setTimeout(r,1500));
    const c=win.querySelector('.om-act-card'); if(!c) return 'nocards'; const cs=getComputedStyle(c); const wr=win.getBoundingClientRect(); const ws2=getComputedStyle(win);
    return JSON.stringify({rect:[wr.x,wr.y,wr.width,wr.height], z:ws2.zIndex, disp:ws2.display, vis:ws2.visibility, op:ws2.opacity, n:items.length, h:cs.height, loadok:[...win.querySelectorAll('.om-act-card')].map(x=>getComputedStyle(x).backgroundImage.slice(0,60))});
  })()`;
  const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
  console.log(JSON.stringify(r.result&&r.result.result&&r.result.result.value||r).slice(0,600));
  const shot=await send('Page.captureScreenshot',{format:'png'});
  if(shot.result&&shot.result.data){fs.writeFileSync('_preview/real1.png',Buffer.from(shot.result.data,'base64'));console.log('shot saved');}
  ws.close();child.kill();
})();
