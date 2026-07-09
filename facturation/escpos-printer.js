/* ═══════════════════════════════════════════════════════════════
   ESCPOS-PRINTER.JS
   Pilote d'impression thermique ESC/POS pour imprimante 58mm
   (POS58B — Poste de Santé de Diandioly), avec DEUX canaux de
   transport possibles :

   1) WebUSB — direct depuis le navigateur, sans app tierce.
      Marche bien sur desktop (Chrome/Edge/Opera). Sur Android,
      dépend fortement du téléphone : si un service système a déjà
      "réservé" l'interface USB de l'imprimante, le navigateur ne
      pourra pas la voir dans la liste WebUSB.

   2) RawBT — via l'app Android "RawBT ESC/POS" (gratuite), qui gère
      elle-même la connexion Bluetooth classique (SPP) ou USB à
      l'imprimante, et reçoit nos données ESC/POS via un lien
      intent:// déclenché depuis la page web. C'est la solution la
      plus robuste sur mobile Android car :
      - Web Bluetooth ne supporte QUE le Bluetooth basse énergie
        (BLE) ; le POS58B utilise le Bluetooth classique (SPP), donc
        Web Bluetooth ne pourra JAMAIS s'y connecter directement —
        ce n'est pas un bug corrigeable côté code.
      - RawBT, en tant qu'app native, a un accès système complet au
        Bluetooth/USB, sans les restrictions d'une page web.

   PAS pris en charge du tout : Safari / iOS (aucune des deux
   méthodes ne fonctionne). Sur ces navigateurs, repli automatique
   sur window.print() (voir printAndClear() dans script.js) — avec
   les limites connues du print natif mobile (taille de papier non
   garantie, cf. IMPRESSION-README.md).
   ═══════════════════════════════════════════════════════════════ */

// ── CONFIGURATION ────────────────────────────────
export const PRINTER_CONFIG = {
    lineWidth: 32,        // caractères par ligne (police A standard sur 58mm)
    hasCutter: false,     // la plupart des POS58B "desktop" n'ont pas de massicot auto
    feedLinesEnd: 4,       // lignes de défilement en fin de ticket (place pour déchirer)
};

const STORAGE_KEY = 'escpos_last_device';
const RAWBT_PACKAGE = 'ru.a402d.rawbtprinter';

// ── ÉTAT INTERNE ─────────────────────────────────
let _device = null;
let _outEndpoint = null;
let _interfaceNumber = null;

// ── DÉTECTION DU SUPPORT ─────────────────────────
export function isWebUSBSupported() {
    return typeof navigator !== 'undefined' && !!navigator.usb;
}

export function isAndroid() {
    return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

// RawBT n'existe que sous forme d'app Android ; on ne peut pas savoir
// avec certitude si elle est installée avant d'essayer de l'ouvrir,
// donc on se contente de vérifier qu'on est bien sur Android.
export function isRawBTAvailable() {
    return isAndroid();
}

export function isPrinterConnected() {
    return !!(_device && _device.opened);
}

// ── BLUETOOTH BASSE ÉNERGIE (BLE) ────────────────
// Web Bluetooth ne parle QUE le BLE (jamais le SPP classique). Mais
// beaucoup d'imprimantes 58mm chinoises (POS58, Goojprt, XPrinter,
// Zjiang…) exposent en réalité les DEUX modes. Si c'est le cas du
// POS58B, ce canal permet d'imprimer directement depuis Chrome, sans
// RawBT, et — c'est là tout l'intérêt — sans geste utilisateur après
// le premier appairage : imprimerTicket() devient totalement silencieux.
//
// Chaque profil = un couple (service GATT, caractéristique d'écriture)
// connu pour ces imprimantes. On les essaie dans l'ordre.
const BLE_PROFILES = [
    { service: 0x18f0, chars: [0x2af1] },                          // le plus répandu (POS58, Goojprt, XPrinter)
    { service: 0xff00, chars: [0xff02] },                          // clones Zjiang / MTP-II
    { service: 0xffe0, chars: [0xffe1] },                          // modules type HM-10
    { service: 0xfff0, chars: [0xfff2, 0xfff1] },                  // variantes diverses
    { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      chars:   ['bef8d6c9-9c21-4c9e-b632-bd58c1009f9f'] },         // Peripage / Paperang
];

// Taille de paquet sûre : le MTU BLE négocié est souvent ~185 octets.
const BLE_CHUNK = 180;
const BLE_STORAGE_KEY = 'escpos_ble_device_name';

let _bleDevice = null;
let _bleChar = null;

export function isBLESupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export function isBLEConnected() {
    return !!(_bleChar && _bleDevice && _bleDevice.gatt && _bleDevice.gatt.connected);
}

// Doit être appelée depuis un geste utilisateur (clic sur le badge).
// Une seule fois : ensuite les impressions partent sans interaction.
export async function connectBLE() {
    if (!isBLESupported()) {
        throw new Error('Web Bluetooth non supporté par ce navigateur.');
    }
    const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLE_PROFILES.map(p => p.service),
    });
    device.addEventListener('gattserverdisconnected', () => { _bleChar = null; });

    const server = await device.gatt.connect();
    for (const prof of BLE_PROFILES) {
        let svc;
        try { svc = await server.getPrimaryService(prof.service); } catch (_) { continue; }
        for (const uuid of prof.chars) {
            try {
                const ch = await svc.getCharacteristic(uuid);
                if (ch.properties.write || ch.properties.writeWithoutResponse) {
                    _bleDevice = device;
                    _bleChar = ch;
                    try { localStorage.setItem(BLE_STORAGE_KEY, device.name || ''); } catch (_) {}
                    return true;
                }
            } catch (_) { /* caractéristique absente : profil suivant */ }
        }
    }
    try { device.gatt.disconnect(); } catch (_) {}
    throw new Error(
        "Aucun service d'impression BLE trouvé sur cet appareil. " +
        "Le POS58B n'expose probablement que du Bluetooth classique (SPP) : " +
        "utilisez alors USB/OTG ou RawBT."
    );
}

export async function disconnectBLE() {
    try { if (_bleDevice && _bleDevice.gatt.connected) _bleDevice.gatt.disconnect(); } catch (_) {}
    _bleDevice = null; _bleChar = null;
}

// Reconnexion silencieuse au chargement de la page. Nécessite que le
// navigateur mémorise l'appareil (Chrome Android : dépend du drapeau
// chrome://flags/#enable-web-bluetooth-new-permissions-backend).
// Si indisponible, l'utilisateur reclique une fois sur le badge par session.
export async function tryAutoReconnectBLE() {
    if (!isBLESupported() || typeof navigator.bluetooth.getDevices !== 'function') return false;
    try {
        const known = await navigator.bluetooth.getDevices();
        if (!known.length) return false;
        const savedName = localStorage.getItem(BLE_STORAGE_KEY);
        const device = known.find(d => d.name === savedName) || known[0];
        const server = await device.gatt.connect();
        for (const prof of BLE_PROFILES) {
            let svc;
            try { svc = await server.getPrimaryService(prof.service); } catch (_) { continue; }
            for (const uuid of prof.chars) {
                try {
                    const ch = await svc.getCharacteristic(uuid);
                    if (ch.properties.write || ch.properties.writeWithoutResponse) {
                        _bleDevice = device; _bleChar = ch; return true;
                    }
                } catch (_) {}
            }
        }
        return false;
    } catch (e) {
        console.warn('Reconnexion BLE impossible :', e);
        return false;
    }
}

async function sendBytesBLE(bytes) {
    if (!isBLEConnected()) throw new Error('Imprimante Bluetooth non connectée.');
    const useNoResponse = _bleChar.properties.writeWithoutResponse;
    for (let i = 0; i < bytes.length; i += BLE_CHUNK) {
        const chunk = bytes.slice(i, i + BLE_CHUNK);
        if (useNoResponse) await _bleChar.writeValueWithoutResponse(chunk);
        else await _bleChar.writeValue(chunk);
        // Ces imprimantes ont un tampon minuscule : sans pause, on perd des octets.
        await new Promise(r => setTimeout(r, 20));
    }
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

async function sendBytesUSB(bytes) {
    if (!isPrinterConnected()) throw new Error('Imprimante USB non connectée.');
    await _device.transferOut(_outEndpoint, bytes);
}

// Envoie les octets ESC/POS à l'app RawBT installée sur le téléphone,
// via un lien intent:// (mécanisme standard Android/Chrome). RawBT
// gère ensuite elle-même la connexion Bluetooth/USB à l'imprimante.
// Doit être appelé depuis un geste utilisateur (clic).
function sendViaRawBT(bytes) {
    if (!isAndroid()) throw new Error('RawBT nécessite un téléphone Android.');
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const url = 'intent:base64,' + encodeURIComponent(b64)
        + '#Intent;scheme=rawbt;package=' + RAWBT_PACKAGE + ';end;';
    window.location.href = url;
}

// ── MISE EN PAGE DES TICKETS ──────────────────────
function buildConsultationBytes(d) {
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
    return r.toBytes();
}

function buildMedicamentsBytes(d) {
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
    return r.toBytes();
}

function buildTestBytes() {
    const r = new Receipt();
    r.align('center').bold(true).line('TEST IMPRESSION');
    r.bold(false).line(new Date().toLocaleString('fr-FR'));
    r.hr();
    r.align('left').line('abcdefghijklmnopqrstuvwxyz');
    r.line('0123456789 FCFA');
    r.row('Gauche', 'Droite');
    r.cut();
    return r.toBytes();
}

// `method` : 'usb' (WebUSB) ou 'rawbt' (app RawBT sur Android).
async function dispatch(bytes, method) {
    if (method === 'rawbt') { sendViaRawBT(bytes); return; }
    if (method === 'ble') { await sendBytesBLE(bytes); return; }
    await sendBytesUSB(bytes);
}

export async function printTicketConsultation(d, method = 'usb') {
    await dispatch(buildConsultationBytes(d), method);
}
export async function printTicketMedicaments(d, method = 'usb') {
    await dispatch(buildMedicamentsBytes(d), method);
}
export async function printTestTicket(method = 'usb') {
    await dispatch(buildTestBytes(), method);
}
