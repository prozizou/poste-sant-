# Relais de notifications push — Cloud Function

Cette Cloud Function est la pièce qui manque pour que les notifications de
caisse s'affichent **dans la barre de statut du téléphone, même quand
l'application est complètement fermée**. Elle se déclenche automatiquement
et quasi instantanément (pas de polling) à chaque encaissement.

## Comment ça marche

```
Caissier(ère) encaisse
        │
        ▼
Firebase RTDB : notifications_caisse (déjà en place)
        │
        │  déclenchement automatique (~1-2 secondes)
        ▼
Cette Cloud Function
   1. lit les appareils admin enregistrés (fcm_tokens_admin)
   2. envoie un push via Firebase Cloud Messaging (FCM)
        │
        ▼
Téléphone de l'administrateur(rice) — notification dans la barre de
statut, même app fermée, avec le bouton "Annuler et retourner"
```

## ⚠️ Prérequis : le forfait "Blaze"

Les Cloud Functions ne se déploient **pas** sur le forfait gratuit
"Spark" — il faut passer au forfait **"Blaze"** (paiement à l'usage) :

Firebase Console → ton projet → ⚙️ (en bas à gauche) → **Utilisation et
facturation** → **Modifier le forfait** → **Blaze**.

Pour le volume d'un petit poste de santé (quelques dizaines
d'encaissements par jour), la facture réelle restera quasiment toujours à
**0 F** : Blaze inclut le même quota gratuit que Spark (2 millions
d'invocations de fonctions par mois, etc.), il faut juste une carte
bancaire enregistrée pour au-delà de ce quota. Aucun prélèvement tant que
tu restes dans le quota gratuit.

## Étape 1 — Clé VAPID (déjà faite ✓)

Déjà renseignée dans `notifications-admin.js`.

## Étape 2 — Installer les outils Firebase

```bash
npm install -g firebase-tools     # ou : npx firebase-tools (sans installation globale)
firebase login                    # ouvre le navigateur pour te connecter
```

## Étape 3 — Installer les dépendances de la fonction

```bash
cd functions
npm install
cd ..
```

## Étape 4 — Déployer

```bash
firebase deploy --only functions
```

(La première fois, Firebase peut demander de confirmer le projet — il est
déjà fixé dans `.firebaserc` sur `poste-sante-280b2`.)

## Étape 5 — Vérifier que ça fonctionne

1. Connecte-toi à l'application en tant qu'**administrateur** sur un
   téléphone, accepte la demande de notification.
2. Ferme complètement l'application (ou verrouille le téléphone).
3. Encaisse un ticket ou une vente depuis un autre appareil (rôle
   caissier).
4. La notification doit apparaître dans la barre de statut en quelques
   secondes — même app fermée.

Pour suivre ce qui se passe côté serveur :

```bash
firebase functions:log
```

## Sécurité

- Le nœud `fcm_tokens_admin` reste illisible par les utilisateurs normaux
  (`.read: false` dans les règles RTDB recommandées, voir
  `firebase-config.js`) — seule cette Cloud Function y accède (le SDK
  Admin qu'elle utilise contourne les règles, comme un accès serveur).
- Aucun secret à gérer manuellement : la Cloud Function s'authentifie
  automatiquement avec les identifiants du projet Firebase (contrairement
  à un serveur externe, pas de compte de service à télécharger ni de
  clé privée à copier quelque part).

## Coûts

- **Cloud Functions (2ᵉ génération)** : 2 millions d'invocations
  gratuites par mois, largement suffisant (quelques dizaines/jour ici).
- **Firebase Cloud Messaging** : gratuit, sans limite.
- Le forfait Blaze reste à 0 F tant que ces quotas ne sont pas dépassés.
