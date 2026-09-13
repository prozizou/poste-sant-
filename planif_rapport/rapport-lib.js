/* ═══════════════════════════════════════════════════════════════
   RAPPORT-LIB.JS
   Socle commun aux pages « Rapports » et « Dépenses ».

   Contient :
   - les helpers de période (jour / semaine / mois / trimestre / année),
   - les agrégations sur les tickets, ventes de médicaments et dépenses,
   - le générateur de feuille A4 imprimable (export PDF).

   POURQUOI PAS jsPDF ?
   L'application est une PWA hors-ligne (service worker). Ajouter une
   librairie PDF depuis un CDN la rendrait dépendante du réseau au
   moment précis où le poste en a le moins : en brousse, sans connexion.
   On génère donc une feuille A4 en HTML/CSS et on laisse le navigateur
   faire le PDF via « Imprimer > Enregistrer au format PDF ». C'est
   natif, hors-ligne, et le rendu est identique sur Android et sur PC.
   ═══════════════════════════════════════════════════════════════ */

// ── ÉCHAPPEMENT XSS ──────────────────────────────
export const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

// ── FORMATS ──────────────────────────────────────
export const fmt = n => Number(n || 0).toLocaleString('fr-FR');
export const fcfa = n => fmt(n) + ' FCFA';

export function dateHeure(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
         + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ── HORODATAGE ROBUSTE ───────────────────────────
// Les enregistrements anciens n'ont pas toujours date_heure_ts : on
// reconstruit alors l'instant depuis les champs "date" et "heure".
export function getSafeTs(val) {
    if (val.date_heure_ts) return val.date_heure_ts;
    if (val.date) {
        const p = String(val.date).split('/');
        if (p.length === 3) {
            let hr = 0, min = 0;
            if (val.heure) {
                const hp = String(val.heure).split(':');
                if (hp.length >= 2) { hr = parseInt(hp[0], 10); min = parseInt(hp[1], 10); }
            }
            return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10), hr, min).getTime();
        }
    }
    return Date.now();
}

// ── PÉRIODES ─────────────────────────────────────
export const PERIODES = {
    jour:      { label: "Aujourd'hui",     court: 'Journalier'   },
    j7:        { label: '7 derniers jours', court: '7 jours'     },
    semaine:   { label: 'Cette semaine',   court: 'Hebdomadaire' },
    mois:      { label: 'Ce mois',         court: 'Mensuel'      },
    trimestre: { label: 'Ce trimestre',    court: 'Trimestriel'  },
    annee:     { label: 'Cette année',     court: 'Annuel'       },
    tout:      { label: 'Depuis le début', court: 'Global'       },
};

// Renvoie [début, fin[ de la période, en millisecondes.
export function bornes(periode, ref = new Date()) {
    const n = new Date(ref);
    const debut = new Date(n); debut.setHours(0, 0, 0, 0);
    switch (periode) {
        case 'jour': break;
        case 'j7': debut.setDate(debut.getDate() - 6); break; // aujourd'hui + 6 jours précédents
        case 'semaine': {
            const dow = n.getDay();                 // 0 = dimanche
            debut.setDate(n.getDate() - (dow === 0 ? 6 : dow - 1)); // lundi
            break;
        }
        case 'mois':      debut.setDate(1); break;
        case 'trimestre': debut.setMonth(Math.floor(n.getMonth() / 3) * 3, 1); break;
        case 'annee':     debut.setMonth(0, 1); break;
        case 'tout':      return [0, Infinity];
        default: break;
    }
    return [debut.getTime(), Infinity];
}

export function dansPeriode(ts, periode) {
    const [a, b] = bornes(periode);
    return ts >= a && ts < b;
}

// Libellé daté, pour l'en-tête du rapport : « Du 01/07/2026 au 09/07/2026 ».
export function libellePeriode(periode) {
    if (periode === 'tout') return 'Toutes périodes confondues';
    const [a] = bornes(periode);
    const d = x => new Date(x).toLocaleDateString('fr-FR');
    if (periode === 'jour') return 'Journée du ' + d(a);
    return 'Du ' + d(a) + ' au ' + d(Date.now());
}

// ── AGRÉGATIONS ──────────────────────────────────
// Les tickets/ventes annulés (retour à la pharmacie, erreur de caisse,
// désistement du client…) sont exclus de toutes les agrégations : un
// enregistrement annulé ne doit jamais fausser le bilan.
const actifs = list => list.filter(x => !x.annule);

export const totalTickets = list => actifs(list).reduce((s, x) => s + Number(x.prix || 0), 0);
export const totalVentes  = list => actifs(list).reduce((s, x) => s + Number(x.total || 0), 0);
export const totalDepenses = list => list.reduce((s, x) => s + Number(x.montant || 0), 0);

// Répartition des consultations par type de prestation.
export function parPrestation(tickets) {
    const m = new Map();
    for (const t of actifs(tickets)) {
        const k = t.choix || 'Non précisé';
        const e = m.get(k) || { nom: k, nb: 0, montant: 0 };
        e.nb++; e.montant += Number(t.prix || 0);
        m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.montant - a.montant);
}

// Médicaments les plus vendus, agrégés sur toutes les ventes de la période.
export function parMedicament(ventes) {
    const m = new Map();
    for (const v of actifs(ventes)) {
        for (const li of (v.medicaments || [])) {
            const k = li.nom || '(sans nom)';
            const e = m.get(k) || { nom: k, qte: 0, montant: 0 };
            e.qte += Number(li.qte || 0);
            e.montant += Number(li.prix || 0) * Number(li.qte || 0);
            m.set(k, e);
        }
    }
    return [...m.values()].sort((a, b) => b.montant - a.montant);
}

export function parCategorie(depenses) {
    const m = new Map();
    for (const d of depenses) {
        const k = d.categorie || 'Autre';
        const e = m.get(k) || { nom: k, nb: 0, montant: 0 };
        e.nb++; e.montant += Number(d.montant || 0);
        m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.montant - a.montant);
}

// ═══════════════════════════════════════════════════
//   GÉNÉRATEUR DE FEUILLE A4 (EXPORT PDF)
// ═══════════════════════════════════════════════════

const LOGO = `
<svg viewBox="0 0 100 100" class="rs-logo" aria-hidden="true">
  <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="5.5"/>
  <path d="M23 50 H77 M50 23 V77" fill="none" stroke="currentColor"
        stroke-width="16" stroke-linecap="round"/>
</svg>`;

/*  Construit une section « tableau ».
    cols : [{ t: 'En-tête', k: 'cle', num: true|false, w: '18%' }]
    Les colonnes num sont alignées à droite (chiffres comparables à l'oeil). */
function sectionTable({ titre, cols, rows, totalLabel, totalValue, vide }) {
    if (!rows.length) {
        return `<section class="rs-sect">
            <h3>${esc(titre)}</h3>
            <p class="rs-empty">${esc(vide || 'Aucune donnée sur cette période.')}</p>
        </section>`;
    }
    const thead = cols.map(c =>
        `<th${c.num ? ' class="num"' : ''}${c.w ? ` style="width:${c.w}"` : ''}>${esc(c.t)}</th>`).join('');
    const tbody = rows.map(r => '<tr>' + cols.map(c => {
        const v = r[c.k];
        return `<td${c.num ? ' class="num"' : ''}>${esc(v ?? '')}</td>`;
    }).join('') + '</tr>').join('');
    const tfoot = totalLabel
        ? `<tfoot><tr><td colspan="${cols.length - 1}">${esc(totalLabel)}</td>
             <td class="num">${esc(totalValue)}</td></tr></tfoot>`
        : '';
    return `<section class="rs-sect">
        <h3>${esc(titre)} <span class="rs-count">${rows.length} ligne${rows.length > 1 ? 's' : ''}</span></h3>
        <table class="rs-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody>${tfoot}</table>
    </section>`;
}

/*  Construit et imprime la feuille.
    Le contenu est injecté dans #report-sheet, que la feuille de style
    d'impression est seule à révéler. Rien n'est visible à l'écran. */
export function exporterPDF({ titre, periodeLabel, meta = [], resume = [], sections = [], note,
    sousTitre = 'République du Sénégal — Ministère de la Santé',
    signatures = ['Le Chef de Poste', 'Le Gestionnaire'] }) {
    let hote = document.getElementById('report-sheet');
    if (!hote) {
        hote = document.createElement('div');
        hote.id = 'report-sheet';
        document.body.appendChild(hote);
    }

    const metaHTML = meta.map(m =>
        `<div><span>${esc(m.k)}</span><strong>${esc(m.v)}</strong></div>`).join('');

    const resumeHTML = resume.map(r =>
        `<div class="rs-kpi ${r.type || ''}">
            <span class="rs-kpi-lbl">${esc(r.label)}</span>
            <span class="rs-kpi-val">${esc(r.valeur)}</span>
         </div>`).join('');

    const sectionsHTML = sections.map(sectionTable).join('');

    hote.innerHTML = `
      <header class="rs-head">
        ${LOGO}
        <div class="rs-ident">
          <h1>Poste de Santé de Diandioly</h1>
          ${sousTitre ? `<p>${esc(sousTitre)}</p>` : ''}
        </div>
      </header>

      <div class="rs-titre">
        <h2>${esc(titre)}</h2>
        <p>${esc(periodeLabel)}</p>
      </div>

      <div class="rs-meta">${metaHTML}</div>

      ${resume.length ? `<div class="rs-resume">${resumeHTML}</div>` : ''}

      ${sectionsHTML}

      ${note ? `<p class="rs-note">${esc(note)}</p>` : ''}

      <footer class="rs-foot">
        ${signatures.map(s => `<div class="rs-sign">
          <span>${esc(s)}</span>
          <span class="rs-sign-line"></span>
        </div>`).join('')}
      </footer>
      <p class="rs-edit">Document édité le ${esc(dateHeure(Date.now()))} — Poste de Santé de Diandioly</p>`;

    document.body.classList.add('printing-sheet');
    // Laisse un cycle de rendu au navigateur avant d'ouvrir la boîte
    // d'impression, sinon Chrome Android capture parfois une page vide.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        window.print();
        // On ne vide PAS #report-sheet après coup : sur Android, afterprint
        // se déclenche avant que l'utilisateur n'ait choisi « Enregistrer en
        // PDF ». Le contenu est réécrit au prochain export de toute façon.
        setTimeout(() => document.body.classList.remove('printing-sheet'), 800);
    }));
}

// ═══════════════════════════════════════════════════
//   EXPORT CSV / EXCEL / PARTAGE (hors-ligne, sans librairie)
//
//   Même contrainte que le PDF : PWA hors-ligne, donc pas de dépendance
//   CDN. Le CSV est du texte pur. L'Excel utilise le format SpreadsheetML
//   (XML « Excel 2003 ») — un simple fichier XML texte que Excel, LibreOffice
//   et Google Sheets (import) ouvrent nativement en plusieurs feuilles,
//   sans le message d'avertissement qu'affiche l'astuce « table HTML
//   renommée .xls ». Aucune librairie, aucun réseau.
// ═══════════════════════════════════════════════════

function nomFichierExport(titre, ext) {
    const slug = String(titre).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `${slug || 'rapport'}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

// Partage natif (WhatsApp, etc.) quand l'appareil le permet — repli
// automatique sur un téléchargement classique sinon. Une annulation du
// partage par l'utilisateur (AbortError) n'est pas un échec à rattraper.
export async function telechargerOuPartager(blob, filename, mimeType) {
    try {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            return;
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return;
        // Échec du partage (non supporté en pratique malgré canShare, etc.) :
        // on retente en téléchargement classique ci-dessous.
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── CSV ───────────────────────────────────────────
// Point-virgule (locale FR : la virgule est déjà le séparateur décimal),
// BOM UTF-8 en tête pour que les accents s'affichent correctement dans
// Excel (qui, sans BOM, suppose du Latin-1 pour les CSV).
export function exporterCSV({ titre, periodeLabel, meta = [], resume = [], sections = [] }) {
    const lignes = [];
    const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    lignes.push(q(titre));
    lignes.push(q(periodeLabel));
    lignes.push('');
    if (meta.length) {
        meta.forEach(m => lignes.push([q(m.k), q(m.v)].join(';')));
        lignes.push('');
    }
    if (resume.length) {
        lignes.push(q('Résumé'));
        resume.forEach(r => lignes.push([q(r.label), q(r.valeur)].join(';')));
        lignes.push('');
    }
    sections.forEach(sec => {
        lignes.push(q(sec.titre));
        lignes.push(sec.cols.map(c => q(c.t)).join(';'));
        if (sec.rows.length) {
            sec.rows.forEach(row => lignes.push(sec.cols.map(c => q(row[c.k])).join(';')));
        } else {
            lignes.push(q(sec.vide || 'Aucune donnée.'));
        }
        if (sec.totalLabel) {
            const rowArr = new Array(sec.cols.length).fill('');
            rowArr[0] = sec.totalLabel;
            rowArr[rowArr.length - 1] = sec.totalValue;
            lignes.push(rowArr.map(q).join(';'));
        }
        lignes.push('');
    });
    const blob = new Blob(['﻿' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    return telechargerOuPartager(blob, nomFichierExport(titre, 'csv'), 'text/csv');
}

// ── EXCEL (SpreadsheetML) ─────────────────────────
const escXml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Noms de feuille : 31 caractères max, certains caractères interdits, pas
// de doublon — Excel refuse d'ouvrir le classeur sinon.
function nomFeuille(s, dejaUtilises) {
    let base = String(s).replace(/[:\\/\?\*\[\]]/g, ' ').trim().slice(0, 31) || 'Feuille';
    let nom = base, i = 2;
    while (dejaUtilises.has(nom)) { nom = (base.slice(0, 28) + ' ' + i).slice(0, 31); i++; }
    dejaUtilises.add(nom);
    return nom;
}
function ligneExcel(cellules, styleId) {
    const attr = styleId ? ` ss:StyleID="${styleId}"` : '';
    return `<Row${attr}>` + cellules.map(c => `<Cell${styleId ? ` ss:StyleID="${styleId}"` : ''}><Data ss:Type="String">${escXml(c)}</Data></Cell>`).join('') + '</Row>';
}
function tableExcel(cols, rows, totalLabel, totalValue, vide) {
    if (!rows.length) return ligneExcel([vide || 'Aucune donnée.']);
    const entete = ligneExcel(cols.map(c => c.t), 'Header');
    const corps = rows.map(r => ligneExcel(cols.map(c => r[c.k] ?? ''))).join('');
    let total = '';
    if (totalLabel) {
        const cellules = new Array(cols.length).fill('');
        cellules[0] = totalLabel; cellules[cellules.length - 1] = totalValue;
        total = ligneExcel(cellules, 'Total');
    }
    return entete + corps + total;
}
export function exporterExcel({ titre, periodeLabel, meta = [], resume = [], sections = [] }) {
    const dejaUtilises = new Set();
    const feuilles = [];

    const resumeLignes = [
        ligneExcel([titre], 'Header'),
        ligneExcel([periodeLabel]),
        ligneExcel([]),
        ...meta.map(m => ligneExcel([m.k, m.v])),
        ligneExcel([]),
        ...resume.map(r => ligneExcel([r.label, r.valeur])),
    ].join('');
    feuilles.push(`<Worksheet ss:Name="${nomFeuille('Résumé', dejaUtilises)}"><Table>${resumeLignes}</Table></Worksheet>`);

    sections.forEach(sec => {
        const table = tableExcel(sec.cols, sec.rows, sec.totalLabel, sec.totalValue, sec.vide);
        feuilles.push(`<Worksheet ss:Name="${nomFeuille(sec.titre, dejaUtilises)}"><Table>${table}</Table></Worksheet>`);
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1A3A5C" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Total"><Font ss:Bold="1"/><Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
 </Styles>
 ${feuilles.join('\n ')}
</Workbook>`;

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    return telechargerOuPartager(blob, nomFichierExport(titre, 'xls'), 'application/vnd.ms-excel');
}
