const CACHE_NAME = 'pianano-v1'
const ASSETS = [
  '/',
  '/index.html',
  '/src/main.js',
  '/src/style.css',
  '/public/songs/index.json',
  '/public/songs/fen_shou_kuai_le.txt',
  '/public/songs/hao_yun_lai.txt',
  '/manifest.webmanifest',
  '/icons/pwa-192.png',
  '/icons/pwa-512.png'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  event.respondWith(
    caches.match(req).then((res) => res || fetch(req))
  )
})