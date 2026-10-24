/* ==========================================================================
   LIFE COACH - GOOGLE DRIVE SYNC MANAGER (OAuth2 / drive.file Scope)
   ========================================================================== */

let googleToken = null;
let googleTokenExpires = 0;
let tokenClient = null;
let driveFolderId = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  // Bind Google Settings UI elements
  document.getElementById('save-client-id-btn').addEventListener('click', saveGoogleClientId);
  document.getElementById('google-login-btn').addEventListener('click', handleGoogleLogin);
  document.getElementById('google-logout-btn').addEventListener('click', handleGoogleLogout);
  document.getElementById('sync-now-btn').addEventListener('click', triggerSync);

  // Load saved configurations after DB is guaranteed to be ready
  if (typeof db !== 'undefined' && db !== null) {
    await loadGoogleConfig();
  } else {
    window.addEventListener('db-ready', async () => {
      await loadGoogleConfig();
    });
  }
});

// Load Client ID and sync status from IndexedDB
async function loadGoogleConfig() {
  const savedClientIdObj = await dbGet('preferences', 'google_client_id');
  if (savedClientIdObj && savedClientIdObj.value) {
    document.getElementById('google-client-id-input').value = savedClientIdObj.value;
    initTokenClient(savedClientIdObj.value);
  }

  // Load cached token if still valid
  const savedTokenObj = await dbGet('preferences', 'google_access_token');
  const savedExpiresObj = await dbGet('preferences', 'google_token_expires');
  
  if (savedTokenObj && savedExpiresObj) {
    const now = Date.now();
    if (now < savedExpiresObj.value) {
      googleToken = savedTokenObj.value;
      googleTokenExpires = savedExpiresObj.value;
      updateSyncStatusUI(true, 'Połączono. Sesja aktywna.');
      document.getElementById('sync-now-btn').disabled = false;
    }
  }

  // Load last sync time
  const lastSyncObj = await dbGet('preferences', 'gdrive_last_sync');
  if (lastSyncObj && lastSyncObj.value) {
    updateSyncTimeUI(lastSyncObj.value);
  }
}

// Save Google Client ID
async function saveGoogleClientId() {
  const clientId = document.getElementById('google-client-id-input').value.trim();
  if (!clientId) {
    alert('Podaj poprawny Client ID.');
    return;
  }
  await dbPut('preferences', { key: 'google_client_id', value: clientId });
  
  // Show save confirmation status
  const statusMsg = document.getElementById('client-id-status-el');
  statusMsg.classList.remove('hidden');
  setTimeout(() => statusMsg.classList.add('hidden'), 3000);

  // Re-initialize token client
  initTokenClient(clientId);
}

// Initialize GSI Client
function initTokenClient(clientId) {
  if (typeof google === 'undefined') {
    console.error('Google client API is not loaded yet.');
    return;
  }
  
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events.readonly',
    callback: async (tokenResponse) => {
      if (tokenResponse.error !== undefined) {
        console.error('GIS authentication error:', tokenResponse.error);
        updateSyncStatusUI(false, 'Błąd autoryzacji: ' + tokenResponse.error);
        return;
      }
      
      // Save Access Token & Expiration
      googleToken = tokenResponse.access_token;
      googleTokenExpires = Date.now() + (parseInt(tokenResponse.expires_in) * 1000);
      
      await dbPut('preferences', { key: 'google_access_token', value: googleToken });
      await dbPut('preferences', { key: 'google_token_expires', value: googleTokenExpires });
      
      updateSyncStatusUI(true, 'Połączono z kontem Google!');
      document.getElementById('sync-now-btn').disabled = false;
      
      // Auto-trigger sync on login
      triggerSync();
    },
  });
}

// Handle Google Login Button Click
function handleGoogleLogin() {
  const clientId = document.getElementById('google-client-id-input').value.trim();
  if (!clientId) {
    alert('Przed zalogowaniem musisz podać i zapisać swój Google Client ID w ustawieniach!');
    return;
  }

  // Always re-initialize to ensure we use the current input value
  initTokenClient(clientId);

  if (tokenClient) {
    // Force account selection + consent — prevents getting stuck on wrong account
    tokenClient.requestAccessToken({ prompt: 'select_account consent' });
  } else {
    alert('Nie udało się zainicjalizować klienta Google. Sprawdź poprawność Client ID.');
  }
}

// Handle Google Logout
async function handleGoogleLogout() {
  // Revoke the token at Google so next login shows account picker
  if (googleToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${googleToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      console.log('Google token revoked successfully.');
    } catch (e) {
      console.warn('Failed to revoke token:', e);
    }
  }
  
  googleToken = null;
  googleTokenExpires = 0;
  await dbDelete('preferences', 'google_access_token');
  await dbDelete('preferences', 'google_token_expires');
  
  updateSyncStatusUI(false, 'Status: Odłączono konto Google');
  document.getElementById('sync-now-btn').disabled = true;
  showBannerNotification('Odłączono konto Google. Przy ponownym logowaniu wybierz odpowiednie konto.');
}

// --- REST API HELPER FUNCTIONS (Direct fetch calls) ---
async function fetchGDrive(endpoint, options = {}) {
  if (!googleToken || Date.now() > googleTokenExpires) {
    updateSyncStatusUI(false, 'Sesja wygasła. Połącz się ponownie.');
    document.getElementById('sync-now-btn').disabled = true;
    throw new Error('Google token expired or invalid.');
  }

  if (!options.headers) {
    options.headers = {};
  }
  options.headers['Authorization'] = `Bearer ${googleToken}`;
  options.headers['Accept'] = 'application/json';

  const response = await fetch(endpoint, options);
  if (!response.ok) {
    const errText = await response.text();
    console.error(`Google API error (${response.status}):`, errText);
    throw new Error(`Google API error: ${response.status} - ${errText}`);
  }
  return response;
}

// Search for directory ID
async function searchFolderId(folderName) {
  const query = encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const response = await fetchGDrive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`);
  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

// Create directory
async function createFolder(folderName) {
  const response = await fetchGDrive('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
  const data = await response.json();
  return data.id;
}

// Get files inside a directory
async function getFilesInFolder(folderId) {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const response = await fetchGDrive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`);
  const data = await response.json();
  return data.files || [];
}

// Download file contents as text
async function downloadFileContent(fileId) {
  const response = await fetchGDrive(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return await response.text();
}

// Create a file in folder
async function createMarkdownFile(folderId, fileName, content) {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'text/markdown'
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: 'text/markdown' }));

  const response = await fetchGDrive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    body: form
  });
  const data = await response.json();
  return data.id;
}

// Search for file ID by name inside a folder
async function searchFileInFolder(folderId, fileName) {
  const query = encodeURIComponent(`'${folderId}' in parents and name='${fileName}' and trashed=false`);
  const response = await fetchGDrive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`);
  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

// Update existing file content
async function updateMarkdownFile(fileId, content) {
  const response = await fetchGDrive(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'text/markdown'
    },
    body: new Blob([content], { type: 'text/markdown' })
  });
  const data = await response.json();
  return data.id;
}

// Create or update a file seamlessly
async function createOrUpdateMarkdownFile(folderId, fileName, content) {
  const fileId = await searchFileInFolder(folderId, fileName);
  if (fileId) {
    return await updateMarkdownFile(fileId, content);
  } else {
    return await createMarkdownFile(folderId, fileName, content);
  }
}

// --- OFFLINE QUEUE ENGINE ---
// Queue offline writes
function queueOfflineDriveWrite(fileName, content) {
  let queue = [];
  const existingQueue = localStorage.getItem('gdrive_offline_queue');
  if (existingQueue) {
    try { queue = JSON.parse(existingQueue); } catch(e) {}
  }
  // Remove existing entries for this file to keep only the latest
  queue = queue.filter(item => item.fileName !== fileName);
  queue.push({ fileName, content, timestamp: Date.now() });
  localStorage.setItem('gdrive_offline_queue', JSON.stringify(queue));
  console.log(`Zapisano ${fileName} do kolejki offline.`);
}

// Flush queue when online
async function flushGDriveOfflineQueue() {
  if (!navigator.onLine) return;
  const existingQueue = localStorage.getItem('gdrive_offline_queue');
  if (!existingQueue) return;
  
  let queue = [];
  try { queue = JSON.parse(existingQueue); } catch(e) { return; }
  if (queue.length === 0) return;

  if (!googleToken || Date.now() > googleTokenExpires) {
    return; // Wait until authenticated
  }
  
  try {
    if (!driveFolderId) {
      driveFolderId = await searchFolderId('[LifeCoach_Data]');
      if (!driveFolderId) return; // Folder not found
    }

    console.log('Rozpoczynam zrzucanie kolejki offline do Dysku Google...');
    for (const item of queue) {
      await createOrUpdateMarkdownFile(driveFolderId, item.fileName, item.content);
      console.log(`Pomyślnie zsynchronizowano z Dyskiem plik z kolejki: ${item.fileName}`);
    }
    // Clear queue after success
    localStorage.removeItem('gdrive_offline_queue');
  } catch (error) {
    console.error('Błąd podczas czyszczenia kolejki offline:', error);
  }
}

// Attach flush to window online event
window.addEventListener('online', flushGDriveOfflineQueue);

// --- ACTUAL SYNC COORDINATOR ---
async function triggerSync() {
  const syncBtn = document.getElementById('sync-now-btn');
  syncBtn.disabled = true;
  const container = document.querySelector('.app-container');
  if (container) container.classList.add('is-loading');
  
  updateSyncStatusUI(true, 'Synchronizacja w toku...');
  showBannerNotification('Rozpoczęto synchronizację z Dyskiem Google... <span class="spinner"></span>');

  try {
    const folderName = '[LifeCoach_Data]';
    
    // Define templates outside folder creation to allow checking/creating them during normal sync
    const defaultContextContent = `# Mój Kontekst Życiowy
(Edytuj ten plik na Dysku Google gdy coś się zmieni — AI czyta go przy każdym generowaniu zadań)

## Kim jestem
- Wojciech, 27 lat. Żona Karolina, 28 lat.
- Mieszkamy w Olsztynie, szykujemy się do powrotu do Niemiec (rejon Drezno/Lipsk).
- Karolina czeka na nowy dowód osobisty (~30 dni od złożenia).
- Oboje szukamy pracy na tę samą zmianę (produkcja/magazyn/operator maszyn).
- Doświadczenie: magazyn (Edeka, Rewe, GXO), wózek widłowy EPT/OPT.
- Karolina: niemiecki B1, doświadczenie hotelowe 5* w Niemczech.

## Zdrowie i leki
- Dulsevia (antydepresant) — KRYTYCZNE: pominięcie powoduje "brain zaps". Biorę wieczorem (19:30).
- Suplementy rozbite na porcje:
  - Kreatyna o 13:00 (po treningu, z dużą ilością wody).
  - Omega-3 po głównym posiłku (OMAD) dla poprawnego wchłaniania.
  - Magnez i Potas wieczorem o 20:30 (wsparcie snu i regeneracji).
- Dieta: keto + OMAD (One Meal A Day). Elektrolity (sól, magnez) krytyczne.
- Problemy skórne: sucha skóra pod oczami, łuszczenie. Stosuję krem pod oczy rano (12:15) i wieczorem (21:30) dla ciągłej odbudowy barierowej.
- Kontuzja: dolny odcinek kręgosłupa + kość ogonowa. Ćwiczenia = rehab, nie siłownia.
- Trening: Fitatu (aplikacja na telefonie). Dziennik Zwycięstw (5 wygranych dziennie, metoda Mazura/Friselli).

## Moje automatyczne skrypty Python
WAŻNE: Nie każ mi robić tego, co robią skrypty! Każ mi DZIAŁAĆ na ich wynikach.

| Skrypt | Co robi | Output | Status |
|--------|---------|--------|--------|
| scout.py | Szuka zleceń freelance na Useme.com (tłumaczenia CV PL→DE) | docs/scout_leads.md | ZEPSUTY — wymaga naprawy |
| fb_scout.py | Skanuje grupy FB "Polacy w Niemczech" pod kątem osób potrzebujących CV | docs/fb_leads.md | ZEPSUTY — wymaga naprawy |
| generuj_drafty.py | Generuje gotowe listy motywacyjne z pliku oferty.md | Robocze/DO_WYSLANIA_*.md | Działa — drafty wymagają weryfikacji CEO |
| wyslij_szablony.py | Interaktywnie wysyła drafty — użytkownik zatwierdza/odrzuca każdy | Gmail draft lub wysyłka | Działa |
| send_application.py | Wysyła aplikacje mailowo przez Gmail API (załącza CV obojga) | Aktualizuje oferty.md | Działa |

ZASADA: Interakcja na FB MUSI być RĘCZNA (zakaz automatycznych odpowiedzi — §3 zasad operacyjnych).

## Tryb dnia
- Budzę się ok. 11:00-12:00 (chcę to zmienić, ale na razie tak jest).
- Poranne rutyny od ~12:00.
- Kreatyna o 13:00.
- Omega-3 po OMAD (~17:00).
- Wieczorne leki i suplementy od 19:30.
- Dziennik Zwycięstw o 22:00.

## Finanse
- Budżet na AI/narzędzia: 0 PLN. Tylko darmowe API (Gemini Flash).
- IBKR: 29k EUR — NIE RUSZAĆ (emerytalne).
`;

    const defaultProjectsContent = `# Moje Aktywne Projekty (limit: 3)

## Priorytet 1: KarolinaMercedes
Status: ZABLOKOWANY: czekam na odpowiedź komornika (wysłany mail)
Opis: Rozwiązanie długów Karoliny (EPU, komornik, niemiecki Kfz-Steuer)
Następny krok gdy odblokowany: sprawdzić status na portalu PISP, odpowiedzieć na pismo komornika

## Priorytet 2: Praca w Niemczech (Festanstellung)
Status: AKTYWNY
Cel: bezpośrednie zatrudnienie dla obojga (Wojciech+Karolina) w rejonie Drezno/Lipsk, ta sama zmiana
Stan: CV (Lebenslauf) GOTOWE dla obojga. Gotowe drafty aplikacji w folderze Robocze/. TRZEBA JE Weryfikować i WYSYŁAĆ.
Firmy docelowe: GlobalFoundries (cleanroom), VW Zwickau, DREMO, iperdi, AutoVision
Bloker: Karolina czeka na nowy dowód (~30 dni). Szukamy też Monteurzimmer (zakwaterowanie).

## Priorytet 3: CV Generator (biznes usługowy)
Status: AKTYWNY
Cel: pozyskanie klientów na usługę profesjonalnego tłumaczenia CV (PL→DE) dla Polaków w Niemczech
Stan: Produkt GOTOWY (web_gui.py, pdf_renderer.py, szablony). Brak klientów. Trzeba budować markę eksperta na grupach FB i pozyskać zlecenia z Useme/Fiverr.
`;
      
    const defaultPracaContent = `# Praca w Niemczech (Festanstellung)

Cel: bezpośrednie zatrudnienie jako operator maszyn/magazynier w systemie zmianowym, razem z Karoliną.

## Pipeline (jak wygląda proces)
1. generuj_drafty.py generuje listy motywacyjne z pliku oferty.md → gotowe drafty lądują w Robocze/
2. Użytkownik (jako CEO/Nadzorca) WERYFIKUJE drafty — ocenia jakość, zleca poprawki agentowi, dopiero potem wysyła
3. wyslij_szablony.py pozwala interaktywnie przejrzeć i wysłać każdy draft (lub stworzyć draft w Gmailu)
4. send_application.py wysyła maile bezpośrednio z załączonymi CV (obojga)

## Zadania do wykonania
- [ ] Zweryfikuj i popraw 1 draft aplikacji z folderu Robocze/ (jako CEO — ocen jakość, zleć poprawki jeśli trzeba)
- [ ] Sprawdź status wysłanych aplikacji w pliku oferty.md
- [ ] Szukaj Monteurzimmer (zakwaterowanie pracownicze) w rejonie Drezno/Lipsk
- [ ] Sprawdź nowe oferty na stronach: GlobalFoundries careers, VW Zwickau, iperdi.de
`;

    const defaultCVContent = `# CV Generator (biznes usługowy)

Cel: pozyskanie klientów i budowanie marki eksperta od niemieckich CV na grupach polonijnych.

## Pipeline
UWAGA: fb_scout.py i scout.py są obecnie ZEPSUTE (STATUS: ZEPSUTY). Nie generuj zadań wymagających ich użycia ani odpowiadania na ich wyniki.
1. fb_scout.py — STATUS: ZEPSUTY. Skanowanie grup FB. Nie uruchamiaj, nie każ odpowiadać na wyniki.
2. scout.py — STATUS: ZEPSUTY. Skanowanie Useme.com. Nie uruchamiaj, nie każ odpowiadać na wyniki.
3. web_gui.py + pdf_renderer.py → generowanie profesjonalnego CV PDF dla klienta (DZIAŁA)
4. Użytkownik RĘCZNIE buduje markę eksperta na grupach FB (merytoryczna pomoc, bez spamu, bez linków)

## Status produktu
Produkt (CV Generator) jest GOTOWY, ale wymaga polerowania przed pozyskiwaniem klientów.
NIE URUCHAMIAJ kampanii reklamowych na FB — produkt nie jest jeszcze w pełni gotowy do masowej promocji.
Skup się na: poprawie jakości draftów, testowaniu pipeline'u, organicznym budowaniu marki.

## Zadania do wykonania
- [ ] Zweryfikuj jakość 1 draftu aplikacji z folderu Robocze/ (ocena CEO — czy akceptowalny do wysyłki?)
- [ ] Przejrzyj kod web_gui.py i pdf_renderer.py pod kątem błędów
- [ ] Zleć agentowi naprawę fb_scout.py lub scout.py (oznaczone jako ZEPSUTY)
`;

    driveFolderId = await searchFolderId(folderName);

    if (!driveFolderId) {
      console.log('Folder not found. Creating a new one...');
      driveFolderId = await createFolder(folderName);
      
      await createMarkdownFile(driveFolderId, '00_Kontekst.md', defaultContextContent);
      await createMarkdownFile(driveFolderId, '00_Aktywne_Projekty.md', defaultProjectsContent);
      await createMarkdownFile(driveFolderId, '01_Praca_w_Niemczech.md', defaultPracaContent);
      await createMarkdownFile(driveFolderId, '01_CV_Generator.md', defaultCVContent);
      console.log('Default folder and files successfully created on Drive!');
    }

    // 2. Fetch and download all files inside this folder
    let files = await getFilesInFolder(driveFolderId);
    
    // Check for missing core files and create them on the fly
    const fileNames = files.map(f => f.name);
    let createdAnyMissing = false;
    
    if (!fileNames.includes('00_Kontekst.md')) {
      console.log('00_Kontekst.md missing on GDrive. Creating default...');
      await createMarkdownFile(driveFolderId, '00_Kontekst.md', defaultContextContent);
      createdAnyMissing = true;
    }
    if (!fileNames.includes('00_Aktywne_Projekty.md')) {
      console.log('00_Aktywne_Projekty.md missing on GDrive. Creating default...');
      await createMarkdownFile(driveFolderId, '00_Aktywne_Projekty.md', defaultProjectsContent);
      createdAnyMissing = true;
    }
    if (!fileNames.includes('01_Praca_w_Niemczech.md')) {
      console.log('01_Praca_w_Niemczech.md missing on GDrive. Creating default...');
      await createMarkdownFile(driveFolderId, '01_Praca_w_Niemczech.md', defaultPracaContent);
      createdAnyMissing = true;
    }
    if (!fileNames.includes('01_CV_Generator.md')) {
      console.log('01_CV_Generator.md missing on GDrive. Creating default...');
      await createMarkdownFile(driveFolderId, '01_CV_Generator.md', defaultCVContent);
      createdAnyMissing = true;
    }

    if (createdAnyMissing) {
      // Refresh files list to include newly created files
      files = await getFilesInFolder(driveFolderId);
    }

    let activeProjectsList = [];

    for (const f of files) {
      if (f.name.endsWith('.md')) {
        const fileContent = await downloadFileContent(f.id);
        const preferenceKey = `file_${f.name}`;
        await dbPut('preferences', { key: preferenceKey, value: fileContent });
        console.log(`Cached file: ${f.name}`);
        
        // Add to active project list if it's a detail file (starts with 01_)
        if (f.name.startsWith('01_')) {
          activeProjectsList.push(f.name);
        }
      }
    }

    // Save project list
    await dbPut('preferences', { key: 'gdrive_active_projects_list', value: activeProjectsList });

    // 3. Sync App State via Server (PC ↔ Phone — no OAuth needed!)
    try {
      if (window.importAppStateFromServer) {
        const imported = await window.importAppStateFromServer();
        if (!imported) {
          // Local state is newer or no server state — export to server
          if (window.syncAppStateToServer) {
            await window.syncAppStateToServer();
          }
        }
      }
    } catch (stateErr) {
      console.warn('Server state sync failed (non-critical):', stateErr);
    }

    // 4. Sync Google Calendar events
    try {
      await syncCalendarEvents();
    } catch (calErr) {
      console.warn('Google Calendar sync failed:', calErr);
    }

    // 4. Update Sync Time
    const now = new Date();
    const syncTimeStr = now.toLocaleDateString('pl-PL') + ' ' + now.toTimeString().split(' ')[0].substring(0, 5);
    await dbPut('preferences', { key: 'gdrive_last_sync', value: syncTimeStr });
    
    updateSyncTimeUI(syncTimeStr);
    updateSyncStatusUI(true, 'Synchronizacja pomyślna!');
    showBannerNotification('Synchronizacja z Google Drive zakończona pomyślnie! ✅');
    
    // Flush any pending offline saves
    flushGDriveOfflineQueue();
    
    // Refresh main app UI
    if (typeof updateUI !== 'undefined') {
      updateUI();
    }
  } catch (error) {
    console.error('Google Drive Sync error:', error);
    updateSyncStatusUI(true, 'Błąd: ' + error.message);
    showBannerNotification('Błąd podczas synchronizacji: ' + error.message);
  } finally {
    syncBtn.disabled = false;
    const container = document.querySelector('.app-container');
    if (container) container.classList.remove('is-loading');
  }
}

// --- UI UPDATERS FOR SYNC ---
function updateSyncStatusUI(isConnected, customText = '') {
  const statusIndicator = document.querySelector('#sync-status-el .status-indicator');
  const statusText = document.querySelector('#sync-status-el .status-text');
  const loginBtn = document.getElementById('google-login-btn');
  const logoutBtn = document.getElementById('google-logout-btn');

  if (isConnected) {
    statusIndicator.className = 'status-indicator online';
    statusText.innerText = customText || 'Status: Połączono z Google Drive';
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
  } else {
    statusIndicator.className = 'status-indicator offline';
    statusText.innerText = customText || 'Status: Brak połączenia z Dyskiem Google';
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
  }
}

function updateSyncTimeUI(timeStr) {
  const descEl = document.querySelector('#settings-modal-el .settings-section:nth-child(4) .section-desc'); // Point to 4th section now because of Notifications block insertion
  if (descEl) {
    descEl.innerHTML = `Połącz aplikację ze swoim Dyskiem Google. Aplikacja będzie miała dostęp wyłącznie do plików w utworzonym przez siebie folderze <code>[LifeCoach_Data]</code>.<br><strong style="color:var(--checked-color);">Ostatnia synchronizacja: ${timeStr}</strong>`;
  }
}

// --- GOOGLE CALENDAR SYNC ENGINE ---
async function syncCalendarEvents() {
  const now = new Date();
  
  // Start and end of today in local time
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  
  const timeMin = startOfToday.toISOString();
  const timeMax = endOfToday.toISOString();
  
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;
  
  try {
    const response = await fetchGDrive(endpoint);
    const data = await response.json();
    
    const events = (data.items || []).map(item => {
      let timeStr = 'Cały dzień';
      if (item.start.dateTime) {
        const start = new Date(item.start.dateTime);
        const end = new Date(item.end.dateTime);
        const formatTime = (d) => d.toTimeString().split(' ')[0].substring(0, 5);
        timeStr = `${formatTime(start)} - ${formatTime(end)}`;
      }
      return {
        summary: item.summary,
        time: timeStr
      };
    });
    
    await dbPut('preferences', { key: 'google_calendar_events_today', value: events });
    console.log('Successfully synced Google Calendar events:', events);
  } catch (error) {
    console.error('Failed to sync Google Calendar events:', error);
    // Clear stale calendar events on error
    await dbPut('preferences', { key: 'google_calendar_events_today', value: [] });
  }
}

