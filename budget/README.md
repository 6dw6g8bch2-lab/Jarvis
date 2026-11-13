# Lionels Budget

Budget-App von Lohn zu Lohn als Web-App (PWA) für den Home-Bildschirm.
Läuft komplett im Browser, offline, ohne Server. Daten liegen nur auf dem Gerät (localStorage), Backup als JSON-Datei.

## Sparziel und Tagesbudget
Ist der Sparplan übernommen, reserviert die App die monatliche Sparrate im Tagesbudget, so wie offene Fixkosten.
Eine Überweisung aufs Sparkonto wird als Kategorie «Sparen» eingetragen: Sie senkt den Kontostand, zählt aber nicht als Ausgabe und erhöht das Gesparte.

## Abgleich zwischen Geräten
`sync.js` verschlüsselt die Daten im Browser (AES-GCM, Schlüssel aus dem Passwort) und legt sie als geheimes GitHub-Gist ab.
Zusammengeführt wird pro Zahlung (neuere Änderung gewinnt, Löschungen werden 90 Tage gemerkt), Einstellungen und Sparplan gewinnt die letzte Änderung.
Token und Passwort liegen nur im localStorage des jeweiligen Geräts.

## Dateien
- `index.html`: Aufbau mit 4 Tabs (Heute, Verlauf, Sparziel, Mehr)
- `styles.css`: Design, Hell- und Dunkelmodus
- `app.js`: Logik (Tagesbudget, Perioden, Apple Pay, Backup)
- `sw.js`: Offline-Cache. Bei Änderungen `CACHE` hochzählen, sonst sieht das iPhone die alte Version.
- `manifest.webmanifest`, `icons/`: App-Name und Icon

## Veröffentlichen
Der Workflow `.github/workflows/pages.yml` stellt den Ordner `budget/` bei jedem Push auf `main` auf GitHub Pages.
