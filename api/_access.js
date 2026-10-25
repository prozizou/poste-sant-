'use strict';
const OWNER_EMAIL = 'prozizou298@gmail.com';
const STAFF = Object.freeze(['caissier','tresorier','icp']);
const ROLE = Object.freeze(['admin',...STAFF]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const forbidden = (msg='Accès non autorisé.')=>Object.assign(new Error(msg),{status:403});
async function identity(db, user) {
 if(!user?.uid) throw Object.assign(new Error('Authentification requise.'),{status:401});
 const record = (await db.ref('db_users/'+user.uid).once('value')).val();
 if(!record || record.active===false) throw forbidden('Compte suspendu ou non enregistré.');
 const owner = (await db.ref('superadmins/'+user.uid).once('value')).val();
 if(owner?.active===true && owner.email===OWNER_EMAIL && user.email?.toLowerCase()===OWNER_EMAIL
    && record.role==='superadmin') return {uid:user.uid,email:user.email,role:'superadmin',global:true};
 if(record.role==='superadmin') throw forbidden('Accès global non confirmé.');
 if(!ROLE.includes(record.role) || !SLUG.test(record.village_id||'')) throw forbidden('Rôle ou village invalide.');
 const village=(await db.ref('villages_registry/'+record.village_id).once('value')).val();
 if(village?.active!==true) throw forbidden('Village inactif.');
 if(Number(village.expires_ts)>0 && Number(village.expires_ts)<Date.now()) throw forbidden('Accès du village expiré.');
 return {uid:user.uid,email:user.email,role:record.role,villageId:record.village_id,global:false};
}
function mayManage(actor, role, villageId) {
 if(!ROLE.includes(role) || !SLUG.test(villageId||'')) throw forbidden('Rôle ou village invalide.');
 if(actor.global) { if(role!=='admin') throw forbidden('Le super administrateur gère les administrateurs locaux uniquement.');return; }
 if(actor.role!=='admin' || actor.villageId!==villageId || !STAFF.includes(role))
   throw forbidden('L’administrateur local ne peut gérer que son équipe.');
}
module.exports={OWNER_EMAIL,STAFF,ROLE,SLUG,EMAIL,identity,mayManage,forbidden};
