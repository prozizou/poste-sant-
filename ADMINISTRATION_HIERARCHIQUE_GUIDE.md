# Poste de santé — Hiérarchie de gestion des accès

Version phase 3 — 24 octobre 2026. **Développement local terminé, aucune écriture en production effectuée.**

## Modèle de responsabilités

Le **seul super administrateur global** est le compte Firebase Authentication correspondant à `prozizou298@gmail.com`, identifié non seulement par l'e-mail mais surtout par son **UID Firebase réel** enregistré sous `/superadmins/{uid}` avec `{email,active:true}` et `/db_users/{uid}` avec `{role:"superadmin",active:true}`. Ce compte **n'a pas de `village_id`**, car il gère tous les villages. L'e-mail n'est pas à lui seul une preuve de privilège : Firebase Auth signe le token et le serveur vérifie aussi l'UID, le rôle en base et l'enregistrement superadmin.

- **Superadmin** : créer un village, activer/désactiver un village, créer/affecter un administrateur local, suspendre/réactiver un administrateur local. Il voit le registre des villages et leurs administrateurs. Il n'obtient pas automatiquement accès aux données sanitaires des patients.
- **Administrateur local (`admin`)** : uniquement son village ; crée des comptes Caissier, Trésorier ou ICP, modifie ces rôles au sein de son équipe, suspend et réactive les membres. Il **ne peut pas** créer/supprimer des villages, promouvoir une personne admin ou modifier une équipe étrangère.
- **Caissier (`caissier`)** : accès aux opérations de caisse et pharmacie prévues dans les règles existantes.
- **Trésorier (`tresorier`)** : dépenses et bilans prévus dans les règles existantes.
- **ICP (`icp`)** : supervision/consultation selon les permissions existantes.

Les privilèges sont actuellement **définis par rôle**. Le panneau ne donne pas encore de cases à cocher pour personnaliser chaque permission individuellement. Un développement distinct et des règles RTDB adaptées seraient nécessaires pour des droits arbitraires par utilisateur.

## Nouvelle arborescence RTDB

```
superadmins/{uid_superadmin}: {"email":"prozizou298@gmail.com","active":true}
db_users/{uid_superadmin}: {"role":"superadmin","active":true,"email":"..."}
db_users/{uid_admin_village}: {"role":"admin","village_id":"diandioly","active":true,"email":"..."}
db_users/{uid_agent}: {"role":"caissier|tresorier|icp","village_id":"diandioly","active":true,"email":"..."}
villages_registry/diandioly: {"nom":"Diandioly","active":true}
villages/diandioly/{collections_métier}: ...
```

L'UID réel du superadmin est volontairement résolu auprès de Firebase Authentication **pendant la migration ou l'amorçage**. Ne pas remplir la clé `/superadmins/` avec l'e-mail comme identifiant et **ne pas inventer d'UID**.

## Nouveaux écrans

- `accueil/menu_superadmin.html` : gestion centrale, visible après connexion du superadmin.
- `accueil/equipe.html` : gestion de l'équipe depuis le menu administrateur local.
- `index.html` : redirection vers l'espace superadmin et option de connexion par mot de passe sécurisé en plus des anciens codes à six chiffres.

## API sécurisée

`api/access-management.js` : gestion des comptes côté serveur Firebase Admin, `Authorization: Bearer <Firebase ID token>`, validation de l'acteur à **chaque requête**, aucun `db_users` ou `superadmins` modifiable directement côté navigateur.

Actions : `createVillage`, `activateVillage`, `deactivateVillage`, `assignAdmin`, `createStaff`, `changeStaffRole`, `revokeStaff`, `reactivateStaff`. Lectures : `GET ?scope=overview` (superadmin), `GET ?scope=team` (administrateur local). Le serveur déduit le village local depuis le compte et refuse toute affectation inter-villages.

À la création d'un nouvel utilisateur, un mot de passe initial aléatoire fort (inconnu de l'administrateur) est affecté côté serveur. Le navigateur demande à Firebase d'envoyer un message de réinitialisation ; le nouvel agent doit définir son propre mot de passe. Si l'e-mail n'est pas reçu, il peut utiliser « Mot de passe oublié ». Vérifier la configuration des modèles d'e-mail Firebase et la présence du fournisseur Email/Mot de passe. Les comptes historiques qui utilisent déjà leur code à 6 chiffres continuent à pouvoir se connecter.

## Déploiement sûr dans la RTDB `poste-sante-280b2`

**N'effectuer aucune écriture depuis un navigateur ou un dépôt public avec la clé Admin.** Votre ancienne clé Firebase Admin, partagée dans la conversation, doit être **révoquée et remplacée** par une nouvelle clé privée réservée à un environnement serveur. Ne jamais inclure cette nouvelle clé dans le ZIP.

**Cas A : la migration multi-villages n'a PAS encore été exécutée en production**

1. Exporter un **nouveau** JSON de la RTDB live ; préparer un sauvegarde de l'authentification (UID et e-mails) ; vérifier qu'aucune écriture n'a lieu pendant la maintenance.
2. Faire `npm --prefix scripts install` depuis le projet téléchargé sur un ordinateur privé connecté.
3. Exécuter en simulation :

```bash
node scripts/migrate-export-diandioly.js --source /private/export-recent.json
```

4. Vérifier les compteurs, les comptes et la correspondance de l'export live.
5. Exécuter avec sauvegarde vérifiée et sous fenêtre de maintenance :

```bash
node scripts/migrate-export-diandioly.js \
 --source /private/export-recent.json \
 --key /private/nouvelle-cle.json \
 --backup-out /private/backup-live-initial.json \
 --backup-confirmed --maintenance-confirmed --apply
```

Cette version active simultanément le superadmin et la migration Diandioly ; les autres comptes restent rattachés à Diandioly. Si l'export source est plus ancien que la RTDB live, le script **refuse** l'écriture.

**Cas B : la migration multi-villages est DÉJÀ active**

1. Faire une sauvegarde complète RTDB et vérifier les UIDs.
2. Tester l'amorçage :

```bash
node scripts/bootstrap-superadmin.js --key /private/nouvelle-cle.json
```

3. Après contrôle, activer :

```bash
node scripts/bootstrap-superadmin.js --key /private/nouvelle-cle.json --backup-confirmed --apply
```

Ce script identifie le compte global **par Firebase Auth**, vérifie qu'il avait le rôle d'administrateur et qu'aucun autre superadmin actif ne porte le privilège. Il remplace uniquement son rôle/affectation et crée `/superadmins/{uid}` ; les autres agents restent inchangés.

4. Déployer le projet statique + les routes `api/*.js` sur Vercel avec la **nouvelle** variable secrète serveur `FIREBASE_SERVICE_ACCOUNT` (JSON du compte de service remplacé), et l'URL RTDB correcte si nécessaire. Ne jamais utiliser `NEXT_PUBLIC_` ou `VITE_` pour cette clé.
5. Déployer `database.rules.json` avec Firebase CLI depuis l'environnement d'administration **dans la même fenêtre de maintenance**. Ne déployer ni les règles seules ni la nouvelle application seule.
6. Vérifier en préproduction avant l'activation sur les comptes réels.

**Interdit :** utiliser l'ancien script `migrate-to-villages.js` pour cette version. Il est désactivé. Ne pas importer le JSON historique au niveau de la racine : cela pourrait effacer d'autres villages.

## Scénarios de réception

1. Le superadmin se connecte et voit tous les villages, crée un village et nomme son admin.
2. L'admin Diandioly voit uniquement l'équipe Diandioly ; impossible de créer un autre administrateur ou village.
3. L'admin d'un autre village ne peut lire ou modifier les agents de Diandioly, même en falsifiant les requêtes HTTP.
4. Un caissier ne peut pas gérer les comptes ; les requêtes répondent 403.
5. Une suspension bloque immédiatement les nouvelles opérations serveur et RTDB ; les clients affichent une déconnexion. Tester la reconnexion sur les anciens appareils.
6. Un administrateur suspendu ne peut pas gérer son équipe ; un village désactivé coupe tous ses agents.
7. La caisse, les stocks, les recettes et les dossiers patients du village A restent indépendants du village B.
8. Confirmer l'arrivée du courriel de configuration du mot de passe et l'ouverture d'une session par le nouvel agent.

## État de validation

Tests locaux : **33/33** (test Node, vérifications des modules, de la hiérarchie et de la syntaxe). **Tests Firebase Emulator, Firebase Authentication réelle, envoi de courriels, UI de navigateur et déploiement non exécutés.** La publication des règles et de l'API sur la production reste une opération distincte et sensible.
