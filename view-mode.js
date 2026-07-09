/* ═══════════════════════════════════════════════════════════════
   VIEW-MODE.JS — Bascule « Vue mobile / Vue PC »
   Partagé par toutes les pages. À charger dans <head>, SANS defer,
   afin que l'attribut data-view soit posé avant le premier rendu
   (sinon on voit brièvement la mise en page desktop sur téléphone).

   Trois modes, mémorisés dans localStorage :
     • auto    — s'adapte à la largeur de l'écran (comportement par défaut)
     • mobile  — force la mise en page compacte
     • desktop — force la mise en page large

   Deux leviers agissent de concert :

   1) La balise <meta name="viewport">. Sur Android, la passer à
      « width=1280 » fait croire à Chrome que l'écran est un grand
      moniteur : la page est composée en 1280 px puis dézoomée pour
      tenir dans l'écran. C'est exactement ce que fait l'option
      « Version pour ordinateur » du menu de Chrome, mais appliquée
      à notre seule application. Les media queries CSS voient alors
      1280 px et cessent de déclencher les règles compactes.

   2) L'attribut data-view sur <html>. Nécessaire pour la direction
      inverse — forcer la vue mobile sur un vrai PC —, car la balise
      viewport y est ignorée par le navigateur. Le CSS s'appuie donc
      sur [data-view="mobile"] plutôt que sur des @media, ce qui rend
      les deux sens symétriques.
   ═══════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const KEY = 'app_view_mode';
    const DESKTOP_WIDTH = 1280;   // largeur de composition en mode PC
    const BREAKPOINT = 900;       // en dessous : mobile, en mode auto

    const MODES = ['auto', 'mobile', 'desktop'];
    const LABEL = {
        auto:    { icon: '⚙️', text: 'Auto' },
        mobile:  { icon: '📱', text: 'Mobile' },
        desktop: { icon: '🖥️', text: 'PC' },
    };

    function readMode() {
        try {
            const m = localStorage.getItem(KEY);
            return MODES.includes(m) ? m : 'auto';
        } catch (_) { return 'auto'; }
    }

    function setViewport(content) {
        let meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'viewport');
            document.head.appendChild(meta);
        }
        if (meta.getAttribute('content') !== content) meta.setAttribute('content', content);
    }

    // Mode effectif : « auto » se résout en mobile ou desktop selon l'écran.
    function resolve(mode) {
        if (mode !== 'auto') return mode;
        const w = window.screen && window.screen.width ? Math.min(window.innerWidth, window.screen.width)
                                                       : window.innerWidth;
        return w < BREAKPOINT ? 'mobile' : 'desktop';
    }

    function apply() {
        const mode = readMode();

        // Le viewport n'est manipulé que lorsqu'on force un mode : en « auto »
        // on laisse la valeur d'origine de la page, plus prévisible.
        if (mode === 'desktop')      setViewport('width=' + DESKTOP_WIDTH);
        else if (mode === 'mobile')  setViewport('width=device-width, initial-scale=1.0');

        const view = resolve(mode);
        const root = document.documentElement;
        root.setAttribute('data-view', view);
        root.setAttribute('data-view-mode', mode);
        return { mode, view };
    }

    function cycle() {
        const next = MODES[(MODES.indexOf(readMode()) + 1) % MODES.length];
        try { localStorage.setItem(KEY, next); } catch (_) {}
        apply();
        renderButton();
        // Le zoom ne se recalcule pas toujours seul après un changement de
        // viewport : un reflow forcé suffit à le déclencher.
        window.scrollTo(window.scrollX, window.scrollY);
    }

    function renderButton() {
        const btn = document.getElementById('view-switch');
        if (!btn) return;
        const mode = readMode();
        const view = resolve(mode);
        const l = LABEL[mode];
        btn.innerHTML = `<span aria-hidden="true">${l.icon}</span><span class="vs-txt">${l.text}</span>`;
        btn.setAttribute('title', mode === 'auto'
            ? `Affichage automatique (actuellement : ${LABEL[view].text}). Cliquer pour forcer.`
            : `Affichage forcé : ${l.text}. Cliquer pour changer.`);
        btn.setAttribute('aria-label', btn.getAttribute('title'));
    }

    apply();   // avant le premier rendu

    window.addEventListener('DOMContentLoaded', function () {
        const btn = document.getElementById('view-switch');
        if (btn) btn.addEventListener('click', cycle);
        renderButton();
    });

    // En mode auto uniquement : suivre les rotations et redimensionnements.
    let t;
    window.addEventListener('resize', function () {
        if (readMode() !== 'auto') return;
        clearTimeout(t);
        t = setTimeout(function () { apply(); renderButton(); }, 120);
    });

    window.AppViewMode = { apply, cycle, get: readMode };
})();
