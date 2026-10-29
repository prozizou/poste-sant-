'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {amount,recordTimestamp,sumAmounts}=require('../domain-values.mjs');

async function report(){
 const file=path.join(__dirname,'../planif_rapport/rapport-lib.js');
 const source=fs.readFileSync(file,'utf8').replace("from '../domain-values.mjs'",'from '+JSON.stringify(pathToFileURL(path.join(__dirname,'../domain-values.mjs')).href))
  .replace("import { villageActuel } from '../village-client.js';","const villageActuel=()=>null;");
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
test('Les montants invalides, négatifs, décimaux ou hors limites sont refusés',()=>{
 for(const value of [null,undefined,'','texte',true,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>amount(value));
 assert.equal(amount('1000'),1000);assert.equal(amount(0),0);
 assert.throws(()=>sumAmounts([{prix:500},{prix:'invalide'}],'prix'));
 assert.throws(()=>sumAmounts([{prix:Number.MAX_SAFE_INTEGER},{prix:1}],'prix'));
 assert.throws(()=>sumAmounts([{prix:100,annule:'false'}],'prix',true));
});
test('Une date manquante ou impossible n’est jamais remplacée par aujourd’hui',()=>{
 for(const row of [{},{date:'30/02/2026'},{date_heure_ts:'invalide'},{date:'29/10/2026',heure:'25:00'}])assert.ok(Number.isNaN(recordTimestamp(row)));
 assert.equal(recordTimestamp({date:'29/10/2026',heure:'09:30'}),Date.parse('2026-10-29T09:30:00Z'));
 assert.equal(recordTimestamp({date_ts:123456789}),123456789);
});
test('Les périodes excluent les dates futures, y compris le bilan global',async()=>{
 const r=await report();const now=new Date('2026-10-29T10:30:00Z');
 for(const period of ['jour','j7','semaine','mois','trimestre','annee','tout']){
  const [start,end]=r.bornes(period,now);
  assert.equal(end,now.getTime()+1);assert.ok(start<end);
  assert.ok(!(now.getTime()+86400000<end));
 }
 assert.ok(Number.isNaN(r.getSafeTs({})));
});
test('Deux références de médicament portant le même nom restent séparées',async()=>{
 const r=await report();
 const result=r.parMedicament([{medicaments:[{stock_key:'ref-A',nom:'Paracétamol',prix:100,qte:2},{stock_key:'ref-B',nom:'Paracétamol',prix:300,qte:3}]}]);
 assert.equal(result.length,2);
 assert.deepEqual(result.map(x=>[x.stock_key,x.qte,x.montant]),[['ref-B',3,900],['ref-A',2,200]]);
});
test('Une annulation ne compte pas et un dépassement ne produit pas un total arrondi',async()=>{
 const r=await report();
 assert.equal(r.totalVentes([{total:100},{total:300,annule:true}]),100);
 assert.throws(()=>r.parMedicament([{medicaments:[{stock_key:'A',nom:'A',prix:Number.MAX_SAFE_INTEGER,qte:2}]}]));
});
