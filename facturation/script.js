import { db, auth } from '../firebase-config.js';
import { ref, push, onValue, off, get, update, runTransaction }
    from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import * as printer from './escpos-printer.js';

// ── AUTH GUARD ──────────────────────────────────
// Admin ET caissier(ère) partagent cette page : l'admin peut notamment s'en
// servir pour la saisie a posteriori (ex. week-end sans caissier). Seul le
// trésorier n'a pas accès à la caisse.
onAuthStateChanged(auth, u => {
    if (!u) { window.location.href = '../index.html'; return; }
    const role = sessionStorage.getItem('userRole');
    if (role === 'tresorier') { window.location.href = '../accueil/menu_tresorier.html'; return; }
    const back = document.querySelector('.back-btn');
    if (back) back.href = (role === 'admin') ? '../accueil/menu_admin.html' : '../accueil/menu_caissier.html';
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

// ── SAISIE A POSTERIORI : date/heure de l'opération ──────────────
// Par défaut : maintenant (saisie normale). Modifiable pour rattacher un
// ticket/une vente à un jour précédent (ex. week-end sans caissier) : le
// numéro d'attente, les statistiques et le reçu imprimé suivent alors cette
// date-là plutôt que l'instant réel de la saisie.
let backdateEtaitActif = false;

function getOpTimestamp() {
    const dEl = document.getElementById('op-date');
    const hEl = document.getElementById('op-heure');
    if (!dEl || !dEl.value) return Date.now();
    const [y, m, d] = dEl.value.split('-').map(Number);
    let hh, mm;
    if (hEl && hEl.value) { [hh, mm] = hEl.value.split(':').map(Number); }
    else { const n = new Date(); hh = n.getHours(); mm = n.getMinutes(); }
    return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

function reglerHeureActuelle() {
    const n = new Date();
    const dEl = document.getElementById('op-date');
    const hEl = document.getElementById('op-heure');
    if (dEl) dEl.value = ymd(n.getTime());
    if (hEl) hEl.value = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
}

// Refuse une date de l'opération dans le futur (remet « aujourd'hui »).
function validerOpDate() {
    const dEl = document.getElementById('op-date');
    if (dEl && dEl.value && dEl.value > ymd(Date.now())) {
        toast("La date de l'opération ne peut pas être dans le futur.", 'err');
        dEl.value = ymd(Date.now());
        majBackdateUI();
        return false;
    }
    return true;
}

function majBackdateUI() {
    const bar = document.getElementById('backdate-bar');
    const banner = document.getElementById('backdate-banner');
    const imprimerEl = document.getElementById('op-imprimer');
    const summary = document.getElementById('backdate-summary-text');
    if (!bar || !banner) return;
    const opTs = getOpTimestamp();
    const backdate = !isSameDay(opTs, Date.now());
    bar.classList.toggle('active', backdate);
    banner.classList.toggle('visible', backdate);
    if (backdate) {
        document.getElementById('backdate-banner-date').textContent =
            new Date(opTs).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    }
    // Résumé compact : « Aujourd'hui, 07/09/2026 · 05:39 » (ou la date
    // choisie en saisie a posteriori) — la barre reste repliée par défaut.
    if (summary) {
        const d = new Date(opTs);
        const jourTxt = backdate ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' }) : "Aujourd'hui";
        const heureTxt = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        summary.textContent = `${jourTxt.charAt(0).toUpperCase()}${jourTxt.slice(1)} · ${heureTxt}`;
    }
    // Décoché par défaut en entrant en mode « a posteriori » (l'imprimé n'a
    // souvent plus lieu d'être plusieurs jours après) — mais on ne revient
    // pas dessus tant que le mode ne change pas, pour respecter un choix
    // manuel de l'utilisateur au sein d'une même saisie.
    if (backdate !== backdateEtaitActif && imprimerEl) imprimerEl.checked = !backdate;
    backdateEtaitActif = backdate;
}

// ── Repli/dépli de la barre de date (repliée par défaut) ────────
window.toggleBackdateExpand = function () {
    const fields = document.getElementById('backdate-fields');
    const btn = document.getElementById('backdate-edit-btn');
    const open = fields.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.textContent = open ? 'Fermer' : 'Modifier la date';
};
window.toggleBackdateInfo = function () {
    document.getElementById('backdate-hint').classList.toggle('open');
};

// Script chargé en <script type="module"> : le DOM est déjà disponible
// (comportement "defer" natif des modules), pas besoin d'attendre
// DOMContentLoaded — cohérent avec le reste du fichier.
reglerHeureActuelle();
majBackdateUI();
// Rafraîchit l'heure affichée chaque minute — mais seulement en saisie
// normale : un mode « a posteriori » choisi par l'utilisateur ne doit
// jamais être silencieusement remis à « maintenant ».
setInterval(() => {
    if (!backdateEtaitActif) reglerHeureActuelle();
    majBackdateUI();
}, 60000);
document.getElementById('op-date')?.addEventListener('change', () => {
    if (validerOpDate()) majBackdateUI();
    if (document.getElementById('m-search-patient')?.value.trim()) window.filtrerPatients();
});
document.getElementById('op-heure')?.addEventListener('change', () => { majBackdateUI(); });
document.getElementById('btn-reset-date')?.addEventListener('click', () => {
    reglerHeureActuelle(); majBackdateUI();
    toast("Date de l'opération réinitialisée à maintenant.", 'ok');
});

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
// Comme isToday(), mais comparé à une date de référence quelconque — utilisé
// pour la saisie a posteriori (ex. rattacher un ticket à un samedi précis).
function isSameDay(ts, refTs) { const d=new Date(ts),r=new Date(refTs); return d.getDate()===r.getDate()&&d.getMonth()===r.getMonth()&&d.getFullYear()===r.getFullYear(); }
// Date locale « AAAA-MM-JJ » (pour les clés Firebase du compteur d'attente).
function ymd(ts) { const d=new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
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
// ts optionnel : sert à dater un reçu sur la date de l'opération choisie
// (saisie a posteriori), et non sur l'instant réel de l'impression.
function dateISO(ts = Date.now()) {
    const d=new Date(ts);
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}
function toast(msg, type='ok') {
    const el=document.getElementById('toast');
    el.textContent=(type==='ok'?'✓ ':'✗ ')+msg;
    el.className='toast show '+type;
    setTimeout(()=>el.classList.remove('show'), 4000);
}

// ── Bibliothèque d'icônes SVG partagée (trait 2px, cohérente avec le
//    reste de l'application) ──────────────────────────────────────
const ICON_PRINTER = '<svg class="icon" viewBox="0 0 24 24"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>';
const ICON_CHECK   = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
const ICON_TRASH   = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
const ICON_PENCIL  = '<svg class="icon" viewBox="0 0 24 24"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';
const ICON_UNDO    = '<svg class="icon" viewBox="0 0 24 24"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
const ICON_DOTS    = '<svg class="icon dots" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';
const ICON_CLOCK    = '<svg class="icon" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
const ICON_BOX     = '<svg class="icon" viewBox="0 0 24 24"><path d="m16.5 9.4-9-5.19"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';

// ── Menus déroulants génériques (kebab) ──────────────────────────
window.toggleDropdown = function (id, btn) {
    const menu = document.getElementById(id);
    if (!menu) return;
    const wasOpen = menu.classList.contains('open');
    closeAllDropdowns();
    if (!wasOpen) { menu.classList.add('open'); btn?.classList.add('open'); }
};
window.closeAllDropdowns = function () {
    document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.menu-btn.open, .btn-kebab.open').forEach(b => b.classList.remove('open'));
};
document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) closeAllDropdowns();
});

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

// Met à jour à la fois l'entrée du menu ⋮ (détail) et la ligne compacte
// du header (statut résumé : connectée / non connectée).
function updatePrinterBadge() {
    const b = document.getElementById('printer-badge');
    if (!b) return;
    const method = getPrintMethod();
    let label, ok;
    if (method === 'usb' && printer.isPrinterConnected())      { label = 'USB connectée';          ok = true;  }
    else if (method === 'usb')                                  { label = 'Connecter USB';           ok = false; }
    else if (method === 'ble' && printer.isBLEConnected())      { label = 'Bluetooth connectée';     ok = true;  }
    else if (method === 'ble')                                  { label = 'Appairer Bluetooth';      ok = false; }
    else if (method === 'rawbt')                                { label = 'Impression via RawBT';    ok = true;  }
    else                                                          { label = 'Impression navigateur';   ok = false; }

    b.innerHTML = ICON_PRINTER + '<span>' + label + '</span>';
    b.className = 'dropdown-item printer-badge' + (ok ? ' ok' : ' off');

    const line = document.getElementById('printer-line');
    const lineText = document.getElementById('printer-line-text');
    if (line) line.classList.toggle('ok', ok);
    if (lineText) lineText.textContent = ok ? 'Imprimante connectée' : 'Imprimante non connectée';

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
// refTs : jour auquel rattacher le compteur — le jour réel en saisie
// normale, ou le jour choisi dans la barre de saisie a posteriori.
async function prochainNumeroAttente(refTs = Date.now()) {
    const jourTickets = allTickets.filter(x => isSameDay(x._ts, refTs));
    let maxAttente = 0;
    jourTickets.forEach(t => {
        if (t.num_attente) {
            const num = parseInt(String(t.num_attente).replace(/\D/g, ''), 10);
            if (!isNaN(num) && num > maxAttente) maxAttente = num;
        }
    });

    const jour = ymd(refTs); // AAAA-MM-JJ du jour de l'opération
    const compteurRef = ref(db, `compteurs/attente_${jour}`);
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
// Le dashboard de caisse ne montre plus que l'essentiel du jour ; le détail
// Semaine/Mois/Trimestre/Année vit dans Planification & Rapports.
function updateStats() {
    const tickets = allTickets.filter(x=>!x.annule);
    const ventes  = allMedVentes.filter(x=>!x.annule);

    const ticketsToday = tickets.filter(x=>isToday(x._ts));
    const ventesToday  = ventes.filter(x=>isToday(x._ts));
    const tDay = ticketsToday.reduce((s,x)=>s+(parseFloat(x.prix)||0),0);
    const mDay = ventesToday.reduce((s,x)=>s+(parseFloat(x.total)||0),0);

    if(document.getElementById('s-g-day'))     document.getElementById('s-g-day').textContent = fmt(tDay + mDay) + ' FCFA';
    if(document.getElementById('s-g-tickets')) document.getElementById('s-g-tickets').textContent = ticketsToday.length + ventesToday.length;

    if(document.getElementById('cnt-ticket')) document.getElementById('cnt-ticket').textContent = ticketsToday.length;
    if(document.getElementById('cnt-med')) document.getElementById('cnt-med').textContent = ventesToday.length;
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

// ── SECTIONS : Nouvelle opération / Historique ────
// Séparation architecturale : le caissier ne charge/parcourt pas
// l'historique complet sous son formulaire de saisie en cours.
window.switchSection = function(s) {
    document.querySelectorAll('.section-block').forEach(el => {
        el.classList.toggle('active', el.dataset.section === s);
    });
    document.getElementById('sbtn-nouvelle').classList.toggle('active', s === 'nouvelle');
    document.getElementById('sbtn-historique').classList.toggle('active', s === 'historique');
};

// ═══════════════════════════════════════════════
//  ONGLET 1 — TICKET DE CONSULTATION
// ═══════════════════════════════════════════════
// Résumé patient au-dessus de la prestation : « Aminata Diallo · 35 ans »,
// visible dès que le formulaire est renseigné, sans attendre l'encaissement.
function updateRecapPatientT() {
    const prenom = document.getElementById('t-prenom').value.trim();
    const nom    = document.getElementById('t-nom').value.trim();
    const age    = document.getElementById('t-age').value.trim();
    const wrap = document.getElementById('r-patient-wrap');
    if (!wrap) return;
    if (!prenom && !nom && !age) { wrap.hidden = true; return; }
    wrap.hidden = false;
    document.getElementById('r-patient-nom').textContent = [prenom, nom].filter(Boolean).join(' ') || '—';
    document.getElementById('r-patient-sub').textContent = age ? `${age} ans` : '';
}

// Le libellé du bouton reflète le montant à encaisser, dès qu'une
// prestation est sélectionnée — l'action devient concrète d'un coup d'œil.
function updateBtnTicketLabel() {
    const el = document.getElementById('btn-ticket-label');
    if (el) el.textContent = prixActuel > 0 ? `Encaisser ${fmt(prixActuel)} FCFA` : 'Encaisser';
}

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
    updateBtnTicketLabel();
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

// Raccourcis de billets (500 / 1000 / 2000 / 5000 FCFA) : évite une saisie
// manuelle pour les montants remis les plus fréquents.
window.setMontantRecuT = function(val) {
    document.getElementById('t-recu').value = val;
    window.calcMonnaieT();
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

    updateRecapPatientT();
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
    if (!validerOpDate()) return;

    const btn=document.getElementById('btn-ticket');
    const btnLabel=document.getElementById('btn-ticket-label');
    btn.disabled=true; btnLabel.textContent='Enregistrement…';

    // opTs = date/heure choisie dans la barre « saisie a posteriori » (ou
    // maintenant, en saisie normale). Tout le ticket (n° d'attente, reçu,
    // validité) est daté sur cette base, pas sur l'instant de la saisie.
    const opTs = getOpTimestamp();
    const enDiffere = !isSameDay(opTs, Date.now());
    const { num: nAtt, fiable } = await prochainNumeroAttente(opTs);
    const numAttente='N° ' + String(nAtt).padStart(3, '0');
    if (!fiable) toast('Connexion instable : risque de doublon.', 'err');

    const validiteTs=opTs + 24*60*60*1000;
    const validiteStr=new Date(validiteTs).toLocaleDateString('fr-FR')+' à '+new Date(validiteTs).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});

    const payload = {
        name:           prenom+' '+nom,
        prenom, nom, age: parseInt(age),
        choix, prix: prixActuel,
        num_attente:    numAttente,
        argent_remis:   recu,
        monnaie_rendue: monnaie,
        date:           new Date(opTs).toLocaleDateString('fr-FR'),
        heure:          new Date(opTs).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),
        date_heure_ts:  opTs,
        validite_ts:    validiteTs,
        saisi_par:      auth.currentUser?.email || '',
        ...(enDiffere ? { saisie_differee: true, saisie_le: Date.now() } : {})
    };

    try {
        const newRef=await push(ticketRef, payload);
        const refNum='TK-'+newRef.key.substring(0,6).toUpperCase();
        const dateStr=dateISO(opTs);

        const ticketData = {
            refNum, dateStr, prenom, nom, age, choix, numAttente,
            total: fmt(prixActuel),
            recu, recuFmt: fmt(recu), monnaieFmt: fmt(monnaie),
            validiteStr
        };
        document.getElementById('print-content').innerHTML = buildConsultationHTML(ticketData);
        const imprimer = document.getElementById('op-imprimer')?.checked !== false;
        if (imprimer) {
            await imprimerTicket('consultation', ticketData);
            toast('Ticket enregistré et imprimé avec succès.','ok');
        } else {
            toast('Ticket enregistré avec succès (sans impression).','ok');
        }

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
        btn.disabled=false; updateBtnTicketLabel();
        checkTicketBtn();
    }
};

window.renderHistTickets = function() {
    const tbody=document.getElementById('hist-tickets');
    const cards=document.getElementById('hist-tickets-cards');
    const filter=document.getElementById('filter-tickets').value;
    let list = filterByPeriod(allTickets, filter);
    const countEl = document.getElementById('hist-tickets-count');
    if (countEl) countEl.textContent = list.length ? `(${list.length})` : '';
    if (!list.length) {
        const empty = `Aucun ticket pour cette période.`;
        tbody.innerHTML=`<tr><td colspan="7" class="hist-empty">${empty}</td></tr>`;
        if (cards) cards.innerHTML = `<div class="hist-empty">${ICON_BOX}<p>${empty}</p></div>`;
        return;
    }
    tbody.innerHTML = list.map(x=>`
        <tr${x.annule ? ' style="opacity:.55;"' : ''}>
            <td><span class="tbadge" style="background:var(--accent);color:white;">${esc(x.num_attente||'—')}</span></td>
            <td><strong>${esc(x.name||'—')}</strong></td>
            <td>${esc(x.age||'—')} ans</td>
            <td><span class="tbadge">${esc(x.choix||'—')}</span></td>
            <td><strong${x.annule ? ' style="text-decoration:line-through;"' : ''}>${esc(fmt(x.prix||0))} FCFA</strong>${x.annule ? ' <span class="tbadge" style="background:var(--danger-bg);color:var(--danger);">Annulé</span>' : ''}</td>
            <td style="white-space:nowrap;font-size:.75rem;color:var(--muted);">${esc(dateTimeStr(x._ts))}${x.saisie_differee ? `<span class="tag-differe">${ICON_CLOCK}a posteriori</span>` : ''}</td>
            <td><div class="hist-actions">
                <button type="button" class="btn-reprint" onclick="reimprimerTicket('${x._key}')">${ICON_PRINTER}Réimprimer</button>
                ${!x.annule ? `<button type="button" class="btn-annuler" onclick="ouvrirModalTicket('${x._key}')">Annuler</button>` : ''}
            </div></td>
        </tr>
    `).join('');

    if (cards) cards.innerHTML = list.map(x => {
        const menuId = 'ht-menu-' + x._key;
        return `<div class="hist-card${x.annule ? ' cancelled' : ''}">
            <div class="hist-card-head">
                <span class="hist-card-ref">${esc(x.num_attente||'—')}</span>
                <span class="hist-card-amount${x.annule ? ' struck' : ''}">${esc(fmt(x.prix||0))} FCFA</span>
            </div>
            <div class="hist-card-patient">${esc(x.name||'—')}</div>
            <div class="hist-card-meta">${esc(x.age||'—')} ans · ${esc(x.choix||'—')}</div>
            <div class="hist-card-date">
                ${esc(dateTimeStr(x._ts))}
                ${x.annule ? '<span class="tbadge" style="background:var(--danger-bg);color:var(--danger);">Annulé</span>' : ''}
                ${x.saisie_differee ? `<span class="tag-differe">${ICON_CLOCK}a posteriori</span>` : ''}
            </div>
            <div class="hist-card-foot">
                <button type="button" class="btn-reprint" onclick="reimprimerTicket('${x._key}')">${ICON_PRINTER}Réimprimer</button>
                ${!x.annule ? `<div class="menu-wrap">
                    <button type="button" class="btn-kebab" onclick="toggleDropdown('${menuId}', this)" aria-label="Plus d'actions">${ICON_DOTS}</button>
                    <div class="dropdown-menu" id="${menuId}" style="right:0;">
                        <button type="button" class="dropdown-item danger" onclick="closeAllDropdowns();ouvrirModalTicket('${x._key}')">${ICON_UNDO}Annuler le ticket</button>
                    </div>
                </div>` : ''}
            </div>
        </div>`;
    }).join('');
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
    // Recherche les tickets du JOUR DE L'OPÉRATION choisi (barre de saisie a
    // posteriori) : en saisie normale, c'est aujourd'hui ; en rattrapage
    // d'un samedi/dimanche, ce sont les tickets déjà saisis pour ce jour-là.
    const opTs = getOpTimestamp();
    const jourTickets=allTickets.filter(x=>isSameDay(x._ts, opTs)&&(x.name||'').toLowerCase().includes(q));
    if (!jourTickets.length) {
        const msgJour = isSameDay(opTs, Date.now()) ? "aujourd'hui" : ('le ' + new Date(opTs).toLocaleDateString('fr-FR'));
        container.innerHTML=`<div style="padding:8px;font-size:0.8rem;color:var(--muted);">Aucun ticket trouvé ${msgJour} — le nom saisi sera utilisé tel quel.</div>`;
        checkMedBtn();
        return;
    }
    window._patientSuggestions = jourTickets.slice(0, 5);
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
        const prixHtml = hasPrix ? `<div class="med-prix">${esc(fmt(m.prix_unitaire))} FCFA</div>` : '';
        const catHtml = m.categorie ? ` · <span style="font-style:italic;">${esc(m.categorie)}</span>` : '';

        const isBlocked = inPanier || isOutOfStock;

        // Action à droite : « + Ajouter », déjà ajouté, ou une référence en
        // rupture n'est jamais sélectionnable.
        let actionHtml;
        if (isOutOfStock) actionHtml = `<button type="button" class="med-add-btn disabled" disabled>Indisponible</button>`;
        else if (inPanier) actionHtml = `<span class="med-added-tag">${ICON_CHECK}Ajouté</span>`;
        else actionHtml = `<button type="button" class="med-add-btn" onclick="event.stopPropagation();ajouterMed('${m._key}')">+ Ajouter</button>`;

        return `
            <div class="med-item ${inPanier ? 'added' : ''}${isOutOfStock ? ' out' : ''}"
                 tabindex="${isBlocked ? '-1' : '0'}" role="button"
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
                <div class="med-item-right">
                    ${prixHtml}
                    ${actionHtml}
                </div>
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

// Le libellé du bouton reflète le total du panier, comme côté ticket.
function updateBtnMedLabel() {
    const total = panier.reduce((s,p) => s + (p.prix * p.qte), 0);
    const el = document.getElementById('btn-med-label');
    if (el) el.textContent = total > 0 ? `Encaisser ${fmt(total)} FCFA` : 'Encaisser';
}

function renderPanier() {
    const container = document.getElementById('panier-liste');
    const total = panier.reduce((s,p) => s + (p.prix * p.qte), 0);
    document.getElementById('panier-count').textContent = panier.length;
    document.getElementById('panier-total').textContent = fmt(total) + ' FCFA';
    updateBtnMedLabel();

    if (!panier.length) {
        container.outerHTML = '<div id="panier-liste" class="panier-vide">Aucun médicament sélectionné</div>';
        document.getElementById('m-recu').value = '';
        calcMonnaieM();
        return;
    }

    container.outerHTML = `<div id="panier-liste" class="panier-list">${panier.map(p => `
        <div class="panier-item">
            <div style="flex:1;">
                <div class="panier-item-nom">${esc(p.nom)}</div>
                <div style="font-size:0.7rem;color:var(--muted);">${esc(fmt(p.prix))} FCFA / unité</div>
            </div>
            <div class="panier-qte-ctrl">
                <button class="panier-btn" onclick="modifierQte('${esc(p.stock_key)}', -1)">-</button>
                <div class="panier-qte-val">${p.qte}</div>
                <button class="panier-btn" onclick="modifierQte('${esc(p.stock_key)}', 1)">+</button>
            </div>
            <div class="panier-item-prix" style="width:82px;text-align:right;white-space:nowrap;">${esc(fmt(p.prix * p.qte))} FCFA</div>
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

// Raccourcis de billets pour le règlement des médicaments.
window.setMontantRecuM = function(val) {
    document.getElementById('m-recu').value = val;
    window.calcMonnaieM();
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
        toast("Chargement du stock en cours — veuillez patienter avant d'encaisser.", 'err');
        return;
    }
    const total = panier.reduce((s,p) => s + (p.prix * p.qte), 0);
    const recu = parseFloat(document.getElementById('m-recu').value) || 0;
    const monnaie = recu - total;

    if (recu > 0 && recu < total) { toast('Montant remis insuffisant.', 'err'); return; }
    if (!validerOpDate()) return;

    const patientNom = patientSelectionne ? patientSelectionne.name : manualName;
    const patientAtt = patientSelectionne ? (patientSelectionne.num_attente||'—') : '—';

    const btn=document.getElementById('btn-med');
    const btnLabel=document.getElementById('btn-med-label');
    btn.disabled=true; btnLabel.textContent='Enregistrement…';

    // Voir encaisserTicket() : opTs suit la barre « saisie a posteriori ».
    const opTs = getOpTimestamp();
    const enDiffere = !isSameDay(opTs, Date.now());
    const payload = {
        patient_nom:  patientNom,
        num_attente:  patientAtt,
        medicaments:  panier.map(p=>({nom:p.nom, prix:p.prix, qte:p.qte, stock_key:p.stock_key})),
        total,
        argent_remis: recu,
        monnaie_rendue: monnaie,
        date:  new Date(opTs).toLocaleDateString('fr-FR'),
        heure: new Date(opTs).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),
        date_heure_ts: opTs,
        saisi_par: auth.currentUser?.email || '',
        ...(enDiffere ? { saisie_differee: true, saisie_le: Date.now() } : {})
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
        const dateStr=dateISO(opTs);

        const medData = {
            refNum, dateStr, patientNom, patientAtt,
            lignes: panier.map(p => ({ nom: p.nom, qte: p.qte, pu: fmt(p.prix), montant: fmt(p.prix * p.qte) })),
            total: fmt(total),
            recu, recuFmt: fmt(recu), monnaieFmt: fmt(monnaie)
        };
        document.getElementById('print-content').innerHTML = buildMedicamentsHTML(medData);
        const imprimer = document.getElementById('op-imprimer')?.checked !== false;
        if (imprimer) {
            await imprimerTicket('medicaments', medData);
            toast('Vente enregistrée et ticket imprimé.','ok');
        } else {
            toast('Vente enregistrée avec succès (sans impression).','ok');
        }

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
        btn.disabled=false; updateBtnMedLabel();
        checkMedBtn();
    }
};

window.renderHistMeds = function() {
    const tbody=document.getElementById('hist-meds');
    const cards=document.getElementById('hist-meds-cards');
    const filter=document.getElementById('filter-meds').value;
    let list=filterByPeriod(allMedVentes,filter);
    const countEl = document.getElementById('hist-meds-count');
    if (countEl) countEl.textContent = list.length ? `(${list.length})` : '';
    if (!list.length) {
        const empty = 'Aucune vente pour cette période.';
        tbody.innerHTML=`<tr><td colspan="6" class="hist-empty">${empty}</td></tr>`;
        if (cards) cards.innerHTML = `<div class="hist-empty">${ICON_BOX}<p>${empty}</p></div>`;
        return;
    }
    tbody.innerHTML=list.map(x=>`
        <tr${x.annule ? ' style="opacity:.55;"' : ''}>
            <td><span class="tbadge ordo">MED-${esc(x._key.substring(0,6).toUpperCase())}</span></td>
            <td><strong>${esc(x.patient_nom||'—')}</strong></td>
            <td><strong${x.annule ? ' style="text-decoration:line-through;"' : ''}>${esc(fmt(x.total||0))} FCFA</strong>${x.annule ? ' <span class="tbadge" style="background:var(--danger-bg);color:var(--danger);">Retourné</span>' : ''}</td>
            <td>${esc(String((x.medicaments||[]).length))}</td>
            <td style="white-space:nowrap;font-size:.75rem;color:var(--muted);">${esc(dateTimeStr(x._ts))}${x.saisie_differee ? `<span class="tag-differe">${ICON_CLOCK}a posteriori</span>` : ''}</td>
            <td><div class="hist-actions">
                <button type="button" class="btn-reprint" onclick="reimprimerMed('${x._key}')">${ICON_PRINTER}Réimprimer</button>
                ${!x.annule ? `<button type="button" class="btn-modifier" onclick="ouvrirModalModifMed('${x._key}')">${ICON_PENCIL}Modifier</button>` : ''}
                ${!x.annule ? `<button type="button" class="btn-annuler" onclick="ouvrirModalMed('${x._key}')">${ICON_UNDO}Annuler</button>` : ''}
            </div></td>
        </tr>
    `).join('');

    if (cards) cards.innerHTML = list.map(x => {
        const menuId = 'hm-menu-' + x._key;
        return `<div class="hist-card${x.annule ? ' cancelled' : ''}">
            <div class="hist-card-head">
                <span class="hist-card-ref">MED-${esc(x._key.substring(0,6).toUpperCase())}</span>
                <span class="hist-card-amount${x.annule ? ' struck' : ''}">${esc(fmt(x.total||0))} FCFA</span>
            </div>
            <div class="hist-card-patient">${esc(x.patient_nom||'—')}</div>
            <div class="hist-card-meta">${esc(String((x.medicaments||[]).length))} médicament${(x.medicaments||[]).length > 1 ? 's' : ''}</div>
            <div class="hist-card-date">
                ${esc(dateTimeStr(x._ts))}
                ${x.annule ? '<span class="tbadge" style="background:var(--danger-bg);color:var(--danger);">Retourné</span>' : ''}
                ${x.saisie_differee ? `<span class="tag-differe">${ICON_CLOCK}a posteriori</span>` : ''}
            </div>
            <div class="hist-card-foot">
                <button type="button" class="btn-reprint" onclick="reimprimerMed('${x._key}')">${ICON_PRINTER}Réimprimer</button>
                ${!x.annule ? `<div class="menu-wrap">
                    <button type="button" class="btn-kebab" onclick="toggleDropdown('${menuId}', this)" aria-label="Plus d'actions">${ICON_DOTS}</button>
                    <div class="dropdown-menu" id="${menuId}" style="right:0;">
                        <button type="button" class="dropdown-item" onclick="closeAllDropdowns();ouvrirModalModifMed('${x._key}')">${ICON_PENCIL}Modifier la vente</button>
                        <button type="button" class="dropdown-item danger" onclick="closeAllDropdowns();ouvrirModalMed('${x._key}')">${ICON_UNDO}Annuler &amp; retourner</button>
                    </div>
                </div>` : ''}
            </div>
        </div>`;
    }).join('');
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
let pendingAnnulationCode = ''; // code de confirmation attendu (n° d'attente, ou nom si patient non identifié)

// ── CONFIRMATION PAR CODE PATIENT ────────────────
// Avant toute action sensible (annulation, modification), on exige de
// resaisir le n° d'attente du patient concerné : un simple clic ne suffit
// plus, ce qui évite d'agir sur le mauvais patient dans une liste. Repli sur
// le nom si le patient n'a pas de n° d'attente (saisie libre en pharmacie).
function normaliseCode(s) { return String(s || '').trim().toLowerCase(); }
function chiffresDe(s) { return String(s || '').replace(/\D/g, ''); }
// Tolère les variantes de saisie d'un n° d'attente (« N° 003 », « 003 », « 3 »…)
// mais reste strict (comparaison exacte du nom) quand le repli est un nom.
function codeConfirmationValide(saisi, attendu) {
    const s = normaliseCode(saisi), a = normaliseCode(attendu);
    if (!a) return false;
    if (s === a) return true;
    const ds = chiffresDe(saisi), da = chiffresDe(attendu);
    return !!ds && !!da && parseInt(ds, 10) === parseInt(da, 10);
}

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

// Prépare le champ de confirmation d'une modale d'action sensible : mémorise
// le code attendu, vide la saisie précédente, affiche l'indice et laisse le
// bouton de confirmation désactivé tant que le code n'est pas resaisi.
function armerConfirmation(code, indiceHtml, inputId, hintId) {
    pendingAnnulationCode = code;
    const input = document.getElementById(inputId);
    if (input) input.value = '';
    const hint = document.getElementById(hintId);
    if (hint) { hint.textContent = indiceHtml; hint.className = 'confirm-hint'; }
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
    armerConfirmation(x.num_attente || '', `Pour confirmer, saisissez le n° d'attente : ${esc(x.num_attente || '—')}`, 'm-confirm-code', 'm-confirm-hint');
    checkAnnulationConfirm();
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
    const identifie = x.num_attente && x.num_attente !== '—';
    const code = identifie ? x.num_attente : (x.patient_nom || '');
    const indice = identifie
        ? `Pour confirmer, saisissez le n° d'attente : ${esc(x.num_attente)}`
        : `Patient non identifié — pour confirmer, saisissez son nom : ${esc(x.patient_nom || '—')}`;
    armerConfirmation(code, indice, 'm-confirm-code', 'm-confirm-hint');
    checkAnnulationConfirm();
    document.getElementById('modal-overlay').classList.add('visible');
};

window.checkAnnulationConfirm = function() {
    const val = document.getElementById('m-confirm-code')?.value || '';
    const ok = codeConfirmationValide(val, pendingAnnulationCode);
    const btn = document.getElementById('modal-confirm-btn');
    if (btn) btn.disabled = !ok;
    const hint = document.getElementById('m-confirm-hint');
    if (hint) hint.classList.toggle('ok', ok);
};

window.closeModalAnnulation = function() {
    document.getElementById('modal-overlay').classList.remove('visible');
    pendingAnnulation = null;
    pendingAnnulationCode = '';
};

window.confirmerAnnulation = async function() {
    if (!pendingAnnulation) return;
    const codeSaisi = document.getElementById('m-confirm-code').value;
    if (!codeConfirmationValide(codeSaisi, pendingAnnulationCode)) {
        toast('Le code de confirmation ne correspond pas au patient.', 'err');
        return;
    }
    const motif = document.getElementById('m-motif').value;
    const obs = document.getElementById('m-obs').value.trim();
    const btn = document.getElementById('modal-confirm-btn');
    btn.disabled = true; document.getElementById('modal-confirm-btn-label').textContent = 'Traitement…';

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

    document.getElementById('modal-confirm-btn-label').textContent = "Confirmer l'annulation";
    checkAnnulationConfirm(); // ré-évalue l'état du bouton (modale restée ouverte après une erreur)
};

// ═══════════════════════════════════════════════
//  MODIFICATION D'UNE VENTE (AJOUT / RETRAIT DE MÉDICAMENTS)
//  Corrige une erreur de saisie — un médicament oublié ou ajouté par
//  erreur — directement sur la vente existante : pas de nouvelle entrée,
//  seul l'écart de quantité est répercuté sur le stock, et la
//  modification est tracée (auteur, motif, avant/après) sur l'enregistrement.
// ═══════════════════════════════════════════════
let modifVente = null;   // enregistrement Firebase d'origine (référence)
let modifPanier = [];    // copie de travail éditable, indépendante tant que non enregistrée
let modifConfirmCode = ''; // code de confirmation attendu (n° d'attente, ou nom si patient non identifié)

// Ajuste le stock d'un médicament d'un écart signé : positif = remis en
// stock (quantité retirée de la vente), négatif = prélevé en plus
// (quantité ajoutée à la vente). Résout stock_key par nom en repli, comme
// restockerMedicaments(), pour les lignes anciennes ou dont la clé a disparu.
async function ajusterStockDelta(nom, stockKeyHint, delta) {
    if (!delta) return { ok: true, stock_key: stockKeyHint || null };
    let key = stockKeyHint;
    if (!key || !allStock.find(s => s._key === key)) {
        const nomLower = (nom || '').trim().toLowerCase();
        const matches = allStock.filter(s => (s.nom || '').trim().toLowerCase() === nomLower);
        key = matches.length === 1 ? matches[0]._key : null;
    }
    if (!key) return { ok: false, stock_key: null };
    let insuffisant = false;
    try {
        await runTransaction(ref(db, `db_pharmacie_stock/${key}/quantite`), current => {
            const n = parseInt(current, 10);
            const next = (isNaN(n) ? 0 : n) + delta;
            if (next < 0) { insuffisant = true; return; } // undefined -> Firebase abandonne la transaction
            return next;
        });
    } catch (e) {
        return { ok: false, stock_key: key };
    }
    return { ok: !insuffisant, stock_key: key };
}

window.ouvrirModalModifMed = function(key) {
    const x = allMedVentes.find(m => m._key === key);
    if (!x || x.annule) return;
    modifVente = x;
    // Copie de travail : les boutons +/-, ✕ et l'ajout n'écrivent rien en
    // base tant que « Enregistrer les modifications » n'est pas cliqué.
    modifPanier = (x.medicaments || []).map(m => ({
        nom: m.nom, prix: Number(m.prix || 0), qte: Number(m.qte || 0), stock_key: m.stock_key || null
    }));
    document.getElementById('modif-sub').textContent =
        `${x.patient_nom || '(non identifié)'} · N° ${x.num_attente || '—'} · Vente MED-${key.substring(0, 6).toUpperCase()}`;
    document.getElementById('modif-med-search').value = '';
    document.getElementById('modif-motif').value = "Médicament oublié à l'ajout";
    document.getElementById('modif-obs').value = '';
    const identifie = x.num_attente && x.num_attente !== '—';
    modifConfirmCode = identifie ? x.num_attente : (x.patient_nom || '');
    document.getElementById('modif-confirm-code').value = '';
    document.getElementById('modif-confirm-hint').textContent = identifie
        ? `Pour confirmer, saisissez le n° d'attente : ${x.num_attente}`
        : `Patient non identifié — pour confirmer, saisissez son nom : ${x.patient_nom || '—'}`;
    document.getElementById('modif-confirm-hint').className = 'confirm-hint';
    checkModifConfirm();
    renderModifPanier();
    document.getElementById('modal-modif-overlay').classList.add('visible');
};

window.checkModifConfirm = function() {
    const val = document.getElementById('modif-confirm-code')?.value || '';
    const ok = codeConfirmationValide(val, modifConfirmCode);
    const btn = document.getElementById('modif-confirm-btn');
    if (btn) btn.disabled = !ok;
    const hint = document.getElementById('modif-confirm-hint');
    if (hint) hint.classList.toggle('ok', ok);
};

window.closeModalModifMed = function() {
    document.getElementById('modal-modif-overlay').classList.remove('visible');
    modifVente = null; modifPanier = []; modifConfirmCode = '';
};

function renderModifPanier() {
    const container = document.getElementById('modif-panier-liste');
    if (!modifPanier.length) {
        container.outerHTML = '<div id="modif-panier-liste" class="panier-vide">Aucun médicament — pour tout retourner, utilisez plutôt « ↩ Annuler &amp; Retourner ».</div>';
    } else {
        container.outerHTML = `<div id="modif-panier-liste" class="panier-list">${modifPanier.map((p, i) => `
            <div class="panier-item">
                <div style="flex:1;">
                    <div class="panier-item-nom">${esc(p.nom)}</div>
                    <div style="font-size:0.7rem;color:var(--muted);">${esc(fmt(p.prix))} FCFA / unité</div>
                </div>
                <div class="panier-qte-ctrl">
                    <button class="panier-btn" onclick="modifierQteModif(${i}, -1)">-</button>
                    <div class="panier-qte-val">${p.qte}</div>
                    <button class="panier-btn" onclick="modifierQteModif(${i}, 1)">+</button>
                </div>
                <div class="panier-item-prix" style="width:82px;text-align:right;white-space:nowrap;">${esc(fmt(p.prix * p.qte))} FCFA</div>
                <button class="panier-del" style="margin-left:10px;" onclick="retirerMedModif(${i})">✕</button>
            </div>`).join('')}</div>`;
    }
    updateModifTotal();
    renderModifMedGrid(document.getElementById('modif-med-search')?.value || '');
}

window.modifierQteModif = function(i, delta) {
    const item = modifPanier[i];
    if (!item) return;
    item.qte += delta;
    if (item.qte <= 0) { retirerMedModif(i); return; }
    renderModifPanier();
};

window.retirerMedModif = function(i) {
    modifPanier.splice(i, 1);
    renderModifPanier();
};

function renderModifMedGrid(q) {
    const container = document.getElementById('modif-med-liste');
    if (!allStock.length) { container.innerHTML = '<div class="med-empty">Chargement des médicaments…</div>'; return; }
    const filtered = allStock.filter(m => {
        if (!q) return true;
        return (m.nom || '').toLowerCase().includes(q.toLowerCase()) ||
               (m.categorie || '').toLowerCase().includes(q.toLowerCase());
    });
    if (!filtered.length) {
        container.innerHTML = `<div class="med-empty">Aucun médicament trouvé${q ? ` pour "${esc(q)}"` : ''}.</div>`;
        return;
    }
    const panierKeys = modifPanier.map(p => p.stock_key);
    const items = filtered.map(m => {
        const inPanier = panierKeys.includes(m._key);
        const stockNum = parseInt(m.quantite, 10) || 0;
        const isOutOfStock = stockNum <= 0;
        const hasPrix = (m.prix_unitaire !== undefined && m.prix_unitaire !== null && m.prix_unitaire !== '');
        const prixHtml = hasPrix
            ? `<div class="med-prix">${esc(fmt(m.prix_unitaire))} FCFA${inPanier ? ' ✓' : ''}</div>`
            : (inPanier ? '<div class="med-prix">✓</div>' : '');
        const catHtml = m.categorie ? ` · <span style="font-style:italic;">${esc(m.categorie)}</span>` : '';
        const isBlocked = inPanier || isOutOfStock;
        return `
            <div class="med-item ${inPanier ? 'added' : ''}"
                 tabindex="${isBlocked ? '-1' : '0'}" role="button"
                 style="${isOutOfStock ? 'opacity:0.5;cursor:not-allowed;border-color:var(--danger);' : ''}"
                 onclick="${isBlocked ? '' : `ajouterMedModif('${m._key}')`}"
                 onkeydown="if(!${isBlocked}&&(event.key==='Enter'||event.key===' ')){ajouterMedModif('${m._key}')}">
                <div class="med-item-left">
                    <div class="med-nom">${esc(m.nom || '—')}</div>
                    <div class="med-meta">
                        Stock : ${stockNum}${isOutOfStock ? ' <b style="color:var(--danger)">(Rupture)</b>' : ''}${catHtml}
                    </div>
                </div>
                ${prixHtml}
            </div>`;
    });
    container.innerHTML = items.join('');
}

window.filtrerModifMeds = function() {
    renderModifMedGrid(document.getElementById('modif-med-search').value);
};

window.ajouterMedModif = function(key) {
    const med = allStock.find(m => m._key === key);
    if (!med) return;
    const existing = modifPanier.find(p => p.stock_key === key);
    if (existing) {
        existing.qte++;
    } else {
        const prix = (med.prix_unitaire !== undefined && med.prix_unitaire !== null && med.prix_unitaire !== '') ? parseFloat(med.prix_unitaire) : 0;
        modifPanier.push({ nom: med.nom, prix, qte: 1, stock_key: key });
    }
    renderModifPanier();
};

function updateModifTotal() {
    const total = modifPanier.reduce((s, p) => s + p.prix * p.qte, 0);
    document.getElementById('modif-total').textContent = fmt(total) + ' FCFA';
    const diffRow = document.getElementById('modif-diff-row');
    const diffEl = document.getElementById('modif-diff');
    const totalInitial = Number(modifVente?.total || 0);
    const diff = total - totalInitial;
    if (diff !== 0) {
        diffRow.style.display = 'flex';
        diffEl.textContent = (diff > 0 ? '+' : '') + fmt(diff) + ' FCFA';
        diffEl.className = 'recap-val ' + (diff > 0 ? 'modal-diff-pos' : 'modal-diff-neg');
    } else {
        diffRow.style.display = 'none';
    }
}

window.confirmerModifMed = async function() {
    if (!modifVente) return;
    const codeSaisi = document.getElementById('modif-confirm-code').value;
    if (!codeConfirmationValide(codeSaisi, modifConfirmCode)) {
        toast('Le code de confirmation ne correspond pas au patient.', 'err');
        return;
    }
    if (!modifPanier.length) {
        toast('Pour retirer tous les médicaments, utilisez plutôt « Annuler & Retourner ».', 'err');
        return;
    }

    const motif = document.getElementById('modif-motif').value;
    const obs = document.getElementById('modif-obs').value.trim();
    const btn = document.getElementById('modif-confirm-btn');

    const original = modifVente.medicaments || [];
    // Regroupe par clé stable (stock_key si connu, sinon nom en repli) pour
    // calculer l'écart de quantité à répercuter sur le stock.
    const cleDe = l => l.stock_key || ('nom:' + (l.nom || '').trim().toLowerCase());
    const avantMap = new Map(), apresMap = new Map(), infoMap = new Map();
    original.forEach(l => {
        const k = cleDe(l);
        avantMap.set(k, (avantMap.get(k) || 0) + Number(l.qte || 0));
        infoMap.set(k, { nom: l.nom, stock_key: l.stock_key || null });
    });
    modifPanier.forEach(l => {
        const k = cleDe(l);
        apresMap.set(k, (apresMap.get(k) || 0) + Number(l.qte || 0));
        infoMap.set(k, { nom: l.nom, stock_key: l.stock_key || null });
    });

    // Pré-vérification : refuse d'enregistrer si le stock disponible ne
    // couvre pas les quantités supplémentaires demandées — évite un état
    // à moitié appliqué en base (certaines lignes ajustées, d'autres non).
    const insuffisants = [];
    for (const [k, info] of infoMap) {
        const delta = (avantMap.get(k) || 0) - (apresMap.get(k) || 0);
        if (delta >= 0) continue; // pas de prélèvement supplémentaire sur cette ligne
        let stockItem = info.stock_key ? allStock.find(s => s._key === info.stock_key) : null;
        if (!stockItem) {
            const nomLower = (info.nom || '').trim().toLowerCase();
            const matches = allStock.filter(s => (s.nom || '').trim().toLowerCase() === nomLower);
            stockItem = matches.length === 1 ? matches[0] : null;
        }
        const dispo = stockItem ? (parseInt(stockItem.quantite, 10) || 0) : 0;
        if (dispo < -delta) insuffisants.push(`${info.nom} (dispo ${dispo}, besoin ${-delta})`);
    }
    if (insuffisants.length) {
        toast(`Stock insuffisant : ${insuffisants.join(', ')}.`, 'err');
        return;
    }

    btn.disabled = true; document.getElementById('modif-confirm-btn-label').textContent = 'Enregistrement…';

    try {
        const stockErrors = [];
        for (const [k, info] of infoMap) {
            const delta = (avantMap.get(k) || 0) - (apresMap.get(k) || 0);
            if (delta === 0) continue;
            const res = await ajusterStockDelta(info.nom, info.stock_key, delta);
            if (!res.ok) stockErrors.push(info.nom);
        }
        if (stockErrors.length) toast(`Stock non ajusté pour : ${stockErrors.join(', ')}`, 'err');

        const total = modifPanier.reduce((s, p) => s + p.prix * p.qte, 0);
        const caissierEmail = auth.currentUser?.email || '';
        const recu = Number(modifVente.argent_remis || 0);
        const monnaie = recu > 0 ? recu - total : (modifVente.monnaie_rendue || 0);
        const apres = modifPanier.map(p => ({ nom: p.nom, prix: p.prix, qte: p.qte, stock_key: p.stock_key || null }));

        const entree = {
            ts: Date.now(), par: caissierEmail, motif, obs,
            avant: original, apres,
            avant_total: modifVente.total || 0, apres_total: total
        };

        await update(ref(db, 'vente_medicaments/' + modifVente._key), {
            medicaments: apres,
            total,
            monnaie_rendue: monnaie,
            modifie_par: caissierEmail,
            modifie_ts: Date.now(),
            modifications: [...(modifVente.modifications || []), entree]
        });

        toast('Vente modifiée avec succès.', 'ok');
        closeModalModifMed();
    } catch (e) {
        console.error(e);
        toast('Erreur lors de la modification : ' + e.message, 'err');
    } finally {
        document.getElementById('modif-confirm-btn-label').textContent = 'Enregistrer les modifications';
        checkModifConfirm(); // ré-évalue l'état du bouton (modale restée ouverte après une erreur)
    }
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