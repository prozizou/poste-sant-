'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../record-actions.js'), 'utf8');

async function setup(actions) {
  const { bindRecordActions } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const listeners = {};
  const root = {
    contains: node => node.inside !== false,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: type => { delete listeners[type]; },
  };
  const stop = bindRecordActions(root, actions);
  return {
    listeners, stop,
    dispatch(node, type = 'click', key) {
      const event = { type, key, target: { closest: () => node }, preventDefault() { this.prevented = true; }, stopPropagation() {} };
      listeners[type](event);
      return event;
    },
  };
}
const node = (action, key, extra = {}) => ({
  dataset: { recordAction: action, recordKey: key },
  getAttribute: () => null, matches: () => false, ...extra,
});

test('Un identifiant hostile est transmis comme donnée, jamais exécuté', async () => {
  let received;
  const ui = await setup({ ouvrir: key => { received = key; } });
  const hostile = '\'");globalThis.compromis=true;//<img src=x onerror=alert(1)>';
  ui.dispatch(node('ouvrir', hostile));
  assert.equal(received, hostile);
  assert.equal(globalThis.compromis, undefined);
});

test('Le dispatcher refuse les actions inconnues, héritées, désactivées ou extérieures', async () => {
  let calls = 0;
  const ui = await setup(Object.assign(Object.create({ inherited() { calls++; } }), { ouvrir() { calls++; } }));
  for (const n of [node('unknown','1'),node('inherited','1'),node('ouvrir','1',{disabled:true}),node('ouvrir','1',{inside:false}),node('ouvrir','1',{getAttribute:()=> 'true'})])
    ui.dispatch(n);
  assert.equal(calls,0);
});

test('Le clavier active les cartes, sans doubler le clic natif des boutons', async () => {
  let calls = 0;
  const ui = await setup({ ouvrir() { calls++; } });
  assert.equal(ui.dispatch(node('ouvrir','1'),'keydown','Enter').prevented,true);
  ui.dispatch(node('ouvrir','1'),'keydown',' ');
  ui.dispatch(node('ouvrir','1'),'keydown','Escape');
  ui.dispatch(node('ouvrir','1',{matches:()=>true}),'keydown','Enter');
  assert.equal(calls,2);
  ui.stop();
  assert.deepEqual(ui.listeners,{});
});

test('Les snapshots ne peuvent pas remplacer les métadonnées de l’interface', () => {
  const files=['facturation/script.js','annulation/annulation.html','planif_rapport/rapports.html','planif_rapport/depenses.html','accueil/menu_icp.html','approvisionnement/stock.html'];
  let count=0;
  for(const file of files){
    const text=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    const data={_key:'faux-identifiant',_ts:-1,id:'autre-produit',date_ts:123};
    const context={c:{key:'cle-reelle',val:()=>data},v:data,getSafeTs:()=>456};
    for(const match of text.matchAll(/\{\s*\.\.\.(?:c\.val\(\)|v),\s*(?:_key|_ts|id):[^}]+\}/g)){
      const result=vm.runInNewContext('('+match[0]+')',context);
      if(/_key:/.test(match[0]))assert.equal(result._key,'cle-reelle',file);
      if(/\bid:/.test(match[0]))assert.equal(result.id,'cle-reelle',file);
      if(/_ts:/.test(match[0]))assert.notEqual(result._ts,-1,file);
      count++;
    }
    assert.doesNotMatch(text, /\{\s*(?:_key|_ts|id):[^\n}]+,\s*\.\.\.(?:c\.val\(\)|v)\s*\}/,file);
  }
  assert.ok(count>=20);
});
