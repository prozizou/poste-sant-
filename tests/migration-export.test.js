'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {args,loadSource,hash,assertSame,run}=require('../scripts/migrate-export-diandioly');
function fixture(mutator) {
  const uid='uid_diandioly_test_00001';
  const obj={db_users:{[uid]:{role:'admin'}},administration:{auth_db:{test:{email:'admin@example.test',role:'admin'}}},ticket_dbase:{a:{prix:100}},vente_medicaments:{b:{total:200}},db_pharmacie_stock:{c:{quantite:2}}};
  mutator?.(obj);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'migr-'));
  const filename=path.join(dir,'source.json');
  fs.writeFileSync(filename,JSON.stringify(obj));
  return {filename,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('analyse les options de sauvegarde et les garde-fous',()=>{
  const opt=args(['--source','source.json','--key','admin.json','--backup-out','/private/backup.json','--apply','--backup-confirmed','--maintenance-confirmed']);
  assert.equal(opt.backupOut,'/private/backup.json');
  assert.equal(opt.apply,true); assert.equal(opt.backup,true); assert.equal(opt.maintenance,true);
});
test('valide un export minimal sans accéder à Firebase',()=>{
  const f=fixture();try{ const {counts,users}=loadSource(f.filename);assert.equal(counts.ticket_dbase,1);assert.equal(users.length,1); }finally{f.cleanup();}
});
test('refuse les fichiers mal structurés',()=>{
  const f=fixture(x=>delete x.db_users);try{assert.throws(()=>loadSource(f.filename),/obligatoires/);}finally{f.cleanup();}
});
test('refuse les comptes affectés à un autre village',()=>{
  const f=fixture(x=>Object.values(x.db_users)[0].village_id='ailleurs');try{assert.throws(()=>loadSource(f.filename),/autre village/);}finally{f.cleanup();}
});
test('refuse les noeuds inconnus pour éviter pertes silencieuses',()=>{
  const f=fixture(x=>x.other_sensitive_node={x:1});try{assert.throws(()=>loadSource(f.filename),/inattendus/);}finally{f.cleanup();}
});
test('hash indépendant de l’ordre des clés et détection des modifications',()=>{
  assert.equal(hash({b:1,a:{z:3,y:4}}),hash({a:{y:4,z:3},b:1}));
  assert.throws(()=>assertSame('stock',{quantite:1},{quantite:2}),/STOP/);
});
test('la simulation est sans clé ni SDK admin, et l’écriture exige les confirmations',async()=>{
  const f=fixture();try{
    await run(args(['--source',f.filename]));
    await assert.rejects(()=>run(args(['--source',f.filename,'--apply'])),/Écriture refusée/);
  }finally{f.cleanup();}
});
