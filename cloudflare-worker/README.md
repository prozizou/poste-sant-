# Relais de notifications push — Poste de Santé de Diandioly

Ce petit serveur (Cloudflare Worker) est la pièce qui manque pour que les
notifications de caisse s'affichent **dans la barre de statut du téléphone,
même quand l'application est complètement fermée**. Il tourne gratuitement
sur l'infrastructure Cloudflare (forfait gratuit largement suffisant pour
un poste de santé), sans passer par le forfait payant "Blaze" de Firebase.

## Comment ça marche

```
Caissier(ère) encaisse
        │
        ▼
Firebase RTDB : notifications_caisse (déjà en place)
        │
        │  toutes les minutes
        ▼
Ce Worker Cloudflare (Cron)
   1. lit les nouvelles entrées
   2. lit les appareils admin enregistrés (fcm_tokens_admin)
   3. envoie un push via Firebase Cloud Messaging (FCM)
        │
        ▼
Téléphone de l'administrateur(rice) — notification dans la barre de
statut, même app fermée, avec le bouton "Annuler et retourner"
```

Délai maximum : **1 minute** (fréquence du Cron Trigger — c'est le minimum
autorisé gratuitement par Cloudflare).

## Ce qu'il te faut avant de commencer

1. Un compte Cloudflare gratuit → https://dash.cloudflare.com/sign-up
2. Node.js installé sur ton ordinateur (pour lancer `wrangler`, l'outil de
   déploiement Cloudflare — aucune installation globale nécessaire, on
   utilise `npx`).
3. Deux éléments à récupérer dans la Console Firebase (voir ci-dessous).

## Étape 1 — Clé VAPID (nécessaire aussi côté application)

Firebase Console → ton projet → ⚙️ **Paramètres du projet** → onglet
**Cloud Messaging** → section **Certificats Web Push** → bouton
**Générer une paire de clés**.

Copie la longue chaîne générée ("clé publique"), et colle-la dans
`notifications-admin.js` à la racine du dépôt, à la place de
`REMPLACE_PAR_TA_CLE_VAPID_PUBLIQUE` (chercher `VAPID_KEY`).

## Étape 2 — Compte de service (accès serveur à Firebase)

Firebase Console → ton projet → ⚙️ **Paramètres du projet** → onglet
**Comptes de service** → bouton **Générer une nouvelle clé privée**.
Un fichier JSON se télécharge — **garde-le secret, ne le commite jamais**.
Il contient (entre autres) :

- `client_email` → une adresse du type `firebase-adminsdk-xxxxx@poste-sante-280b2.iam.gserviceaccount.com`
- `private_key` → un bloc commençant par `-----BEGIN PRIVATE KEY-----`

## Étape 3 — Installer et configurer Wrangler (CLI Cloudflare)

Depuis le dossier `cloudflare-worker/` de ce dépôt :

```bash
cd cloudflare-worker
npx wrangler login          # ouvre le navigateur pour te connecter à Cloudflare
```

Crée le namespace KV (mémorise où en est le Worker entre deux passages) :

```bash
npx wrangler kv namespace create NOTIF_STATE
```

La commande affiche un `id`. Ouvre `wrangler.toml` et remplace
`REMPLACE_PAR_ID_KV` par cet identifiant.

## Étape 4 — Secrets (jamais dans un fichier versionné)

```bash
npx wrangler secret put FIREBASE_CLIENT_EMAIL
# colle la valeur "client_email" du fichier JSON, puis Entrée

npx wrangler secret put FIREBASE_PRIVATE_KEY
# colle la valeur "private_key" du fichier JSON EN ENTIER
# (avec les lignes -----BEGIN PRIVATE KEY----- / -----END PRIVATE KEY-----)

npx wrangler secret put RUN_SECRET
# invente un mot de passe aléatoire (sert uniquement à tester le Worker
# manuellement à l'étape 6, ex. avec `openssl rand -hex 20`)
```

## Étape 5 — Déployer

```bash
npx wrangler deploy
```

Wrangler affiche une URL du type
`https://ps-diandioly-notif-relais.<ton-compte>.workers.dev` — le Cron
Trigger (toutes les minutes) est déjà actif, aucune autre action requise.

## Étape 6 — Vérifier que ça fonctionne

1. Connecte-toi à l'application en tant qu'**administrateur** sur un
   téléphone (ou un navigateur desktop), accepte la demande de
   notification. Vérifie dans la console du navigateur (F12) qu'aucune
   erreur `[notif]` n'apparaît.
2. Ferme complètement l'application (ou verrouille le téléphone).
3. Encaisse un ticket ou une vente depuis un autre appareil (rôle
   caissier).
4. Dans la minute qui suit, la notification doit apparaître dans la barre
   de statut du téléphone administrateur — même app fermée.

Pour déclencher le Worker immédiatement sans attendre la minute (utile en
test), appelle :

```
https://ps-diandioly-notif-relais.<ton-compte>.workers.dev/run?secret=<RUN_SECRET>
```

La réponse JSON indique combien de notifications ont été traitées et
envoyées — pratique pour diagnostiquer sans attendre.

## Sécurité

- Le compte de service a un accès complet à la base Firebase (comme le
  SDK Admin) : le fichier JSON téléchargé à l'étape 2 ne doit **jamais**
  être commité ni partagé. Une fois copié dans les secrets Wrangler
  (étape 4), tu peux le supprimer de ton ordinateur.
- Le nœud `fcm_tokens_admin` est volontairement illisible par les
  utilisateurs normaux (`.read: false` dans les règles RTDB recommandées,
  voir `firebase-config.js`) — seul ce Worker y accède, via le compte de
  service qui contourne les règles.
- `RUN_SECRET` protège le déclenchement manuel (`/run`) contre un appel
  public non désiré.

## Coûts

- **Cloudflare Workers** : forfait gratuit = 100 000 requêtes/jour. Ce
  Worker en consomme ~1 440/jour (1/minute) → très large marge.
- **Firebase Cloud Messaging** : gratuit, sans limite, sur tous les
  forfaits (y compris "Spark", le forfait gratuit).
- **Aucun** forfait Firebase "Blaze" n'est nécessaire.
