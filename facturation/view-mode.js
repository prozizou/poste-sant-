/* ═══════════════════════════════════════════════════════════════
   VIEW-MODE.JS
   Bascule d'affichage : Auto / Vue mobile / Vue PC.

   Deux leviers complémentaires, car aucun des deux ne suffit seul :

   1) L'attribut html[data-view="mobile"|"desktop"], sur lequel
      style.css branche toutes ses règles compactes. C'est ce qui
      permet de forcer la vue mobile sur un grand écran (les media
      queries, elles, ne réagissent qu'à la largeur réelle).

   2) La balise <meta name="viewport">. Sur un téléphone, forcer la
      vue PC ne sert à rien si le viewport reste à device-width : la
      page ferait 360 px de large et les règles « desktop » n'auraient
      aucune place pour s'exprimer. On élargit donc le viewport à
      DESKTOP_WIDTH et le navigateur dézoome pour tout faire tenir —
      exactement le mécanisme du « Site pour ordinateur » de Chrome.

   Chargé en <head> AVANT le rendu, pour poser data-view tout de suite
   et éviter un flash de mise en page.
   ═══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var KEY            = 'ui_view_mode';
    var MODES          = ['auto', 'mobile', 'desktop'];
    var DESKTOP_WIDTH  = 1180;   // largeur logique simulée en vue PC forcée
    var BREAKPOINT     = 900;    // seuil de bascule en mode auto

    var LABELS = { auto: 'Auto', mobile: 'Vue mobile', desktop: 'Vue PC' };
    var ICONS  = {
        auto:    '<svg class="icon" viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
        mobile:  '<svg class="icon" viewBox="0 0 24 24"><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg>',
        desktop: '<svg class="icon" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>'
    };

    var html = document.documentElement;
    var saved = localStorage.getItem(KEY);
    var mode = MODES.indexOf(saved) !== -1 ? saved : 'auto';

    // En mode auto, on décide d'après la largeur réelle de la fenêtre.
    function resolve() {
        if (mode !== 'auto') return mode;
        return window.innerWidth <= BREAKPOINT ? 'mobile' : 'desktop';
    }

    // On n'élargit le viewport que sur un écran physiquement étroit :
    // sur un vrai PC, y toucher provoquerait un zoom parasite.
    function screenIsNarrow() {
        return !!(window.screen && window.screen.width < DESKTOP_WIDTH);
    }

    function setViewport(view) {
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'viewport');
            document.head.appendChild(meta);
        }
        meta.setAttribute('content',
            (view === 'desktop' && screenIsNarrow())
                ? 'width=' + DESKTOP_WIDTH
                : 'width=device-width, initial-scale=1.0');
    }

    function paintButton() {
        var btn = document.getElementById('view-switch');
        if (!btn) return;
        btn.innerHTML = '<span class="vs-ico">' + ICONS[mode] + '</span>' +
                        '<span class="vs-txt">' + LABELS[mode] + '</span>';
        var t = 'Affichage : ' + LABELS[mode] + ' — cliquer pour changer';
        btn.title = t;
        btn.setAttribute('aria-label', t);
        btn.setAttribute('data-mode', mode);
    }

    function apply() {
        var view = resolve();
        html.setAttribute('data-view', view);
        setViewport(view);
        paintButton();
    }

    window.cycleViewMode = function () {
        mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
        localStorage.setItem(KEY, mode);
        apply();
        if (typeof window.toast === 'function') {
            window.toast('Affichage : ' + LABELS[mode], 'ok');
        }
    };

    // Le mode auto doit suivre les rotations d'écran / redimensionnements.
    var t = null;
    window.addEventListener('resize', function () {
        if (mode !== 'auto') return;
        clearTimeout(t);
        t = setTimeout(apply, 120);
    });

    apply();                                              // le plus tôt possible
    document.addEventListener('DOMContentLoaded', apply); // puis pour le bouton
})();
