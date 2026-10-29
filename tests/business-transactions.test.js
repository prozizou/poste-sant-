'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const memory=require('./helpers/memory-db.cjs');
const {executeBusiness,TARIFS}=require('../api/_business.js');
const {execute}=require('../api/pharmacie-operations.js')._testing;
const {balance}=require('../api/_atomic.js');
const {scopedDatabase}=require('../api/_village.js');
const user={uid:'staff-001',email:'staff@example.test'};
const admin={uid:'admin-001',email:'admin@example.test'};
const fixture=()=>({ticket_dbase:{income:{prix:10000,date_heure_ts:Date.now()-1000}},db_pharmacie_stock:{'med-001':{nom:'Produit A',quantite:5,prix_unitaire:200,date_peremption:'2099-12-31'}}});
const expense=(montant=7000)=>({operationId:randomUUID(),categorie:'Matériel médical',libelle:'Achat contrôlé',montant,date_iso:new Date().toISOString().slice(0,10)});
const ticket=()=>({operationId:randomUUID(),prenom:'Agent',nom:'Test',age:25,choix:Object.keys(TARIFS)[0],argent_remis:1000,date_heure_ts:Date.now()});
const sale=(qte=3)=>({operationId:randomUUID(),patient_nom:'Patient test',medicaments:[{stock_key:'med-001',qte,prix:200}],argent_remis:2000,date_heure_ts:Date.now()});

test('Le cache Firebase reste vivant pendant les suppressions puis son écoute est libérée',async()=>{
 const f=fixture();f.ticket_dbase['existing-ticket']=f.ticket_dbase.income;delete f.ticket_dbase.income;
 const m=memory(f,{evictAfterOnce:true});
 const sold=await execute(m.db,'encaisser',sale(2),user,'caissier');
 const removeSale={operationId:randomUUID(),key:sold.key,motif:'Test / essai'};
 await execute(m.db,'supprimer',removeSale,admin,'admin');
 assert.equal(m.state().db_pharmacie_stock['med-001'].quantite,5);
 assert.equal((await execute(m.db,'supprimer',removeSale,admin,'admin')).deja,true);
 await execute(m.db,'supprimer_ticket',{operationId:randomUUID(),key:'existing-ticket',motif:'Test / essai'},admin,'admin');
 assert.equal(m.state().ticket_dbase['existing-ticket'],undefined);
 assert.equal(Object.keys(m.state().corbeille).length,2);
 assert.equal(m.stats.listeners,0);
 await assert.rejects(execute(m.db,'supprimer_ticket',{operationId:randomUUID(),key:'absent-ticket',motif:'Test / essai'},admin,'admin'),e=>e.status===404);
 assert.equal(m.stats.listeners,0);
});

test('Le caissier ne peut pas supprimer un ticket et un refus ne change aucune donnée',async()=>{
 const m=memory(fixture(),{evictAfterOnce:true}),before=m.state();
 await assert.rejects(execute(m.db,'supprimer_ticket',{operationId:randomUUID(),key:'existing-ticket',motif:'Test / essai'},user,'caissier'),e=>e.status===403);
 assert.deepEqual(m.state(),before);assert.equal(m.stats.listeners,0);
});

test('Rejouer exactement une dépense ne la débite jamais deux fois',async()=>{
 const m=memory(fixture()),command=expense();
 const first=await executeBusiness(m.db,'depense_creer',command,user,'tresorier');
 const second=await executeBusiness(m.db,'depense_creer',{...command},user,'tresorier');
 assert.equal(first.key,second.key);assert.equal(second.deja,true);
 assert.equal(Object.keys(m.state().db_depenses).length,1);
 assert.equal(balance(m.state()),3000);assert.equal(m.stats.commits,1);
});
test('Un identifiant ne peut pas être réutilisé pour un autre panier ou patient',async()=>{
 const m=memory(fixture()),command=sale(1);
 await execute(m.db,'encaisser',command,user,'caissier');
 for(const changed of [{...command,patient_nom:'Autre patient'},{...command,medicaments:[{stock_key:'med-001',qte:2,prix:200}]}])
  await assert.rejects(execute(m.db,'encaisser',changed,user,'caissier'),e=>e.status===409);
 assert.equal(m.state().db_pharmacie_stock['med-001'].quantite,4);
 assert.equal(Object.keys(m.state().vente_medicaments).length,1);
});
test('L’ordre des propriétés JSON ne change pas l’identité d’une commande',async()=>{
 const m=memory(fixture()),c=expense(100);
 await executeBusiness(m.db,'depense_creer',c,user,'tresorier');
 const reversed=Object.fromEntries(Object.entries(c).reverse());
 assert.equal((await executeBusiness(m.db,'depense_creer',reversed,user,'tresorier')).deja,true);
 await assert.rejects(executeBusiness(m.db,'depense_creer',c,admin,'tresorier'),e=>e.status===409);
});
test('Deux dépenses simultanées ne peuvent dépasser le solde disponible',async()=>{
 const m=memory(fixture());
 const results=await Promise.allSettled([executeBusiness(m.db,'depense_creer',expense(),user,'tresorier'),executeBusiness(m.db,'depense_creer',expense(),admin,'admin')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 assert.equal(results.find(r=>r.status==='rejected').reason.notCommitted,true);
 assert.equal(balance(m.state()),3000);assert.ok(m.stats.retries>0);
});
test('Deux ventes simultanées ne peuvent délivrer plus que le stock',async()=>{
 const m=memory(fixture());
 const results=await Promise.allSettled([execute(m.db,'encaisser',sale(),user,'caissier'),execute(m.db,'encaisser',sale(),admin,'admin')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(m.state().db_pharmacie_stock['med-001'].quantite,2);
 assert.equal(Object.keys(m.state().vente_medicaments).length,1);
 assert.ok(m.stats.retries>0);
 assert.ok(m.stats.paths.every(p=>p==='/')); // no expiring-lock protocol
});
test('Un ajustement concurrent à une vente est recalculé ou refusé, jamais écrasé',async()=>{
 const m=memory(fixture());
 const results=await Promise.allSettled([
  executeBusiness(m.db,'stock_ajuster',{operationId:randomUUID(),key:'med-001',expectedQuantity:5,quantite:4,motif:'Inventaire physique'},admin,'admin'),
  execute(m.db,'encaisser',sale(),user,'caissier'),
 ]);
 assert.equal(results[1].status,'fulfilled');
 const state=m.state();
 assert.equal(state.db_pharmacie_stock['med-001'].quantite,results[0].status==='fulfilled'?1:2);
 if(results[0].status==='fulfilled'){
  const log=Object.values(state.db_pharmacie_reappro);
  assert.equal(log.length,1);assert.equal(log[0].ancienne_quantite,5);assert.equal(log[0].nouvelle_quantite,4);
 }
});
test('Une erreur de lot annule aussi les changements de stock et de journal',async()=>{
 const m=memory(fixture()),before=m.state();
 await assert.rejects(executeBusiness(m.db,'stock_modifier_lot',{operationId:randomUUID(),key:'med-001',lotId:'absent',date_peremption:'2099-02-30'},admin,'admin'),e=>e.status===422);
 assert.deepEqual(m.state(),before);assert.equal(m.stats.commits,0);
});
test('Ticket et numéro d’attente sont attribués dans le même commit',async()=>{
 const m=memory({});
 const [a,b]=await Promise.all([executeBusiness(m.db,'ticket_creer',ticket(),user,'caissier'),executeBusiness(m.db,'ticket_creer',ticket(),admin,'admin')]);
 assert.notEqual(a.ticket.num_attente,b.ticket.num_attente);
 assert.deepEqual(Object.values(m.state().compteurs),[2]);
 assert.equal(Object.keys(m.state().ticket_dbase).length,2);
 assert.equal(a.ticket.saisi_uid,user.uid);assert.equal(a.ticket.prix,500);
});
test('Les tarifs et les rôles sont contrôlés au serveur',async()=>{
 const m=memory(fixture());
 await assert.rejects(executeBusiness(m.db,'ticket_creer',{...ticket(),prix:1},user,'caissier'),e=>e.status===409);
 await assert.rejects(executeBusiness(m.db,'depense_creer',expense(),user,'caissier'),e=>e.status===403);
 await assert.rejects(executeBusiness(m.db,'stock_ajuster',{operationId:randomUUID(),key:'med-001',quantite:0,expectedQuantity:5,motif:'Test'},user,'caissier'),e=>e.status===403);
 assert.equal(m.stats.commits,0);
});
test('Une annulation de recette ne peut consommer de l’argent déjà dépensé',async()=>{
 const m=memory(fixture());
 await executeBusiness(m.db,'depense_creer',expense(9000),user,'tresorier');
 await assert.rejects(executeBusiness(m.db,'ticket_annuler',{operationId:randomUUID(),key:'income',motif:'Erreur'},user,'caissier'),e=>e.status===409);
 assert.equal(m.state().ticket_dbase.income.annule,undefined);
});
test('La suppression de dépense conserve sa trace avec la mutation du solde',async()=>{
 const m=memory(fixture());const c=await executeBusiness(m.db,'depense_creer',expense(),user,'tresorier');
 await executeBusiness(m.db,'depense_supprimer',{operationId:randomUUID(),key:c.key},admin,'admin');
 assert.equal(balance(m.state()),10000);
 const log=Object.values(m.state().business_audit).find(x=>x.action==='depense_supprimer');
 assert.equal(log.avant.montant,7000);assert.equal(log.apres,null);
});
test('Une valeur financière historique invalide bloque les écritures de caisse',async()=>{
 const state=fixture();state.ticket_dbase.income.prix='invalide';const m=memory(state);
 await assert.rejects(executeBusiness(m.db,'depense_creer',expense(100),user,'tresorier'),e=>e.status===409);
 assert.equal(m.stats.commits,0);
});
test('Une ancienne commande sans empreinte n’est pas acceptée comme une nouvelle',async()=>{
 const c=sale(1),state=fixture();state.pharmacie_operations={[c.operationId]:{uid:user.uid,action:'encaisser'}};
 const m=memory(state);
 await assert.rejects(execute(m.db,'encaisser',c,user,'caissier'),e=>e.status===409);
 assert.equal(m.stats.commits,0);
});
test('Chaque transaction reste dans son village',async()=>{
 const m=memory({villages:{alpha:fixture(),beta:fixture()}});
 await executeBusiness(scopedDatabase(m.db,'alpha'),'depense_creer',expense(100),user,'tresorier');
 assert.equal(m.state().villages.beta.db_depenses,undefined);
 assert.equal(balance(m.state().villages.alpha),9900);
 assert.deepEqual(m.stats.paths,['villages/alpha']);
});
test('L’archivage se base sur le stock courant et non sur la fiche ouverte',async()=>{
 const m=memory(fixture());
 await assert.rejects(executeBusiness(m.db,'stock_archiver',{operationId:randomUUID(),key:'med-001'},admin,'admin'),e=>e.status===409);
 assert.equal(m.state().db_pharmacie_stock['med-001'].archive,undefined);
});
test('Un retrait de lot valide met à jour quantité, lot et journal ensemble',async()=>{
 const f=fixture();f.db_pharmacie_stock['med-001'].lots={lotA:{numero:'A',date_peremption:'2099-12-31',qte_recue:5}};
 const m=memory(f);
 const result=await executeBusiness(m.db,'stock_retirer_lot',{operationId:randomUUID(),key:'med-001',lotId:'lotA',motif:'Rappel de lot'},admin,'admin');
 assert.equal(result.apres,0);assert.equal(m.state().db_pharmacie_stock['med-001'].lots.lotA.retire,true);
 const log=Object.values(m.state().db_pharmacie_reappro)[0];assert.equal(log.quantite_ajoutee,-5);
 assert.equal(m.stats.commits,1);
});
