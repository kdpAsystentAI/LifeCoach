/* ==========================================================================
   LIFE COACH - SERVICE WORKER (Offline support - v29)
   Zoptymalizowany pod niezawodną pracę offline (np. w magazynie).
   ========================================================================== */

const CACHE_NAME = 'life-coach-cache-v31';

const LOCAL_ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'gdrive.js',
  'ai.js',
  'manifest.json',
  'tasks.json',
  'icon-192.png',
  'icon-512.png'
];

const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
];

// Install Event - Pre-cache all core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.log('[SW v30] Caching local core assets...');
        // 1. Mandatory local assets
        await Promise.all(
          LOCAL_ASSETS.map(url => 
            cache.add(new Request(url, { cache: 'reload' })).catch(err => {
              console.warn(`[SW v30] Failed to cache local asset: ${url}`, err);
            })
          )
        );

        // 2. Non-blocking external assets
        Promise.allSettled(
          EXTERNAL_ASSETS.map(url => cache.add(url))
        ).catch(() => {});
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Clean old caches & claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW v28] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Full Offline Support
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // 1. Navigation requests (Opening the app from shortcut or address bar)
  // MUST NEVER fail with Dino offline!
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true })
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Update cache in background if online
            fetch(event.request)
              .then((netRes) => {
                if (netRes && netRes.status === 200) {
                  caches.open(CACHE_NAME).then(c => c.put(event.request, netRes));
                }
              })
              .catch(() => {});
            return cachedResponse;
          }
          // Fallback to cached index.html or root
          return caches.match('index.html')
            .then(indexRes => indexRes || caches.match('./'))
            .then(fallbackRes => {
              if (fallbackRes) return fallbackRes;
              return fetch(event.request);
            });
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // 2. tasks.json (Static snapshot for GitHub Pages & warehouse offline)
  if (url.includes('tasks.json')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          console.log('[SW v28] Serving tasks.json from cache (Offline in warehouse)');
          return caches.match('tasks.json')
            .then(res => res || caches.match(event.request, { ignoreSearch: true }));
        })
    );
    return;
  }

  // 3. API Tasks Sync - Network-First with Cache fallback
  if (url.includes('/api/tasks')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          console.log('[SW v28] Serving /api/tasks from cache (Offline in warehouse)');
          return caches.match(event.request, { ignoreSearch: true });
        })
    );
    return;
  }

  // 4. Google Fonts & Static Assets - Cache-First
  const isGoogleFont = url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com');
  if (isGoogleFont) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => cachedResponse);
      })
    );
    return;
  }

  // 5. Default: Cache-First for all local files (with ignoreSearch: true for versioned ?v=28 tags)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // Background revalidate
        fetch(event.request).then((netRes) => {
          if (netRes && netRes.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, netRes));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return networkResponse;
      });
    })
  );
});
