const fs=require('fs');
const scenes=require('./scenes.js');
const dur=JSON.parse(fs.readFileSync('durations.json'));
const script=JSON.parse(fs.readFileSync('script.json'));
const PAD_IN=0.6, PAD_OUT=0.9;
let t=0; const meta=[];
const body=scenes.map((s,i)=>{
  const a=dur[s.id]; const total=PAD_IN+a+PAD_OUT;
  const D=f=>(PAD_IN+f*a).toFixed(2);
  const text=script.find(x=>x.id===s.id).text;
  const sents=text.match(/[^.:]+[.:]?/g).map(x=>x.trim()).filter(Boolean);
  const totalChars=sents.reduce((n,x)=>n+x.length+8,0);
  let c=0; const subs=sents.map(x=>{const st=PAD_IN+a*c/totalChars; c+=x.length+8; return {st,en:PAD_IN+a*c/totalChars,x};});
  meta.push({id:s.id,start:t,total,audio:a,subs}); t+=total;
  const head=s.title?`<div class="head"><div class="num a-pop" style="animation-delay:0.1s">${s.num}</div><h2 class="a-up" style="animation-delay:0.2s">${s.title}</h2></div>`:'';
  return `<section class="scene" id="s${i}">${head}<div class="content">${s.html(D)}</div></section>`;
}).join('\n');
const css=fs.readFileSync('style.css','utf8');
fs.writeFileSync('video.html',`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="stage"><div class="bgblob b1"></div><div class="bgblob b2"></div>${body}
<div id="sub"></div><div id="brand">✚ Poste de Santé</div><div id="prog"><div id="pb"></div></div></div>
<script>
const META=${JSON.stringify(meta)}; const TOTAL=${t};
window.TOTAL=TOTAL; window.META=META;
window.seek=function(t){
  let k=META.findIndex(m=>t>=m.start&&t<m.start+m.total); if(k<0)k=META.length-1;
  const m=META[k], lt=t-m.start;
  document.querySelectorAll('.scene').forEach((el,i)=>{el.style.display=i===k?'flex':'none';});
  const sc=document.getElementById('s'+k);
  const fin=Math.min(1,lt/0.45), fout=Math.min(1,(m.total-lt)/0.45);
  sc.style.opacity=(k===0?1:fin)*(k===META.length-1?1:fout);
  sc.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=lt*1000;});
  const s=m.subs.find(s=>lt>=s.st&&lt<s.en+0.15);
  const sub=document.getElementById('sub'); sub.textContent=s?s.x:''; sub.style.opacity=s?1:0;
  document.getElementById('pb').style.width=(100*t/TOTAL)+'%';
  document.querySelectorAll('.bgblob').forEach((b,i)=>{b.style.transform='translate('+(Math.sin(t/7+i*2)*60)+'px,'+(Math.cos(t/9+i)*40)+'px)';});
};
</script></body></html>`);
fs.writeFileSync('timeline.json',JSON.stringify({total:t,meta}));
console.log('total',t.toFixed(1));
