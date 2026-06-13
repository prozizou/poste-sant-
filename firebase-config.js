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
//  ⚠️  ATTENTION : la règle ".read"/".write": "auth != null" ne suffit PAS.
//  Elle autorise N'IMPORTE QUEL utilisateur authentifié (donc un(e) caissier(ère))
//  à lire/écrire TOUTES les données, y compris le stock pharmacie, les rapports,
//  etc., même si l'interface (UI) le lui interdit. Le contrôle de rôle actuel
//  (sessionStorage côté navigateur) n'est qu'un confort d'affichage : il peut
//  être contourné en modifiant le sessionStorage ou en appelant l'API REST
//  Firebase directement.
//
//  RECOMMANDATION : stocker le rôle de chaque utilisateur côté serveur, par ex.
//  dans un nœud "db_users/{uid}/role" écrit UNIQUEMENT par un administrateur
//  (ou via des "custom claims" Firebase Auth), puis écrire des règles RTDB du type :
//
//    {
//      "rules": {
//        "db_pharmacie_stock":   { ".read": "auth != null", ".write": "root.child('db_users').child(auth.uid).child('role').val() === 'admin'" },
//        "db_pharmacie_reappro": { ".read": "auth != null", ".write": "root.child('db_users').child(auth.uid).child('role').val() === 'admin'" },
//        "db_agenda":            { ".read": "auth != null", ".write": "root.child('db_users').child(auth.uid).child('role').val() === 'admin'" },
//        "ticket_dbase":         { ".read": "auth != null", ".write": "auth != null" },
//        "vente_medicaments":    { ".read": "auth != null", ".write": "auth != null" },
//        "compteurs":            { ".read": "auth != null", ".write": "auth != null" },
//        "db_users":             { ".read": "auth != null", ".write": false }
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
