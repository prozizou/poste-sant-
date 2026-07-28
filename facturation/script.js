import { db, auth } from '../firebase-config.js';
import { ref, push, onValue, off, get, update, runTransaction }
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

// ── GABARITS HTML DES REÇUS (repli navigateur) ───
// Les logos et le formatage du numéro d'attente proviennent de
// escpos-printer.js : une seule source de vérité, donc un reçu
// HTML et un ticket thermique rigoureusement identiques.
const SVG_CROIX = printer.SVG_CROIX;
const SVG_HYGIE = printer.SVG_HYGIE;
const attenteDigits = printer.attenteDigits;

function receiptHead(svg, sousTitre, bandeau = '') {
    return `
        <header class="r-head">
            ${svg}
            <h1 class="r-title">Poste de Santé de Diandioly</h1>
            <p class="r-sub">${esc(sousTitre)}</p>
        </header>
        ${bandeau ? `<div class="r-banner">${esc(bandeau)}</div>` : ''}`;
}

function rRow(label, value, strong = true) {
    return `<div class="r-row"><span class="r-lbl">${esc(label)}</span>` +
           `<span class="r-dots"></span>` +
           `<${strong?'strong':'span'} class="r-val">${esc(value)}</${strong?'strong':'span'}></div>`;
}

function buildConsultationHTML(d) {
    return `
        ${receiptHead(SVG_CROIX, 'Ticket de consultation')}
        <hr class="r-div solid">
        ${rRow('Référence', d.refNum)}
        ${rRow('Date', d.dateStr)}
        <hr class="r-div">
        <h2 class="r-sect">Patient</h2>
        ${rRow('Nom', d.nom)}
        ${rRow('Prénom', d.prenom)}
        ${rRow('Âge', d.age + ' ans')}
        <hr class="r-div">
        <h2 class="r-sect">Prestation</h2>
        <p class="r-free">${esc(d.choix)}</p>
        <hr class="r-div">
        <div class="r-attente">
            <p class="r-attente-lbl">Numéro d'attente</p>
            <div class="attente-badge">${esc(attenteDigits(d.numAttente))}</div>
        </div>
        <hr class="r-div">
        <div class="r-total">Total à payer<b>${esc(d.total)} FCFA</b></div>
        ${d.recu > 0 ? `
        <div class="r-pay">
            ${rRow('Montant remis', d.recuFmt + ' FCFA', false)}
            ${rRow('Monnaie rendue', d.monnaieFmt + ' FCFA')}
        </div>` : ''}
        <hr class="r-div">
        <p class="r-valid">Valide jusqu'au<br><strong>${esc(d.validiteStr)}</strong></p>
        <footer class="r-foot">
            Conservez ce ticket pour accéder au médecin.<br>
            Validité : 24 heures.<br><br>
            Merci de votre confiance.
        </footer>`;
}

function buildMedicamentsHTML(d) {
    const qteTotale = d.lignes.reduce((n, i) => n + Number(i.qte || 0), 0);
    const lignes = d.lignes.map(p => `
        <li class="r-item">
            <p class="r-item-nom">${esc(p.qte)} × ${esc(p.nom)}</p>
            <div class="r-item-calc">
                <span>à ${esc(p.pu ?? '—')} FCFA/u</span>
                <strong>${esc(p.montant)} FCFA</strong>
            </div>
        </li>`).join('');
    return `
        ${receiptHead(SVG_HYGIE, 'Ticket médicaments', "À agrafer sur l'ordonnance")}
        <hr class="r-div solid">
        ${rRow('Référence', d.refNum)}
        ${rRow('Date', d.dateStr)}
        <hr class="r-div">
        <h2 class="r-sect">Patient</h2>
        ${rRow('Nom', d.patientNom)}
        ${rRow('N° attente', attenteDigits(d.patientAtt))}
        <hr class="r-div">
        <h2 class="r-sect">Médicaments délivrés</h2>
        <ul class="r-items">${lignes}</ul>
        <hr class="r-div">
        ${rRow('Lignes', String(d.lignes.length), false)}
        ${rRow('Quantité totale', String(qteTotale))}
        <div class="r-total">Total à payer<b>${esc(d.total)} FCFA</b></div>
        ${d.recu > 0 ? `
        <div class="r-pay">
            ${rRow('Montant remis', d.recuFmt + ' FCFA', false)}
            ${rRow('Monnaie rendue', d.monnaieFmt + ' FCFA')}
        </div>` : ''}
        <footer class="r-foot">
            Ce ticket est à <strong>agrafer sur l'ordonnance</strong>.<br>
            À présenter à la pharmacie pour la livraison.<br><br>
            Prompt rétablissement.
        </footer>`;
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
// Les tickets/ventes annulés (retour pharmacie, erreur de caisse…) sont
// exclus de toutes les statistiques pour ne pas fausser le bilan.
function updateStats() {
    const tickets = allTickets.filter(x=>!x.annule);
    const ventes  = allMedVentes.filter(x=>!x.annule);

    const tDay = tickets.filter(x=>isToday(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);
    const tWeek = tickets.filter(x=>isThisWeek(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);
    const tMonth = tickets.filter(x=>isMonth(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);
    const tQuarter = tickets.filter(x=>isThisQuarter(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);
    const tYear = tickets.filter(x=>isThisYear(x._ts)).reduce((s,x)=>s+(parseFloat(x.prix)||0),0);

    const mDay = ventes.filter(x=>isToday(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);
    const mWeek = ventes.filter(x=>isThisWeek(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);
    const mMonth = ventes.filter(x=>isMonth(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);
    const mQuarter = ventes.filter(x=>isThisQuarter(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);
    const mYear = ventes.filter(x=>isThisYear(x._ts)).reduce((s,x)=>s+(parseFloat(x.total)||0),0);

    if(document.getElementById('s-g-day')) document.getElementById('s-g-day').textContent = fmt(tDay + mDay) + ' F';
    if(document.getElementById('s-g-week')) document.getElementById('s-g-week').textContent = fmt(tWeek + mWeek) + ' F';
    if(document.getElementById('s-g-month')) document.getElementById('s-g-month').textContent = fmt(tMonth + mMonth) + ' F';
    if(document.getElementById('s-g-quarter')) document.getElementById('s-g-quarter').textContent = fmt(tQuarter + mQuarter) + ' F';
    if(document.getElementById('s-g-year')) document.getElementById('s-g-year').textContent = fmt(tYear + mYear) + ' F';

    if(document.getElementById('cnt-ticket')) document.getElementById('cnt-ticket').textContent = tickets.filter(x=>isToday(x._ts)).length;
    if(document.getElementById('cnt-med')) document.getElementById('cnt-med').textContent = ventes.filter(x=>isToday(x._ts)).length;
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
        <tr${x.annule ? ' style="opacity:.55;"' : ''}>
            <td><span class="tbadge" style="background:var(--accent);color:white;">${esc(x.num_attente||'—')}</span></td>
            <td><strong>${esc(x.name||'—')}</strong></td>
            <td>${esc(x.age||'—')} ans</td>
            <td><span class="tbadge">${esc(x.choix||'—')}</span></td>
            <td><strong${x.annule ? ' style="text-decoration:line-through;"' : ''}>${esc(fmt(x.prix||0))} FCFA</strong>${x.annule ? ' <span class="tbadge" style="background:var(--danger-bg);color:var(--danger);">✕ Annulé</span>' : ''}</td>
            <td style="white-space:nowrap;font-size:.75rem;color:var(--muted);">${esc(dateTimeStr(x._ts))}</td>
            <td><div class="hist-actions">
                <button type="button" class="btn-reprint" onclick="reimprimerTicket('${x._key}')">🖨️ Réimprimer</button>
                ${!x.annule ? `<button type="button" class="btn-annuler" onclick="ouvrirModalTicket('${x._key}')">✕ Annuler</button>` : ''}
            </div></td>
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
    // Toute frappe invalide la sélection précédente : le nom saisi devient la
    // nouvelle source de vérité (évite un patient "fantôme" qui ne
    // correspondrait plus au texte affiché à l'écran).
    patientSelectionne = null;
    document.getElementById('patient-selectionne').style.display='none';
    if (!q) { container.innerHTML=''; checkMedBtn(); return; }
    const todayTickets=allTickets.filter(x=>isToday(x._ts)&&(x.name||'').toLowerCase().includes(q));
    if (!todayTickets.length) {
        container.innerHTML='<div style="padding:8px;font-size:0.8rem;color:var(--muted);">Aucun ticket trouvé aujourd\'hui — le nom saisi sera utilisé tel quel.</div>';
        checkMedBtn();
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
    checkMedBtn();
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
    const manualName = document.getElementById('m-search-patient').value.trim();
    const hasPatient = !!(patientSelectionne || manualName);
    document.getElementById('btn-med').disabled = panier.length === 0 || !hasPatient;
}

window.encaisserMedicaments = async function() {
    if (!panier.length) return;
    const manualName = document.getElementById('m-search-patient').value.trim();
    if (!patientSelectionne && !manualName) {
        toast('Le nom du patient est obligatoire.', 'err');
        return;
    }
    if (!loadedS) {
        toast("⏳ Chargement du stock en cours — veuillez patienter avant d'encaisser.", 'err');
        return;
    }
    const total = panier.reduce((s,p) => s + (p.prix * p.qte), 0);
    const recu = parseFloat(document.getElementById('m-recu').value) || 0;
    const monnaie = recu - total;

    if (recu > 0 && recu < total) { toast('Montant remis insuffisant.', 'err'); return; }

    const patientNom = patientSelectionne ? patientSelectionne.name : manualName;
    const patientAtt = patientSelectionne ? (patientSelectionne.num_attente||'—') : '—';

    const btn=document.getElementById('btn-med');
    btn.disabled=true; btn.innerHTML='⏳ Enregistrement…';

    const now=Date.now();
    const payload = {
        patient_nom:  patientNom,
        num_attente:  patientAtt,
        medicaments:  panier.map(p=>({nom:p.nom, prix:p.prix, qte:p.qte, stock_key:p.stock_key})),
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
            lignes: panier.map(p => ({ nom: p.nom, qte: p.qte, pu: fmt(p.prix), montant: fmt(p.prix * p.qte) })),
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
        <tr${x.annule ? ' style="opacity:.55;"' : ''}>
            <td><span class="tbadge ordo">MED-${esc(x._key.substring(0,6).toUpperCase())}</span></td>
            <td><strong>${esc(x.patient_nom||'—')}</strong></td>
            <td><strong${x.annule ? ' style="text-decoration:line-through;"' : ''}>${esc(fmt(x.total||0))} FCFA</strong>${x.annule ? ' <span class="tbadge" style="background:var(--danger-bg);color:var(--danger);">↩ Retourné</span>' : ''}</td>
            <td>${esc(String((x.medicaments||[]).length))}</td>
            <td style="white-space:nowrap;font-size:.75rem;color:var(--muted);">${esc(dateTimeStr(x._ts))}</td>
            <td><div class="hist-actions">
                <button type="button" class="btn-reprint" onclick="reimprimerMed('${x._key}')">🖨️ Réimprimer</button>
                ${!x.annule ? `<button type="button" class="btn-annuler" onclick="ouvrirModalMed('${x._key}')">↩ Annuler &amp; Retourner</button>` : ''}
            </div></td>
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
        lignes: (x.medicaments||[]).map(m => ({ nom: m.nom, qte: m.qte, pu: fmt(m.prix||0), montant: fmt((m.prix||0) * (m.qte||0)) })),
        total: fmt(x.total||0),
        recu: x.argent_remis||0, recuFmt: fmt(x.argent_remis||0), monnaieFmt: fmt(x.monnaie_rendue||0)
    };
    document.getElementById('print-content').innerHTML = buildMedicamentsHTML(data);
    await imprimerTicket('medicaments', data);
    toast('Ticket réimprimé.', 'ok');
};

// ═══════════════════════════════════════════════
//  ANNULATION / RETOUR PHARMACIE (accessible à la caisse)
//  Permet à la caissière/au caissier de corriger elle/lui-même une
//  erreur de saisie ou un désistement de client, sans passer par
//  l'administration. La vente/le ticket n'est jamais supprimé (traçable),
//  seulement marqué "annule" et exclu de toutes les statistiques.
// ═══════════════════════════════════════════════
let pendingAnnulation = null; // { type: 'ticket'|'med', key }

// Remet en stock les médicaments d'une vente annulée. Retourne le détail
// par ligne (clé stock résolue, succès/échec) pour que l'administration
// puisse plus tard reverser précisément cette remise en stock si elle
// décide de révoquer l'annulation.
async function restockerMedicaments(items) {
    const detail = [];
    for (const item of items) {
        let key = item.stock_key;
        if (!key || !allStock.find(s => s._key === key)) {
            const nomLower = (item.nom || '').trim().toLowerCase();
            const matches = allStock.filter(s => (s.nom || '').trim().toLowerCase() === nomLower);
            key = matches.length === 1 ? matches[0]._key : null;
        }
        if (!key) { detail.push({ nom: item.nom, qte: item.qte, stock_key: null, ok: false }); continue; }
        try {
            await runTransaction(ref(db, `db_pharmacie_stock/${key}/quantite`), (current) => {
                const n = parseInt(current, 10);
                return (isNaN(n) ? 0 : n) + Number(item.qte || 0);
            });
            detail.push({ nom: item.nom, qte: item.qte, stock_key: key, ok: true });
        } catch (e) {
            detail.push({ nom: item.nom, qte: item.qte, stock_key: key, ok: false });
        }
    }
    return detail;
}

window.ouvrirModalTicket = function(key) {
    const x = allTickets.find(t => t._key === key);
    if (!x || x.annule) return;
    pendingAnnulation = { type: 'ticket', key };
    document.getElementById('modal-title').textContent = 'Annuler le ticket de consultation';
    document.getElementById('modal-sub').textContent = 'Aucun impact sur le stock — le ticket sera exclu du bilan.';
    document.getElementById('modal-summary').innerHTML = `
        <div><strong>Patient :</strong> ${esc(x.name||'—')} (${esc(x.age||'?')} ans)</div>
        <div><strong>Prestation :</strong> ${esc(x.choix||'—')}</div>
        <div><strong>Montant :</strong> ${esc(fmt(x.prix||0))} FCFA</div>
        <div><strong>N° attente :</strong> ${esc(x.num_attente||'—')}</div>`;
    document.getElementById('m-motif').value = 'Erreur de saisie (caisse)';
    document.getElementById('m-obs').value = '';
    document.getElementById('modal-overlay').classList.add('visible');
};

window.ouvrirModalMed = function(key) {
    const x = allMedVentes.find(m => m._key === key);
    if (!x || x.annule) return;
    pendingAnnulation = { type: 'med', key };
    const meds = x.medicaments || [];
    document.getElementById('modal-title').textContent = 'Annuler la vente & retourner en pharmacie';
    document.getElementById('modal-sub').textContent = 'Les quantités seront automatiquement remises en stock.';
    document.getElementById('modal-summary').innerHTML = `
        <div><strong>Patient :</strong> ${esc(x.patient_nom||'—')}</div>
        <div><strong>Montant :</strong> ${esc(fmt(x.total||0))} FCFA</div>
        <div><strong>Médicaments à retourner :</strong></div>
        <ul style="margin:4px 0 0 18px;">${meds.map(m => `<li>${esc(m.qte)} × ${esc(m.nom)}</li>`).join('')}</ul>`;
    document.getElementById('m-motif').value = 'Désistement du client';
    document.getElementById('m-obs').value = '';
    document.getElementById('modal-overlay').classList.add('visible');
};

window.closeModalAnnulation = function() {
    document.getElementById('modal-overlay').classList.remove('visible');
    pendingAnnulation = null;
};

window.confirmerAnnulation = async function() {
    if (!pendingAnnulation) return;
    const motif = document.getElementById('m-motif').value;
    const obs = document.getElementById('m-obs').value.trim();
    const btn = document.getElementById('modal-confirm-btn');
    btn.disabled = true; btn.innerHTML = '⏳ Traitement…';

    const caissierEmail = auth.currentUser?.email || '';
    const annuleFields = {
        annule: true,
        annule_ts: Date.now(),
        annule_motif: motif,
        annule_obs: obs,
        annule_par: caissierEmail
    };

    try {
        if (pendingAnnulation.type === 'ticket') {
            await update(ref(db, 'ticket_dbase/' + pendingAnnulation.key), annuleFields);
            toast('Ticket annulé. Il est exclu du bilan.', 'ok');
        } else {
            const vente = allMedVentes.find(m => m._key === pendingAnnulation.key);
            const items = (vente && vente.medicaments) || [];
            const retourDetail = await restockerMedicaments(items);
            const restockOk = retourDetail.filter(d => d.ok).length;
            const restockFail = retourDetail.filter(d => !d.ok).map(d => d.nom);

            await update(ref(db, 'vente_medicaments/' + pendingAnnulation.key), {
                ...annuleFields,
                retour_detail: retourDetail,
                retour_stock_ok: restockOk,
                retour_stock_echec: restockFail
            });

            if (restockFail.length) {
                toast(`Vente annulée. ${restockOk}/${items.length} médicament(s) retourné(s) — non retrouvé(s) en stock : ${restockFail.join(', ')}.`, 'err');
            } else {
                toast(`Vente annulée. ${restockOk} médicament(s) remis en stock.`, 'ok');
            }
        }
        closeModalAnnulation();
    } catch (e) {
        console.error(e);
        toast("Erreur lors de l'annulation : " + e.message, 'err');
    }

    btn.disabled = false; btn.innerHTML = '✕ Confirmer l\'annulation';
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