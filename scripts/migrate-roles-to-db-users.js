// ═══════════════════════════════════════════════════════════════════════
//  scripts/migrate-roles-to-db-users.js
//  Poste de Santé de Diandioly — Migration ponctuelle des rôles
//
//  Rôle : recopie chaque compte de "administration/auth_db" (email → rôle,
//  utilisé pour la connexion) vers "db_users/{uid}/role" (utilisé par les
//  RÈGLES DE SÉCURITÉ RTDB, voir database.rules.json — indexé par UID, pas
//  par email, car les règles ne peuvent pas "chercher" un email).
//
//  À exécuter UNE FOIS avant de déployer database.rules.json, puis à
//  chaque fois qu'un nouveau compte est ajouté à "administration/auth_db"
//  (ou directement ajouter son entrée "db_users/{uid}/role" à la main
//  ensuite, ce script n'est qu'un raccourci pratique).
//
//  Usage :
//    cd scripts
//    npm install firebase-admin
//    node migrate-roles-to-db-users.js /chemin/vers/service-account.json
//
//  Le fichier service-account.json s'obtient dans Firebase Console →
//  Paramètres du projet → Comptes de service → Générer une nouvelle clé
//  privée (même fichier que pour les Cloud Functions, voir functions/).
//  Ne JAMAIS le committer (déjà exclu par scripts/.gitignore).
// ═══════════════════════════════════════════════════════════════════════

const path = require('path');

const ROLES_VALIDES = new Set(['admin', 'caissier', 'tresorier', 'icp']);

async function main() {
    const keyPath = process.argv[2];
    if (!keyPath) {
        console.error('Usage : node migrate-roles-to-db-users.js /chemin/vers/service-account.json');
        process.exit(1);
    }

    const admin = require('firebase-admin');
    const serviceAccount = require(path.resolve(keyPath));

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://poste-sante-280b2-default-rtdb.firebaseio.com',
    });

    const db = admin.database();
    const auth = admin.auth();

    console.log('Lecture de administration/auth_db…');
    const snap = await db.ref('administration/auth_db').once('value');
    const entries = [];
    snap.forEach((c) => { entries.push(c.val()); });

    if (!entries.length) {
        console.log('Aucune entrée trouvée dans administration/auth_db — rien à migrer.');
        process.exit(0);
    }
    console.log(`${entries.length} compte(s) trouvé(s). Résolution des UID…\n`);

    let ok = 0, ignores = 0, echecs = 0;
    for (const entry of entries) {
        const email = (entry.email || '').trim().toLowerCase();
        const role = entry.role;

        if (!email || !ROLES_VALIDES.has(role)) {
            console.warn(`⚠️  Ignoré (email ou rôle invalide) : ${JSON.stringify(entry)}`);
            ignores++;
            continue;
        }

        try {
            const userRecord = await auth.getUserByEmail(email);
            await db.ref(`db_users/${userRecord.uid}/role`).set(role);
            console.log(`✅ ${email} → ${role} (uid ${userRecord.uid})`);
            ok++;
        } catch (e) {
            console.error(`❌ ${email} : ${e.message}`);
            echecs++;
        }
    }

    console.log(`\nTerminé : ${ok} migré(s), ${ignores} ignoré(s), ${echecs} échec(s).`);
    process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
