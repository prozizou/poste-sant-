// ═══════════════════════════════════════════════════════════════════════
//  medoc-image.js — Miniatures des médicaments (Stock pharmacie)
//  Poste de Santé de Diandioly
//
//  1. analyser()  : lit le nom tel qu'il est saisi en pharmacie
//                   (« AMOXICILLINE 250MG SP. », « PARACETAMOL 1G CP. »…)
//                   et en extrait la DCI, la forme et le dosage.
//  2. chercherImage() : interroge Wikimedia Commons (photos sous licence
//                   libre, sans clé d'API) puis note chaque résultat :
//                   la DCI doit figurer dans le titre du fichier ; les
//                   schémas de molécule, graphiques, etc. sont écartés ;
//                   la forme (comprimé, sirop…) et le dosage donnent des
//                   points. En dessous du seuil, rien n'est retenu : la
//                   page affiche alors une vignette neutre selon la forme.
//  3. vignetteHTML() : rendu unique (image enregistrée, sinon vignette).
// ═══════════════════════════════════════════════════════════════════════

const sansAccent = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// DCI françaises → termes de recherche (anglais, langue majoritaire des
// titres sur Commons). « m » = fragment qui doit apparaître dans le titre.
const DCI = {
    'paracetamol': { q: 'paracetamol' },
    'amoxicilline': { q: 'amoxicillin' },
    'metronidazole': { q: 'metronidazole' },
    'cefixime': { q: 'cefixime' }, 'cefexime': { q: 'cefixime' },
    'ceftriaxone': { q: 'ceftriaxone' },
    'dexchlorpheniramine': { q: 'dexchlorpheniramine' },
    'carbocysteine': { q: 'carbocisteine', m: 'carbocist' },
    'flucloxacilline': { q: 'flucloxacillin' },
    'fer': { q: 'ferrous sulfate', m: 'ferrous' },
    'sulfamethoxazole': { q: 'co-trimoxazole', m: 'trimoxazol' },
    'co-trimoxazole': { q: 'co-trimoxazole', m: 'trimoxazol' }, 'cotrimoxazole': { q: 'co-trimoxazole', m: 'trimoxazol' },
    'mebendazole': { q: 'mebendazole' },
    'albendazole': { q: 'albendazole' },
    'sro': { q: 'oral rehydration salts', m: 'rehydrat' }, 's.r.o': { q: 'oral rehydration salts', m: 'rehydrat' },
    'ibuprofene': { q: 'ibuprofen' },
    'nystatine': { q: 'nystatin' },
    'diclofenac': { q: 'diclofenac' },
    'ciprofloxacine': { q: 'ciprofloxacin' },
    'phenobarbital': { q: 'phenobarbital' },
    'glucose': { q: 'glucose infusion', m: 'glucose' },
    'sodium': { q: 'sodium chloride infusion', m: 'sodium chlor' }, 'chlorure': { q: 'sodium chloride infusion', m: 'sodium chlor' },
    'ringer': { q: 'ringer lactate', m: 'ringer' },
    'cyanocobalamine': { q: 'cyanocobalamin injection', m: 'cyanocobalamin' },
    'oxytocine': { q: 'oxytocin' },
    'nicardipine': { q: 'nicardipine' },
    'medroxy': { q: 'medroxyprogesterone', m: 'medroxyprog' }, 'medroxyprogesterone': { q: 'medroxyprogesterone', m: 'medroxyprog' },
    'depo-provera': { q: 'depo-provera', m: 'depo' },
    'niflumique': { q: 'niflumic acid', m: 'niflumi' },
    'econazole': { q: 'econazole' },
    'gentamycine': { q: 'gentamicin' }, 'gentamicine': { q: 'gentamicin' },
    'doxycycline': { q: 'doxycycline' }, 'doxycyline': { q: 'doxycycline' },
    'metformine': { q: 'metformin' },
    'amlodipine': { q: 'amlodipine' },
    'misoprostol': { q: 'misoprostol' },
    'omeprazole': { q: 'omeprazole' },
    'artemether': { q: 'artemether lumefantrine', m: 'artemether' },
    'quinine': { q: 'quinine tablets', m: 'quinine' },
    'benzathine': { q: 'benzathine benzylpenicillin', m: 'benzathine' }, 'benzatihne': { q: 'benzathine benzylpenicillin', m: 'benzathine' },
    'seringue': { q: 'disposable syringe', m: 'syringe' },
    'catheter': { q: 'intravenous cannula', m: 'cannula' },
    'compresse': { q: 'gauze swabs', m: 'gauze' },
    'bande': { q: 'elastic bandage', m: 'bandage' },
    'urine': { q: 'urine bag', m: 'urine' },
    'gants': { q: 'medical gloves', m: 'glove' },
    'gaze': { q: 'gauze bandage', m: 'gauze' }, 'bande de gaze': { q: 'gauze bandage', m: 'gauze' },
    'tramadol': { q: 'tramadol' },
    'vitamine k': { q: 'phytomenadione injection', m: 'phytomenadion' }, 'vitamine k1': { q: 'phytomenadione injection', m: 'phytomenadion' },
    'magnesium': { q: 'magnesium sulfate injection', m: 'magnesium sulf' },
    'diazepam': { q: 'diazepam' },
    'hydrocortisone': { q: 'hydrocortisone' },
    'lactulose': { q: 'lactulose' },
    'gelofusine': { q: 'gelofusine', m: 'gelofusin' },
    'perfuseur': { q: 'infusion set', m: 'infusion set' },
    'zinc': { q: 'zinc sulfate tablets', m: 'zinc' },
};
const MOTS_VIDES = new Set(['ac', 'ac.', 'acide', 'acetate', 'de', 'du', 'des', 'la', 'le', 'kit', 'a', 'faible', 'osmolarite', 'sol', 'solution', 'enfant', 'adulte', 'flacon', 'boite', 'b', 'fl']);
const ABREV_FORME = /^(sp|sirop|susp|cp|cpr|comprimes?|gel|gelules?|caps|inj|ini|injectable|amp|ampoules?|perf|creme|pde|pommade|collyre|sachets?|sol|secable|gyn)\.?$/;

// Forme : libellé français affiché + mots-clés cherchés dans les titres.
const FORMES = [
    { k: 'sirop',     fr: 'Sirop',          en: 'syrup',          re: /\b(sp|sirop|susp|suspension|syrup)\b|sirop/, mots: ['syrup', 'suspension', 'bottle', 'liquid', 'oral'] },
    { k: 'gelule',    fr: 'Gélule',         en: 'capsules',       re: /\b(gel|gelules?|caps|capsules?)\b/,             mots: ['capsule', 'capsules'] },
    { k: 'comprime',  fr: 'Comprimé',       en: 'tablets',        re: /\b(cp|cpr|comprimes?|tablets?)\b|comprim/,       mots: ['tablet', 'tablets', 'pill', 'pills', 'blister'] },
    { k: 'perf',      fr: 'Perfusion',      en: 'infusion',       re: /\b(perf|perfusion|infusion)\b/,                  mots: ['infusion', 'bag', 'iv', 'drip', 'bottle'] },
    { k: 'inj',       fr: 'Injectable',     en: 'injection vial', re: /\b(inj|ini|injectable|injection|amp|ampoules?)\b|injection|injectable/, mots: ['injection', 'vial', 'ampoule', 'ampule', 'syringe', 'injectable'] },
    { k: 'creme',     fr: 'Crème / pommade', en: 'cream tube',    re: /\b(creme|pde|pommade|cream|ointment)\b|creme|pommade/, mots: ['cream', 'ointment', 'tube', 'gel'] },
    { k: 'collyre',   fr: 'Collyre',        en: 'eye drops',      re: /collyre|eye drop/,                               mots: ['eye', 'drops'] },
    { k: 'sachet',    fr: 'Sachet',         en: 'sachet',         re: /\bsachets?\b/,                                   mots: ['sachet', 'packet', 'powder'] },
];
const MOTS_PRODUIT = ['tablet', 'tablets', 'pill', 'pills', 'capsule', 'capsules', 'bottle', 'box', 'package', 'packaging', 'pack', 'blister', 'vial', 'ampoule', 'syrup', 'suspension', 'cream', 'tube', 'injection', 'infusion', 'bag', 'sachet', 'medication', 'medicine', 'drug', 'generic', 'mg', 'syringe', 'cannula', 'bandage', 'gauze', 'glove'];
const MOTS_REJET = ['structure', 'ball-and-stick', 'ball and stick', 'skeletal', 'spacefill', 'space-filling', '3d', 'molecule', 'molecular', 'chromatogram', 'figure', 'formula', 'crystal', 'sequence', 'nmr', 'synthesis', 'graph', 'chart', 'mechanism', 'diagram', 'reaction', 'spectrum', 'plot', 'map', 'pathway', 'binding', 'receptor', 'protein', 'logo', 'icon', 'levels', 'concentration', 'serum', 'plasma', 'study', 'trial', 'position', 'placement', 'insertion', 'patient', 'surgery', 'procedure', 'vaccination', 'covid', 'recalled', 'overdose', 'poster', 'advert', 'substance', 'aspiration', 'bronchus', 'x-ray', 'xray', 'scan', 'endoscop', 'biopsy', 'histolog', 'micrograph', 'stain', 'display', 'screen'];
// Mots propres à chaque forme : un titre qui en porte une autre que celle
// du produit (comprimé pour un sirop…) est pénalisé.
const MOTS_FORME_EXCLUSIFS = { sirop: ['syrup', 'suspension'], gelule: ['capsule', 'capsules'], comprime: ['tablet', 'tablets', 'pill', 'pills'],
    perf: ['infusion'], inj: ['injection', 'vial', 'ampoule', 'ampule', 'injectable'], creme: ['cream', 'ointment'], collyre: ['eye drops', 'eye'], sachet: ['sachet', 'packet'] };
// Molécules souvent associées : présentes dans le titre mais pas dans le
// nom du produit = photo d'une autre spécialité (association).
const AUTRES_MOLECULES = ['clavulan', 'codeine', 'hydrocodone', 'caffeine', 'aceclofenac', 'thiocolchicoside', 'tramadol', 'chlorphenamine', 'pseudoephedrine', 'trimethoprim', 'folic', 'zinc', 'lumefantrine', 'artemether', 'sulfadoxine', 'pyrimethamine', 'omeprazole', 'domperidone'];

// Règle de secours pour une DCI absente du dictionnaire : terminaisons
// françaises → anglaises les plus courantes.
function versAnglais(dci) {
    return dci.replace(/illine$/, 'illin').replace(/acine$/, 'acin').replace(/mycine$/, 'micin').replace(/ocine$/, 'ocin')
        .replace(/formine$/, 'formin').replace(/statine$/, 'statin').replace(/amine$/, 'amin').replace(/ene$/, 'en');
}

export function analyser(m) {
    const brut = sansAccent(m.nom).replace(/-(\d)/g, ' $1');
    const paren = (brut.match(/\(([^)]*)\)/) || [])[1] || '';
    const nom = brut.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
    const tout = `${nom} ${sansAccent(m.forme)}`;
    const forme = FORMES.find(f => f.re.test(tout)) || null;
    const dosM = sansAccent(m.dosage || m.nom).match(/(\d+(?:[.,]\d+)?)\s?(mg|g|ml|ui|%|mcg|µg)\b/);
    const dosage = dosM ? dosM[1].replace(',', '.') + (dosM[2] === '%' ? '%' : ' ' + dosM[2]) : '';
    // DCI : premiers mots avant le dosage / la forme / la composition.
    const mots = nom.split(/[\s+/]+/).map(w => w.replace(/[.,;:]+$/, ''));
    const dci = [];
    for (const w of mots) {
        if (!w || /\d/.test(w) || ABREV_FORME.test(w)) { if (dci.length) break; else continue; }
        if (MOTS_VIDES.has(w)) { if (dci.length) break; else continue; }
        dci.push(w);
        if (dci.length >= 2) break;
    }
    // Entrée du dictionnaire : d'abord dans le nom, puis entre parenthèses
    // (« Optadol (Tramadol) ») ; la clé la plus longue l'emporte.
    const trouve = txt => Object.keys(DCI).filter(k => new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(txt))
        .sort((x, y) => y.length - x.length)[0];
    const cle = trouve(nom) || trouve(paren);
    const inn = /^[a-z][a-z -]{3,}$/.test(paren.trim()) ? paren.trim().split(' ')[0] : '';
    let q = '', match = '', marque = false;
    if (cle) { q = DCI[cle].q; match = DCI[cle].m || DCI[cle].q.split(' ')[0]; }
    else if (inn) { q = versAnglais(inn); match = q.slice(0, Math.max(4, Math.min(7, q.length))); }
    // Nom commercial / DCI inconnue : recherche seulement s'il s'agit bien
    // d'un médicament (forme reconnue) — pas de « cartes de rendez-vous ».
    else if (dci.length && forme) { q = versAnglais(dci[0]); match = q.slice(0, Math.max(4, Math.min(7, q.length))); marque = true; }
    return { dci: dci.join(' '), q, match: match.toLowerCase(), forme, dosage, marque };
}

// Libellé lisible : « Sirop · 250 mg · FL/60 »
export function libelleForme(m) {
    const a = analyser(m);
    const formeTxt = a.forme ? a.forme.fr : (m.forme && m.forme.length > 3 && !/^[a-z]{1,3}\s?\/\s?\d+/i.test(m.forme) ? m.forme : '');
    const cond = m.forme && /^[a-z]{1,3}\s?\/\s?\d+/i.test(m.forme) ? m.forme.toUpperCase().replace(/\s/g, '') : (m.conditionnement || '');
    return [formeTxt, m.dosage || a.dosage, cond].filter(Boolean).join(' · ');
}

function noter(c, a, nomProduit = '') {
    const t = sansAccent(c.title).replace(/^file:/, '').replace(/[_-]/g, ' ');
    const ext = (t.match(/\.(\w+)$/) || [])[1] || '';
    if (!a.match || !t.includes(a.match.replace(/-/g, ' '))) return -1;
    if (['svg', 'gif', 'tif', 'tiff', 'pdf', 'webm', 'ogv', 'djvu'].includes(ext)) return -1;
    if (MOTS_REJET.some(w => t.includes(w))) return -1;
    if (c.width && c.height && (c.width < 200 || c.height < 200)) return -1;
    let s = 0;
    const base = t.replace(/\.\w+$/, '').trim();
    if (ext === 'jpg' || ext === 'jpeg') s += 5; else if (ext === 'png') s -= 10;
    if (base === a.match || base === a.q) s += 6;                     // « Amoxicillin.jpg » : photo du produit le plus souvent
    const mot = w => new RegExp(`\\b${w}\\b`).test(t);
    if (a.forme && a.forme.mots.some(mot)) s += 14;
    if (a.forme) {
        const autres = Object.entries(MOTS_FORME_EXCLUSIFS).filter(([k]) => k !== a.forme.k).flatMap(([, w]) => w)
            .filter(w => !a.forme.mots.includes(w));
        if (autres.some(mot)) s -= 14;
    }
    const nomP = sansAccent(nomProduit);
    if (AUTRES_MOLECULES.some(x => t.includes(x) && !nomP.includes(x) && !a.match.includes(x))) return -1;
    // Nom commercial inconnu : n'accepter qu'une photo qui nomme aussi la bonne forme.
    if (a.marque && !(a.forme && a.forme.mots.some(mot))) return -1;
    // La DCI doit être le sujet : en tête du titre plutôt qu'en 3e position.
    const pos = base.split(/\s+/).findIndex(w => w.startsWith(a.match.split(' ')[0]));
    if (pos === 0) s += 4; else if (pos > 1) s -= 8;
    s += Math.min(2, MOTS_PRODUIT.filter(w => new RegExp(`\\b${w}\\b`).test(t)).length) * 5;
    if (a.dosage) { const n = a.dosage.split(' ')[0]; if (new RegExp(`\\b${n.replace('.', '\\.')}\\s?(mg|g|ml)?\\b`).test(t)) s += 8; }
    if (c.width && c.height) { const r = c.width / c.height; if (r > 0.6 && r < 1.7) s += 3; }
    return s;
}
export const SEUIL_SCORE = 10;

async function commons(q, signal) {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
        + '&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=' + encodeURIComponent(q + ' filetype:bitmap')
        + '&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=240';
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    return Object.values(d.query?.pages || {}).map(p => {
        const ii = (p.imageinfo || [])[0] || {};
        return { title: p.title, thumb: ii.thumburl || ii.url, page: ii.descriptionurl, width: ii.width, height: ii.height };
    }).filter(c => c.thumb);
}

// Renvoie les candidats triés (meilleur d'abord) — tous ceux qui passent
// le filtre si « tous » est vrai (choix manuel), sinon le meilleur ou null.
export async function chercherImage(m, { tous = false, requete = '', signal } = {}) {
    const a = analyser(m);
    const req = requete ? [requete] : [...new Set([a.forme ? `${a.q} ${a.forme.en}` : '', a.q].filter(Boolean))];
    if (!req.length) return tous ? [] : null;
    const vus = new Map();
    const crit = requete ? { ...a, match: sansAccent(requete).split(' ')[0].slice(0, 7) } : a;
    for (const q of req) {
        const res = await commons(q, signal);
        res.forEach(c => { if (!vus.has(c.title)) vus.set(c.title, { ...c, score: noter(c, crit, m.nom) }); });
        if (!tous && [...vus.values()].some(c => c.score >= SEUIL_SCORE)) break;
    }
    const tri = [...vus.values()].sort((x, y) => y.score - x.score);
    if (tous) return tri.filter(c => c.score >= 0);
    return tri[0] && tri[0].score >= SEUIL_SCORE ? tri[0] : null;
}

// ── Vignette : image enregistrée, sinon pictogramme selon la forme ──────
const PICTO = {
    comprime: '<circle cx="9.5" cy="10" r="6"/><path d="M5.3 14.2 13.7 5.8"/><circle cx="17" cy="17" r="4"/><path d="M14.2 17h5.6"/>',
    gelule:   '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    sirop:    '<path d="M10 2h4"/><path d="M10 2v3a4 4 0 0 0-3 3.87V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8.87A4 4 0 0 0 14 5V2"/><path d="M7 13h10"/>',
    perf:     '<path d="M8 2h8v13a4 4 0 0 1-8 0Z"/><path d="M8 7h8"/><path d="M12 19v3"/>',
    inj:      '<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/>',
    creme:    '<path d="M6 3h12l-1 4H7Z"/><path d="M7 7v11a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V7"/>',
    collyre:  '<path d="M12 2.7c2.5 3.2 5 6 5 9.3a5 5 0 0 1-10 0c0-3.3 2.5-6.1 5-9.3Z"/>',
    sachet:   '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 7h14"/><path d="M9 12h6"/>',
    autre:    '<path d="m16.5 9.4-9-5.19"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M12 22V12"/>',
};
export function imageDe(m) {
    return m.image_data || m.image_url || m.image || m.photo || '';
}
export function pictogramme(m) {
    const a = analyser(m);
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${PICTO[a.forme?.k] || PICTO.autre}</svg>`;
}
export function vignetteHTML(m, cls = 'thumb') {
    const src = imageDe(m);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return `<span class="${cls}${src ? '' : ' ph'}">${src
        ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('ph');this.remove();">`
        : ''}${pictogramme(m)}</span>`;
}
