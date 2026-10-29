# Postes de santé — développement

Application de gestion multi-villages : caisse, pharmacie, dépenses et rapports.
Les pages utilisent Firebase Authentication et Realtime Database ; les opérations
pharmacie et la gestion des accès passent par les fonctions Vercel de `api/`.

## Installation et vérification

Node **24** est requis (`.nvmrc` fixe la version utilisée pour les vérifications).
Depuis la racine du dépôt :

```bash
npm ci
npm ci --prefix scripts
npm test
npm run test:browser
npm audit --omit=dev
npm audit --omit=dev --prefix scripts
```

Les tests navigateur utilisent Chromium (`/usr/bin/chromium` par défaut ;
`CHROMIUM_PATH` permet de choisir un autre exécutable). Ils exécutent les modules
réels avec une authentification et un transport RTDB simulés, sans production.

Les lockfiles doivent être versionnés. La CI exécute ces vérifications sans
identifiants de production. Les tests locaux utilisent des doubles Firebase et
ne vérifient pas les règles dans Firebase Emulator.

## Structure

| Emplacement | Responsabilité |
| --- | --- |
| `index.html`, `accueil/` | Connexion et espaces par rôle |
| `facturation/`, `approvisionnement/`, `planif_rapport/`, `annulation/` | Interfaces métier |
| `api/` | Fonctions Vercel et contrôles serveur ; modules privés préfixés `_` |
| `api/_http.js` | Validation commune du JSON et réponses privées |
| `api/_atomic.js`, `api/_business.js` | Transactions, idempotence, solde, tickets, dépenses et stock |
| `business-client.js` | Conservation et récupération des commandes incertaines |
| `domain-values.mjs`, `data-quality.js` | Montants entiers, dates et signalement des données incohérentes |
| `record-actions.js` | Actions de l’interface sans identifiants injectés dans du JavaScript |
| `village-client.js`, `api/_village.js` | Contexte et isolation des villages |
| `database.rules.json` | Autorisations RTDB côté Firebase |
| `sw.js` | PWA ; cache limité aux ressources publiques autorisées |
| `scripts/` | Outils d’administration et de migration |
| `functions/` | Ancien relais Firebase, remplacé par `api/notifier.js` |
| `tests/` | Régressions métier, accès, HTTP, cache PWA et actions de l’interface |

Pour examiner les pages statiques :

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Ce serveur n’exécute pas les API Vercel. Une session métier complète nécessite
un environnement de préproduction Vercel/Firebase et ses identifiants. La
configuration Firebase du navigateur référence actuellement le projet existant :
ce n’est pas un mode de démonstration isolé. Ne pas utiliser des données réelles
pour les essais de développement.

Les API utilisent `FIREBASE_SERVICE_ACCOUNT` (JSON privé, traité localement),
éventuellement `FIREBASE_DATABASE_URL`, et, pour les images, `SERPER_API_KEY`,
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Les valeurs
privées doivent être configurées dans l’hébergement, jamais dans les fichiers
publics ou Git. Les clés publiques de configuration Firebase ne remplacent pas
les règles d’accès à la base.

## État de sécurité et prochaines évolutions

Consulter [l’audit et les corrections du 29 octobre 2026](AUDIT_2026-10-29.md).
Il distingue les corrections vérifiées localement des risques encore ouverts et
des vérifications à effectuer avant la production. Aucun déploiement ni aucune
migration de données ne font partie de ces vérifications locales.

## Contrat d’écriture et déploiement

Toutes les écritures de caisse et de stock passent par les API :
`/api/business-operations` pour tickets/dépenses/gestion du stock et
`/api/pharmacie-operations` pour ventes/retours/réapprovisionnements. Une commande
porte un UUID et une empreinte du contenu, et s’applique dans une transaction sur
le village. Le solde, les quantités, les numéros de tickets et les journaux sont
validés sur le même état. Les règles RTDB refusent les anciennes écritures directes.

Déployer ensemble API, interfaces et règles ; ne pas déployer les règles seules
sur une ancienne interface. Prévoir une recette sur préproduction et vérifier le
rechargement des PWA. Les dates et montants historiques incohérents doivent être
rapprochés avec une source fiable : le logiciel ne les remplace pas par zéro ou
par la date du jour. Voir le rapport d’audit pour les tests exécutés et les limites.
