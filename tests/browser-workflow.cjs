'use strict';
// Real Chromium, application modules and transaction planners. Authentication,
// RTDB transport and external integrations are replaced; no production access.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright-core');
const memory=require('./helpers/memory-db.cjs');
const {executeBusiness}=require('../api/_business.js');
const {execute}=require('../api/pharmacie-operations.js')._testing;
const {balance}=require('../api/_atomic.js');
const root=path.resolve(__dirname,'..');
const user={uid:'browser-user',email:'browser@example.test'};
const fixture=()=>({ticket_dbase:{income:{name:'Patient initial',prenom:'Patient',nom:'Initial',prix:10000,argent_remis:10000,date_heure_ts:Date.now()-1000}},db_pharmacie_stock:{'med-001':{nom:'Produit A',forme:'Comprimé',dosage:'200 mg',quantite:5,prix_unitaire:200,date_peremption:'2099-12-31'}}});
const authModule=`export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb(auth.currentUser),0);return ()=>{}};export const signOut=async()=>{};export const sendPasswordResetEmail=async()=>{};`;
const dbModule=`
export const ref=(_,path)=>({path});
function snapshot(path){
 let value=path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],window.__state);
 if(path==='.info/connected')value=true;
 return {val:()=>value ?? null,exists:()=>value!=null,forEach:cb=>{for(const [key,val] of Object.entries(value || {}))cb({key,val:()=>val})}};
}
export function onValue(ref,cb){const fn=()=>cb(snapshot(ref.path));window.__listeners??=[];window.__listeners.push(fn);setTimeout(fn,0);return ()=>{}}
export const get=async ref=>snapshot(ref.path);export const off=()=>{};
export const push=(ref,data)=>{if(ref.path!=='notifications_caisse')throw Error('Direct write forbidden: '+ref.path);const pending=Promise.resolve();pending.key='notification-local';return pending};
export const update=async(ref)=>{if(!ref.path.startsWith('db_pharmacie_stock/'))throw Error('Direct financial update forbidden');};
export const remove=async()=>{throw Error('Direct remove forbidden')};
export const runTransaction=async()=>{throw Error('Direct client transaction forbidden')};
export const query=x=>x;export const orderByChild=()=>{};export const startAt=()=>{};
`;
async function main(){
 const server=http.createServer((req,res)=>{
  if(req.url==='/__harness'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="fr"><body>Test local</body></html>');return;}
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let tests=0;
 try{
  async function contextFor(store,{loseFirst=false,denyAfterLoss=false}={}){
   const context=await browser.newContext({serviceWorkers:'block'});
   let lost=false,denied=false;
   await context.addInitScript(state=>{window.__state=state;window.__listeners=[];},store.state());
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),p=url.pathname;
    const js=body=>route.fulfill({contentType:'text/javascript',body});
    if(url.origin===base && p==='/firebase-config.js')return js(`export const auth={currentUser:{uid:'browser-user',email:'browser@example.test',getIdToken:async()=>'local-test'}};export const db={};export const app={};`);
    if(url.origin===base && p==='/village-client.js')return js(`export const villageActuel=()=>({id:'diandioly',uid:'browser-user',nom:'Village local',role:'admin'});export const chargerVillage=async()=>villageActuel();export const villagePourUtilisateur=async()=>villageActuel();export const villageRef=(_,path)=>({path});`);
    if(url.origin===base && p==='/notifications-admin.js')return js('export const initNotifCaisseAdmin=()=>{};export const desabonnerPushAdmin=async()=>{};');
    if(url.origin===base && p==='/push-relay.js')return js('export const signalerPush=()=>{};');
    if(url.hostname==='www.gstatic.com' && p.endsWith('/firebase-auth.js'))return js(authModule);
    if(url.hostname==='www.gstatic.com' && p.endsWith('/firebase-database.js'))return js(dbModule);
    if(url.origin===base && (p==='/api/business-operations'||p==='/api/pharmacie-operations')){
     const command=route.request().postDataJSON();
     if(lost && denyAfterLoss && !denied){denied=true;return route.fulfill({status:403,json:{error:'Session temporairement refusée'}});}
     let result;
     try{result=await (p.endsWith('/business-operations')?executeBusiness:execute)(store.db,command.action,command,user,'admin');}
     catch(e){return route.fulfill({status:e.status || 500,json:{error:e.message,not_committed:e.notCommitted===true}});}
     if(loseFirst && !lost){lost=true;return route.abort('connectionfailed');}
     for(const page of context.pages())await page.evaluate(state=>{window.__state=state;for(const cb of window.__listeners || [])cb();},store.state()).catch(()=>{});
     return route.fulfill({json:result});
    }
    if(url.origin===base && p.startsWith('/api/'))return route.fulfill({json:{ok:true,configure:false,cloudinary:false}});
    if(url.origin!==base)return route.abort();
    return route.continue();
   });
   return context;
  }
  const date=new Date().toISOString().slice(0,10);
  // Simulate a committed operation whose HTTP response was lost.
  {
   const store=memory(fixture()),context=await contextFor(store,{loseFirst:true}),page=await context.newPage();
   await page.goto(base+'/__harness');
   const outcome=await page.evaluate(async date=>{
    const {operationMetier}=await import('/business-client.js');
    try{await operationMetier('depense_creer',{categorie:'Matériel médical',libelle:'Achat',montant:7000,date_iso:date});return 'unexpected';}catch{return 'failed';}
   },date);
   assert.equal(outcome,'failed');assert.equal(balance(store.state()),3000);
   const changed=await page.evaluate(async date=>{
    const {operationMetier}=await import('/business-client.js');
    try{await operationMetier('depense_creer',{categorie:'Matériel médical',libelle:'Achat',montant:1000,date_iso:date});return 'unexpected';}catch(e){return e.message;}
   },date);
   assert.match(changed,/Saisie modifiée/);assert.equal(Object.keys(store.state().db_depenses).length,1);
   await page.getByRole('button',{name:'Vérifier la saisie précédente'}).click();
   await page.getByRole('button',{name:'Actualiser',exact:true}).waitFor();
   assert.equal(balance(store.state()),3000);assert.equal(store.stats.commits,1);
   assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('ps-command:')).length),0);
   await context.close();tests++;console.log('PASS Chromium : réponse perdue, formulaire modifié, récupération sans double débit');
  }
  {
   const store=memory(fixture()),context=await contextFor(store,{loseFirst:true,denyAfterLoss:true}),page=await context.newPage();
   await page.goto(base+'/__harness');
   for(let i=0;i<2;i++)await page.evaluate(async date=>{
    const {operationMetier}=await import('/business-client.js');
    try{await operationMetier('depense_creer',{categorie:'Matériel médical',libelle:'Achat',montant:1000,date_iso:date});}catch{}
   },date);
   assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('ps-command:')).length),1);
   await page.getByRole('button',{name:'Vérifier la saisie précédente'}).click();
   await page.getByRole('button',{name:'Actualiser',exact:true}).waitFor();
   assert.equal(balance(store.state()),9000);assert.equal(store.stats.commits,1);
   await context.close();tests++;console.log('PASS Chromium : refus de session après une réponse perdue, identifiant conservé');
  }
  {
   const store=memory(fixture()),context=await contextFor(store),page=await context.newPage();
   await page.goto(base+'/__harness');
   const result=await page.evaluate(async date=>{
    const {operationMetier,completeOperation}=await import('/business-client.js');
    const body={categorie:'Matériel médical',libelle:'Achat',montant:1000,date_iso:date};
    const first=await operationMetier('depense_creer',body);
    // The caller has not reset its form (e.g. rendering failed after commit).
    const replay=await operationMetier('depense_creer',body);
    completeOperation('depense_creer');
    const next=await operationMetier('depense_creer',body);
    completeOperation('depense_creer');
    return {first:first.key,replay:replay.key,deja:replay.deja,next:next.key};
   },date);
   assert.equal(result.first,result.replay);assert.equal(result.deja,true);assert.notEqual(result.next,result.first);
   assert.equal(balance(store.state()),8000);assert.equal(store.stats.commits,2);
   await context.close();tests++;console.log('PASS Chromium : erreur après confirmation, reprise et nouvelle saisie identique explicite');
  }
  // Exercise actual application screens, with live local planner responses.
  {
   const store=memory(fixture()),context=await contextFor(store),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER ERROR',e.message);});
   await page.goto(base+'/facturation/facturation.html');
   await page.waitForFunction(()=>typeof window.encaisserTicket==='function');
   await page.evaluate(()=>{
    for(const [id,value] of Object.entries({'t-prenom':'Agent','t-nom':'Test','t-age':'25'})){document.getElementById(id).value=value;}
    window.selectTarif(document.querySelector('.tarif-card'));
    document.getElementById('t-recu').value='1000';document.getElementById('op-imprimer').checked=false;
   });
   await page.evaluate(()=>window.encaisserTicket());
   assert.equal(Object.keys(store.state().ticket_dbase).length,2);
   const created=Object.values(store.state().ticket_dbase).find(t=>t.saisi_uid===user.uid);
   assert.equal(created.prix,500);assert.equal(created.num_attente,'N° 001');
   assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('ps-command:')).length),0);
   assert.deepEqual(errors,[]);
   await context.close();tests++;console.log('PASS Chromium : écran caisse → ticket, tarif et numéro serveur');
  }
  {
   const store=memory(fixture()),context=await contextFor(store),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER ERROR',e.message);});
   await page.goto(base+'/planif_rapport/depenses.html');
   await page.locator('#d-categorie').evaluate(el=>el.value='Matériel médical');
   await page.locator('#d-montant').evaluate(el=>{el.value='100.5';el.dispatchEvent(new Event('input',{bubbles:true}));});
   assert.equal(await page.locator('#d-montant').inputValue(),'100.5');
   assert.equal(await page.locator('#d-montant').evaluate(el=>el.validity.customError),true);
   await page.locator('#dep-form').evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   assert.equal(store.stats.commits,0);
   await page.locator('#d-montant').evaluate(el=>{el.value='1000';el.dispatchEvent(new Event('input',{bubbles:true}));});
   await page.locator('#d-date').evaluate((el,date)=>el.value=date,date);
   await page.locator('#dep-form').evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   await page.waitForFunction(()=>Object.keys(window.__state.db_depenses || {}).length===1);
   assert.equal(balance(store.state()),9000);assert.deepEqual(errors,[]);
   await page.waitForFunction(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('ps-command:')).length===0);
   await context.close();tests++;console.log('PASS Chromium : écran dépenses → validation serveur du solde');
  }
  {
   const store=memory(fixture()),context=await contextFor(store),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER ERROR',e.message);});
   await page.goto(base+'/approvisionnement/stock.html');
   await page.locator('[data-fiche="med-001"]').click();
   await page.locator('[data-f="ajuster"]').click();
   await page.locator('#a-q').fill('4');await page.locator('#a-m').selectOption({label:'Inventaire physique'});
   await page.locator('#sheet2 [data-d="ok"]').click();
   await page.waitForFunction(()=>window.__state.db_pharmacie_stock['med-001'].quantite===4);
   const state=store.state();assert.equal(Object.values(state.db_pharmacie_reappro)[0].nouvelle_quantite,4);
   assert.equal(Object.keys(state.business_audit).length,1);assert.deepEqual(errors,[]);
   await context.close();tests++;console.log('PASS Chromium : écran stock → ajustement et journal atomiques');
  }
  console.log(`${tests} scénarios Chromium réussis, sans connexion à la production.`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
