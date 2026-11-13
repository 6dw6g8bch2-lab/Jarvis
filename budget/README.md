# Lionels Budget

Budget-App von Lohn zu Lohn als Web-App (PWA) für den Home-Bildschirm.
Läuft komplett im Browser, offline, ohne Server. Daten liegen nur auf dem Gerät (localStorage), Backup als JSON-Datei.

## Dateien
- `index.html`: Aufbau mit 4 Tabs (Heute, Verlauf, Sparziel, Mehr)
- `styles.css`: Design, Hell- und Dunkelmodus
- `app.js`: Logik (Tagesbudget, Perioden, Apple Pay, Backup)
- `sw.js`: Offline-Cache. Bei Änderungen `CACHE` hochzählen, sonst sieht das iPhone die alte Version.
- `manifest.webmanifest`, `icons/`: App-Name und Icon

## Veröffentlichen
Der Workflow `.github/workflows/pages.yml` stellt den Ordner `budget/` bei jedem Push auf `main` auf GitHub Pages.
