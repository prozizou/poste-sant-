import { villageActuel } from '../village-client.js';
/* ═══════════════════════════════════════════════════════════════
   ESCPOS-PRINTER.JS
   Pilote d'impression thermique ESC/POS pour imprimante 58mm
   (POS58B — Poste de santé), avec DEUX canaux de
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
    lineWidth: 32,        // colonnes en police A (58mm)
    lineWidthB: 42,       // colonnes en police B (glyphes plus petits)
    dotsPerLine: 384,     // points par ligne physique (58mm = 384 dots)
    hasCutter: false,     // la plupart des POS58B "desktop" n'ont pas de massicot auto

    // ── ÉCONOMIE DE PAPIER ──
    // Hauteur de ligne en points (commande ESC 3 n). L'imprimante démarre
    // vers 30-34 : la resserrer supprime le blanc inutile entre les lignes.
    // Les glyphes font 24 points en police A et 17 en police B : descendre
    // en dessous de glyphe+2 fait se toucher les jambages (p, g, q).
    lineSpacing: 26,      // police A
    lineSpacingB: 20,     // police B
    attenteScaleW: 3,     // largeur du numéro d'attente (1..8)
    attenteScaleH: 2,     // hauteur du numéro d'attente — c'est elle qui coûte du papier
    // Défilement final : il faut de quoi amener la dernière ligne au-delà
    // de la barre de déchirure. 3 lignes suffisent sur un POS58B.
    feedLinesEnd: 3,

    printLogo: true,      // rastérise et imprime le logo vectoriel en tête de ticket
    logoWidth: 96,        // côté du logo en points (96 = ~12mm). Multiple de 8 conseillé.

    // true  : le bitmap est complété de blanc jusqu'à 384 points et centré
    //         nous-mêmes. Marche sur TOUS les firmwares, mais ~2,5x plus d'octets.
    // false : bitmap étroit + centrage confié à ESC a 1. Beaucoup plus rapide en
    //         Bluetooth, mais certains firmwares ignorent l'alignement des images.
    centerLogoByPadding: true,

    // Vidéo inverse (GS B) pour le bandeau "À AGRAFER". Si votre POS58B
    // l'ignore ou imprime un pavé noir illisible, passez à false : on
    // retombe alors sur un encadrement en astérisques.
    useInvert: true,
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
    // Espaces insecables produites par toLocaleString('fr-FR') : sans cette
    // conversion, "2 000" perdait son separateur de milliers a l'impression.
    '\u00a0':' ', '\u202f':' ', '\u2009':' ',
    '°':'o', '\u20ac':'EUR', '\u00d7':'x',
};
function normalizeText(str) {
    return String(str ?? '')
        .replace(/[^\u0000-\u007E]/g, ch => ACCENTS_MAP[ch] ?? '')
        .replace(/[^\x20-\x7E]/g, ''); // sécurité : supprime tout résidu non-ASCII imprimable
}

// ── LOGOS VECTORIELS ─────────────────────────────
// Source unique de vérité : ces mêmes SVG servent au reçu HTML
// (repli navigateur) ET sont rastérisés ci-dessous pour l'imprimante
// thermique. Un seul tracé à maintenir, rendu identique partout.
export const SVG_CROIX = `
<svg class="r-logo" viewBox="0 0 100 100" role="img" aria-label="Croix médicale">
  <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="5.5"/>
  <path d="M23 50 H77 M50 23 V77" fill="none" stroke="currentColor"
        stroke-width="16" stroke-linecap="round"/>
</svg>`;

export const SVG_HYGIE = `
<svg class="r-logo" viewBox="0 0 100 100" role="img" aria-label="Coupe d'Hygie, symbole de la pharmacie">
  <path d="M46 56 C18 50 22 13 50 13 C74 13 78 33 63 37"
        fill="none" stroke="currentColor" stroke-width="7.5"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="61" cy="37.5" r="5.8" fill="currentColor"/>
  <circle cx="62.5" cy="36.2" r="1.6" fill="#fff"/>
  <path d="M28 46 H72 C72 70 58 75 54.5 79 V85 L70 87
           Q73 90 69 93 H31 Q27 90 30 87 L45.5 85 V79
           C42 75 28 70 28 46 Z" fill="currentColor"/>
</svg>`;

// ── RASTÉRISATION SVG → BITMAP ESC/POS ───────────
// Une imprimante thermique ne connaît que des points noirs ou blancs :
// le vectoriel doit être converti. On dessine le SVG sur un <canvas>
// à la taille exacte voulue (donc net, sans interpolation d'un PNG),
// puis on seuille chaque pixel et on empaquette 8 pixels par octet,
// format attendu par la commande GS v 0.
const _rasterCache = new Map();

async function rasterizeSVG(svg, targetW) {
    const key = targetW + '|' + PRINTER_CONFIG.centerLogoByPadding + '|' + svg;
    if (_rasterCache.has(key)) return _rasterCache.get(key);

    const job = (async () => {
        if (typeof document === 'undefined') throw new Error('Canvas indisponible.');
        // `currentColor` n'a aucun sens hors du DOM ; xmlns + dimensions
        // explicites sont obligatoires pour qu'un <img> accepte le SVG.
        const src = svg
            .replace(/currentColor/g, '#000')
            .replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetW}"`);

        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
        await img.decode();

        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = targetW;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, targetW, targetW);
        ctx.drawImage(img, 0, 0, targetW, targetW);
        const px = ctx.getImageData(0, 0, targetW, targetW).data;

        const dots = PRINTER_CONFIG.centerLogoByPadding ? PRINTER_CONFIG.dotsPerLine : targetW;
        const bytesPerRow = Math.ceil(dots / 8);
        const offsetX = Math.max(0, (dots - targetW) >> 1);
        const data = new Uint8Array(bytesPerRow * targetW);

        for (let y = 0; y < targetW; y++) {
            for (let x = 0; x < targetW; x++) {
                const i = (y * targetW + x) * 4;
                // Luminance perçue ; seuil un peu haut pour conserver
                // les bords antialiasés des traits fins.
                const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
                if (lum < 160) {
                    const X = offsetX + x;
                    data[y * bytesPerRow + (X >> 3)] |= 0x80 >> (X & 7);
                }
            }
        }
        return { bytesPerRow, height: targetW, data };
    })();

    _rasterCache.set(key, job);
    return job;
}

// Pré-chauffage : le rendu canvas est ainsi déjà prêt au premier clic,
// ce qui évite de consommer l'« activation utilisateur » (nécessaire au
// lancement de l'intent RawBT) pendant la rastérisation.
if (typeof document !== 'undefined') {
    Promise.all([
        rasterizeSVG(SVG_CROIX, PRINTER_CONFIG.logoWidth),
        rasterizeSVG(SVG_HYGIE, PRINTER_CONFIG.logoWidth),
    ]).catch(() => {});
}

// ── DÉCOUPE DE TEXTE ─────────────────────────────
// Clé de la robustesse : aucune ligne envoyée à l'imprimante ne doit
// dépasser la largeur utile. Sinon le firmware coupe brutalement au
// caractère près et le retour à la ligne se superpose à la mise en
// page (les fameux « chevauchements »). On découpe donc nous-mêmes,
// aux espaces, en cassant les mots trop longs.
function wrapText(str, width) {
    const out = [];
    for (const para of String(str).split('\n')) {
        let line = '';
        for (let word of para.split(/\s+/).filter(Boolean)) {
            while (word.length > width) {
                if (line) { out.push(line); line = ''; }
                out.push(word.slice(0, width));
                word = word.slice(width);
            }
            if (!line) line = word;
            else if (line.length + 1 + word.length <= width) line += ' ' + word;
            else { out.push(line); line = word; }
        }
        out.push(line);
    }
    return out.length ? out : [''];
}

// « N° 7 », « 007 », 7 → « 007 ». Toujours 3 chiffres, jamais vide.
export function attenteDigits(v) {
    const d = String(v ?? '').replace(/\D/g, '');
    return d ? d.padStart(3, '0') : String(v ?? '---');
}

// ── CONSTRUCTEUR DE TICKET ESC/POS ───────────────
const ESC = 0x1B, GS = 0x1D, LF = 0x0A;

class Receipt {
    constructor(width = PRINTER_CONFIG.lineWidth) {
        this.width = width;
        this.bytes = [];
        this._scaleW = 1;              // multiplicateur de largeur courant
        this._font = 'A';
        this._raw([ESC, 0x40]);        // ESC @  : réinitialise l'imprimante
        this._raw([ESC, 0x74, 0x00]);  // ESC t 0: page de code PC437
        this._sp = 0;
        this._setSpacing(PRINTER_CONFIG.lineSpacing);   // ESC 3 n : interligne serré
    }

    // ESC 3 n fixe l'avance papier par ligne. ATTENTION : sur les firmwares
    // bon marché, cette avance est appliquée telle quelle, même si les
    // caractères sont plus hauts — d'où des chevauchements en double/triple
    // taille. On remonte donc systématiquement l'interligne avant d'écrire
    // gros, puis on le restaure.
    _setSpacing(n) {
        this._sp = Math.min(255, Math.max(1, n | 0));
        return this._raw([ESC, 0x33, this._sp]);
    }
    _glyphH() { return this._font === 'B' ? 17 : 24; }

    // Police A (32 col., glyphes 12x24) ou B (42 col., glyphes 9x17).
    // La police B est le principal levier d'économie de papier : plus
    // courte ET plus large, elle évite la plupart des retours à la ligne.
    font(f) {
        const next = (f === 'B') ? 'B' : 'A';
        if (next === this._font && this._sp) return this;
        this._font = next;
        this.width = next === 'B' ? PRINTER_CONFIG.lineWidthB : PRINTER_CONFIG.lineWidth;
        this._raw([ESC, 0x4D, next === 'B' ? 1 : 0]);
        return this._setSpacing(next === 'B' ? PRINTER_CONFIG.lineSpacingB : PRINTER_CONFIG.lineSpacing);
    }

    // Écrit en taille agrandie sans risque de chevauchement.
    big(w, h, fn) {
        const prev = this._sp;
        this._setSpacing(this._glyphH() * h + 4);
        this.size(w, h);
        fn(this);
        this.size(1, 1);
        return this._setSpacing(prev);
    }

    // Largeur utile réelle : en double/triple largeur, il tient
    // proportionnellement moins de caractères sur la ligne.
    get eff() { return Math.max(1, Math.floor(this.width / this._scaleW)); }

    _raw(arr) { this.bytes.push(...arr); return this; }
    _rawBulk(u8) { for (let i = 0; i < u8.length; i++) this.bytes.push(u8[i]); return this; }
    _textBytes(str) {
        const clean = normalizeText(str);
        for (let i = 0; i < clean.length; i++) this.bytes.push(clean.charCodeAt(i));
        return this;
    }

    // ── styles ──
    align(a) { return this._raw([ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0]); }
    bold(on) { return this._raw([ESC, 0x45, on ? 1 : 0]); }
    invert(on) { return this._raw([GS, 0x42, on ? 1 : 0]); }
    size(w = 1, h = 1) {
        w = Math.min(Math.max(w, 1), 8);
        h = Math.min(Math.max(h, 1), 8);
        this._scaleW = w;
        return this._raw([GS, 0x21, ((w - 1) << 4) | (h - 1)]);
    }

    // ── texte ──
    // line() découpe systématiquement : impossible de déborder.
    line(str = '') {
        for (const l of wrapText(normalizeText(str), this.eff)) {
            this._textBytes(l);
            this._raw([LF]);
        }
        return this;
    }
    blank(n = 1) { for (let i = 0; i < n; i++) this._raw([LF]); return this; }
    hr(ch = '-') { return this.line(ch.repeat(this.eff)); }
    center(str) { this.align('center'); this.line(str); this.align('left'); return this; }

    // Titre de rubrique.
    sect(t) { this.bold(true); this.line(t); this.bold(false); return this; }

    // ── deux colonnes, sans chevauchement possible ──
    // Si le libellé est trop long, il passe à la ligne et seule sa
    // dernière portion partage la ligne avec la valeur.
    // Largeur minimale acceptable pour le libellé : en dessous, mieux vaut
    // deux lignes propres qu'un libellé haché en morceaux illisibles.
    _pair(left, right, filler) {
        const w = this.eff;
        const L = normalizeText(left);
        const R = normalizeText(right);
        const MIN_L = 6;

        if (R.length + MIN_L + 2 > w) {           // la valeur mange toute la ligne
            this.line(L);
            for (const l of wrapText(R, w)) {     // valeur cadrée à droite
                this._textBytes(' '.repeat(w - l.length) + l);
                this._raw([LF]);
            }
            return this;
        }

        const maxL = w - R.length - 2;   // 2 = un espace de chaque côté du remplissage
        if (L.length <= maxL) return this._emit(L, R, filler, w);

        const parts = wrapText(L, maxL);
        const last = parts.pop();
        for (const p of parts) { this._textBytes(p); this._raw([LF]); }
        return this._emit(last, R, filler, w);
    }
    _emit(L, R, filler, w) {
        const n = w - L.length - R.length - 2;
        const mid = n > 0 ? ' ' + filler.repeat(n) + ' ' : '  ';
        this._textBytes((L + mid + R).slice(0, w));
        return this._raw([LF]);
    }
    row(left, right)    { return this._pair(left, right, ' '); }
    dotRow(left, right) { return this._pair(left, right, '.'); }

    // ── bandeau en vidéo inverse ──
    banner(txt) {
        const lines = wrapText(normalizeText(txt), this.eff);
        if (PRINTER_CONFIG.useInvert) {
            this.align('left').bold(true).invert(true);
            for (const l of lines) {
                const pad = this.eff - l.length;
                const left = pad >> 1;
                this._textBytes(' '.repeat(left) + l + ' '.repeat(pad - left));
                this._raw([LF]);
            }
            this.invert(false).bold(false);
        } else {
            this.align('center').hr('*');
            this.bold(true);
            for (const l of lines) this.line(l);
            this.bold(false).hr('*').align('left');
        }
        return this;
    }

    // ── numéro d'attente, très lisible à distance ──
    // Compact : libellé en police B, chiffres en triple taille, encadré
    // par deux filets. 4 lignes au total.
    attente(num) {
        this.font('A').align('center');
        this.hr('=');
        this.font('B').line("NUMERO D'ATTENTE");
        this.font('A').bold(true);
        this.big(PRINTER_CONFIG.attenteScaleW, PRINTER_CONFIG.attenteScaleH, r => r.line(num));
        this.bold(false);
        this.hr('=');
        this.align('left');
        return this;
    }

    // ── total mis en valeur (double hauteur, largeur normale : 32 col.) ──
    total(montant) {
        this.font('A').bold(true);
        this.big(1, 2, r => r.row('TOTAL', montant + ' FCFA'));
        this.bold(false);
        return this;
    }

    // ── ligne d'article : tout sur une ligne en police B (42 col.) ──
    // « 2x PARACETAMOL 500MG @150      300 FCFA »
    item(it) {
        const pu = (it.pu ?? null);
        const left = `${it.qte}x ${it.nom}` + (pu !== null ? ` @${pu}` : '');
        return this.row(left, it.montant + ' FCFA');
    }

    // ── image monochrome (GS v 0) ──
    raster(bmp) {
        const xL = bmp.bytesPerRow & 0xFF, xH = (bmp.bytesPerRow >> 8) & 0xFF;
        const yL = bmp.height & 0xFF,      yH = (bmp.height >> 8) & 0xFF;
        this._raw([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
        return this._rawBulk(bmp.data);
    }

    cut() {
        this.blank(PRINTER_CONFIG.feedLinesEnd);
        if (PRINTER_CONFIG.hasCutter) this._raw([GS, 0x56, 0x01]); // coupe partielle
        return this;
    }
    toBytes() { return Uint8Array.from(this.bytes); }
}

// Ajoute le logo en tête. Silencieusement ignoré si la rastérisation
// échoue : un ticket sans logo vaut mieux qu'un ticket non imprimé.
async function addLogo(r, svg) {
    if (!PRINTER_CONFIG.printLogo) return;
    try {
        const bmp = await rasterizeSVG(svg, PRINTER_CONFIG.logoWidth);
        // En mode « padding », l'image occupe toute la largeur : elle doit
        // partir de la colonne 0, donc alignement à gauche impératif.
        r.align(PRINTER_CONFIG.centerLogoByPadding ? 'left' : 'center');
        r.raster(bmp);
        r.align('left').blank(1);
    } catch (e) {
        console.warn('Logo non rastérisé, ticket imprimé sans :', e);
    }
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
// Principe : police A (grosse) réservée à ce qui doit se lire d'un
// coup d'oeil — nom du poste, numéro d'attente, total. Tout le reste
// en police B, qui tient 42 colonnes et consomme un tiers de hauteur
// en moins. Objectif : ~6 cm de papier par ticket au lieu de ~13.
function entete(r, sousTitre) {
    r.align('center').font('A').bold(true);
    r.line(('POSTE DE SANTE ' + (villageActuel()?.nom || '')).slice(0,32).toUpperCase());
    r.bold(false).font('B').line(sousTitre);
    r.font('A').align('left');
    return r;
}

// Pied de page : lignes centrées en police B.
function pied(r, lignes) {
    r.font('B').align('center');
    for (const l of lignes) r.line(l);
    r.font('A').align('left');
    return r;
}

async function buildConsultationBytes(d) {
    const r = new Receipt();
    await addLogo(r, SVG_CROIX);
    entete(r, 'Ticket de consultation');
    r.hr('=');

    // Réf + date sur une seule ligne ; identité regroupée.
    r.font('B');
    r.row('Ref ' + d.refNum, d.dateStr);
    r.line(`${d.nom} ${d.prenom} - ${d.age} ans`);
    r.line('Prestation : ' + d.choix);
    r.font('A');

    r.attente(attenteDigits(d.numAttente));

    r.total(d.total);
    r.font('B');
    if (d.recu > 0) r.row('Remis ' + d.recuFmt + ' FCFA', 'Monnaie ' + d.monnaieFmt + ' FCFA');
    r.row('Valide le', d.validiteStr);

    pied(r, ['Conservez ce ticket pour voir le medecin.',
             'Validite 24 h. Merci de votre confiance.']);
    r.cut();
    return r.toBytes();
}

async function buildMedicamentsBytes(d) {
    const lignes = d.lignes || [];
    const qteTotale = lignes.reduce((n, i) => n + Number(i.qte || 0), 0);

    const r = new Receipt();
    await addLogo(r, SVG_HYGIE);
    entete(r, 'Ticket medicaments');
    r.banner("A AGRAFER SUR L'ORDONNANCE");

    r.font('B');
    r.row('Ref ' + d.refNum, d.dateStr);
    r.row(d.patientNom, 'No ' + attenteDigits(d.patientAtt));
    r.font('A').hr('-');

    // Une ligne par médicament (42 colonnes : le nom tient presque toujours).
    r.font('B');
    for (const it of lignes) r.item(it);
    r.dotRow(`${lignes.length} ligne(s)`, `${qteTotale} unite(s)`);
    r.font('A').hr('-');

    r.total(d.total);
    r.font('B');
    if (d.recu > 0) r.row('Remis ' + d.recuFmt + ' FCFA', 'Monnaie ' + d.monnaieFmt + ' FCFA');

    // Une seule chaîne : wrapText coupe aux espaces, jamais en plein mot.
    pied(r, ["A agrafer sur l'ordonnance, a presenter a la pharmacie. Prompt retablissement."]);
    r.cut();
    return r.toBytes();
}

// Ticket de calibration : vérifie logo, largeur réelle des deux polices,
// interligne et alignement à deux colonnes. Chaque règle graduée doit
// tenir EXACTEMENT sur une ligne ; sinon ajustez lineWidth / lineWidthB.
async function buildTestBytes() {
    const r = new Receipt();
    await addLogo(r, SVG_HYGIE);
    entete(r, 'Test d\'impression');
    r.hr('=');
    r.font('B');
    r.dotRow('Date', new Date().toLocaleString('fr-FR'));
    r.dotRow('Interligne', PRINTER_CONFIG.lineSpacing + ' points');
    r.dotRow('Logo', PRINTER_CONFIG.logoWidth + ' points');
    r.font('A').hr('-');

    r.line('Police A - ' + PRINTER_CONFIG.lineWidth + ' col.');
    r.line('....|....1....|....2....|....3..');
    r.font('B');
    r.line('Police B - ' + PRINTER_CONFIG.lineWidthB + ' col.');
    r.line('....|....1....|....2....|....3....|....4..');
    r.font('A').hr('-');

    r.font('B');
    r.item({ qte: 2, nom: 'PARACETAMOL 500MG COMPRIME', pu: '150', montant: '300' });
    r.dotRow('Libelle volontairement tres long pour tester le retour a la ligne', '1 250 FCFA');
    r.font('A');

    r.attente('007');
    r.total('1 500');
    r.cut();
    return r.toBytes();
}

// `method` : 'ble' (Web Bluetooth), 'usb' (WebUSB) ou 'rawbt' (app Android).
async function dispatch(bytes, method) {
    if (method === 'rawbt') { sendViaRawBT(bytes); return; }
    if (method === 'ble') { await sendBytesBLE(bytes); return; }
    await sendBytesUSB(bytes);
}

export async function printTicketConsultation(d, method = 'usb') {
    await dispatch(await buildConsultationBytes(d), method);
}
export async function printTicketMedicaments(d, method = 'usb') {
    await dispatch(await buildMedicamentsBytes(d), method);
}
export async function printTestTicket(method = 'usb') {
    await dispatch(await buildTestBytes(), method);
}
