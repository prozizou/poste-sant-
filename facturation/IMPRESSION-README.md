# Impression thermique 58mm — POS58B (WebUSB / ESC-POS)

## Ce qui a changé
- **`escpos-printer.js`** (nouveau) : pilote ESC/POS complet, connexion à l'imprimante
  en USB via l'API WebUSB du navigateur. Construit les octets de commande directement
  (gras, tailles, alignement, coupe) — aucune dépendance à `window.print()`.
- **`script.js`** : les deux flux d'encaissement (consultation & médicaments) envoient
  maintenant les données à `imprimerTicket()`, qui utilise l'USB si l'imprimante est
  connectée, sinon retombe automatiquement sur l'ancien `window.print()`.
- **Réimpression** : un bouton 🖨️ apparaît sur chaque ligne des historiques (tickets et
  ventes médicaments) pour renvoyer le même ticket à l'imprimante sans tout ressaisir.
- **`style.css`** : `@page` corrigé à 58mm (au lieu de 80mm), largeur du reçu réduite à
  ~48mm imprimables, police remplacée par une monospace (meilleur alignement des montants).

## Utilisation (côté caissier)
1. Brancher le POS58B en USB à l'ordinateur/tablette.
2. Cliquer sur le badge **"🖨️ Imprimante non connectée"** en haut de la page Facturation.
3. Le navigateur affiche une liste d'appareils USB → choisir l'imprimante → **Connecter**.
4. Le badge passe au vert : **"🖨️ Imprimante connectée (USB)"**. C'est fait pour de bon —
   Chrome retient l'autorisation, la reconnexion se refait toute seule aux prochaines visites
   tant que le câble est branché.
5. Bouton **"🧪 Test"** pour vérifier l'alignement/la largeur avant le premier vrai ticket.

## Limites à connaître
- **Navigateur requis** : WebUSB fonctionne sur Chrome, Edge, Opera (desktop et Android).
  **Safari / iOS ne le supportent pas** — sur ces appareils, l'app retombe automatiquement
  sur `window.print()` (boîte de dialogue navigateur), avec le CSS 58mm corrigé.
- **Accents** : le texte envoyé en ESC/POS est translittéré en ASCII pur (é→e, à→a, etc.)
  car la plupart des clones POS58B gèrent mal l'UTF-8 en direct. C'est un compromis
  volontaire pour garantir un rendu fiable quel que soit le firmware exact de l'imprimante.
- **Coupe automatique** : désactivée par défaut (`PRINTER_CONFIG.hasCutter = false`) car
  la majorité des POS58B "desktop" n'ont pas de massicot — juste une barre à déchirer.
  Si le tien en a un, passer `hasCutter: true` dans `escpos-printer.js`.
- **Largeur de ligne** : 32 caractères par défaut (`PRINTER_CONFIG.lineWidth`). Si le ticket
  de test montre du texte tronqué ou trop de marge, ajuster cette valeur (souvent 32 ou 42
  selon la police interne de l'imprimante).

## Si besoin d'ajuster le format
Tout se règle en tête de `escpos-printer.js` :
```js
export const PRINTER_CONFIG = {
    lineWidth: 32,
    hasCutter: false,
    feedLinesEnd: 4,
};
```
