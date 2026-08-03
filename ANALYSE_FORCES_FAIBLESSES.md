# Analyse : forces, faiblesses et améliorations

Application de gestion du Poste de Santé de Diandioly (facturation, stock,
rapports, annulation) — PWA en JavaScript natif (sans framework ni build),
adossée à Firebase (Auth + Realtime Database). Ce document complète
`CORRECTIONS.md` (qui liste les correctifs déjà appliqués) par une lecture
transversale de l'ensemble du dépôt.

## Forces

- **Bonne discipline anti-XSS dans l'ensemble** : la fonction `esc()`
  est systématiquement appliquée avant toute injection de données
  dynamiques dans `innerHTML` (`facturation/script.js`, `stock.html`,
  `annulation.html`, `rapport-lib.js`).
- **Écritures Firebase sûres** : les décréments/incréments de stock
  passent par `runTransaction` (et non un read-puis-write), ce qui évite
  les conditions de course classiques lors de ventes concurrentes
  (`facturation/script.js:812-822`, `annulation/annulation.html:731-742`).
- **Module de rapports factorisé** : `planif_rapport/rapport-lib.js`
  centralise les filtres de période et la règle « exclure les ventes
  annulées des totaux » (`actifs()`), réutilisé correctement par
  `rapports.html` et `depenses.html` — le meilleur exemple de code
  partagé du projet.
- **PWA bien conçue** : `sw.js` sépare proprement les stratégies de cache
  (Firebase toujours réseau, polices cache-first, reste network-first
  avec page `offline.html` de secours) ; `manifest.json` est complet
  (icônes, maskable, raccourcis).
- **Documentation de sécurité honnête** : `firebase-config.js` explique
  clairement que le contrôle de rôle actuel est côté client et fournit un
  modèle de règles RTDB par rôle prêt à appliquer.
- **Accessibilité clavier soignée** : cartes cliquables (tarifs,
  médicaments) dotées de `tabindex`, `role="button"` et gestion
  Entrée/Espace, en plus des points UX déjà nombreux (saisie code à 6
  chiffres avec collage, calcul de monnaie en direct, toasts non
  bloquants).
- **Historique d'audit maintenu** (`CORRECTIONS.md`) : rare dans un
  projet sans suivi de tickets, et utile pour ne pas régresser.

## Faiblesses

### Critique

- **Le contrôle des rôles reste uniquement côté client.** Chaque page
  fait confiance à `sessionStorage`/`localStorage` (`userRole`,
  `savedRole`) : modifier ces valeurs dans les outils de développement
  suffit à obtenir l'interface admin depuis un compte caissier. Tant que
  les règles RTDB par rôle documentées dans `firebase-config.js` ne sont
  pas appliquées côté console Firebase, ce n'est pas seulement un
  problème d'affichage : un compte caissier authentifié peut lire/écrire
  directement stock, rapports, etc. via l'API REST Firebase.
- **Incohérence des chiffres d'affaires selon l'écran.**
  `accueil/menu_caissier.html` et `accueil/menu_tresorier.html` calculent
  les « recettes du jour » sans exclure les ventes/tickets annulés,
  contrairement à `accueil/menu_admin.html` (qui filtre `d.annule`) et à
  `rapport-lib.js` (`actifs()`), utilisé par `rapports.html` et
  `depenses.html`. Résultat : trois écrans peuvent afficher trois
  montants différents pour la même journée.
- **Logique d'annulation dupliquée et incohérente.** La caisse
  (`facturation/script.js`) ne peut qu'annuler ; le module admin
  (`annulation/annulation.html`) peut annuler **et** restaurer, avec une
  logique de résolution de stock quasi identique mais réécrite deux
  fois. Une caissière qui annule par erreur n'a aucun moyen de revenir en
  arrière sans solliciter un compte admin.

### Important

- **`esc()` est réimplémenté à l'identique dans 3 fichiers** (approche
  DOM) et une 4ᵉ fois avec une approche différente (regex) dans
  `rapport-lib.js`. Un correctif de sécurité sur l'un ne se propage pas
  automatiquement aux autres.
- **Deux fichiers `view-mode.js` incompatibles** coexistent (racine et
  `facturation/`), avec des clés de stockage et des API différentes ; le
  fichier racine n'est référencé par aucune page — code mort qui peut
  induire en erreur un futur mainteneur.
- **Aucun outillage de qualité** : pas de `package.json`, pas de CI
  (`.github/workflows`), pas de linter, **et aucun test automatisé**, y
  compris pour la logique métier sensible (calcul des totaux, décrément
  de stock) déjà responsable d'un bug « critique » listé dans
  `CORRECTIONS.md`.
- **Versionnage du cache Service Worker entièrement manuel**
  (`APP_VERSION` dans `sw.js`) : l'historique Git montre des bumps
  répétés (`v18→v19`, `v20→v21`, …) faits à la main. Un oubli laisse des
  utilisateurs PWA avec une version obsolète du code, potentiellement
  buggée.
- **Import Excel du stock** (`approvisionnement/stock.html`) détecte les
  colonnes par nom sans validation de vraisemblance des quantités
  importées ; une mauvaise détection de colonne peut fausser le stock en
  masse sans alerte forte.
- **Réapprovisionnement mono-lot** : une nouvelle entrée écrase la date
  de péremption/l'ancien lot au lieu de gérer plusieurs lots (FEFO) —
  limitation déjà connue (`CORRECTIONS.md`), toujours présente.
- **Résolution par nom de médicament fragile** : si `stock_key` est
  absent et que deux médicaments partagent le même nom, la restauration
  de stock échoue silencieusement (`resoudreCleStock`, dupliqué dans
  `facturation/script.js` et `annulation/annulation.html`).

### Mineur

- Usage de `alert()`/`confirm()` natifs dans `stock.html` alors que le
  reste de l'app utilise un système de toasts/modales personnalisé.
- Pas de région `aria-live` sur les toasts : les lecteurs d'écran
  n'annoncent pas les messages de succès/erreur.
- CSS quasi identique (variables `:root`, `.topbar`, `.stat-card`)
  dupliqué dans chaque page plutôt que dans une feuille partagée.
- Noms de nœuds Firebase (`ticket_dbase`, `db_pharmacie_stock`,
  `db_depenses`, …) tapés en dur dans 6+ fichiers, sans constante
  partagée — un commentaire dans `depenses.html` rappelle même « doit
  rester identique » à un autre fichier, signe qu'une constante
  éliminerait ce risque.
- Fichier parasite `icons/Hello.txt` (1 octet) resté dans le dépôt.
- `annulation/annulation.html` : le handler `beforeunload` est vide, les
  écouteurs Firebase ne sont jamais détachés (contrairement aux autres
  pages).

## Améliorations recommandées (par priorité)

1. **Appliquer les règles RTDB par rôle** décrites dans
   `firebase-config.js` (nœud `db_users/{uid}/role`) — c'est la seule
   action qui transforme le contrôle d'accès actuel (cosmétique) en
   sécurité réelle. Sans backend dédié, c'est le levier le plus
   important du projet.
2. **Unifier le calcul des « recettes du jour »** dans une seule fonction
   partagée (par ex. déplacer `actifs()`/les totaux de
   `rapport-lib.js` vers un module commun importé par les 3 menus) pour
   garantir un chiffre unique partout.
3. **Fusionner la logique d'annulation/restauration** en un seul module
   partagé, avec une action « annuler » accessible à la caisse et un
   contrôle de type d'action (annuler/restaurer) selon le rôle, plutôt
   que deux implémentations séparées.
4. **Créer un petit module JS commun** (`common/utils.js` ou similaire)
   exportant `esc()`, les constantes de nœuds Firebase, et l'init
   `app/db/auth`, importé par toutes les pages — supprime la duplication
   la plus risquée sans nécessiter de build.
5. **Supprimer le `/view-mode.js` racine orphelin** (ou fusionner les
   deux implémentations) pour éviter toute confusion future.
6. **Mettre en place un minimum de tests automatisés** (par ex. Vitest
   ou Jest sur les fonctions pures extraites de `rapport-lib.js` et sur
   la résolution de clé de stock) et un lint de base (ESLint) — même
   sans CI complète, cela aurait détecté le bug « champs Stock ↔
   Facturation » documenté dans `CORRECTIONS.md`.
7. **Automatiser le bump de version du Service Worker** (hash de
   contenu ou date de build généré à la volée) pour ne plus dépendre
   d'un geste manuel à chaque déploiement.
8. **Ajouter une gestion multi-lots (FEFO)** au stock, et une validation
   de vraisemblance (bornes min/max) sur les imports Excel.
9. Remplacer les `alert()`/`confirm()` restants par le système de
   modales déjà en place, et ajouter `aria-live="polite"` aux
   conteneurs de toast pour l'accessibilité.
