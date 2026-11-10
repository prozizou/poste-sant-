// Each scene: id, num, title, html(D) where D(f) returns a delay string from a fraction of narration
const card = (icon, title, sub, d, cls='') => `<div class="card a-up ${cls}" style="animation-delay:${d}s"><div class="ic">${icon}</div><div><b>${title}</b>${sub?`<span>${sub}</span>`:''}</div></div>`;
const step = (n, t, d) => `<div class="step a-pop" style="animation-delay:${d}s"><div class="sn">${n}</div><div>${t}</div></div>`;
module.exports = [
 {id:'intro', html:D=>`
  <div class="center">
   <div class="logo a-pop" style="animation-delay:0.2s"><svg viewBox="0 0 100 100"><rect x="38" y="12" width="24" height="76" rx="6" fill="#fff"/><rect x="12" y="38" width="76" height="24" rx="6" fill="#fff"/></svg></div>
   <h1 class="big a-up" style="animation-delay:0.8s">Poste de Santé</h1>
   <p class="lead a-up" style="animation-delay:1.4s">Application de gestion des postes de santé de village</p>
   <div class="chips">
    ${['Caisse','Pharmacie','Dépenses','Rapports','Multi-villages'].map((c,i)=>`<span class="chip a-pop" style="animation-delay:${D(.35+i*.08)}s">${c}</span>`).join('')}
   </div>
   <p class="small a-fade" style="animation-delay:${D(.8)}s">Présentation de A à Z</p>
  </div>`},
 {id:'contexte', num:'01', title:'Le contexte', html:D=>`
  <div class="two">
   <div class="col">
    <h3 class="a-up" style="animation-delay:${D(.12)}s">Avant</h3>
    ${card('📒','Registres papier','caisse, pharmacie, dépenses',D(.18),'bad')}
    ${card('🧮','Erreurs de calcul','totaux incohérents',D(.32),'bad')}
    ${card('📦','Pertes de stock','ruptures, péremptions',D(.38),'bad')}
    ${card('⏳','Rapports tardifs','consolidation manuelle',D(.44),'bad')}
   </div>
   <div class="arrow a-pop" style="animation-delay:${D(.58)}s">➜</div>
   <div class="col">
    <h3 class="a-up" style="animation-delay:${D(.6)}s">Après</h3>
    <div class="phone a-up" style="animation-delay:${D(.66)}s">
      <div class="ph-top">Poste de santé · Diandioly</div>
      <div class="ph-kpi"><div><small>Recettes du jour</small><b>48 500 F</b></div><div><small>Tickets</small><b>37</b></div></div>
      <div class="ph-row">💊 Pharmacie</div><div class="ph-row">🧾 Facturation</div><div class="ph-row">📊 Rapports</div>
    </div>
    <p class="cap a-fade" style="animation-delay:${D(.82)}s">Un outil unique, sur un simple téléphone</p>
   </div>
  </div>`},
 {id:'archi', num:'02', title:'Architecture technique', html:D=>`
  <div class="archi">
   <div class="node client a-pop" style="animation-delay:${D(.05)}s"><div class="ic">📱</div><b>Application web progressive</b><span>JavaScript natif · sans framework<br>installable · fonctionne hors ligne</span></div>
   <div class="links">
    <div class="line a-grow" style="animation-delay:${D(.35)}s"></div>
    <div class="line a-grow" style="animation-delay:${D(.5)}s"></div>
    <div class="line a-grow" style="animation-delay:${D(.78)}s"></div>
   </div>
   <div class="stack">
    <div class="node a-up" style="animation-delay:${D(.35)}s"><div class="ic">🔥</div><b>Firebase</b><span>Authentification · Realtime Database · règles d'accès</span></div>
    <div class="node a-up" style="animation-delay:${D(.52)}s"><div class="ic">▲</div><b>Vercel — fonctions API</b><span>caisse · pharmacie · accès · notifications</span></div>
    <div class="node a-up" style="animation-delay:${D(.8)}s"><div class="ic">🖼️</div><b>Cloudinary</b><span>images des médicaments</span></div>
   </div>
  </div>`},
 {id:'roles', num:'03', title:'Connexion et rôles', html:D=>`
  <div class="two">
   <div class="col narrow">
    <div class="login a-up" style="animation-delay:${D(.02)}s">
     <b>Connexion</b><span>Code secret</span>
     <div class="pin">${[0,1,2,3,4,5].map(i=>`<i class="a-pop" style="animation-delay:${D(.06+i*.025)}s">●</i>`).join('')}</div>
     <div class="btn">Se connecter</div>
    </div>
   </div>
   <div class="col roles">
    ${card('👑','Super administrateur','tous les villages',D(.22))}
    ${card('🏥','Administrateur local','son poste et son équipe',D(.35))}
    ${card('💵','Caissier','consultations et médicaments',D(.47))}
    ${card('📈','Trésorier','dépenses et bilans',D(.58))}
    ${card('🩺','Infirmier chef de poste (ICP)','supervision',D(.7))}
   </div>
  </div>`},
 {id:'villages', num:'04', title:'Multi-villages, données isolées', html:D=>`
  <div class="vill">
   ${[['Diandioly','#1e9e8f'],['Keur Moussa','#3a7bd5'],['Ndiaffate','#8e5bd6']].map(([n,c],i)=>`${i?`<div class="wall a-grow-y" style="animation-delay:${D(.45)}s"></div>`:''}
   <div class="village a-up" style="animation-delay:${D(.1+i*.08)}s;--c:${c}">
     <div class="vh">🏘️ ${n}</div>
     <div class="vb">Caisse<br>Stock<br>Dépenses<br>Équipe</div>
   </div>`).join('')}
  </div>
  <div class="deny a-pop" style="animation-delay:${D(.52)}s">⛔ Accès refusé entre villages</div>
  <p class="cap a-fade" style="animation-delay:${D(.78)}s">Isolation garantie par les règles de la base de données — pas seulement par l'interface</p>`},
 {id:'facturation', num:'05', title:'Facturation', html:D=>`
  <div class="two">
   <div class="col">
    <div class="steps">${step(1,'Patient',D(.1))}${step(2,'Prestation',D(.15))}${step(3,'Encaissement',D(.2))}</div>
    <div class="tarifs">
     ${[['Consultation adulte','500 F'],['Consultation enfant','300 F'],['Consultation prénatale','700 F'],['Pansement','200 F'],['Accouchement','5 000 F']].map(([a,b],i)=>`<div class="tarif a-up" style="animation-delay:${D(.3+i*.06)}s"><span>${a}</span><b>${b}</b></div>`).join('')}
    </div>
   </div>
   <div class="col">
    <div class="ticket a-print" style="animation-delay:${D(.66)}s">
     <b>POSTE DE SANTÉ</b><small>Diandioly</small><hr>
     <div class="big-n">N° 024</div><small>Numéro d'attente</small><hr>
     <div class="tl"><span>Consultation adulte</span><span>500</span></div>
     <div class="tl"><span>Reçu</span><span>1 000</span></div>
     <div class="tl"><b>Monnaie</b><b>500</b></div><hr><small>Imprimante thermique 58 mm</small>
    </div>
   </div>
  </div>`},
 {id:'pharmacie', num:'06', title:'Pharmacie et stock', html:D=>`
  <div class="two">
   <div class="col">
    <div class="stock">
     ${[['💊','Paracétamol 500 mg','Lot A12 · exp. 03/2027',212],['💉','Amoxicilline 500 mg','Lot B07 · exp. 11/2026',84],['🧴','SRO sachet','Lot C03 · exp. 01/2027',150],['🩹','Bande 10 cm','Lot D21 · exp. 06/2028',40]].map(([e,n,l,q],i)=>`
      <div class="srow a-up" style="animation-delay:${D(.05+i*.06)}s"><div class="thumb">${e}</div><div class="sn2"><b>${n}</b><span>${l}</span></div><div class="q"><span class="qa" style="animation-delay:${D(.3)}s">${q}</span><span class="qb" style="animation-delay:${D(.3)}s">${q-(i==0?6:i==1?2:0)}</span></div></div>`).join('')}
    </div>
   </div>
   <div class="col">
    ${card('⚡','Stock décrémenté instantanément','à chaque vente validée',D(.3))}
    ${card('🗓️','Gestion par lots — FEFO','premier périmé, premier sorti',D(.48))}
    ${card('🔁','Réapprovisionnements','entrées tracées',D(.62))}
    ${card('📜','Historique des mouvements','avec miniature du produit',D(.72))}
   </div>
  </div>`},
 {id:'annulation', num:'07', title:'Retours et annulations', html:D=>`
  <div class="center">
   <div class="sale a-up" style="animation-delay:${D(.05)}s"><span>Vente n° 0147 · Amoxicilline × 2</span><b>1 200 F</b><div class="strike a-grow" style="animation-delay:${D(.2)}s"></div></div>
   <div class="motif a-up" style="animation-delay:${D(.25)}s">Motif obligatoire : <i>erreur de saisie</i></div>
   <div class="row3">
    ${card('↩️','Stock restauré','+2 Amoxicilline',D(.42))}
    ${card('🗑️','Corbeille du village','suppressions encadrées',D(.6))}
    ${card('🔍','Traçabilité','rien ne disparaît',D(.8))}
   </div>
  </div>`},
 {id:'rapports', num:'08', title:'Dépenses et rapports', html:D=>`
  <div class="two">
   <div class="col">
    <div class="chart a-up" style="animation-delay:${D(.05)}s">
     <div class="legend"><span class="lg r"></span>Recettes <span class="lg d"></span>Dépenses</div>
     <div class="bars">${[[60,30],[72,35],[55,40],[80,32],[90,38],[76,30]].map(([r,d],i)=>`<div class="bg"><div class="bar r a-grow-y" style="height:${r}%;animation-delay:${D(.25+i*.04)}s"></div><div class="bar d a-grow-y" style="height:${d}%;animation-delay:${D(.27+i*.04)}s"></div><small>${['Juin','Juil.','Août','Sept.','Oct.','Nov.'][i]}</small></div>`).join('')}</div>
     <div class="solde a-fade" style="animation-delay:${D(.45)}s">Solde de caisse : <b>412 300 F</b></div>
    </div>
   </div>
   <div class="col">
    <div class="pdf a-up" style="animation-delay:${D(.55)}s"><b>📄 Bilan PDF</b><span>évolution mensuelle · détail des recettes</span><div class="sig"><div>Signature ICP</div><div>Signature CDS</div></div></div>
    <div class="exports">${['CSV','Excel','Partager'].map((x,i)=>`<span class="chip a-pop" style="animation-delay:${D(.85+i*.04)}s">${x}</span>`).join('')}</div>
   </div>
  </div>`},
 {id:'notifs', num:'09', title:'Notifications en temps réel', html:D=>`
  <div class="center">
   <div class="phone small-ph a-up" style="animation-delay:${D(.03)}s">
     <div class="ph-top">12:42</div>
     ${['Ticket n° 025 · Consultation enfant · 300 F','Vente pharmacie · 2 produits · 1 450 F','Ticket n° 026 · CPN · 700 F'].map((t,i)=>`<div class="notif a-slide" style="animation-delay:${D(.2+i*.18)}s"><b>🔔 Poste de santé</b><span>${t}</span></div>`).join('')}
   </div>
   <p class="cap a-fade" style="animation-delay:${D(.7)}s">Notification push à chaque opération de caisse, via un relais serveur</p>
  </div>`},
 {id:'securite', num:'10', title:'Sécurité et fiabilité', html:D=>`
  <div class="grid4">
   ${card('🔒','Écritures via l\'API','caisse et stock côté serveur',D(.08))}
   ${card('⚛️','Transactions atomiques','solde, quantités, numéros',D(.2))}
   ${card('🆔','Identifiant unique par commande','renvoi sans double comptage',D(.38))}
   ${card('✅','Tests automatisés + CI','chaque modification vérifiée',D(.75))}
  </div>
  <div class="net a-fade" style="animation-delay:${D(.5)}s">📶 coupure réseau → ↻ renvoi → <b>1 seule</b> opération enregistrée</div>`},
 {id:'abonnement', num:'11', title:'Super administration et abonnement', html:D=>`
  <div class="two">
   <div class="col">
    ${card('➕','Création des villages','',D(.08))}
    ${card('🧑‍💼','Désignation des administrateurs','',D(.15))}
    ${card('📋','Suivi des abonnements','',D(.22))}
    <div class="wave a-pop" style="animation-delay:${D(.32)}s">Abonnement mensuel · paiement <b>Wave</b></div>
   </div>
   <div class="col">
    <div class="cal a-up" style="animation-delay:${D(.4)}s">
     ${Array.from({length:28},(_,i)=>{const d=i+1;const c=d>=10&&d<=18?'g':d>=19?'r':'';return `<div class="day ${c}">${d}</div>`}).join('')}
    </div>
    <div class="leg2"><span class="a-fade" style="animation-delay:${D(.5)}s"><i class="g"></i>10 → 18 : carte de rappel</span><span class="a-fade" style="animation-delay:${D(.65)}s"><i class="r"></i>dès le 19 : accès suspendu si impayé</span><span class="a-fade" style="animation-delay:${D(.85)}s">✅ rétabli dès la validation</span></div>
   </div>
  </div>`},
 {id:'conclusion', num:'', title:'', html:D=>`
  <div class="center">
   <h2 class="a-up" style="animation-delay:0.2s">En résumé</h2>
   <div class="grid5">
    ${[['💵','Caisse fiable'],['💊','Pharmacie maîtrisée'],['📊','Rapports clairs'],['🔐','Données protégées'],['🏘️','Isolées par village']].map(([e,t],i)=>`<div class="sum a-pop" style="animation-delay:${D(.08+i*.1)}s"><div>${e}</div><b>${t}</b></div>`).join('')}
   </div>
   <div class="logo sm a-pop" style="animation-delay:${D(.7)}s"><svg viewBox="0 0 100 100"><rect x="38" y="12" width="24" height="76" rx="6" fill="#fff"/><rect x="12" y="38" width="76" height="24" rx="6" fill="#fff"/></svg></div>
   <p class="lead a-up" style="animation-delay:${D(.75)}s">Poste de Santé — la gestion moderne au service de chaque poste rural</p>
  </div>`},
];
