// ═══════════════════════════════════════════════════════════════════════
//  firebase-config.js — Configuration Firebase
//  Poste de Santé de Diandioly
//  ✅ MIGRÉ : Firestore → Realtime Database (RTDB)
// ═══════════════════════════════════════════════════════════════════════
//
//  ⚠️  IMPORTANT – SÉCURITÉ :
//  Ces clés sont exposées côté client (comportement normal pour Firebase).
//  La sécurité réelle repose sur les RÈGLES RTDB & AUTHENTICATION.
//
//  Règles Realtime Database recommandées (Firebase Console > RTDB > Rules) :
//
//    {
//      "rules": {
//        ".read":  "auth != null",
//        ".write": "auth != null"
//      }
//    }
//
//  Règles Authentication recommandées :
//  - Activer uniquement Email/Password dans Firebase Console
//  - Activer la protection "App Check" pour les environnements de production
//  - Limiter les domaines autorisés dans Authentication > Settings
//
//  ⚠️  IMPORTANT – databaseURL :
//  Remplacez "poste-sante-280b2-default-rtdb" par votre ID RTDB réel.
//  Vous le trouvez dans Firebase Console > Realtime Database > URL de la base.
//  Format : https://<projet>-default-rtdb.firebaseio.com
//
// ═══════════════════════════════════════════════════════════════════════

import { initializeApp }     from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAnalytics }      from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";
import { getDatabase }       from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { getAuth }           from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey:            "AIzaSyAN_XP-qqacK5P0HZZ-VWaqpEHHaCXvqOI",
    authDomain:        "poste-sante-280b2.firebaseapp.com",
    // ⚠️ Remplacez cette URL par celle de votre base RTDB (Firebase Console > Realtime Database)
    databaseURL:       "https://poste-sante-280b2-default-rtdb.firebaseio.com",
    projectId:         "poste-sante-280b2",
    storageBucket:     "poste-sante-280b2.firebasestorage.app",
    messagingSenderId: "204790038326",
    appId:             "1:204790038326:web:8a24c27204e296de577d97",
    measurementId:     "G-FVSGF6X7D1"
};

// Initialisation des services Firebase
const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);       // Google Analytics
const db        = getDatabase(app);        // ✅ Realtime Database
const auth      = getAuth(app);            // Authentification

// Noeuds RTDB utilisés dans l'application
//   db_pharmacie_stock    → inventaire des médicaments
//   db_pharmacie_sorties  → journal des délivrances
//   db_pharmacie_reappro  → journal des réapprovisionnements
//   db_patients           → dossiers patients
//   db_consultations      → consultations médicales
//   db_suivi_vulnerables  → suivis CPN / Vaccination / Planning familial
//   db_agenda             → rendez-vous

export { app, db, auth, analytics };
