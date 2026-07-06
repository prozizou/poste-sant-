# Impression thermique 58mm — POS58B

## Diagnostic de ton problème (câble/BT non détectés + PDF vide)

**PDF vide** : le PDF que tu as généré fait 595×841pt (= A4), pas 58mm — la
CSS `@page` personnalisée n'est **pas respectée par le pipeline d'impression
natif d'Android**. En plus, l'ancien code vidait la zone du reçu quelques
secondes après avoir appelé `window.print()`, en pensant que l'impression
était terminée. Sur Android, l'événement `afterprint` peut se déclencher
avant que tu aies fini d'interagir avec la boîte de dialogue — donc le
PDF/impression sortait vide. **C'est corrigé** dans cette version : la zone
n'est plus vidée automatiquement.

**Détection USB/Bluetooth qui échoue** : ce n'est pas (seulement) un bug de
code, ce sont des limites de plateforme :
- **Bluetooth** : le POS58B utilise le Bluetooth "classique" (profil SPP).
  L'API Web Bluetooth des navigateurs ne sait parler qu'au Bluetooth basse
  énergie (BLE). Aucune page web ne peut donc se connecter à ce genre
  d'imprimante en Bluetooth, quel que soit le code — il faut une app native.
- **USB (WebUSB)** : sur Android, si le téléphone a déjà un service système
  qui "réserve" l'interface USB de l'imprimante (service d'impression
  générique, pilote Mopria, etc.), Chrome ne peut pas la voir dans la liste
  WebUSB. Sur PC (Windows), c'est souvent le pilote générique Windows qui
  bloque l'accès (voir plus bas).

## La solution robuste retenue : RawBT

Puisque tu es sur Android, la solution la plus fiable est l'app gratuite
**RawBT ESC/POS** (Google Play, éditeur "a402d"). Elle gère elle-même la
connexion Bluetooth/USB à l'imprimante — la page web ne fait que lui envoyer
les données via un lien `intent://`, ce qui contourne toutes les limites
ci-dessus.

### Mise en place
1. Installer **RawBT ESC/POS** depuis le Play Store.
2. Ouvrir RawBT → appairer/sélectionner le POS58B (Bluetooth ou USB, au choix
   dans l'app) → faire un test d'impression depuis RawBT lui-même pour
   confirmer que la connexion marche.
3. Dans Facturation, en haut à droite, mettre le sélecteur sur **"RawBT
   (Android)"**.
4. Cliquer **🧪 Test** : Chrome va demander l'autorisation d'ouvrir RawBT →
   autoriser. Le ticket de test doit sortir sur l'imprimante.
5. Si un ticket ne s'imprime qu'à moitié ou avec des caractères bizarres,
   régler `lineWidth` dans `escpos-printer.js` (essayer 32 puis 42).

## Les 3 méthodes disponibles (sélecteur en haut à droite)
| Méthode | Quand l'utiliser | Fiabilité |
|---|---|---|
| **RawBT** | Android, BT ou USB, POS58B non reconnu par WebUSB | ⭐⭐⭐ recommandé pour ton cas |
| **USB (WebUSB)** | PC desktop (Chrome/Edge), câble USB direct | ⭐⭐⭐ sur PC, ⭐ variable sur Android |
| **Navigateur** | Secours si rien d'autre ne marche, ou Safari/iOS | ⭐ taille papier non garantie |

## Si tu veux quand même faire marcher le WebUSB direct (sans RawBT)
- **Sur PC Windows** : Windows installe souvent un pilote générique qui
  "capture" l'imprimante avant que Chrome ne puisse y accéder. Il faut
  remplacer ce pilote par WinUSB avec l'outil **Zadig** (zadig.akeo.ie) pour
  l'interface USB du POS58B, puis réessayer "Connecter USB" dans l'app.
- **Sur Android** : vérifier qu'aucun "service d'impression" par défaut
  (Paramètres → Impression) n'a déjà la main sur l'imprimante ; le
  désactiver temporairement peut suffire. Résultat non garanti selon le
  téléphone — RawBT reste la voie recommandée sur mobile.

## Limites à connaître (inchangées)
- **Accents** : translittérés en ASCII pur (é→e, à→a…) pour un rendu fiable
  quel que soit le firmware du POS58B.
- **Coupe automatique** : désactivée par défaut (la plupart des POS58B
  "desktop" n'ont pas de massicot). `PRINTER_CONFIG.hasCutter = true` dans
  `escpos-printer.js` si le tien en a un.
- **Largeur de ligne** : 32 caractères par défaut (`PRINTER_CONFIG.lineWidth`).

