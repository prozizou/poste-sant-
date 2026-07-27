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
export const totalTickets = list => list.reduce((s, x) => s + Number(x.prix || 0), 0);
export const totalVentes  = list => list.reduce((s, x) => s + Number(x.total || 0), 0);
export const totalDepenses = list => list.reduce((s, x) => s + Number(x.montant || 0), 0);

// Répartition des consultations par type de prestation.
export function parPrestation(tickets) {
    const m = new Map();
    for (const t of tickets) {
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
    for (const v of ventes) {
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
