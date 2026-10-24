# Migration Firebase RTDB vers Diandioly en mode multi-villages

Date : 24 octobre 2026. **ÉTAT : préparé hors ligne ; aucune modification de production effectuée.**

## Pourquoi le déploiement n'a pas été effectué ici

L'environnement d'exécution de cette conversation n'a pas pu résoudre les noms des services Google (`firebase.googleapis.com`). Il n'est donc pas possible de se connecter, sauvegarder ou écrire dans le projet Firebase réel depuis cette session. Les deux fichiers reçus ont uniquement été lus localement. Toute indication de « migration déjà effectuée en production » serait incorrecte.

## Données exactes reçues

- Projet Firebase (clé de service) : `poste-sante-280b2`
- Source RTDB : `poste-sante-280b2-default-rtdb-export.json`
- Collections métier présentes : `ticket_dbase`, `vente_medicaments`, `db_pharmacie_stock`, `db_pharmacie_reappro`, `db_depenses`, `compteurs`, `notifications_caisse`, `gallery`, `fcm_tokens_admin`.
- `pharmacie_operations` absent de l'export : le programme ne l'invente pas.
- `administration/auth_db` reste à la racine comme historique et ne sera pas utilisé comme contrôle de permissions après bascule.
- `db_users` reste à la racine pour associer chaque UID Firebase Auth à `{role, village_id}`.
- Les données de Diandioly sont copiées sous `villages/diandioly`, identifiants intacts.
- Une entrée `villages_registry/diandioly` marque l'activation **en dernier**.

## Opération en production (sur un poste serveur autorisé avec internet)

**Ne jamais importer un fichier JSON au niveau de la racine RTDB : l'import pourrait remplacer toute la base et écraser d'autres villages.** Ne jamais mettre la clé de service dans Vercel public, GitHub, un ZIP de l'application, une page web ou un chat public.

1. Sauvegarder **la RTDB réellement en ligne au moment de l'opération**, ainsi que Firebase Authentication, puis vérifier que cette sauvegarde est exploitable. La copie fournie peut être devenue ancienne depuis son export.
2. Exporter la configuration et les règles actuelles ; conserver une version de l'application permettant un retour arrière. Tester la nouvelle version sur une base de préproduction distincte.
3. Informer les agents et fermer **toutes les écritures** de l'ancien site avant migration.
4. Depuis le dossier du projet (sur un ordinateur privé connecté), installer les dépendances :

```bash
npm install
# ou, si vous utilisez uniquement le ZIP « outils de migration » : npm --prefix scripts install
```

5. Simuler la migration locale avec l'export conservé dans un répertoire privé :

```bash
node scripts/migrate-export-diandioly.js --source /repertoire/prive/poste-sante-280b2-default-rtdb-export.json
```

6. Après validation, depuis l'environnement serveur privé, exécuter :

```bash
node scripts/migrate-export-diandioly.js \
  --source /repertoire/prive/poste-sante-280b2-default-rtdb-export.json \
  --key /repertoire/prive/nouvelle-cle-admin.json \
  --backup-out /repertoire/prive/sauvegarde-live-avant-migration.private-backup.json \
  --backup-confirmed --maintenance-confirmed --apply
```

Avant la première écriture, le script crée aussi une **sauvegarde complète de la RTDB LIVE** à l’emplacement privé indiqué par `--backup-out`, en mode fichier non-écrasable (permissions 0600). Conserver ce fichier en lieu sûr et ne pas le publier. La sauvegarde préalable et celle de Firebase Authentication restent indispensables.

Le script compare **chaque collection historique de l'export à la RTDB en ligne**. La moindre différence fait échouer la migration, afin de ne pas copier un ancien état. Il compare également les 5 comptes à Firebase Auth (UID et rôle), vérifie qu'un autre village n'est pas enregistré à cette destination, copie une seule fois les données puis active les comptes et le registre. Les anciennes collections ne sont pas supprimées.

**Important :** si l'export ne correspond plus à la base, exporter un nouvel état et réexécuter la simulation. Ne pas modifier l'export pour contourner le refus. `--resume` s'utilise uniquement après une copie interrompue et inspection de la destination inactivée.

7. Dans **la même maintenance**, mettre en ligne le projet multi-villages et `database.rules.json`, avec la configuration des API Vercel. Ces éléments sont dépendants. Les règles seules peuvent empêcher l'ancien site de fonctionner. Ne pas basculer tant que le serveur pharmacie et le nouveau site ne sont pas prêts.
8. Vérifier avec des comptes distincts : lecture de Diandioly, impossibilité de lire un autre village, encaissements, pharmacies, stocks, ventes annulées, dépenses, tickets, impressions et notifications. Comparer les effectifs ci-dessous au nouveau sous-arbre.
9. Conserver les collections historiques jusqu'à vérification complète et politique de rétention. Faire la rotation/révocation de **la clé de service partagée** après avoir configuré un mode d'accès sûr pour l'administration.

## Import manuel des JSON préparés (réservé à un environnement de test)

Le fichier `poste-sante-diandioly-noeud-village.json` représente **uniquement** la valeur attendue pour `/villages/diandioly` : ne pas l'importer à la racine, ni dans un autre village. `poste-sante-diandioly-affectations.json` décrit les rôles existants avec un `village_id` ajouté ; ne pas l'importer à la racine des utilisateurs si de nouveaux comptes existent. `poste-sante-diandioly-registre.json` sert de modèle, mais ne doit être activé qu'après vérification de la copie, des comptes et du site.

**L'import manuel ne vérifie pas les correspondances Firebase Authentication ni les changements survenus en production : préférer le script contrôlé.**

## Points en suspens

- Auth Firebase en ligne inaccessible depuis ici : les correspondances email → UID sont encore à confirmer.
- Une fiche stock possède une date de péremption passée avec quantité positive dans l'export : **ne pas délivrer** sans contrôle ; l'historique est copié tel quel.
- Les ventes historiques référencent essentiellement les noms des produits, pas toujours les identifiants/lots exacts. La migration n'invente pas ces correspondances.
- Les règles Firebase doivent passer des tests d'isolation via Emulator avec deux comptes distincts, puis être vérifiées sur une préproduction ; les 23 tests réalisés sont des tests locaux et syntaxiques.
- L'utilisateur doit procéder à la **rotation de la clé privée Firebase Admin** fournie dans cette conversation, car elle accorde des droits étendus. Aucune clé ne figure dans ce guide ni dans les archives générées.


## Addendum — modèle super administrateur (phase 3)

**Attention :** la migration actuelle `migrate-export-diandioly.js` a été adaptée pour enregistrer `prozizou298@gmail.com` comme unique super administrateur global (UID Firebase Auth, sans village_id). Ne pas utiliser l’ancienne archive phase 2 ou les fichiers d’affectations JSON antérieurs pour remettre son rôle à `admin` local. Voir le nouveau `ADMINISTRATION_HIERARCHIQUE_GUIDE.md`.
