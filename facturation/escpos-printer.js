/* ═══════════════════════════════════════════════════════════════
   ESCPOS-PRINTER.JS
   Pilote d'impression thermique ESC/POS via WebUSB, pour imprimante
   58mm (ex : POS58B — modèle utilisé au Poste de Santé de Diandioly).

   Pourquoi WebUSB plutôt que window.print() ?
   - Aucune boîte de dialogue navigateur, aucun en-tête/pied de page
     parasite, aucune variation de mise en page selon le navigateur.
   - Contrôle exact des caractères par ligne, du gras, des tailles.
   - Fonctionne identiquement sur tous les postes (Chrome/Edge desktop
     ET Chrome Android), tant que le câble est branché en USB.
   - NB : Web Bluetooth ne fonctionne PAS avec ce type d'imprimante
     (Bluetooth "classique" SPP, pas BLE), d'où le choix de l'USB.

   Compatibilité : Chrome / Edge / Opera desktop + Chrome Android.
   PAS pris en charge : Safari / iOS (aucune version ne supporte
   WebUSB). Sur ces navigateurs, on retombe automatiquement sur
   window.print() (voir printAndClear() dans script.js).
   ═══════════════════════════════════════════════════════════════ */

// ── CONFIGURATION ────────────────────────────────
export const PRINTER_CONFIG = {
    lineWidth: 32,        // caractères par ligne (police A standard sur 58mm)
    hasCutter: false,     // la plupart des POS58B "desktop" n'ont pas de massicot auto
    feedLinesEnd: 4,       // lignes de défilement en fin de ticket (place pour déchirer)
};

const STORAGE_KEY = 'escpos_last_device';

// ── ÉTAT INTERNE ─────────────────────────────────
let _device = null;
let _outEndpoint = null;
let _interfaceNumber = null;

// ── DÉTECTION DU SUPPORT ─────────────────────────
export function isWebUSBSupported() {
    return typeof navigator !== 'undefined' && !!navigator.usb;
}

export function isPrinterConnected() {
    return !!(_device && _device.opened);
}

// ── NORMALISATION DU TEXTE ───────────────────────
// Les imprimantes ESC/POS bon marché utilisent des pages de code
// mono-octet (CP437/CP850) et gèrent très mal l'UTF-8 brut : les
// accents français ("é", "è", "à"…) et les émojis ressortent en
// symboles illisibles. Pour un rendu fiable quel que soit le
// firmware exact du POS58B, on translittère en ASCII pur avant
// impression. C'est le choix le plus robuste (au prix des accents).
const ACCENTS_MAP = {
    'à':'a','â':'a','ä':'a','á':'a','ã':'a','À':'A','Â':'A','Ä':'A','Á':'A',
    'é':'e','è':'e','ê':'e','ë':'e','É':'E','È':'E','Ê':'E','Ë':'E',
    'î':'i','ï':'i','í':'i','Î':'I','Ï':'I',
    'ô':'o','ö':'o','ó':'o','õ':'o','Ô':'O','Ö':'O',
    'ù':'u','û':'u','ü':'u','ú':'u','Ù':'U','Û':'U','Ü':'U',
    'ç':'c','Ç':'C','ñ':'n','Ñ':'N',
    '\u2019':"'", '\u2018':"'", '\u201c':'"', '\u201d':'"', '\u2013':'-', '\u2014':'-',
    '°':'deg',
};
function normalizeText(str) {
    return String(str ?? '')
        .replace(/[^\u0000-\u007E]/g, ch => ACCENTS_MAP[ch] ?? '')
        .replace(/[^\x20-\x7E]/g, ''); // sécurité : supprime tout résidu non-ASCII imprimable
}

// ── CONSTRUCTEUR DE TICKET ESC/POS ───────────────
const ESC = 0x1B, GS = 0x1D, LF = 0x0A;

class Receipt {
    constructor(width = PRINTER_CONFIG.lineWidth) {
        this.width = width;
        this.bytes = [];
        this._raw([ESC, 0x40]); // ESC @ : initialise l'imprimante
    }
    _raw(arr) { this.bytes.push(...arr); return this; }
    _textBytes(str) {
        const clean = normalizeText(str);
        for (let i = 0; i < clean.length; i++) this.bytes.push(clean.charCodeAt(i));
        return this;
    }
    align(a) { // 'left' | 'center' | 'right'
        const n = a === 'center' ? 1 : a === 'right' ? 2 : 0;
        return this._raw([ESC, 0x61, n]);
    }
    bold(on) { return this._raw([ESC, 0x45, on ? 1 : 0]); }
    size(w = 1, h = 1) { // 1..8, 1 = normal
        const n = ((Math.min(w,8)-1) << 4) | (Math.min(h,8)-1);
        return this._raw([GS, 0x21, n]);
    }
    text(str) { return this._textBytes(str); }
    line(str = '') { this._textBytes(str); return this._raw([LF]); }
    blank(n = 1) { for (let i=0;i<n;i++) this._raw([LF]); return this; }
    hr(ch = '-') { return this.line(ch.repeat(this.width)); }
    // Deux colonnes : libellé à gauche, valeur alignée à droite
    row(left, right) {
        left = normalizeText(left); right = normalizeText(right);
        const space = this.width - left.length - right.length;
        const gap = space > 0 ? ' '.repeat(space) : ' ';
        return this.line(left + gap + right);
    }
    center(str) { this.align('center'); this.line(str); this.align('left'); return this; }
    cut() {
        this.blank(PRINTER_CONFIG.feedLinesEnd);
        if (PRINTER_CONFIG.hasCutter) this._raw([GS, 0x56, 0x01]); // coupe partielle
        return this;
    }
    toBytes() { return Uint8Array.from(this.bytes); }
}

// ── CONNEXION WEBUSB ──────────────────────────────
// Doit être appelée depuis un geste utilisateur (clic sur un bouton).
export async function connectPrinter() {
    if (!isWebUSBSupported()) {
        throw new Error('WebUSB non supporté par ce navigateur.');
    }
    const device = await navigator.usb.requestDevice({ filters: [] });
    await _openAndClaim(device);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            vendorId: device.vendorId, productId: device.productId
        }));
    } catch (_) {}
    return true;
}

// Tentative de reconnexion silencieuse (sans popup) au chargement de
// la page, si l'utilisateur a déjà autorisé l'appareil précédemment.
export async function tryAutoReconnect() {
    if (!isWebUSBSupported()) return false;
    try {
        const known = await navigator.usb.getDevices();
        if (!known.length) return false;
        let target = known[0];
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved) {
                target = known.find(d => d.vendorId === saved.vendorId && d.productId === saved.productId) || known[0];
            }
        } catch (_) {}
        await _openAndClaim(target);
        return true;
    } catch (e) {
        console.warn('Reconnexion imprimante impossible :', e);
        return false;
    }
}

async function _openAndClaim(device) {
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    let ifaceNum = null, epOut = null;
    outer:
    for (const conf of device.configurations) {
        for (const iface of conf.interfaces) {
            for (const alt of iface.alternates) {
                const bulkOut = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
                if (bulkOut) { ifaceNum = iface.interfaceNumber; epOut = bulkOut.endpointNumber; break outer; }
            }
        }
    }
    if (ifaceNum === null) throw new Error("Aucun endpoint USB compatible trouvé sur l'imprimante.");

    await device.claimInterface(ifaceNum);
    _device = device;
    _interfaceNumber = ifaceNum;
    _outEndpoint = epOut;

    device.addEventListener('disconnect', () => {
        _device = null; _outEndpoint = null; _interfaceNumber = null;
    });
}

export async function disconnectPrinter() {
    if (_device) {
        try { await _device.close(); } catch (_) {}
    }
    _device = null; _outEndpoint = null; _interfaceNumber = null;
}

async function sendBytes(bytes) {
    if (!isPrinterConnected()) throw new Error('Imprimante non connectée.');
    await _device.transferOut(_outEndpoint, bytes);
}

// ── MISE EN PAGE DES TICKETS ──────────────────────
export async function printTicketConsultation(d) {
    const r = new Receipt();
    r.align('center').bold(true).size(1,1).line('POSTE DE SANTE DE DIANDIOLY');
    r.bold(false).line('TICKET DE CONSULTATION');
    r.align('left').hr();
    r.row('Ref :', d.refNum);
    r.row('Date :', d.dateStr);
    r.hr('-');
    r.row('Prenom :', d.prenom);
    r.row('Nom :', d.nom);
    r.row('Age :', d.age + ' ans');
    r.row('Prestation :', d.choix);
    r.hr('-');
    r.align('center').line('NUMERO D\'ATTENTE');
    r.bold(true).size(2,2).line(d.numAttente);
    r.bold(false).size(1,1);
    r.hr('-');
    r.bold(true).align('right').line('TOTAL : ' + d.total + ' FCFA');
    r.bold(false);
    if (d.recu > 0) r.row('Remis : ' + d.recuFmt, 'Monnaie : ' + d.monnaieFmt);
    r.align('left').hr('-');
    r.row('Valide jusqu\'au :', d.validiteStr);
    r.align('center').line('Conservez ce ticket pour acceder au medecin.');
    r.line('Validite : 24 heures.');
    r.cut();
    await sendBytes(r.toBytes());
}

export async function printTicketMedicaments(d) {
    const r = new Receipt();
    r.align('center').bold(true).line('POSTE DE SANTE DE DIANDIOLY');
    r.bold(false).line('TICKET MEDICAMENTS');
    r.line('A AGRAFER SUR L\'ORDONNANCE');
    r.align('left').hr();
    r.row('Ref :', d.refNum);
    r.row('Date :', d.dateStr);
    r.hr('-');
    r.row('Patient :', d.patientNom);
    r.row('N Attente :', d.patientAtt);
    r.hr('-');
    r.bold(true).line('MEDICAMENTS'); r.bold(false);
    for (const item of d.lignes) {
        r.row(`${item.qte}x ${item.nom}`, item.montant + ' FCFA');
    }
    r.hr('-');
    r.bold(true).align('right').line('TOTAL : ' + d.total + ' FCFA');
    r.bold(false).align('left');
    if (d.recu > 0) r.row('Remis : ' + d.recuFmt, 'Monnaie : ' + d.monnaieFmt);
    r.hr('-');
    r.align('center').line('A AGRAFER sur l\'ordonnance.');
    r.line('A presenter a la pharmacie pour la livraison.');
    r.cut();
    await sendBytes(r.toBytes());
}

// Ticket de test, utile pour valider le branchement/calibrage.
export async function printTestTicket() {
    const r = new Receipt();
    r.align('center').bold(true).line('TEST IMPRESSION');
    r.bold(false).line(new Date().toLocaleString('fr-FR'));
    r.hr();
    r.align('left').line('abcdefghijklmnopqrstuvwxyz');
    r.line('0123456789 FCFA');
    r.row('Gauche', 'Droite');
    r.cut();
    await sendBytes(r.toBytes());
}
