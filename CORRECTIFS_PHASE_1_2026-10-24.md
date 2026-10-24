# Poste de santé de Diandioly — corrections Phase 1

**Date :** 24 octobre 2026. **Source :** archive `poste-sant--main.zip`. **Statut :** code modifié et tests locaux réussis, **non déployé**. Ne pas l'utiliser sur des données réelles sans sauvegarde, déploiement de préproduction et vérification fonctionnelle.

## Changements effectués

1. **API de pharmacie contrôlée** (`api/pharmacie-operations.js`, `pharmacie-client.js`) : les opérations `encaisser`, `annuler`, `restaurer`, `modifier`, `reappro` sont authentifiées par ID token Firebase et par le rôle réel `db_users/{uid}/role` ; la vérification de révocation du token est activée.
2. **Intégrité des mutations pharmacie** : verrou d'opération serveur pour sérialiser les actions qui passent par cette API et écriture RTDB multi-chemins atomique : quantités de stock, ventes, mouvements de réapprovisionnement et identifiant de commande sont enregistrés ensemble ou non enregistrés. Les tentatives répétées avec un même identifiant d'opération retournent le résultat déjà enregistré sans nouveau débit.
3. **Vérifications serveur** : identifiants produits stables, quantités entières positives, absence de stock négatif, montant remis suffisant, prix de vente récupéré depuis la fiche officielle (personnel caisse), rejet des stocks archivés, dates de péremption absentes ou expirées, et lots incohérents. Les restaurations refusent désormais un débit impossible au lieu de ramener silencieusement la quantité à zéro.
4. **Écrans adaptés** : la vente et l'annulation des médicaments depuis Facturation, l'annulation/restauration depuis Annulations, ainsi que la modification/annulation depuis Rapports utilisent l'API plutôt que des débits successifs côté navigateur. Les anciennes fonctions de décrémentation/restauration directes ne sont plus utilisées (et ont été retirées là où cela ne cassait pas d'autre fonction).
5. **Contrôle d'accès** (`role-server.js`) : les pages sensibles et la redirection automatique de connexion relisent le rôle enregistré en RTDB, au lieu de faire confiance au stockage navigateur.
6. **Règles RTDB** (`database.rules.json`) : suppression des écritures directes sur les ventes de pharmacie depuis les clients, interdiction des écritures pharmacie par les caissiers, rôles obligatoires, restriction des mutations de tickets, validation des quantités et compteurs, notifications append-only, protection des jetons push et des nœuds de commandes/verrou.
7. **Gestion des péremptions** : désactivation côté caisse des médicaments sans péremption ou périmés. Côté serveur, les lots restants sont évalués selon la logique FEFO historique de l'application. En cas de données d'inventaire non réconciliées, la vente est refusée (sécurité par défaut).
8. **Monnaie et paiement** : la saisie de zéro comme montant remis pour un paiement obligatoire est rejetée ; aucune opération n'est comptée comme encaissée sans paiement suffisant.
9. **Comptabilité** : les tableaux Caisse et Trésorerie excluent les tickets/ventes annulés, et ne classent plus par défaut les enregistrements sans date dans les recettes du jour.
10. **Numéro d'attente** : en cas d'échec de la transaction de compteur, aucune attribution locale risquant un doublon n'est permise.
11. **Impression** : un échec d'imprimante après une vente réussie n'est plus présenté comme un échec d'encaissement ; la réimpression reste disponible depuis l'historique.
12. **Validation** : heure future bloquée, heure saisie manuellement conservée, validation plus stricte des quantités/dates/prix dans les imports Excel, rapprochement par nom + dosage + forme au lieu du seul nom.
13. **Stock** : un ajustement dépassant la quantité disponible est désormais refusé au lieu d'un clamp à zéro. Le réapprovisionnement d'un produit existant passe par l'API serveur ; sa quantité, ses lots et son mouvement sont écrits atomiquement.
14. **Archivage** : une référence ne peut être archivée que lorsque son stock est égal à zéro. Elle n'est pas supprimée de l'historique ; elle est accessible dans le filtre « Archivés », avec restauration possible depuis la fiche.
15. **Confidentialité** : échappement HTML des caractères d'attributs dans les zones vérifiées, URLs de sources d'images limitées à HTTPS, notifications push sans nom ni montant patient, contrôle du rôle admin avant émission vers un terminal, désabonnement push au moment de la déconnexion.
16. **PWA** : nouvelles ressources incluses dans le pré-cache, ICP ajouté, correspondance des chemins statiques exacte, politique réseau prioritaire pour les fichiers critiques, suppression des captures manifest inexistantes, version de cache mise à jour.
17. **Tests** : `npm test` exécute 11 tests, dont un parcours de validation syntaxique de tous les scripts JS et inline du dépôt.

## Mise en production — ordre obligatoire

1. Exporter **une sauvegarde complète de Realtime Database** et de l'inventaire actuel. Conserver la version précédente du site pour rétablissement.
2. Copier le projet sur un environnement **de préproduction**, avec des comptes Firebase distincts pour tester : administrateur, caissier, trésorier, ICP. Vérifier que les documents `db_users/{uid}/role` existent et concordent avec les comptes. Si nécessaire, examiner `scripts/migrate-roles-to-db-users.js` avant migration.
3. Déployer sur **Vercel** les nouveaux fichiers et la fonction `/api/pharmacie-operations`. Renseigner une variable secrète `FIREBASE_SERVICE_ACCOUNT` (JSON service account, **jamais** exposé en frontend) et, si nécessaire, `FIREBASE_DATABASE_URL`. Cette API nécessite un hébergement Vercel compatible Node/Firebase Admin. Sans ces variables, les ventes de pharmacie sont bloquées par sécurité.
4. Exécuter et valider les tests sur une copie de la base. **Déployer les règles RTDB en coordination avec la nouvelle API** ; ne pas déployer les nouvelles règles avant que l'API soit opérationnelle. Commande indicative : `firebase deploy --only database` depuis un poste correctement authentifié.
5. Vérifier à partir de chaque rôle les scénarios suivants : vente réussie, manque de stock, vente multi-médicaments avec 2ᵉ produit indisponible, prix modifié entre sélection et validation, paiement nul, péremption, annulation simultanée, restauration sans quantité suffisante, réapprovisionnement, panne imprimante, recettes du jour et fermeture de session sur téléphone partagé.
6. Si `notifierCaisseAdmin` de `functions/index.js` est encore déployé, **désactiver l'un des deux relais** (Firebase Function historique et `api/notifier.js`) afin d'éviter les notifications doubles. Ne jamais supprimer une fonction de production sans contrôler son emploi.
7. Vérifier les ventes historiques sans `stock_key`, les anciennes dates de lots vides et les stocks physiques incohérents : le nouveau serveur les rejette volontairement pour éviter des corrections silencieuses dangereuses. Une réconciliation encadrée est nécessaire.

## Limites et risques restant à traiter

Cette livraison est une **Phase 1 et non la correction intégrale des 75 constats** du rapport d'audit initial.

- La robustesse complète exige que **tous** les ajustements manuels, retraits de lots, créations/renommages de produits, imports Excel, corrections d'admin et modifications des tickets passent également par des commandes serveur idempotentes. Certains modules admin écrivent encore directement le stock et le journal, donc la sérialisation de l'API ne couvre pas les opérations manuelles concurrentes. Ce déploiement doit d'abord être testé en préproduction.
- Les tickets restent en partie enregistrés et annulés directement par navigateur avec les règles RTDB, sans commande serveur transactionnelle complète.
- Les lots historiques sont déduits du total selon une approximation FEFO : il reste à enregistrer **le lot physique réellement délivré** dans chaque vente, avec sa quantité restante propre.
- L'identification par six chiffres utilisée à la connexion n'a pas encore été remplacée par une authentification robuste cohérente avec la réinitialisation. MFA, prévention de force brute et gouvernance des comptes sont à mener séparément.
- Les règles limitent les écritures, mais les lectures patient restent larges entre plusieurs rôles qui utilisent des tableaux agrégés ; les vues de supervision doivent être séparées des dossiers nominatifs.
- Les relais push ne forment pas encore une outbox serveur transactionnelle unique ; la concurrence, les réessais et le risque de doublons doivent encore être révisés.
- L'import Excel n'est pas encore une transaction multi-lignes tout-ou-rien ; il reste partiel en cas d'échec au milieu.
- La PWA garde un mode hors-ligne partiel, **pas une caisse hors-ligne sûre**. Toute confirmation de paiement exige le serveur et la base.
- Aucun test Firebase Emulator, Vercel réel, navigateur Android, imprimante ESC/POS réelle, sécurité dynamique ou données de production n'a été effectué ici. Les **11 tests réussis** portent sur les contrôles locaux et la syntaxe.

**Ne pas exposer publiquement une copie de la base de données ni la clé privée du compte de service.**
