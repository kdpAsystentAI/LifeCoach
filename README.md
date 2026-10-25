# 🚀 Life Coach (Life OS)

> **Osobiste Centrum Dowodzenia i Mobilny Przewodnik Życiowy**  
> Zgodny z zasadami **Protokołu Świateł** oraz architekturą **Offline-First**.

---

## 📌 Przegląd Projektu

Life Coach to samowystarczalna, mobilna aplikacja internetowa (PWA) zaprojektowana z myślą o żelaznej dyscyplinie, organizacji pracy i celach życiowych:
- **Główny Ekran (Home): Zawsze Aktualna Lista Zadań** — błyskawiczny wgląd w bieżące zadania z podziałem na statusy Protokołu Świateł (🔴 Do zrobienia, 🔵 W toku, 🟡 Oczekuje/Zablokowane, 🟢 Zrobione). Działa w 100% offline, np. w warunkach magazynu bez łączności z siecią.
- **Podstrona: Trener RPG (Life Coach)** — zarchiwizowany, pełny panel grywalizacji i nawyków:
  - System serii dni (Dni Serii 🔥) w stylu Duolingo z Tarczami Serii (Shields).
  - Baza rutyn osobistych: Poranek 🌅 i Wieczór 🌌 (suplementy, leki, ćwiczenia, higiena).
  - Misja Dnia (Focus Biznes) generowana przez AI.
  - Wieczorny Rachunek Sumienia (inteligentny czat asystencki).
  - Dziennik Zwycięstw (5 zwycięstw dziennie).

---

## 🛠️ Architektura Techniczna

- **Frontend:** Vanilla HTML5, CSS3 (nowoczesny design system dark-mode, bezpieczne obszary PWA), czysty JavaScript ES6+.
- **Pamięć i Baza:**
  - **IndexedDB (`LifeCoachDB`)** — główne repozytorium rutyn, zadań, streaka i historii czatu.
  - **LocalStorage Snapshot** — natychmiastowy fallback gwarantujący wyświetlenie zadań przy starcie z zerowym opóźnieniem offline.
  - **Service Worker (`sw.js`)** — Cache-First dla zasobów lokalnych, navigation fallback (`index.html`) przy braku internetu.
- **Backend / Narzędzia lokalne:**
  - `server.py` — lekki serwer HTTP/HTTPS w Pythonie z endpointami synchronizacji stanu (`/sync/save`, `/sync/get`) oraz zadań (`/api/tasks`).
- **Standard Zarządzania:** **Protokół Świateł** (`stan_projektu/cel_i_problem.md`, `stan_projektu/pamiec_robocza.md`, `stan_projektu/tasks.md`).

---

## 🚀 Uruchomienie i Dostęp

### 1. Uruchomienie lokalne na PC / Homelab
```bash
python server.py
# lub z poziomu powłoki bash
./start.sh
```
Aplikacja dostępna pod adresem: `http://localhost:8080` (lub `http://IP_KOMPUTERA:8080`).

### 2. Dostęp mobilny i PWA Offline
- Serwis działa wyłącznie w prywatnej sieci **Tailscale VPN** (Homelab Pop!_OS pod adresem `100.95.73.1:8080` lub PC).
- Hosting publiczny **GitHub Pages został wygaszony** zgodnie z decyzją o 100% prywatności.
- Po dodaniu do ekranu głównego w przeglądarce, aplikacja działa w pełni **OFFLINE w magazynie**.

---

## 📂 Struktura Katalogów

```
03_Life_Coach/
├── stan_projektu/             # Protokół Świateł (SSOT)
│   ├── cel_i_problem.md       # Cel nadrzędny, definicja problemu, kryteria DoD
│   ├── pamiec_robocza.md      # Pamięć operacyjna agentów (Krok 0)
│   ├── tasks.md               # Rejestr zadań ze statusami 🔴/🔵/🟡/🟢
│   └── artefakty/             # Audyty, raporty i analizy
│       └── audyty/
│           └── 2026-10-24_audyt_stanu_projektu.md
├── index.html                 # Główna struktura aplikacji (Home Tasks + Trener RPG Subpage)
├── app.js                     # Rdzeń logiki: stan, zadania, IndexedDB, nawigacja
├── style.css                  # Stylowanie, dark mode, responsywność, PWA
├── ai.js                      # Integracje modeli AI (Gemini, OpenRouter, Cerebras)
├── gdrive.js                  # Opcjonalny sync z Google Drive
├── sw.js                      # Service Worker (Cache-First, PWA Offline)
├── manifest.json              # PWA Manifest (standalone, ikony)
├── server.py                  # Lokalny serwer z endpointami sync i api zadań
└── .gitignore                 # Zabezpieczenie danych wrażliwych i logów
```
