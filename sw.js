// ═══════════════════════════════════════════════════════════════════════
//  sw.js — Service Worker
//  Poste de Santé de Diandioly
//  Stratégie : Cache-First pour assets statiques, Network-First pour données
// ═══════════════════════════════════════════════════════════════════════

const APP_VERSION     = 'v25';
const CACHE_STATIC    = `ps-diandioly-static-${APP_VERSION}`;
const CACHE_DYNAMIC   = `ps-diandioly-dynamic-${APP_VERSION}`;
const CACHE_FONTS     = `ps-diandioly-fonts-${APP_VERSION}`;

// Assets statiques à pré-cacher lors de l'installation
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/firebase-config.js',
  '/accueil/menu_admin.html',
  '/accueil/menu_caissier.html',
  '/accueil/menu_tresorier.html',
  '/facturation/facturation.html',
  '/facturation/style.css',
  '/facturation/script.js',
  '/facturation/escpos-printer.js',
  '/facturation/view-mode.js',
  '/planif_rapport/rapports.html',
  '/planif_rapport/depenses.html',
  '/planif_rapport/rapport-lib.js',
  '/planif_rapport/rapport-print.css',
  '/approvisionnement/stock.html',
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
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Certains assets n\'ont pas pu être mis en cache :', err);
      });
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
  if (STATIC_ASSETS.some((asset) => url.pathname === asset || url.pathname.endsWith(asset.replace('/', '')))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE_STATIC).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        }).catch(() => caches.match('/offline.html'));
      })
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
