# Poste de santé — Édition multi-villages (24 octobre 2026)

**Livraison : code préparé, tests locaux réussis, NON déployé et NON testé sur la base Firebase en production.** Cette version repose sur la phase 1 du 24 octobre 2026 ; elle ne règle pas toutes les faiblesses du premier audit.

## Principe

Chaque compte Firebase Authentication est affecté à **un village unique** par un administrateur technique doté du compte de service (aucun village choisi dans un simple formulaire). Son rôle `admin`, `caissier`, `tresorier` ou `icp` est également défini côté serveur. Le village actif et son nom sont lus lors de l'authentification ; l'identité du poste apparaît en haut des écrans et sur les tickets/rapports imprimés. Les pages de caisse, stock, rapport, dépenses, annulations, réapprovisionnements, les notifications et les opérations API utilisent exclusivement le village affecté.

Structure RTDB cible :

```text
villages_registry/
  diandioly/       { nom: "Diandioly", active: true }
  keur-moussa/     { nom: "Keur Moussa", active: true }
  ndiaffate/       { nom: "Ndiaffate", active: true }
db_users/
  <uid-agent-A>/   { role: "admin", village_id: "diandioly" }
  <uid-agent-B>/   { role: "caissier", village_id: "keur-moussa" }
villages/
  diandioly/
    ticket_dbase/, vente_medicaments/, db_pharmacie_stock/
    db_pharmacie_reappro/, db_depenses/, compteurs/
    notifications_caisse/, fcm_tokens_admin/, gallery/
    pharmacie_operations/, system_locks/
  keur-moussa/
    ... (collections indépendantes)
```

**Confidentialité :** les règles RTDB exigent que `db_users/{auth.uid}/village_id` corresponde exactement au village lu/écrit **et** que son registre soit actif. Les clients ne peuvent ni modifier leur rôle ni leur affectation. La pharmacie Vercel déduit le village **depuis l'identité Firebase**, jamais depuis le corps de la requête. Le verrou, les numéros d'attente et les clés d'opérations idempotentes sont isolés par village. Les notifications FCM et les images Cloudinary le sont également. Les données anciennes à la racine seront bloquées par les nouvelles règles ; elles sont conservées pour la sauvegarde et vérification jusqu'à suppression encadrée.

## Installation et migration initiale de Diandioly

**Ne pas changer directement les règles ou le site de production.** Préparer une copie de la RTDB et une instance de préproduction. Informer les agents et suspendre les écritures pendant la bascule ; le script de migration copie un état de la base et ne capture pas automatiquement les écritures arrivant après cette copie.

1. Sauvegarder intégralement Firebase Realtime Database et la liste des utilisateurs ; vérifier l'export et conserver l'ancienne version du site. Conserver la clé privée **sur le poste technique uniquement**, jamais dans le dépôt ni dans le navigateur.
2. Créer un environnement de préproduction ; installer Node.js et les dépendances à la racine (`npm install`) ainsi que dans `scripts/` (`npm --prefix scripts install`).
3. Mettre la base en maintenance, puis exécuter la **simulation** :

   ```bash
   node scripts/migrate-to-villages.js --key /chemin/prive/service-account.json --id diandioly --nom Diandioly
   ```

4. Contrôler la liste des collections et des comptes, puis procéder à la **copie effective** uniquement après la sauvegarde :

   ```bash
   node scripts/migrate-to-villages.js --key /chemin/prive/service-account.json --id diandioly --nom Diandioly --apply
   ```

   Le script remplit `villages/diandioly`, affecte les comptes historiques à `db_users/{uid}/village_id`, et crée un registre `active=true` à la fin. Il refuse d'écraser un village déjà actif, ne supprime pas les nœuds historiques et s'arrête si aucun agent n'est attribuable. `--resume --apply` ne doit servir qu'à reprendre une copie interrompue après inspection manuelle.

5. Déployer dans la même fenêtre de maintenance **l'intégralité** de ce projet sur Vercel (incluant `api/_village.js` et les autres API), puis les **nouvelles règles Firebase** avec `firebase deploy --only database`. Les règles seules bloqueraient l'ancienne application ; la nouvelle application seule serait privée d'accès au schéma RTDB.
6. Tester au minimum : authentification de chaque rôle, tickets, compteur d'attente, pharmacie, stock, dépenses, recettes, annulation, réapprovisionnement, imprimante, push, déconnexion sur téléphone partagé, réessai de vente après coupure réseau. Comparer les totaux à la sauvegarde et ne rouvrir la production que lorsque les contrôles sont concluants.
7. Pour activer la Cloud Function de notifications (si cette architecture est utilisée), déployer sa nouvelle version avec le déclencheur `/villages/{villageId}/notifications_caisse/{notifId}`. Ne pas faire tourner deux relais concurrents qui envoient les mêmes notifications ; vérifier la configuration existante.

Le fichier `scripts/migrate-roles-to-db-users.js` (ancienne migration mono-village) est volontairement désactivé. Il faut maintenant affecter **rôle + village_id** ensemble.

## Créer un nouveau village

Le nouveau responsable doit disposer au préalable d'un compte dans Firebase Authentication. Ensuite, l'administrateur technique lance :

```bash
# Simulation sans écriture
node scripts/provision-village.js --key /chemin/prive/service-account.json --id keur-moussa --nom "Keur Moussa" --email responsable@exemple.sn --role admin

# Activer le village et son administrateur
node scripts/provision-village.js --key /chemin/prive/service-account.json --id keur-moussa --nom "Keur Moussa" --email responsable@exemple.sn --role admin --apply

# Affecter un caissier existant à ce village
node scripts/provision-village.js --key /chemin/prive/service-account.json --id keur-moussa --email caisse@exemple.sn --role caissier --apply
```

La création n'importe **aucun** stock, patient, vente, dépense ou numéro d'attente d'un autre village. Pour ajouter une secrétaire, un trésorier ou un ICP, utiliser respectivement les rôles disponibles `caissier`, `tresorier`, `icp`. Le script refuse la mutation d'un compte déjà affecté à un autre village : changement de poste et transferts de patients nécessitent une procédure administrative explicite, avec audit.

## Vérifications de sécurité à effectuer avec deux comptes différents

- Un compte de `diandioly` lit `villages/diandioly/db_pharmacie_stock` mais reçoit `PERMISSION_DENIED` pour `villages/keur-moussa/db_pharmacie_stock`.
- Il ne peut ni changer `db_users/{uid}/village_id` ou `role`, ni lire les fiches d'un autre agent.
- Il ne peut pas écrire à la racine historique `vente_medicaments`, `ticket_dbase` ou `db_pharmacie_stock`.
- Une requête HTTP à l'API pharmacie ou images avec l'identifiant d'un médicament/vente d'un autre village retourne une erreur/absence de fiche, sans toucher au stock distant.
- Un événement de caisse de Keur Moussa n'est reçu que par les administrateurs de Keur Moussa, même si les jetons FCM sont présents dans la base d'un autre village.
- Un village `active:false` empêche les accès métier, même si le compte est correctement affecté.

## Limites connues / travaux ultérieurs

- Le modèle prend en charge **un village par compte**, et plusieurs comptes par village. L'administration régionale multi-villages (un même utilisateur habilité dans plusieurs villages et vues consolidées) doit faire l'objet d'un espace distinct avec des permissions renforcées, non accordées aux admins locaux.
- La création d'un village et l'affectation des agents sont pour l'instant des **scripts d'administration**, pas un formulaire public ; c'est délibéré pour éviter les auto-attributions de privilèges.
- Les nouvelles règles doivent être exécutées contre **Firebase Emulator** avec deux véritables identités avant production. Les 17 tests locaux fournis sont unitaires/statiques et n'ont pas testé réellement les règles RTDB, le déclencheur FCM, Vercel, Cloudinary ou les imprimantes.
- Les autres constats de l'audit de phase 1 subsistent, notamment la traçabilité physique des lots et les écritures administrateur non transactionnelles.
- En cas de partage d'appareil, l'interface charge le village connecté à chaque page. Éviter de sauvegarder des documents médicaux nominatifs dans des caches ou exports locaux partagés.
- Cette livraison ne modifie **aucune donnée de production** et ne contient **aucune clé privée**.
