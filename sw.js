// ═══════════════════════════════════════════════════════════════════════
//  sw.js — Service Worker
//  Poste de Santé de Diandioly
//  Stratégie : Cache-First pour assets statiques, Network-First pour données
// ═══════════════════════════════════════════════════════════════════════

const APP_VERSION     = 'v73-corbeille-motif-20261025';
const CACHE_STATIC    = `ps-diandioly-static-${APP_VERSION}`;
const CACHE_DYNAMIC   = `ps-diandioly-dynamic-${APP_VERSION}`;
const CACHE_FONTS     = `ps-diandioly-fonts-${APP_VERSION}`;

// ── Firebase Cloud Messaging : notifications même application fermée ───
// Un Service Worker « classique » (non-module) ne peut pas importer le
// module ES firebase-config.js — on duplique donc ici sa configuration
// publique (ces clés sont de toute façon exposées côté client ; la
// sécurité réelle repose sur les règles RTDB, voir firebase-config.js).
// En cas d'échec (hors-ligne à l'installation, navigateur trop ancien…),
// le reste du Service Worker (cache PWA) continue de fonctionner : voir
// notifications-admin.js pour le chemin temps réel (app ouverte), et
// api/notifier.js pour l'envoi effectif de ces messages FCM (fonction Vercel).
try {
  importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey:            "AIzaSyAN_XP-qqacK5P0HZZ-VWaqpEHHaCXvqOI",
    authDomain:        "poste-sante-280b2.firebaseapp.com",
    databaseURL:       "https://poste-sante-280b2-default-rtdb.firebaseio.com",
    projectId:         "poste-sante-280b2",
    storageBucket:     "poste-sante-280b2.firebasestorage.app",
    messagingSenderId: "204790038326",
    appId:             "1:204790038326:web:8a24c27204e296de577d97",
  });
  const messaging = firebase.messaging();

  // La fonction Vercel (api/notifier.js) envoie des messages « data-only » (jamais
  // de champ "notification" côté FCM) : c'est ce gestionnaire qui construit
  // et affiche lui-même la notification, avec les mêmes boutons d'action que
  // le chemin temps réel — le même "tag" (voir notifications-admin.js) évite
  // un doublon si les deux chemins se déclenchent pour le même événement.
  messaging.onBackgroundMessage((payload) => {
    const d = payload.data || {};
    self.registration.showNotification(d.title || 'Poste de santé', {
      body: 'Nouvelle opération de caisse. Ouvrez l’application pour consulter les détails.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      tag: d.tag || ('caisse-' + (d.nkey || Date.now())),
      data: { type: d.type, key: d.key, nkey: d.nkey },
      // Une opération déjà annulée n'a plus de bouton « Annuler ».
      actions: d.action === 'annulation'
        ? [{ action: 'voir', title: 'Voir le détail' }]
        : [{ action: 'annuler', title: 'Annuler et retourner' },
           { action: 'voir',    title: 'Voir le détail' }],
    });
  });
} catch (e) {
  console.warn('[SW] Firebase Messaging indisponible :', e);
}

// Assets statiques à pré-cacher lors de l'installation
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/firebase-config.js',
  '/role-server.js',
  '/village-client.js',
  '/access-panel.css',
  '/accueil/menu_superadmin.html',
  '/accueil/equipe.html',
  '/pharmacie-client.js',
  '/notifications-admin.js',
  '/push-relay.js',
  '/accueil/menu_admin.html',
  '/accueil/menu_caissier.html',
  '/accueil/menu_tresorier.html',
  '/accueil/menu_icp.html',
  '/facturation/facturation.html',
  '/facturation/style.css',
  '/facturation/script.js',
  '/facturation/escpos-printer.js',
  '/facturation/view-mode.js',
  '/facturation/wizard.js',
  '/planif_rapport/rapports.html',
  '/planif_rapport/depenses.html',
  '/planif_rapport/rapport-lib.js',
  '/planif_rapport/rapport-print.css',
  '/approvisionnement/stock.html',
  '/approvisionnement/medoc-image.js',
  '/annulation/annulation.html',
  '/offline.html',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Domaines Firebase (toujours réseau — jamais mis en cache)
const FIREBASE_DOMAINS = [
  'firebaseio.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'googleapis.com',
  'gstatic.com'
];

// ── Installation : pré-cache des assets statiques ──────────────────────
self.addEventListener('install', (event) => {
  console.log(`[SW ${APP_VERSION}] Installation...`);
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      console.log(`[SW] Pré-cache des assets statiques`);
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── Activation : nettoyage des anciens caches ──────────────────────────
self.addEventListener('activate', (event) => {
  console.log(`[SW ${APP_VERSION}] Activation...`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) =>
            name.startsWith('ps-diandioly-') &&
            name !== CACHE_STATIC &&
            name !== CACHE_DYNAMIC &&
            name !== CACHE_FONTS
          )
          .map((name) => {
            console.log(`[SW] Suppression ancien cache : ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch : stratégies de cache selon la ressource ────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // 2. Firebase → toujours réseau (données temps réel)
  if (FIREBASE_DOMAINS.some((d) => url.hostname.includes(d))) {
    event.respondWith(fetch(request));
    return;
  }

  // 3. Google Fonts → Cache-First avec fallback réseau
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_FONTS).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // 4. Assets statiques → Cache-First
  if (url.origin === self.location.origin && STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      fetch(request).then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE_STATIC).then((cache) => cache.put(request, response.clone()));
          }
          return response;
      }).catch(async () => (await caches.match(request)) || caches.match('/offline.html'))
    );
    return;
  }

  // 5. Reste → Network-First avec fallback cache puis offline
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          caches.open(CACHE_DYNAMIC).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) =>
          cached || caches.match('/offline.html')
        )
      )
  );
});

// ── Message : forcer la mise à jour depuis le client ──────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Notifications caisse : clic sur la notification ou sur une action ──
// Émises par notifications-admin.js (app ouverte) ou par le push FCM
// (app fermée) à chaque opération de caisse. Le bouton d'action « Annuler et
// retourner » ouvre directement la fiche d'annulation correspondante ;
// un clic simple sur la notification ouvre le détail en lecture seule.
self.addEventListener('notificationclick', (event) => {
  const notif = event.notification;
  const data  = notif.data || {};
  notif.close();

  let url = '/accueil/menu_admin.html';
  if (data.type && data.key) {
    const param = event.action === 'annuler' ? 'annuler' : 'voir';
    url = `/annulation/annulation.html?${param}=${encodeURIComponent(data.type)}&key=${encodeURIComponent(data.key)}`;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) return client.navigate(url);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
