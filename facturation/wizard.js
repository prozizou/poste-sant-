// Assistant de facturation à 3 étapes (consultation).
// Couche d'interface uniquement : la validation des montants, l'attribution
// atomique du numéro d'attente, l'encaissement Firebase et l'impression
// restent gérés par script.js. Ce module ne fait que guider la saisie.
'use strict';

const wiz = document.getElementById('wiz-ticket');
if (wiz) {
    const steps = [...wiz.querySelectorAll('.wiz-step')];
    const dots  = [...wiz.querySelectorAll('.wiz-dot')];
    const bars  = [...wiz.querySelectorAll('.wiz-bar')];
    const $ = id => document.getElementById(id);
    let courant = 1;

    const ageValide = v => { const n = parseInt(v, 10); return !isNaN(n) && n >= 0 && n <= 120; };

    function montre(n, defiler = true) {
        courant = n;
        steps.forEach(s => s.classList.toggle('active', +s.dataset.step === n));
        dots.forEach(d => {
            const i = +d.dataset.dot;
            d.classList.toggle('active', i === n);
            d.classList.toggle('done', i < n);
        });
        bars.forEach(b => b.classList.toggle('done', +b.dataset.bar < n));
        if (n === 3) remplirSynthese();
        // Ramène le haut de l'assistant dans la vue lors d'un changement d'étape
        // (jamais au chargement, pour ne pas sauter par-dessus l'en-tête).
        if (defiler) wiz.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function erreur(n, msg) {
        const el = $('wiz-err-' + n);
        if (!el) return;
        if (msg) { el.textContent = msg; el.hidden = false; } else { el.hidden = true; }
    }

    function valideEtape1() {
        const prenom = $('t-prenom').value.trim();
        const nom = $('t-nom').value.trim();
        const age = $('t-age').value.trim();
        if (!prenom || !nom || !age) { erreur(1, 'Renseignez le prénom, le nom et l’âge du patient.'); return false; }
        if (!ageValide(age)) { erreur(1, 'Âge invalide (0 à 120 ans).'); return false; }
        erreur(1, ''); return true;
    }

    function valideEtape2() {
        const carte = document.querySelector('.tarif-card.sel');
        if (!carte) { erreur(2, 'Sélectionnez une prestation.'); return false; }
        const prix = parseInt(carte.dataset.prix, 10) || 0;
        const recu = parseFloat($('t-recu').value) || 0;
        if (recu <= 0) { erreur(2, 'Saisissez la somme remise par le patient.'); return false; }
        if (recu < prix) { erreur(2, 'Somme remise insuffisante pour cette prestation.'); return false; }
        erreur(2, ''); return true;
    }

    function remplirSynthese() {
        $('sy-prenom').textContent = $('t-prenom').value.trim() || '—';
        $('sy-nom').textContent = $('t-nom').value.trim() || '—';
        const age = $('t-age').value.trim();
        $('sy-age').textContent = age ? age + ' ans' : '—';
        $('sy-du').textContent = $('r-prix').textContent;
        const recu = parseFloat($('t-recu').value) || 0;
        const prix = parseInt(document.querySelector('.tarif-card.sel')?.dataset.prix, 10) || 0;
        $('sy-recu').textContent = recu.toLocaleString('fr-FR') + ' FCFA';
        $('sy-monnaie').textContent = Math.max(0, recu - prix).toLocaleString('fr-FR') + ' FCFA';
        // Numéro prévisionnel : le définitif est fixé à l'encaissement.
        if (typeof window.numeroAttentePrevisionnel === 'function') {
            $('r-attente').textContent = window.numeroAttentePrevisionnel();
        }
    }

    wiz.querySelectorAll('.wiz-next').forEach(b => b.addEventListener('click', () => {
        const from = +b.dataset.next;
        if (from === 1 && !valideEtape1()) return;
        if (from === 2 && !valideEtape2()) return;
        montre(from + 1);
    }));
    wiz.querySelectorAll('.wiz-prev').forEach(b => b.addEventListener('click', () => montre(+b.dataset.prev - 1)));
    wiz.querySelectorAll('.sy-edit').forEach(b => b.addEventListener('click', () => montre(+b.dataset.goto)));

    // Efface l'erreur dès que l'utilisateur corrige, sans perdre aucune donnée.
    ['t-prenom', 't-nom', 't-age'].forEach(id => $(id)?.addEventListener('input', () => erreur(1, '')));
    $('t-recu')?.addEventListener('input', () => erreur(2, ''));
    wiz.querySelectorAll('.tarif-card').forEach(c => c.addEventListener('click', () => erreur(2, '')));

    // ── Confirmation d'encaissement ──────────────────────────────
    const overlay = $('su-overlay');
    let dernier = null;

    document.addEventListener('ticket:success', e => {
        dernier = e.detail || {};
        $('su-num').textContent = 'Ticket ' + (dernier.numAttente || '—');
        $('su-datetime').textContent = dernier.dateAffiche || '—';
        $('su-patient').textContent = ((dernier.prenom || '') + ' ' + (dernier.nom || '')).trim() || '—';
        $('su-age').textContent = dernier.age ? dernier.age + ' ans' : '—';
        $('su-prest').textContent = dernier.choix || '—';
        $('su-montant').textContent = (dernier.total || '—') + ' FCFA';
        $('su-remise').textContent = (dernier.recuFmt || '—') + ' FCFA';
        $('su-monnaie').textContent = (dernier.monnaieFmt || '—') + ' FCFA';
        $('su-sub').textContent = dernier.imprime ? 'Le ticket a été généré et imprimé.' : 'Le ticket a été généré (sans impression).';
        overlay.classList.add('open');
    });

    const ferme = () => overlay.classList.remove('open');
    $('su-close')?.addEventListener('click', () => { ferme(); montre(1); });
    $('su-close-x')?.addEventListener('click', () => { ferme(); montre(1); });
    $('su-new')?.addEventListener('click', () => { ferme(); montre(1); });
    overlay?.addEventListener('click', ev => { if (ev.target === overlay) ferme(); });

    // Réimpression : réutilise la fonction d'historique (aucun réencaissement).
    $('su-print')?.addEventListener('click', () => {
        if (dernier?.key && typeof window.reimprimerTicket === 'function') window.reimprimerTicket(dernier.key);
    });
    // « Voir le ticket » : aperçu du reçu généré pour cette opération.
    $('su-view')?.addEventListener('click', () => {
        const contenu = document.getElementById('print-content');
        if (!contenu || !contenu.innerHTML.trim()) return;
        let vue = document.getElementById('su-view-overlay');
        if (!vue) {
            vue = document.createElement('div');
            vue.id = 'su-view-overlay';
            vue.className = 'su-overlay';
            vue.innerHTML = '<div class="su-card su-view-card"><button type="button" class="su-x" aria-label="Fermer"><svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button><div class="su-view-body"></div></div>';
            document.body.appendChild(vue);
            vue.addEventListener('click', ev => { if (ev.target === vue || ev.target.closest('.su-x')) vue.classList.remove('open'); });
        }
        vue.querySelector('.su-view-body').innerHTML = contenu.innerHTML;
        vue.classList.add('open');
    });

    montre(1, false);
}

// ══════════════ Assistant Médicaments (3 étapes) ══════════════
const wizM = document.getElementById('wiz-med');
if (wizM) {
    const steps = [...wizM.querySelectorAll('.wiz-step')];
    const dots  = [...wizM.querySelectorAll('.wiz-dot')];
    const bars  = [...wizM.querySelectorAll('.wiz-bar')];
    const $ = id => document.getElementById(id);
    let courant = 1;

    function totalPanier() {
        const r = typeof window.panierResume === 'function' ? window.panierResume() : { total: 0, count: 0, lignes: [] };
        return r;
    }

    function montre(n, defiler = true) {
        courant = n;
        steps.forEach(s => s.classList.toggle('active', +s.dataset.step === n));
        dots.forEach(d => { const i = +d.dataset.dot; d.classList.toggle('active', i === n); d.classList.toggle('done', i < n); });
        bars.forEach(b => b.classList.toggle('done', +b.dataset.bar < n));
        if (n === 3) remplirSynthese();
        if (defiler) wizM.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function erreur(n, msg) { const el = $('wiz-med-err-' + n); if (!el) return; if (msg) { el.textContent = msg; el.hidden = false; } else { el.hidden = true; } }

    function patientPresent() {
        const visible = $('patient-selectionne') && $('patient-selectionne').style.display !== 'none';
        return visible || $('m-search-patient').value.trim().length > 0;
    }
    function valideEtape1() {
        if (!patientPresent()) { erreur(1, 'Sélectionnez un ticket ou saisissez le nom du patient.'); return false; }
        erreur(1, ''); return true;
    }
    function valideEtape2() {
        if (totalPanier().count === 0) { erreur(2, 'Ajoutez au moins un médicament.'); return false; }
        erreur(2, ''); return true;
    }

    // En étape 3, l'encaissement n'est permis que si la somme remise couvre le total.
    function gateEncaissement() {
        if (courant !== 3) return;
        const { total } = totalPanier();
        const recu = parseFloat($('m-recu').value) || 0;
        const ok = total > 0 && recu >= total && patientPresent();
        $('btn-med').disabled = !ok;
        erreur(3, recu > 0 && recu < total ? 'Somme remise insuffisante pour le total à payer.' : '');
    }

    function remplirSynthese() {
        const selVisible = $('patient-selectionne') && $('patient-selectionne').style.display !== 'none';
        $('sy-m-patient').textContent = selVisible ? ($('ps-nom').textContent || '—') : ($('m-search-patient').value.trim() || '—');
        $('sy-m-attente').textContent = selVisible ? ($('ps-attente').textContent || '—') : '—';
        const { lignes, total } = totalPanier();
        $('sy-med-list').innerHTML = lignes.length
            ? lignes.map(l => `<div class="sy-med-row"><span>${l.qte}× ${escHtml(l.nom)}</span><b>${escHtml(l.montantFmt)} FCFA</b></div>`).join('')
            : '<div class="sy-med-empty">Aucun médicament</div>';
        $('sy-m-total').textContent = total.toLocaleString('fr-FR') + ' FCFA';
        gateEncaissement();
    }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

    wizM.querySelectorAll('.wiz-next').forEach(b => b.addEventListener('click', () => {
        const from = +b.dataset.next;
        if (from === 1 && !valideEtape1()) return;
        if (from === 2 && !valideEtape2()) return;
        montre(from + 1);
    }));
    wizM.querySelectorAll('.wiz-prev').forEach(b => b.addEventListener('click', () => montre(+b.dataset.prev - 1)));
    wizM.querySelectorAll('.sy-edit').forEach(b => b.addEventListener('click', () => montre(+b.dataset.goto)));

    $('m-search-patient')?.addEventListener('input', () => erreur(1, ''));
    $('m-recu')?.addEventListener('input', gateEncaissement);
    // calcMonnaieM émet med:recalc : on resynchronise le bouton et la synthèse.
    document.addEventListener('med:recalc', () => { if (courant === 3) { $('sy-m-total').textContent = totalPanier().total.toLocaleString('fr-FR') + ' FCFA'; gateEncaissement(); } });

    // ── Confirmation ──
    const overlay = $('sm-overlay');
    let dernier = null;
    document.addEventListener('med:success', e => {
        dernier = e.detail || {};
        $('sm-num').textContent = 'Ordonnance ' + (dernier.key ? 'MED-' + String(dernier.key).substring(0, 6).toUpperCase() : '');
        $('sm-datetime').textContent = dernier.dateAffiche || '—';
        $('sm-patient').textContent = dernier.patientNom || '—';
        $('sm-total').textContent = (dernier.total || '—') + ' FCFA';
        $('sm-remise').textContent = (dernier.recuFmt || '—') + ' FCFA';
        $('sm-monnaie').textContent = (dernier.monnaieFmt || '—') + ' FCFA';
        $('sm-sub').textContent = dernier.imprime ? 'Le ticket ordonnance a été généré et imprimé.' : 'Le ticket ordonnance a été généré (sans impression).';
        $('sm-med-list').innerHTML = (dernier.lignes || []).map(l => `<div class="sy-med-row"><span>${l.qte}× ${escHtml(l.nom)}</span><b>${escHtml(l.montant)} FCFA</b></div>`).join('');
        overlay.classList.add('open');
    });
    const ferme = () => overlay.classList.remove('open');
    $('sm-close')?.addEventListener('click', () => { ferme(); montre(1); });
    $('sm-close-x')?.addEventListener('click', () => { ferme(); montre(1); });
    $('sm-new')?.addEventListener('click', () => { ferme(); montre(1); });
    overlay?.addEventListener('click', ev => { if (ev.target === overlay) ferme(); });
    $('sm-print')?.addEventListener('click', () => { if (dernier?.key && typeof window.reimprimerMed === 'function') window.reimprimerMed(dernier.key); });
    $('sm-view')?.addEventListener('click', () => {
        const contenu = document.getElementById('print-content');
        if (!contenu || !contenu.innerHTML.trim()) return;
        let vue = document.getElementById('su-view-overlay');
        if (!vue) {
            vue = document.createElement('div');
            vue.id = 'su-view-overlay'; vue.className = 'su-overlay';
            vue.innerHTML = '<div class="su-card su-view-card"><button type="button" class="su-x" aria-label="Fermer"><svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button><div class="su-view-body"></div></div>';
            document.body.appendChild(vue);
            vue.addEventListener('click', ev => { if (ev.target === vue || ev.target.closest('.su-x')) vue.classList.remove('open'); });
        }
        vue.querySelector('.su-view-body').innerHTML = contenu.innerHTML;
        vue.classList.add('open');
    });

    montre(1, false);
}
