import { db, auth } from '../firebase-config.js';
import { ref, push, onValue, off, get, runTransaction }
    from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import * as printer from './escpos-printer.js';

// ── AUTH GUARD ──────────────────────────────────
onAuthStateChanged(auth, u => {
    if (!u) { window.location.href = '../index.html'; return; }
    const role = sessionStorage.getItem('userRole');
    if (role === 'admin') { window.location.href = '../accueil/menu_admin.html'; }
});

// ── REFS FIREBASE ───────────────────────────────
const ticketRef   = ref(db, 'ticket_dbase');
const medVenteRef = ref(db, 'vente_medicaments');
const stockRef    = ref(db, 'db_pharmacie_stock');

// ── STATE ───────────────────────────────────────
let allTickets   = [];
let allMedVentes = [];
let allStock     = [];
let prixActuel   = 0;
let panier       = [];          // [{nom, prix, stock_key, qte, stock_max}]
let patientSelectionne = null;  // {name, age, attente}
let loadedT = false, loadedM = false, loadedS = false;

// ── SÉCURITÉ : Échappement XSS ──────────────────
function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

// ── HELPERS ─────────────────────────────────────
function getSafeTs(val) {
    if (val.date_heure_ts) return val.date_heure_ts;
    if (val.date) {
        const parts = val.date.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0],10), month = parseInt(parts[1],10)-1, year = parseInt(parts[2],10);
            let hr=0, min=0;
            if (val.heure) { const hp = val.heure.split(':'); if(hp.length>=2){hr=parseInt(hp[0]);min=parseInt(hp[1]);} }
            return new Date(year,month,day,hr,min).getTime();
        }
    }
    return Date.now();
}
function isToday(ts) { const d=new Date(ts),n=new Date(); return d.getDate()===n.getDate()&&d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); }
function isThisWeek(ts) {
    const d=new Date(ts),now=new Date(),dow=now.getDay(),numDay=dow===0?6:dow-1;
    const sow=new Date(now); sow.setDate(now.getDate()-numDay); sow.setHours(0,0,0,0);
    return d>=sow;
}
function isMonth(ts) { const d=new Date(ts),n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); }
function isThisQuarter(ts) {
    const d = new Date(ts), n = new Date();
    return d.getFullYear() === n.getFullYear() && Math.floor(d.getMonth()/3) === Math.floor(n.getMonth()/3);
}
function isThisYear(ts) { return new Date(ts).getFullYear()===new Date().getFullYear(); }
function fmt(n) { return Number(n).toLocaleString('fr-FR'); }
function dateTimeStr(ts) {
    const d=new Date(ts);
    return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'}) + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}
function dateISO() {
    const d=new Date();
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}
function toast(msg, type='ok') {
    const el=document.getElementById('toast');
    el.textContent=(type==='ok'?'✓ ':'✗ ')+msg;
    el.className='toast show '+type;
    setTimeout(()=>el.classList.remove('show'), 4000);
}

// ── GABARITS HTML DES REÇUS (aperçu écran + repli navigateur) ───
function buildConsultationHTML(d) {
    return `
        <div class="r-logo">🏥</div>
        <div class="r-title">POSTE DE SANTÉ DE DIANDIOLY</div>
        <div class="r-sub">TICKET DE CONSULTATION</div>
        <hr class="r-div">
        <div class="r-row"><span>Réf :</span><strong>${esc(d.refNum)}</strong></div>
        <div class="r-row"><span>Date :</span><strong>${esc(d.dateStr)}</strong></div>
        <hr class="r-div">
        <div class="r-row"><span>Prénom :</span><strong>${esc(d.prenom)}</strong></div>
        <div class="r-row"><span>Nom :</span><strong>${esc(d.nom)}</strong></div>
        <div class="r-row"><span>Âge :</span><strong>${esc(d.age)} ans</strong></div>
        <div class="r-row"><span>Prestation :</span><strong>${esc(d.choix)}</strong></div>
        <hr class="r-div">
        <div style="text-align:center; margin:8px 0;">
            <div style="font-size:0.75rem;color:#666;margin-bottom:4px;">NUMÉRO D'ATTENTE</div>
            <div class="attente-badge">${esc(d.numAttente)}</div>
        </div>
        <hr class="r-div">
        <div class="r-total">TOTAL : ${esc(d.total)} FCFA</div>
        ${d.recu>0?`<div class="r-change">Remis : ${esc(d.recuFmt)} FCFA &nbsp;|&nbsp; Monnaie : ${esc(d.monnaieFmt)} FCFA</div>`:''}
        <hr class="r-div">
        <div class="r-row" style="font-size:0.75rem;color:#666;"><span>⏰ Valide jusqu'au :</span><strong>${esc(d.validiteStr)}</strong></div>
        <div class="r-foot">Conservez ce ticket pour accéder au médecin.<br>Validité : 24 heures.</div>
    `;
}
function buildMedicamentsHTML(d) {
    const lignesMeds = d.lignes.map(p=>`
        <div class="r-row">
            <span>${esc(p.qte)}x ${esc(p.nom)}</span>
            <strong>${esc(p.montant)} FCFA</strong>
        </div>`).join('');
    return `
        <div class="r-logo">🏥</div>
        <div class="r-title">POSTE DE SANTÉ DE DIANDIOLY</div>
        <div class="r-sub">TICKET MÉDICAMENTS – À AGRAFER SUR L'ORDONNANCE</div>
        <hr class="r-div">
        <div class="r-row"><span>Réf :</span><strong>${esc(d.refNum)}</strong></div>
        <div class="r-row"><span>Date :</span><strong>${esc(d.dateStr)}</strong></div>
        <hr class="r-div">
        <div class="r-row"><span>Patient :</span><strong>${esc(d.patientNom)}</strong></div>
        <div class="r-row"><span>N° Attente :</span><strong>${esc(d.patientAtt)}</strong></div>
        <hr class="r-div">
        <div style="font-size:0.72rem;font-weight:800;color:#666;text-transform:uppercase;margin-bottom:6px;">Médicaments</div>
        ${lignesMeds}
        <hr class="r-div">
        <div class="r-total">TOTAL : ${esc(d.total)} FCFA</div>
        ${d.recu>0?`<div class="r-change">Remis : ${esc(d.recuFmt)} FCFA &nbsp;|&nbsp; Monnaie : ${esc(d.monnaieFmt)} FCFA</div>`:''}
        <div class="r-foot">Ce ticket est à AGRAFER sur l'ordonnance.<br>À présenter à la pharmacie pour la livraison.</div>
    `;
}

// ── NETTOYAGE FIABLE DE LA ZONE D'IMPRESSION ─────
// IMPORTANT : sur Android, l'événement 'afterprint' peut se déclencher
// quasi immédiatement après l'appel à window.print() — bien avant que
// l'utilisateur ait fini d'interagir avec la boîte de dialogue système
// (choix de l'imprimante / "Enregistrer en PDF"). Si on vide
// #print-content trop tôt, le PDF/impression sort VIDE. On ne vide donc
// plus automatiquement : le contenu est de toute façon systématiquement
// réécrit juste avant chaque impression suivante, donc rien ne traîne
// visuellement (la zone reste masquée hors contexte d'impression).
function printAndClear() {
    window.print();
}
// ── IMPRESSION THERMIQUE (USB, RawBT ou navigateur) ──
const PRINT_METHOD_KEY = 'ticket_print_method';

function getPrintMethod() {
    const saved = localStorage.getItem(PRINT_METHOD_KEY);
    if (saved) return saved;
    // Par défaut : BLE si disponible (impression silencieuse), sinon USB,
    // sinon RawBT sur Android, sinon repli navigateur.
    if (printer.isBLESupported()) return 'ble';
    if (printer.isWebUSBSupported()) return 'usb';
    return printer.isRawBTAvailable() ? 'rawbt' : 'browser';
}

function updatePrinterBadge() {
    const b = document.getElementById('printer-badge');
    if (!b) return;
    const method = getPrintMethod();
    if (method === 'usb' && printer.isPrinterConnected()) {
        b.textContent = '🖨️ USB connectée'; b.className = 'printer-badge ok';
    } else if (method === 'usb') {
        b.textContent = '🖨️ Connecter USB'; b.className = 'printer-badge off';
    } else if (method === 'ble' && printer.isBLEConnected()) {
        b.textContent = '🖨️ Bluetooth connectée'; b.className = 'printer-badge ok';
    } else if (method === 'ble') {
        b.textContent = '🖨️ Appairer Bluetooth'; b.className = 'printer-badge off';
    } else if (method === 'rawbt') {
        b.textContent = '📲 Impression via RawBT'; b.className = 'printer-badge ok';
    } else {
        b.textContent = '🖨️ Impression navigateur'; b.className = 'printer-badge off';
    }
    const sel = document.getElementById('print-method');
    if (sel) sel.value = method;
}

// Reconnexion silencieuse au démarrage, selon la méthode active.
(async () => {
    const m = getPrintMethod();
    if (m === 'ble') await printer.tryAutoReconnectBLE();
    else if (m === 'usb') await printer.tryAutoReconnect();
})().finally(updatePrinterBadge);

// Clic sur le badge : comportement dépend de la méthode active.
window.connectPrinter = async function() {
    const method = getPrintMethod();
    if (method !== 'usb' && method !== 'ble') {
        toast('Passez la méthode sur "Bluetooth" ou "USB" pour appairer une imprimante.', 'err');
        return;
    }
    try {
        if (method === 'ble') await printer.connectBLE();
        else await printer.connectPrinter();
        updatePrinterBadge();
        toast('Imprimante connectée avec succès.', 'ok');
    } catch (e) {
        console.error(e);
        toast("Connexion impossible : " + e.message, 'err');
    }
};

window.setPrintMethod = async function(method) {
    localStorage.setItem(PRINT_METHOD_KEY, method);
    if (method === 'ble') await printer.tryAutoReconnectBLE();
    else if (method === 'usb') await printer.tryAutoReconnect();
    updatePrinterBadge();
    toast('Méthode d\'impression : ' + method.toUpperCase(), 'ok');
};

window.printTestTicket = async function() {
    const method = getPrintMethod();
    if (method === 'usb' && !printer.isPrinterConnected()) { toast('Connectez d\'abord l\'imprimante USB.', 'err'); return; }
    if (method === 'ble' && !printer.isBLEConnected()) { toast('Appairez d\'abord l\'imprimante Bluetooth (clic sur le badge).', 'err'); return; }
    try { await printer.printTestTicket(method); toast('Ticket de test envoyé.', 'ok'); }
    catch (e) { toast('Échec de l\'impression test : ' + e.message, 'err'); }
};

// Impression unifiée : utilise la méthode choisie (USB direct, RawBT,
// ou repli navigateur via le HTML déjà injecté dans #print-content).
async function imprimerTicket(kind, data) {
    const method = getPrintMethod();
    if (method === 'usb' || method === 'rawbt' || method === 'ble') {
        try {
            if (kind === 'consultation') await printer.printTicketConsultation(data, method);
            else await printer.printTicketMedicaments(data, method);
            return;
        } catch (e) {
            console.warn('Impression ' + method + ' échouée, repli navigateur :', e);
            toast('Impression ' + method.toUpperCase() + ' indisponible — impression via le navigateur.', 'err');
        }
    }
    printAndClear();
}

function checkLoadState() {
    if (loadedT && loadedM && loadedS) {
        document.getElementById('loading-container').style.display='none';
        const b=document.getElementById('conn-badge');
        b.innerHTML='● En direct'; b.style.color='#7dffd0';
    }
}

// ── TIMEOUT LOADER (sécurité 10s) ───────────────
setTimeout(() => {
    const lc = document.getElementById('loading-container');
    if (lc && lc.style.display !== 'none') {
        lc.style.display = 'none';
        toast('Connexion lente — certaines données peuvent être incomplètes.', 'err');
    }
}, 10000);

// ── NUMÉRO D'ATTENTE ATOMIQUE (sans doublons) ────
async function prochainNumeroAttente() {
    const todayTickets = allTickets.filter(x => isToday(x._ts));
    let maxAttente = 0;
    todayTickets.forEach(t => {
        if (t.num_attente) {
            const num = parseInt(String(t.num_attente).replace(/\D/g, ''), 10);
            if (!isNaN(num) && num > maxAttente) maxAttente = num;
        }
    });

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const compteurRef = ref(db, `compteurs/attente_${today}`);
    try {
        const result = await runTransaction(compteurRef, (current) => {
            let c = current || 0;
            if (maxAttente > c) c = maxAttente;
            return c + 1;
        });
        if (result.committed) return { num: result.snapshot.val(), fiable: true };
        throw new Error('transaction non validée');
    } catch (e) {
        console.warn("Compteur en ligne indisponible — utilisation du compteur local.", e);
        return { num: maxAttente + 1, fiable: false };
    }
}
// ── STATS GLOBALES (TICKETS + MÉDICAMENTS) ───────
function updateStats() {
    const tDay = allTickets.filter(x=>isToday(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);
    const tWeek = allTickets.filter(x=>isThisWeek(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);
    const tMonth = allTickets.filter(x=>isMonth(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);
    const tQuarter = allTickets.filter(x=>isThisQuarter(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);
    const tYear = allTickets.filter(x=>isThisYear(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);

    const mDay = allMedVentes.filter(x=>isToday(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);
    const mWeek = allMedVentes.filter(x=>isThisWeek(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);
    const mMonth = allMedVentes.filter(x=>isMonth(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);
    const mQuarter = allMedVentes.filter(x=>isThisQuarter(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);
    const mYear = allMedVentes.filter(x=>isThisYear(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);

    if(document.getElementById('s-g-day')) document.getElementById('s-g-day').textContent = fmt(tDay + mDay) + ' F';
    if(document.getElementById('s-g-week')) document.getElementById('s-g-week').textContent = fmt(tWeek + mWeek) + ' F';
    if(document.getElementById('s-g-month')) document.getElementById('s-g-month').textContent = fmt(tMonth + mMonth) + ' F';
    if(document.getElementById('s-g-quarter')) document.getElementById('s-g-quarter').textContent = fmt(tQuarter + mQuarter) + ' F';
    if(document.getElementById('s-g-year')) document.getElementById('s-g-year').textContent = fmt(tYear + mYear) + ' F';

    if(document.getElementById('cnt-ticket')) document.getElementById('cnt-ticket').textContent = allTickets.filter(x=>isToday(x._ts)).length;
    if(document.getElementById('cnt-med')) document.getElementById('cnt-med').textContent = allMedVentes.filter(x=>isToday(x._ts)).length;
}

// ── FIREBASE LISTENERS ───────────────────────────
onValue(ticketRef, snap => {
    allTickets = [];
    snap.forEach(c => { allTickets.push({ _key:c.key, _ts:getSafeTs(c.val()), ...c.val() }); });
    allTickets.sort((a,b)=>b._ts-a._ts);
    updateStats(); renderHistTickets();
    loadedT=true; checkLoadState();
});

onValue(medVenteRef, snap => {
    allMedVentes = [];
    snap.forEach(c => { allMedVentes.push({ _key:c.key, _ts:getSafeTs(c.val()), ...c.val() }); });
    allMedVentes.sort((a,b)=>b._ts-a._ts);
    updateStats(); renderHistMeds();
    loadedM=true; checkLoadState();
});

onValue(stockRef, snap => {
    allStock = [];
    snap.forEach(c => { allStock.push({ _key:c.key, ...c.val() }); });
    allStock.sort((a,b)=>(a.nom||'').localeCompare(b.nom||''));
    renderMedGrid('');
    loadedS=true; checkLoadState();
});

// ── TABS ─────────────────────────────────────────
window.switchTab = function(t) {
    ['ticket','med'].forEach(id => {
        document.getElementById('pane-'+id).classList.toggle('active', id===t);
        document.getElementById('tbtn-'+id).classList.toggle('active', id===t);
    });
};

// ═══════════════════════════════════════════════
//  ONGLET 1 — TICKET DE CONSULTATION
// ═══════════════════════════════════════════════
window.selectTarif = function(card) {
    document.querySelectorAll('.tarif-card').forEach(c=>c.classList.remove('sel'));
    card.classList.add('sel');
    prixActuel = parseInt(card.dataset.prix);
    document.getElementById('r-prest').textContent = card.dataset.prest;
    document.getElementById('r-prix').textContent  = fmt(prixActuel) + ' FCFA';
    document.getElementById('r-attente').textContent = '…';
    document.getElementById('t-recu').value = '';
    document.getElementById('t-monnaie').textContent = '—';
    document.getElementById('t-monnaie').className = 'monnaie-result';
    checkTicketBtn();
};

window.calcMonnaieT = function() {
    const recu=parseFloat(document.getElementById('t-recu').value)||0;
    const m=recu-prixActuel;
    const el=document.getElementById('t-monnaie');
    el.textContent = recu>0 ? fmt(m)+' FCFA' : '—';
    el.className   = 'monnaie-result'+(m<0?' neg':'');
    checkTicketBtn();
};

function validateAge(val) {
    const n = parseInt(val, 10);
    return !isNaN(n) && n >= 0 && n <= 120;
}

function checkTicketBtn() {
    const prenom=document.getElementById('t-prenom').value.trim();
    const nom   =document.getElementById('t-nom').value.trim();
    const age   =document.getElementById('t-age').value.trim();
    const recu  =parseFloat(document.getElementById('t-recu').value)||0;

    const ageEl = document.getElementById('t-age');
    if (age && !validateAge(age)) {
        ageEl.setCustomValidity('Âge invalide (0–120 ans)');
        ageEl.reportValidity();
    } else {
        ageEl.setCustomValidity('');
    }

    let montantOk = true;
    if (recu > 0 && recu < prixActuel) {
        montantOk = false;
        document.getElementById('t-monnaie').textContent = '⚠ Montant insuffisant';
        document.getElementById('t-monnaie').className = 'monnaie-result neg';
    }

    document.getElementById('btn-ticket').disabled =
        !(prenom && nom && age && validateAge(age) && prixActuel > 0 && montantOk);
}

['t-prenom','t-nom','t-age','t-recu'].forEach(id => {
    const el=document.getElementById(id);
    if (el) el.addEventListener('input', checkTicketBtn);
});

document.querySelectorAll('.tarif-card').forEach(card => {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.selectTarif(card); }
    });
});

window.encaisserTicket = async function() {
    const prenom=document.getElementById('t-prenom').value.trim();
    const nom   =document.getElementById('t-nom').value.trim();
    const age   =document.getElementById('t-age').value.trim();
    const choix =document.querySelector('.tarif-card.sel')?.dataset.prest||'';
    const recu  =parseFloat(document.getElementById('t-recu').value)||0;
    const monnaie=recu-prixActuel;

    if (!prenom||!nom||!age||!prixActuel) return;
    if (!validateAge(age)) { toast('Âge invalide (0–120 ans).', 'err'); return; }
    if (recu > 0 && recu < prixActuel) { toast('Montant remis insuffisant.', 'err'); return; }

    const btn=document.getElementById('btn-ticket');
    btn.disabled=true; btn.innerHTML='⏳ Enregistrement…';

    const now=Date.now();
    const { num: nAtt, fiable } = await prochainNumeroAttente();
    const numAttente='N° ' + String(nAtt).padStart(3, '0');
    if (!fiable) toast('Connexion instable : risque de doublon.', 'err');
    
    const validiteTs=now + 24*60*60*1000;
    const validiteStr=new Date(validiteTs).toLocaleDateString('fr-FR')+' à '+new Date(validiteTs).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});

    const payload = {
        name:           prenom+' '+nom,
        prenom, nom, age: parseInt(age),
        choix, prix: prixActuel,
        num_attente:    numAttente,
        argent_remis:   recu,
        monnaie_rendue: monnaie,
        date:           new Date(now).toLocaleDateString('fr-FR'),
        heure:          new Date(now).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),
        date_heure_ts:  now,
        validite_ts:    validiteTs
    };

    try {
        const newRef=await push(ticketRef, payload);
        const refNum='TK-'+newRef.key.substring(0,6).toUpperCase();
        const dateStr=dateISO();

        const ticketData = {
            refNum, dateStr, prenom, nom, age, choix, numAttente,
            total: fmt(prixActuel),
            recu, recuFmt: fmt(recu), monnaieFmt: fmt(monnaie),
            validiteStr
        };
        document.getElementById('print-content').innerHTML = buildConsultationHTML(ticketData);
        await imprimerTicket('consultation', ticketData);
        toast('Ticket enregistré et imprimé avec succès.','ok');

        document.getElementById('t-prenom').value='';
        document.getElementById('t-nom').value='';
        document.getElementById('t-age').value='';
        document.getElementById('t-recu').value='';
        document.getElementById('t-monnaie').textContent='—';
        document.getElementById('t-monnaie').className='monnaie-result';
        document.getElementById('r-prest').textContent='—';
        document.getElementById('r-prix').textContent='— FCFA';
        document.getElementById('r-attente').textContent='—';
        document.querySelectorAll('.tarif-card').forEach(c=>c.classList.remove('sel'));
        prixActuel=0;
    } catch(e) {
        console.error(e); toast('Erreur lors de l\'enregistrement.','err');
    } finally {
        btn.disabled=false; btn.innerHTML='🖨️ Encaisser &amp; Imprimer le Ticket';
        checkTicketBtn();
    }
};

window.renderHistTickets = function() {
    const tbody=document.getElementById('hist-tickets');
    const filter=document.getElementById('filter-tickets').value;
    let list = filterByPeriod(allTickets, filter);
    const countEl = document.getElementById('hist-tickets-count');
    if (countEl) countEl.textContent = list.length ? `(${list.length})` : '';
    if (!list.length) {
        tbody.innerHTML=`<tr><td colspan="6" class="hist-empty">Aucun ticket pour cette période.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(x=>`
        <tr>
            <td><span class="tbadge" style="background:var(--accent);color:white;">${esc(x.num_attente||'—')}</span></td>
            <td><strong>${esc(x.name||'—')}</strong></td>
            <td>${esc(x.age||'—')} ans</td>
            <td><span class="tbadge">${esc(x.choix||'—')}</span></td>
            <td><strong>${esc(fmt(x.prix||0))} FCFA</strong></td>
            <td style="white-space:nowrap;font-size:.75rem;color:var(--muted);">${esc(dateTimeStr(x._ts))}</td>
            <td><button type="button" class="btn-reprint" onclick="reimprimerTicket('${x._key}')">🖨️ Réimprimer</button></td>
        </tr>
    `).join('');
};

window.reimprimerTicket = async function(key) {
    const x = allTickets.find(t => t._key === key);
    if (!x) { toast('Ticket introuvable.', 'err'); return; }
    const validiteTs = x.validite_ts || (x._ts + 24*60*60*1000);
    const data = {
        refNum: 'TK-'+key.substring(0,6).toUpperCase(),
        dateStr: (x.date||'')+' '+(x.heure||''),
        prenom: x.prenom||'', nom: x.nom||'', age: x.age||'', choix: x.choix||'',
        numAttente: x.num_attente||'—',
        total: fmt(x.prix||0),
        recu: x.argent_remis||0, recuFmt: fmt(x.argent_remis||0), monnaieFmt: fmt(x.monnaie_rendue||0),
        validiteStr: new Date(validiteTs).toLocaleDateString('fr-FR')+' à '+new Date(validiteTs).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
    };
    document.getElementById('print-content').innerHTML = buildConsultationHTML(data);
    await imprimerTicket('consultation', data);
    toast('Ticket réimprimé.', 'ok');
};
// ═══════════════════════════════════════════════
//  ONGLET 2 — MÉDICAMENTS ORDONNANCE
// ═══════════════════════════════════════════════
window.filtrerPatients = function() {
    const q=document.getElementById('m-search-patient').value.trim().toLowerCase();
    const container=document.getElementById('patient-suggestions');
    if (!q) { container.innerHTML=''; return; }
    const todayTickets=allTickets.filter(x=>isToday(x._ts)&&(x.name||'').toLowerCase().includes(q));
    if (!todayTickets.length) {
        container.innerHTML='<div style="padding:8px;font-size:0.8rem;color:var(--muted);">Aucun patient trouvé aujourd\'hui</div>';
        return;
    }
    window._patientSuggestions = todayTickets.slice(0, 5);
    container.innerHTML = window._patientSuggestions.map((x, i)=>`
        <div class="patient-item" tabindex="0" role="button"
             onclick="selectPatientById(${i})"
             onkeydown="if(event.key==='Enter'||event.key===' '){selectPatientById(${i})}">
            <span>${esc(x.name||'—')} (${esc(String(x.age||'?'))} ans)</span>
            <span class="pi-attente">${esc(x.num_attente||'—')}</span>
        </div>
    `).join('');
};

window.selectPatientById = function(i) {
    const p = (window._patientSuggestions || [])[i];
    if (!p) return;
    window.selectPatient(p);
};

window.selectPatient = function(p) {
    patientSelectionne = p;
    document.getElementById('m-search-patient').value = p.name || '';
    document.getElementById('patient-suggestions').innerHTML='';
    document.getElementById('patient-selectionne').style.display='block';
    document.getElementById('ps-nom').textContent = (p.name||'—') + ' · ' + (p.age||'?') + ' ans';
    document.getElementById('ps-attente').textContent = p.num_attente||'—';
    checkMedBtn();
};

function renderMedGrid(q) {
    const container = document.getElementById('med-liste');
    if (!allStock.length) {
        container.innerHTML='<div class="med-empty">Chargement des médicaments…</div>';
        return;
    }
    
    const filtered = allStock.filter(m => {
        if (!q) return true;
        return (m.nom||'').toLowerCase().includes(q.toLowerCase()) ||
               (m.categorie||'').toLowerCase().includes(q.toLowerCase());
    });
    
    if (!filtered.length) {
        const msg = q ? `Aucun médicament trouvé pour "${esc(q)}".` : 'Aucun médicament enregistré dans la base.';
        container.innerHTML=`<div class="med-empty">${msg}</div>`;
        return;
    }
    
    const panierNoms = panier.map(p => p.stock_key);
    
    const items = filtered.map(m => {
        const inPanier = panierNoms.includes(m._key);
        const rawStock = m.quantite !== undefined ? m.quantite : 0;
        const stockNum = parseInt(rawStock, 10) || 0; 
        const seuilNum = parseInt(m.seuil_alerte, 10) || 10;
        
        const isLowStock = stockNum > 0 && stockNum <= seuilNum;
        const isOutOfStock = stockNum <= 0;

        const today = new Date(); today.setHours(0,0,0,0);
        let perimStr = '', perimClass = '';
        if (m.date_peremption) {
            const pd = new Date(m.date_peremption);
            if (!isNaN(pd.getTime())) {
                const daysLeft = Math.ceil((pd-today)/(1000*3600*24));
                const perimAffiche = pd.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});
                if (daysLeft < 0) { perimStr = 'PÉRIMÉ'; perimClass = 'med-perim'; }
                else if (daysLeft < 30) { perimStr = `Expire dans ${daysLeft}j`; perimClass = 'med-perim'; }
                else perimStr = `Exp. ${esc(perimAffiche)}`;
            }
        }

        const hasPrix = (m.prix_unitaire !== undefined && m.prix_unitaire !== null && m.prix_unitaire !== '');
        const prixHtml = hasPrix
            ? `<div class="med-prix">${esc(fmt(m.prix_unitaire))} FCFA${inPanier?' ✓':''}</div>`
            : (inPanier ? `<div class="med-prix">✓</div>` : '');
        const catHtml = m.categorie ? ` · <span style="font-style:italic;">${esc(m.categorie)}</span>` : '';
        
        const isBlocked = inPanier || isOutOfStock;
        
        return `
            <div class="med-item ${inPanier ? 'added' : ''}"
                 tabindex="${isBlocked ? '-1' : '0'}" role="button"
                 style="${isOutOfStock ? 'opacity: 0.5; cursor: not-allowed; border-color: var(--danger);' : ''}"
                 onclick="${isBlocked ? '' : `ajouterMed('${m._key}')`}"
                 onkeydown="if(!${isBlocked}&&(event.key==='Enter'||event.key===' ')){ajouterMed('${m._key}')}">
                <div class="med-item-left">
                    <div class="med-nom">${esc(m.nom||'—')}</div>
                    <div class="med-meta">
                        Stock : <span class="${isLowStock ? 'med-stock-low' : ''}">${stockNum}</span>
                        ${isOutOfStock ? ' <b style="color:var(--danger)">(Rupture)</b>' : ''}
                        ${catHtml}
                        ${perimStr ? ' · <span class="'+perimClass+'">'+perimStr+'</span>' : ''}
                    </div>
                </div>
                ${prixHtml}
            </div>`;
    }).filter(Boolean);
    
    const hint = filtered.length > 4
        ? `<div class="med-grid-hint">↕ ${filtered.length} médicaments trouvés — faites défiler</div>`
        : '';
        
    container.innerHTML = items.join('') + hint;
}

window.filtrerMeds = function() {
    const q=document.getElementById('m-search').value;
    renderMedGrid(q);
};

window.ajouterMed = function(key) {
    const med = allStock.find(m => m._key === key);
    if (!med) return;
    
    const stockDispo = parseInt(med.quantite, 10) || 0;
    const existing = panier.find(p => p.stock_key === key);
    if (existing) {
        if (existing.qte < stockDispo) existing.qte++;
        else toast('Stock insuffisant !', 'err');
    } else {
        const prix = (med.prix_unitaire !== undefined && med.prix_unitaire !== null && med.prix_unitaire !== '') ? parseFloat(med.prix_unitaire) : 0;
        panier.push({ nom: med.nom, prix: prix, stock_key: key, qte: 1, stock_max: stockDispo });
    }
    renderPanier(); 
    renderMedGrid(document.getElementById('m-search').value); 
    checkMedBtn();
};

window.modifierQte = function(key, delta) {
    const item = panier.find(p => p.stock_key === key);
    if (!item) return;
    item.qte += delta;
    if (item.qte <= 0) retirerMed(key);
    else if (item.qte > item.stock_max) {
        item.qte = item.stock_max; toast('Stock maximum atteint !', 'err');
    } else { renderPanier(); calcMonnaieM(); }
};

window.retirerMed = function(key) {
    panier = panier.filter(p=>p.stock_key!==key);
    renderPanier();
    renderMedGrid(document.getElementById('m-search').value);
    checkMedBtn();
};

function renderPanier() {
    const container = document.getElementById('panier-liste');
    const total = panier.reduce((s,p) => s + (p.prix * p.qte), 0);
    document.getElementById('panier-count').textContent = panier.length;
    document.getElementById('panier-total').textContent = fmt(total) + ' FCFA';
    
    if (!panier.length) {
        container.outerHTML = '<div id="panier-liste" class="panier-vide">Aucun médicament sélectionné</div>';
        document.getElementById('m-recu').value = ''; 
        calcMonnaieM();
        return;
    }
    
    container.outerHTML = `<div id="panier-liste" class="panier-list">${panier.map(p => `
        <div class="panier-item">
            <div style="flex:1;">
                <div class="panier-item-nom">💊 ${esc(p.nom)}</div>
                <div style="font-size:0.7rem;color:var(--muted);">${esc(fmt(p.prix))} F / unité</div>
            </div>
            <div class="panier-qte-ctrl">
                <button class="panier-btn" onclick="modifierQte('${esc(p.stock_key)}', -1)">-</button>
                <div class="panier-qte-val">${p.qte}</div>
                <button class="panier-btn" onclick="modifierQte('${esc(p.stock_key)}', 1)">+</button>
            </div>
            <div class="panier-item-prix" style="width:70px;text-align:right;">${esc(fmt(p.prix * p.qte))} F</div>
            <button class="panier-del" style="margin-left:10px;" onclick="retirerMed('${esc(p.stock_key)}')">✕</button>
        </div>`).join('')}</div>`;
    calcMonnaieM();
}

window.calcMonnaieM = function() {
    const total = panier.reduce((s,p) => s + (p.prix * p.qte), 0);
    const recu = parseFloat(document.getElementById('m-recu').value) || 0;
    const m = recu - total;
    const el = document.getElementById('m-monnaie');
    el.textContent = recu > 0 ? fmt(m) + ' FCFA' : '—';
    el.className = 'monnaie-result' + (m < 0 ? ' neg' : '');
};

function checkMedBtn() {
    document.getElementById('btn-med').disabled = panier.length === 0;
}

window.encaisserMedicaments = async function() {
    if (!panier.length) return;
    if (!loadedS) {
        toast("⏳ Chargement du stock en cours — veuillez patienter avant d'encaisser.", 'err');
        return;
    }
    const total = panier.reduce((s,p) => s + (p.prix * p.qte), 0);
    const recu = parseFloat(document.getElementById('m-recu').value) || 0;
    const monnaie = recu - total;

    if (recu > 0 && recu < total) { toast('Montant remis insuffisant.', 'err'); return; }

    const patientNom = patientSelectionne ? patientSelectionne.name : '(non identifié)';
    const patientAtt = patientSelectionne ? (patientSelectionne.num_attente||'—') : '—';

    const btn=document.getElementById('btn-med');
    btn.disabled=true; btn.innerHTML='⏳ Enregistrement…';

    const now=Date.now();
    const payload = {
        patient_nom:  patientNom,
        num_attente:  patientAtt,
        medicaments:  panier.map(p=>({nom:p.nom, prix:p.prix, qte:p.qte})),
        total,
        argent_remis: recu,
        monnaie_rendue: monnaie,
        date:  new Date(now).toLocaleDateString('fr-FR'),
        heure: new Date(now).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),
        date_heure_ts: now
    };

    try {
        const stockErrors = [];
        for (const item of panier) {
            const itemStockRef = ref(db, `db_pharmacie_stock/${item.stock_key}/quantite`);
            try {
                await runTransaction(itemStockRef, (current) => {
                    const n = parseInt(current, 10);
                    if (isNaN(n) || n < item.qte) return; 
                    return n - item.qte; 
                });
            } catch (stockErr) {
                stockErrors.push(item.nom);
            }
        }
        if (stockErrors.length) toast(`Stock non mis à jour pour : ${stockErrors.join(', ')}`, 'err');

        const newRef=await push(medVenteRef, payload);
        const refNum='MED-'+newRef.key.substring(0,6).toUpperCase();
        const dateStr=dateISO();

        const medData = {
            refNum, dateStr, patientNom, patientAtt,
            lignes: panier.map(p => ({ nom: p.nom, qte: p.qte, montant: fmt(p.prix * p.qte) })),
            total: fmt(total),
            recu, recuFmt: fmt(recu), monnaieFmt: fmt(monnaie)
        };
        document.getElementById('print-content').innerHTML = buildMedicamentsHTML(medData);
        await imprimerTicket('medicaments', medData);
        toast('Vente enregistrée et ticket imprimé.','ok');

        panier=[];
        patientSelectionne=null;
        document.getElementById('m-search-patient').value='';
        document.getElementById('m-search').value='';
        document.getElementById('patient-selectionne').style.display='none';
        document.getElementById('m-recu').value='';
        document.getElementById('m-monnaie').textContent='—';
        document.getElementById('m-monnaie').className='monnaie-result';
        document.getElementById('panier-count').textContent='0';
        document.getElementById('panier-total').textContent='0 FCFA';
        const pl=document.getElementById('panier-liste');
        if (pl) pl.outerHTML='<div id="panier-liste" class="panier-vide">Aucun médicament sélectionné</div>';
        renderMedGrid('');
    } catch(e) {
        console.error(e); toast('Erreur lors de l\'enregistrement.','err');
    } finally {
        btn.disabled=false; btn.innerHTML='🖨️ Encaisser &amp; Générer le Ticket Ordonnance';
        checkMedBtn();
    }
};

window.renderHistMeds = function() {
    const tbody=document.getElementById('hist-meds');
    const filter=document.getElementById('filter-meds').value;
    let list=filterByPeriod(allMedVentes,filter);
    const countEl = document.getElementById('hist-meds-count');
    if (countEl) countEl.textContent = list.length ? `(${list.length})` : '';
    if (!list.length) {
        tbody.innerHTML=`<tr><td colspan="5" class="hist-empty">Aucune vente pour cette période.</td></tr>`;
        return;
    }
    tbody.innerHTML=list.map(x=>`
        <tr>
            <td><span class="tbadge ordo">MED-${esc(x._key.substring(0,6).toUpperCase())}</span></td>
            <td><strong>${esc(x.patient_nom||'—')}</strong></td>
            <td><strong>${esc(fmt(x.total||0))} FCFA</strong></td>
            <td>${esc(String((x.medicaments||[]).length))}</td>
            <td style="white-space:nowrap;font-size:.75rem;color:var(--muted);">${esc(dateTimeStr(x._ts))}</td>
            <td><button type="button" class="btn-reprint" onclick="reimprimerMed('${x._key}')">🖨️ Réimprimer</button></td>
        </tr>
    `).join('');
};

window.reimprimerMed = async function(key) {
    const x = allMedVentes.find(m => m._key === key);
    if (!x) { toast('Vente introuvable.', 'err'); return; }
    const data = {
        refNum: 'MED-'+key.substring(0,6).toUpperCase(),
        dateStr: (x.date||'')+' '+(x.heure||''),
        patientNom: x.patient_nom||'(non identifié)', patientAtt: x.num_attente||'—',
        lignes: (x.medicaments||[]).map(m => ({ nom: m.nom, qte: m.qte, montant: fmt((m.prix||0) * (m.qte||0)) })),
        total: fmt(x.total||0),
        recu: x.argent_remis||0, recuFmt: fmt(x.argent_remis||0), monnaieFmt: fmt(x.monnaie_rendue||0)
    };
    document.getElementById('print-content').innerHTML = buildMedicamentsHTML(data);
    await imprimerTicket('medicaments', data);
    toast('Ticket réimprimé.', 'ok');
};

function filterByPeriod(list, period) {
    if (period==='day')   return list.filter(x=>isToday(x._ts));
    if (period==='week')  return list.filter(x=>isThisWeek(x._ts));
    if (period==='month') return list.filter(x=>isMonth(x._ts));
    if (period==='quarter') return list.filter(x=>isThisQuarter(x._ts)); 
    if (period==='year')  return list.filter(x=>isThisYear(x._ts));
    return list;
}

window.addEventListener('beforeunload', () => { off(ticketRef); off(medVenteRef); off(stockRef); });