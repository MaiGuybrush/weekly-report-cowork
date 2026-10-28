import json
D = open('../../temp/eng-works-data/CIM2_ENG_WeeklyReport_261022_SEC1.json', encoding='utf8').read()
data = json.dumps(json.loads(D)['results'], ensure_ascii=False)

BASE = r'''
:root{--paper:#eef1ee;--sheet:#fbfcfb;--ink:#18222b;--mute:#5d6b73;--line:#d5dcd8;--line2:#e6ebe8;--steel:#1c5f6b;--steel-d:#12434c;--steel-t:#dcebec;--amber:#d49a00;--amber-t:#fbf0cf;--red:#bf3b32;--red-t:#f8dcd9;--ok:#2f7d4f;--ok-t:#dcefe3;
--num:'Bahnschrift','DIN Alternate','Segoe UI',sans-serif;--txt:'Microsoft JhengHei UI','Microsoft JhengHei','PingFang TC','Noto Sans TC',system-ui,sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 var(--txt)}
button,textarea{font:inherit;color:inherit}:focus-visible{outline:2px solid var(--steel);outline-offset:2px}
.num{font-family:var(--num);font-variant-numeric:tabular-nums}
a.wid{font-family:var(--num);color:var(--steel);text-decoration:none;border-bottom:1px solid transparent}a.wid:hover{border-color:var(--steel)}
.st{display:inline-block;padding:0 .5rem;border-radius:99px;font-size:12px;white-space:nowrap}
.st.done{background:var(--ok-t);color:var(--ok)}.st.doing{background:var(--steel-t);color:var(--steel-d)}.st.wait{background:var(--amber-t);color:#7a5a00}.st.stop{background:var(--red-t);color:var(--red)}
.tag{font-size:11px;padding:0 .4rem;border-radius:3px;border:1px solid var(--line);color:var(--mute)}.tag.long{border-color:var(--amber);color:#7a5a00;background:var(--amber-t)}.tag.rms{border-color:var(--steel);color:var(--steel)}
.star{border:0;background:none;cursor:pointer;font-size:16px;line-height:1;color:var(--line);padding:2px}.star.on{color:var(--amber)}.star:hover{color:var(--amber)}
.cbtn{border:0;background:none;cursor:pointer;color:var(--mute);padding:2px 4px;border-radius:4px;display:inline-flex}.cbtn:hover,.cbtn.has{color:var(--steel)}.cbtn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.6}.cbtn.has svg{fill:var(--steel-t)}
.cbox{display:none;margin-top:.4rem}.cbox.open{display:block}
.cbox textarea{width:100%;min-height:3.2rem;resize:vertical;border:1px solid var(--steel);border-radius:6px;padding:.4rem .6rem;background:#fff}
.cshow{margin-top:.3rem;padding:.2rem .6rem;border-left:3px solid var(--steel);background:var(--steel-t);color:var(--steel-d);cursor:pointer;border-radius:0 4px 4px 0;white-space:pre-wrap}
.cshow:hover{outline:1px dashed var(--steel)}
.flash{animation:fl 1.4s}@keyframes fl{0%,40%{background:var(--amber-t)}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.flash{animation:none}}
'''

COMMON = r'''
const D=__DATA__;
const LINK=id=>`https://tnecimwork.cminl.oa/Work/BrowseWork.aspx?WorkID=${id}`;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cls=s=>s.includes('完成')?'done':s.includes('處理')?'doing':s=='中止'?'stop':'wait';
const ICON='<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>';
const names=Object.keys(D);
const nm=k=>D[k].items[0]?.ownerName||k;
const S={star:{},cm:{}};
const flat=ws=>ws.flatMap(w=>[w,...flat(w.subItems||[])]);
const isLong=w=>w.deltaTime>=10;
function cwidget(w){const c=S.cm[w.workId]||'';return `<div class="cwrap" data-c="${w.workId}">${c?`<div class="cshow" tabindex="0">${esc(c)}</div>`:''}<div class="cbox"><textarea maxlength="2000" placeholder="主管評語（失焦即儲存）">${esc(c)}</textarea></div></div>`}
function cbtn(w){return `<button class="cbtn ${S.cm[w.workId]?'has':''}" data-cb="${w.workId}" title="評語" aria-label="編輯 #${w.workId} 評語">${ICON}</button>`}
function starBtn(w){return `<button class="star ${S.star[w.workId]?'on':''}" data-star="${w.workId}" aria-pressed="${!!S.star[w.workId]}" aria-label="標記重要">${S.star[w.workId]?'★':'☆'}</button>`}
function openBox(id){const wrap=document.querySelector(`[data-c="${id}"]`);wrap.querySelector('.cshow')?.remove();const b=wrap.querySelector('.cbox');b.classList.add('open');b.firstElementChild.focus()}
document.addEventListener('click',e=>{
 const cb=e.target.closest('[data-cb]');if(cb)return openBox(cb.dataset.cb);
 const sh=e.target.closest('.cshow');if(sh)return openBox(sh.parentElement.dataset.c);
 const st=e.target.closest('[data-star]');if(st){const id=st.dataset.star;S.star[id]=!S.star[id];st.classList.toggle('on',S.star[id]);st.textContent=S.star[id]?'★':'☆';window.onStar&&onStar()}
});
document.addEventListener('focusout',e=>{
 if(!e.target.matches('.cbox textarea'))return;const wrap=e.target.closest('[data-c]'),id=wrap.dataset.c,v=e.target.value.trim();S.cm[id]=v;
 wrap.querySelector('.cbox').classList.remove('open');wrap.querySelector('.cshow')?.remove();
 if(v){const d=document.createElement('div');d.className='cshow';d.tabIndex=0;d.textContent=v;wrap.prepend(d)}
 document.querySelector(`[data-cb="${id}"]`)?.classList.toggle('has',!!v)});
function jump(sel){const el=document.querySelector(sel);if(!el)return;el.scrollIntoView({block:'start'});el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash')}
'''.replace('__DATA__', data)

# ---------- A: 左側名冊 + 連續長頁 ----------
A_CSS = r'''
.shell{display:grid;grid-template-columns:230px 1fr;gap:1.5rem;max-width:1180px;margin:0 auto;padding:1.25rem}
.rail{position:sticky;top:1rem;align-self:start;max-height:calc(100vh - 2rem);overflow:auto;background:var(--sheet);border:1px solid var(--line);border-radius:8px;padding:.5rem}
.rail h2{font-size:13px;margin:.4rem .6rem;color:var(--mute);font-weight:600}
.rail a{display:grid;grid-template-columns:1fr auto;gap:0 .5rem;padding:.4rem .6rem;border-radius:6px;color:var(--ink);text-decoration:none;border-left:3px solid transparent}
.rail a:hover{background:var(--line2)}.rail a.on{background:var(--steel-t);border-left-color:var(--steel)}
.rail .h{font-family:var(--num);font-size:12px;color:var(--mute);text-align:right}
.rail .bar{grid-column:1/3;height:3px;background:var(--line2);border-radius:2px;margin-top:3px}.rail .bar i{display:block;height:100%;background:var(--steel);border-radius:2px}
.rail .sc{color:var(--amber);font-size:12px}
section.eng{margin-bottom:1.75rem;scroll-margin-top:1rem}
h2.en{display:flex;align-items:baseline;gap:.75rem;margin:0 0 .4rem;font-size:20px}
h2.en small{font-size:12px;font-weight:400;color:var(--mute)}
.w{display:grid;grid-template-columns:24px 78px 1fr auto;gap:.15rem .6rem;align-items:start;padding:.55rem .6rem;background:var(--sheet);border:1px solid var(--line);border-bottom:0;scroll-margin-top:1rem}
.w:last-child{border-bottom:1px solid var(--line)}
.w .mid{min-width:0}.w .meta{display:flex;gap:.5rem;align-items:center;justify-self:end;white-space:nowrap}
.w .sub{margin:.3rem 0 0;padding:0 0 0 .8rem;border-left:2px dashed var(--line);list-style:none;color:var(--mute);font-size:13px}.w .sub li{display:flex;gap:.6rem;padding:1px 0}
.w .cwrap{grid-column:3/5}
.pct{width:46px;height:5px;background:var(--line2);border-radius:3px;display:inline-block}.pct i{display:block;height:100%;background:var(--steel);border-radius:3px}
@media(max-width:760px){.shell{grid-template-columns:1fr}.rail{position:static;display:flex;overflow:auto}.rail a{min-width:110px}.rail h2{display:none}.w{grid-template-columns:24px 1fr}.w .meta{grid-column:2}.w .cwrap{grid-column:1/3}}
'''
A_JS = r'''
function row(w){return `<div class="w" id="w${w.workId}"><div>${starBtn(w)}</div><a class="wid" href="${LINK(w.workId)}" target="_blank" rel="noopener">#${w.workId}</a>
<div class="mid">${esc(w.workContent)} ${isLong(w)?'<span class="tag long">耗時</span>':''} ${w.rmsFlag?'<span class="tag rms">RMS</span>':''}
${w.subItems?.length?`<ul class="sub">${w.subItems.map(s=>`<li><a class="wid" href="${LINK(s.workId)}" target="_blank" rel="noopener">#${s.workId}</a><span>${esc(s.workContent)}</span><span class="num">${s.deltaTime}H</span></li>`).join('')}</ul>`:''}</div>
<div class="meta"><span class="st ${cls(w.status)}">${w.status}</span><span class="pct"><i style="width:${w.percentage}%"></i></span><span class="num">${w.percentage}%</span><b class="num">${w.deltaTime}H</b>${cbtn(w)}</div>${cwidget(w)}</div>`}
const rail=document.getElementById('rail');
function drawRail(){const on=rail.querySelector('a.on')?.dataset.k;rail.innerHTML='<h2>工程師（點選跳到工作）</h2>'+names.map(k=>{const r=D[k],stars=flat(r.items).filter(w=>S.star[w.workId]).length;return `<a href="#e-${k}" data-k="${k}" class="${k===on?'on':''}"><span>${nm(k)} <span class="sc">${stars?'★'+stars:''}</span></span><span class="h">${r.totalWorkHours}H</span><span class="bar"><i style="width:${Math.min(100,r.totalWorkHours/40*100)}%"></i></span></a>`}).join('')}
window.onStar=drawRail;
drawRail();
document.getElementById('main').innerHTML=names.map(k=>{const r=D[k];return `<section class="eng" id="e-${k}"><h2 class="en">${nm(k)} <small class="num">${k}・工時 ${r.totalWorkHours}H・休假 ${r.totalOffHours}H・${r.items.length} 項</small></h2>${r.items.map(row).join('')}</section>`}).join('');
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)rail.querySelectorAll('a').forEach(l=>l.classList.toggle('on',l.dataset.k===e.target.id.slice(2)))}),{rootMargin:'-10% 0px -80% 0px'});
document.querySelectorAll('section.eng').forEach(s=>io.observe(s));
rail.addEventListener('click',e=>{const a=e.target.closest('a');if(a){e.preventDefault();jump('#e-'+a.dataset.k)}});
'''
A = '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>方案 A 名冊側欄</title><style>' + BASE + A_CSS + '</style><div class="shell"><nav class="rail" id="rail"></nav><main id="main"></main></div><script>' + COMMON + A_JS + '</script>'

# ---------- B: 頂部工程師列 + 緊湊表格 ----------
B_CSS = r'''
.strip{position:sticky;top:0;z-index:10;background:var(--ink);padding:.5rem 1rem;display:flex;gap:.4rem;overflow-x:auto;align-items:center}
.strip button{flex:none;border:0;border-radius:99px;padding:.25rem .8rem;background:#2b3943;color:#cfd8dc;cursor:pointer;display:flex;gap:.5rem;align-items:center}
.strip button:hover{background:#3a4b57}.strip button.on{background:#fff;color:var(--ink)}.strip .num{font-size:12px;opacity:.75}
.strip label{margin-left:auto;color:#cfd8dc;flex:none;font-size:13px}
main{max-width:1180px;margin:0 auto;padding:1rem}
.eng{margin-bottom:1.5rem;scroll-margin-top:3.4rem}
.eng>h2{margin:0;padding:.45rem .8rem;background:var(--steel-d);color:#fff;border-radius:8px 8px 0 0;font-size:15px;display:flex;gap:1rem;align-items:baseline}
.eng>h2 small{font-weight:400;opacity:.8}
table{width:100%;border-collapse:collapse;background:var(--sheet);border:1px solid var(--line)}
th{font-weight:600;font-size:12px;color:var(--mute);text-align:left;padding:.3rem .6rem;border-bottom:1px solid var(--line);background:var(--line2)}
td{padding:.4rem .6rem;border-bottom:1px solid var(--line2);vertical-align:top}
tr.sub td{color:var(--mute);font-size:13px}tr.sub td.c{padding-left:1.8rem}
td.r,th.r{text-align:right}.cwrap{margin-top:.2rem}
tr.flash td{background:var(--amber-t)}
@media(max-width:760px){th:nth-child(5),td:nth-child(5){display:none}}
'''
B_JS = r'''
let onlyStar=false;
function rows(w,sub){return `<tr class="${sub?'sub':'w'}" id="w${w.workId}"><td>${sub?'':starBtn(w)}</td><td><a class="wid" href="${LINK(w.workId)}" target="_blank" rel="noopener">#${w.workId}</a></td>
<td class="c">${esc(w.workContent)} ${isLong(w)?'<span class="tag long">耗時</span>':''} ${w.rmsFlag?'<span class="tag rms">RMS</span>':''}${sub?'':cwidget(w)}</td>
<td><span class="st ${cls(w.status)}">${w.status}</span></td><td class="r num">${w.percentage}%</td><td class="r num"><b>${w.deltaTime}H</b></td><td>${sub?'':cbtn(w)}</td></tr>`+(w.subItems||[]).map(s=>rows(s,1)).join('')}
const strip=document.getElementById('strip');
strip.innerHTML=names.map(k=>`<button data-k="${k}">${nm(k)}<span class="num">${D[k].totalWorkHours}</span></button>`).join('')+'<label><input type="checkbox" id="os"> 僅重要</label>';
function render(){
 document.getElementById('main').innerHTML=names.map(k=>{const r=D[k],items=r.items.filter(w=>!onlyStar||S.star[w.workId]);return `<section class="eng" id="e-${k}"><h2>${nm(k)}<small class="num">工時 ${r.totalWorkHours}H・休假 ${r.totalOffHours}H</small></h2><table><thead><tr><th></th><th>工作</th><th>內容</th><th>狀態</th><th class="r">進度</th><th class="r">本週</th><th></th></tr></thead><tbody>${items.map(w=>rows(w)).join('')||'<tr><td colspan=7 style="color:var(--mute)">沒有標記重要的工作</td></tr>'}</tbody></table></section>`}).join('');
 document.querySelectorAll('section.eng').forEach(s=>io.observe(s))}
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)strip.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.k===e.target.id.slice(2)))}),{rootMargin:'-8% 0px -85% 0px'});
strip.addEventListener('click',e=>{const b=e.target.closest('button');if(b)jump('#e-'+b.dataset.k)});
strip.addEventListener('change',e=>{if(e.target.id=='os'){onlyStar=e.target.checked;render()}});
render();
'''
B = '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>方案 B 頂部工程師列</title><style>' + BASE + B_CSS + '</style><nav class="strip" id="strip"></nav><main id="main"></main><script>' + COMMON + B_JS + '</script>'

# ---------- C: 工時條 + 工作小地圖 ----------
C_CSS = r'''
.shell{display:grid;grid-template-columns:150px 1fr 26px;gap:1.25rem;max-width:1220px;margin:0 auto;padding:1.25rem}
.names{position:sticky;top:1rem;align-self:start;display:flex;flex-direction:column;gap:2px}
.names a{display:flex;justify-content:space-between;padding:.3rem .6rem;border-radius:6px;text-decoration:none;color:var(--ink)}
.names a:hover{background:var(--line2)}.names a.on{background:var(--ink);color:#fff}.names .num{opacity:.7;font-size:12px}
.eng{margin-bottom:2rem;scroll-margin-top:1rem}
.eng h2{margin:0;font-size:20px;display:flex;gap:.8rem;align-items:baseline}.eng h2 small{font-size:12px;font-weight:400;color:var(--mute)}
.tbar{display:flex;height:22px;margin:.5rem 0 .8rem;border-radius:4px;overflow:hidden;background:var(--line2);gap:2px}
.tbar a{display:block;min-width:4px;background:var(--steel);opacity:.85;font-size:10px;color:#fff;overflow:hidden;text-align:center;line-height:22px;text-decoration:none}
.tbar a.done{background:var(--ok)}.tbar a.wait{background:var(--amber)}.tbar a.stop{background:var(--red)}.tbar a:hover{opacity:1;outline:2px solid var(--ink)}.tbar .off{background:repeating-linear-gradient(45deg,#cdd5d1 0 4px,#e6ebe8 4px 8px)}
.card{background:var(--sheet);border:1px solid var(--line);border-left:4px solid var(--steel);border-radius:6px;padding:.6rem .8rem;margin-bottom:.5rem;scroll-margin-top:1rem}
.card.done{border-left-color:var(--ok)}.card.wait{border-left-color:var(--amber)}.card.stop{border-left-color:var(--red)}
.card .top{display:flex;gap:.6rem;align-items:flex-start}.card .top>.t{flex:1;font-size:15px}
.card .foot{display:flex;gap:.8rem;align-items:center;margin-top:.3rem;color:var(--mute);font-size:13px}
.card .pb{flex:0 0 120px;height:6px;background:var(--line2);border-radius:3px}.card .pb i{display:block;height:100%;background:var(--steel);border-radius:3px}
.card .big{font-family:var(--num);font-size:20px;font-weight:600;line-height:1}
details.sub{margin-top:.3rem;font-size:13px;color:var(--mute)}details.sub div{padding:1px 0 1px 1rem}
.mini{position:sticky;top:1rem;align-self:start;height:calc(100vh - 2rem);display:flex;flex-direction:column;gap:1px}
.mini a{flex:1 1 0;min-height:1px;background:var(--steel);opacity:.4;border-radius:1px}.mini a.done{background:var(--ok)}.mini a.wait{background:var(--amber)}.mini a.stop{background:var(--red)}.mini a:hover{opacity:1}.mini a.sep{flex:0 0 5px;background:none;opacity:1}.mini a.cur{opacity:1;outline:1px solid var(--ink)}
@media(max-width:760px){.shell{grid-template-columns:1fr}.names,.mini{display:none}}
'''
C_JS = r'''
function card(w){return `<article class="card ${cls(w.status)}" id="w${w.workId}"><div class="top">${starBtn(w)}<div class="t">${esc(w.workContent)} ${isLong(w)?'<span class="tag long">耗時</span>':''} ${w.rmsFlag?'<span class="tag rms">RMS</span>':''}</div><div class="big">${w.deltaTime}<small>H</small></div>${cbtn(w)}</div>
<div class="foot"><a class="wid" href="${LINK(w.workId)}" target="_blank" rel="noopener">#${w.workId}</a><span class="st ${cls(w.status)}">${w.status}</span><span class="pb"><i style="width:${w.percentage}%"></i></span><span class="num">${w.percentage}%</span></div>
${w.subItems?.length?`<details class="sub"><summary>${w.subItems.length} 個子項</summary>${w.subItems.map(s=>`<div><a class="wid" href="${LINK(s.workId)}" target="_blank" rel="noopener">#${s.workId}</a> ${esc(s.workContent)} <span class="num">${s.deltaTime}H</span></div>`).join('')}</details>`:''}${cwidget(w)}</article>`}
document.getElementById('names').innerHTML=names.map(k=>`<a href="#" data-k="${k}">${nm(k)}<span class="num">${D[k].totalWorkHours}</span></a>`).join('');
document.getElementById('main').innerHTML=names.map(k=>{const r=D[k];return `<section class="eng" id="e-${k}"><h2>${nm(k)}<small class="num">${k}・工時 ${r.totalWorkHours}H・休假 ${r.totalOffHours}H</small></h2>
<div class="tbar" title="每格＝一項工作的本週工時，點擊跳到該工作">${r.items.map(w=>`<a href="#w${w.workId}" data-w="${w.workId}" class="${cls(w.status)}" style="flex:${w.deltaTime||.3}" title="#${w.workId} ${esc(w.workContent)}・${w.deltaTime}H">${w.deltaTime>=3?w.deltaTime:''}</a>`).join('')}${r.totalOffHours?`<span class="off" style="flex:${r.totalOffHours}" title="休假 ${r.totalOffHours}H"></span>`:''}</div>${r.items.map(card).join('')}</section>`}).join('');
const mini=document.getElementById('mini');mini.innerHTML=names.map((k,i)=>(i?'<a class="sep"></a>':'')+D[k].items.map(w=>`<a href="#w${w.workId}" data-w="${w.workId}" class="${cls(w.status)}" style="flex-grow:${1+Math.min(w.deltaTime,20)/10}" title="${nm(k)} #${w.workId}"></a>`).join('')).join('');
document.addEventListener('click',e=>{const a=e.target.closest('[data-w]');if(a){e.preventDefault();jump('#w'+a.dataset.w)}const n=e.target.closest('#names a');if(n){e.preventDefault();jump('#e-'+n.dataset.k)}});
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){const k=e.target.id.slice(2);document.querySelectorAll('#names a').forEach(l=>l.classList.toggle('on',l.dataset.k===k))}}),{rootMargin:'-10% 0px -80% 0px'});document.querySelectorAll('section.eng').forEach(s=>io.observe(s));
const io2=new IntersectionObserver(es=>es.forEach(e=>{mini.querySelector(`[data-w="${e.target.id.slice(1)}"]`)?.classList.toggle('cur',e.isIntersecting)}));document.querySelectorAll('.card').forEach(c=>io2.observe(c));
'''
C = '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>方案 C 工時條與小地圖</title><style>' + BASE + C_CSS + '</style><div class="shell"><nav class="names" id="names"></nav><main id="main"></main><nav class="mini" id="mini" aria-label="工作小地圖"></nav></div><script>' + COMMON + C_JS + '</script>'

for n, h in (('a', A), ('b', B), ('c', C)):
    open(n + '.html', 'w', encoding='utf8').write(h)
