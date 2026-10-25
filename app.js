/* ==========================================================================
   LIFE COACH - CORE APPLICATION LOGIC (IndexedDB & State Engine)
   ========================================================================== */

// Zwykłe logowanie na frontendzie bez wysyłania do /log (PWA jest bezserwerowe)

// Detect when Material Symbols font has loaded to show icons (prevents text glitches offline)
if ('fonts' in document) {
  document.fonts.ready.then(() => {
    document.body.classList.add('fonts-ready');
  });
  // Also try to specifically load the Material Symbols font
  document.fonts.load('24px "Material Symbols Outlined"').then(() => {
    document.body.classList.add('fonts-ready');
  }).catch(() => {
    // Font failed to load — show icons anyway (fallback CSS will handle it)
    document.body.classList.add('fonts-ready');
  });
} else {
  // Fallback for browsers without Font Loading API
  document.body.classList.add('fonts-ready');
}

// Database Configuration
const DB_NAME = 'LifeCoachDB';
const DB_VERSION = 7;
let db = null;

// Initial state variables
let streakState = {
  currentStreak: 0,
  longestStreak: 0,
  lastActiveDate: '',
  shieldsAvailable: 0,
  gracePeriodActive: false,
  isStreakMaintainedToday: false
};

// --- INDEXEDDB HELPER ACTIONS ---
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Database error:', event.target.error);
      // Try to recover by deleting and recreating the database
      console.warn('Attempting emergency DB recovery...');
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
      deleteRequest.onsuccess = () => {
        console.log('Old DB deleted. Recreating...');
        const retryRequest = indexedDB.open(DB_NAME, DB_VERSION);
        retryRequest.onsuccess = (e) => {
          db = e.target.result;
          resolve(db);
        };
        retryRequest.onerror = (e) => {
          console.error('Emergency DB recreation failed:', e.target.error);
          reject(e.target.error);
        };
      };
      deleteRequest.onerror = () => reject(event.target.error);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      const oldVersion = event.oldVersion;

      // Store 1: Preferences (API key, project structures)
      if (!dbInstance.objectStoreNames.contains('preferences')) {
        dbInstance.createObjectStore('preferences', { keyPath: 'key' });
      }

      // Store 2: Personal Routines
      if (!dbInstance.objectStoreNames.contains('routines')) {
        dbInstance.createObjectStore('routines', { keyPath: 'id', autoIncrement: true });
      }

      // Store 3: Business Focus Tasks
      if (!dbInstance.objectStoreNames.contains('businessTasks')) {
        dbInstance.createObjectStore('businessTasks', { keyPath: 'id', autoIncrement: true });
      }

      // Store 4: Streak State (single entry)
      if (!dbInstance.objectStoreNames.contains('streakState')) {
        dbInstance.createObjectStore('streakState', { keyPath: 'id' });
      }

      // Store 5: Victory Journal (5 wins per day)
      if (!dbInstance.objectStoreNames.contains('victoryJournal')) {
        dbInstance.createObjectStore('victoryJournal', { keyPath: 'date' });
      }

      // Store 6: Project Tasks (Home view - Protokół Świateł)
      if (!dbInstance.objectStoreNames.contains('projectTasks')) {
        dbInstance.createObjectStore('projectTasks', { keyPath: 'id', autoIncrement: true });
      }

      // v5→v6: Remove issues store if it exists (from temporary v5 deployment)
      if (oldVersion >= 5 && dbInstance.objectStoreNames.contains('issues')) {
        dbInstance.deleteObjectStore('issues');
        console.log('Removed deprecated issues store during DB upgrade to v6');
      }
    };
  });
}

// Read data helper
function dbGet(storeName, key) {
  return new Promise((resolve) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

// Write data helper
function dbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Get all items in store helper
function dbGetAll(storeName) {
  return new Promise((resolve) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
}

// Delete item helper
function dbDelete(storeName, key) {
  return new Promise((resolve) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
  });
}

// --- DATABASE SEEDING (Seed defaults if empty) ---
async function seedDefaultData() {
  // 1. Preferences Setup
  const prefKey = await dbGet('preferences', 'gemini_api_key');
  if (!prefKey) {
    await dbPut('preferences', { key: 'gemini_api_key', value: '' });
  }

  const clientIdPref = await dbGet('preferences', 'google_client_id');
  const oldDesktopId = '349299107213-5kb40cioa26dll0tfmll5k8eja5jdg37.apps.googleusercontent.com';
  const newWebId = '349299107213-25npb6ffepoc9ocmvra0jrlj16slm1mf.apps.googleusercontent.com';
  if (!clientIdPref || !clientIdPref.value || clientIdPref.value === oldDesktopId) {
    await dbPut('preferences', { key: 'google_client_id', value: newWebId });
  }

  // 2. Routines Seed
  const routines = await dbGetAll('routines');
  const waterDescription = `**1. Dlaczego sól i cytryna na Keto?**
* **Zapobieganie kamicy nerkowej:** Dieta keto zwiększa wydalanie wapnia. Kwas cytrynowy wiąże wapń w nerkach, zapobiegając powstawaniu bolesnych kamieni.
* **Przygotowanie do OMAD:** Kwaśny smak stymuluje żołądek i żółć do trawienia jednego, obfitego posiłku w ciągu dnia.
* **Alkalizacja:** Cytryna działa odkwaszająco po strawieniu, buforując kwasotwórcze tłuszcze i białka.
* **Lepsza przyswajalność:** Witamina C wspiera wchłanianie elektrolitów, a cytryna maskuje słony smak wody.

**2. Jak przygotować napój?**
* **Cytryna:** Sok z **1/4 do 1/2 cytryny** (czyli około 1-2 łyżki stołowe soku). Wyłącznie **świeżo wyciśnięty sok** (unikaj soków z butelki).
* **Sól:** Zaledwie mała **szczypta soli** (np. kłodawskiej / himalajskiej). ABSOLUTNIE NIE 2 łyżki soli! Sól służy tylko do uzupełnienia sodu, szczypta w zupełności wystarczy.`;

  if (routines.length === 0) {
    const defaultRoutines = [
      // Morning (user wakes at ~11-12, routines relative to waking up)
      { title: 'Szklanka wody z solą i cytryną (elektrolity keto!) 🥤', type: 'morning', isCompletedToday: false, scheduledTime: '12:00', isActive: true, description: waterDescription },
      { title: 'Umyj twarz i nałóż krem pod oczy 🧴', type: 'morning', isCompletedToday: false, scheduledTime: '12:15', isActive: true },
      { title: 'Trening z Fitatu (lub rehab pleców) 🏋️', type: 'morning', isCompletedToday: false, scheduledTime: '12:30', isActive: true },
      { title: 'Kreatyna 💊 (z dużą ilością wody!)', type: 'morning', isCompletedToday: false, scheduledTime: '13:00', isActive: true },
      // Afternoon / Evening
      { title: 'Weź Omega-3 po głównym posiłku (OMAD) 💊', type: 'evening', isCompletedToday: false, scheduledTime: '17:00', isActive: true },
      { title: 'Weź Dulsevię 💊 (NIE POMIJAJ — brain zaps!)', type: 'evening', isCompletedToday: false, scheduledTime: '19:30', isActive: true },
      { title: 'Magnez i Potas 💊 (na regenerację przed snem)', type: 'evening', isCompletedToday: false, scheduledTime: '20:30', isActive: true },
      { title: 'Umyj twarz + krem pod oczy na noc 🌙', type: 'evening', isCompletedToday: false, scheduledTime: '21:30', isActive: true },
      { title: 'Wpisz 5 zwycięstw dnia w Dziennik Zwycięstw 🏆', type: 'evening', isCompletedToday: false, scheduledTime: '22:00', isActive: true }
    ];
    for (const r of defaultRoutines) {
      await dbPut('routines', r);
    }
  } else {
    // Migration: Update existing routines to add description if missing
    for (const r of routines) {
      if (r.title.includes('Szklanka wody z solą') && !r.description) {
        r.description = waterDescription;
        await dbPut('routines', r);
      }
    }
  }

  // 3. Business Tasks Seed — based on REAL pipeline
  const bTasks = await dbGetAll('businessTasks');
  if (bTasks.length === 0) {
    const todayStr = getTodayDateString();
    const defaultBusinessTasks = [
      {
        title: 'Przejrzyj i popraw 1 draft aplikacji z folderu Robocze/',
        description: 'Otwórz folder Robocze/ → generuj_drafty.py wygenerował gotowe listy motywacyjne. Zamiast wysyłać w ciemno, przeczytaj go, popraw błędy i przygotuj do wysyłki (przez wyslij_szablony.py).',
        projectAssociation: 'Praca w Niemczech',
        status: 'todo',
        date: todayStr,
        leverageLevel: 4,
        estimatedMinutes: 15
      },
      {
        title: 'Zweryfikuj 1 draft aplikacji z folderu Robocze/',
        description: 'Otwórz folder Robocze/ → generuj_drafty.py wygenerował gotowe listy motywacyjne. Jako Nadzorca/CEO: przeczytaj, oceń jakość, zleć agentowi poprawki jeśli trzeba. Nie wysyłaj w ciemno — najpierw upewnij się, że draft jest akceptowalny.',
        projectAssociation: 'Praca w Niemczech',
        status: 'todo',
        date: todayStr,
        leverageLevel: 4,
        estimatedMinutes: 15
      }
    ];
    for (const t of defaultBusinessTasks) {
      await dbPut('businessTasks', t);
    }
  }

  // 4. Streak State Setup
  const savedStreak = await dbGet('streakState', 'current');
  if (!savedStreak) {
    streakState = {
      id: 'current',
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: getTodayDateString(),
      shieldsAvailable: 1, // Start with one free shield
      gracePeriodActive: false,
      isStreakMaintainedToday: false
    };
    await dbPut('streakState', streakState);
  } else {
    streakState = savedStreak;
  }

  // 5. Project Tasks Seed (Zawsze aktualna lista zadań na ekranie Home)
  const pTasks = await dbGetAll('projectTasks');
  if (pTasks.length === 0) {
    const defaultProjectTasks = [
      {
        title: 'Reorganizacja aplikacji: Główny Home jako zawsze aktualna Lista Zadań (z obsługą offline w magazynie), a panel Trenera RPG zarchiwizowany jako podstrona/zakładka.',
        description: 'Oddzielenie listy zadań na Home od widoku Trenera RPG, uszczelnienie Service Workera (sw.js v24) i dual storage (IndexedDB + localStorage).',
        status: 'in_progress',
        size: 'M',
        project: 'Life Coach'
      },
      {
        title: 'Dodanie endpointu /api/tasks w server.py do dwukierunkowej synchronizacji z plikiem stan_projektu/tasks.md na PC.',
        description: 'Dwukierunkowy sync zadań markdown <-> aplikacja mobilna.',
        status: 'todo',
        size: 'S',
        project: 'Life Coach'
      },
      {
        title: 'Konfiguracja opcjonalnego SSL/HTTPS w server.py dla zapewnienia Secure Context na telefonie w sieci lokalnej.',
        description: 'Umożliwia pełną rejestrację Service Workera w Chrome Mobile.',
        status: 'todo',
        size: 'S',
        project: 'Life Coach'
      },
      {
        title: 'Przejrzyj i popraw 1 draft aplikacji z folderu Robocze/',
        description: 'Sprawdź list motywacyjny, oceń jakość jako Nadzorca/CEO.',
        status: 'todo',
        size: 'S',
        project: 'Praca w Niemczech'
      },
      {
        title: 'Ustalić coś w sprawie Karoliny i napisać co (komornik/PISP)',
        description: 'Sprawdź portal PISP, odpowiedz na pismo komornika.',
        status: 'pending',
        size: 'S',
        project: 'KarolinaMercedes'
      },
      {
        title: 'Bootstrap Protokołu Świateł: utworzenie cel_i_problem.md, pamiec_robocza.md, tasks.md, .gitignore, README.md',
        description: 'Dostosowanie projektu do globalnych standardów ekosystemu AgentAI.',
        status: 'done',
        size: 'S',
        project: 'Life Coach'
      },
      {
        title: 'Audyt obecnego stanu projektu: utworzenie szczegółowego raportu w stan_projektu/artefakty/audyty/',
        description: 'Szczegółowa diagnoza problemu offline i plan drogi do 100%.',
        status: 'done',
        size: 'M',
        project: 'Life Coach'
      }
    ];
    for (const t of defaultProjectTasks) {
      await dbPut('projectTasks', t);
    }
  }
}

// --- DOBA OPERACYJNA (Europe/Berlin, reset o 04:00 rano) ---
function getOperationalDate(now = new Date()) {
  const shifted = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(shifted);
}

// Get standard date string YYYY-MM-DD (operacyjna doba z resetem o 04:00)
function getTodayDateString() {
  return getOperationalDate();
}

// Get Polish written date
function getPolishDateString() {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Berlin' };
  return new Date().toLocaleDateString('pl-PL', options);
}

// --- PROTOKÓŁ MEDYCZNY: DULSEVIA (Matematyka UTC, trwały log w IndexedDB) ---
function isDulseviaDay(operationalDateStr = getOperationalDate()) {
  const parts = operationalDateStr.split('-').map(Number);
  const targetUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const startUtc = Date.UTC(2026, 9, 26); // 2026-10-26 (miesiąc 9 = październik)
  const diffDays = Math.round((targetUtc - startUtc) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    // Before 2026-10-26: daily dose phase (30 mg codziennie do 25.10)
    return true;
  }
  // From 2026-10-26: alternate days starting with break on 26.10 (diffDays=0 -> false, diffDays=1 -> true)
  return (diffDays % 2 === 1);
}

async function getMedicationHistory() {
  try {
    const pref = await dbGet('preferences', 'medication_history');
    if (pref && pref.data) return pref.data;
  } catch (e) {}
  try {
    const raw = localStorage.getItem('medication_history');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

async function saveMedicationHistory(history) {
  try {
    await dbPut('preferences', { key: 'medication_history', data: history });
  } catch (e) {}
  try {
    localStorage.setItem('medication_history', JSON.stringify(history));
  } catch (e) {}
}

async function updateDulseviaUI() {
  const todayOp = getOperationalDate();
  const opBadge = document.getElementById('operational-day-badge');
  if (opBadge) {
    opBadge.innerText = `Doba: ${todayOp}`;
  }

  const schedTag = document.getElementById('dulsevia-schedule-tag');
  if (schedTag) {
    schedTag.innerText = todayOp < '2026-10-26' ? 'Etap 2: Codziennie 30 mg' : 'Etap 3: Co 2 dni';
  }

  const statusBadge = document.getElementById('dulsevia-day-status');
  const confirmBtn = document.getElementById('btn-dulsevia-confirm');
  const history = await getMedicationHistory();
  const todayRecord = history[todayOp];
  const isPillDay = isDulseviaDay(todayOp);

  if (todayRecord && todayRecord.taken) {
    if (statusBadge) {
      statusBadge.className = 'medical-status-badge taken';
      statusBadge.innerText = '✅ Przyjęto dzisiaj';
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span class="material-symbols-outlined">check</span> Dawka przyjęta (${todayRecord.time || 'OK'})`;
    }
  } else if (isPillDay) {
    if (statusBadge) {
      statusBadge.className = 'medical-status-badge pill-day';
      statusBadge.innerText = '💊 Dzień dawki (30 mg)';
    }
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `<span class="material-symbols-outlined">medication</span> Potwierdź przyjęcie dawki (30 mg)`;
    }
  } else {
    if (statusBadge) {
      statusBadge.className = 'medical-status-badge rest-day';
      statusBadge.innerText = '⏸️ Dzień przerwy (0 mg)';
    }
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `<span class="material-symbols-outlined">medication</span> Potwierdź dawkę (nadprogramowo)`;
    }
  }
}

window.confirmDulseviaDose = async function() {
  const todayOp = getOperationalDate();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  const history = await getMedicationHistory();
  history[todayOp] = {
    taken: true,
    timestamp: now.getTime(),
    time: timeStr
  };
  await saveMedicationHistory(history);
  await updateDulseviaUI();
  showBannerNotification(`Zarejestrowano przyjęcie dawki Dulsevii na dobę ${todayOp}! 💊`);
};

// --- RUTYNA REGENERACYJNA (Europe/Berlin 04:00, trwały log w IndexedDB) ---
async function getRegenerationHistory() {
  try {
    const pref = await dbGet('preferences', 'regeneration_history');
    if (pref && pref.data) return pref.data;
  } catch (e) {}
  try {
    const raw = localStorage.getItem('regeneration_history');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

async function saveRegenerationHistory(history) {
  try {
    await dbPut('preferences', { key: 'regeneration_history', data: history });
  } catch (e) {}
  try {
    localStorage.setItem('regeneration_history', JSON.stringify(history));
  } catch (e) {}
}

async function updateRegenerationUI() {
  const todayOp = getOperationalDate();
  const statusBadge = document.getElementById('regeneration-day-status');
  const confirmBtn = document.getElementById('btn-regeneration-confirm');
  const history = await getRegenerationHistory();
  const todayRecord = history[todayOp];

  if (todayRecord && todayRecord.completed) {
    if (statusBadge) {
      statusBadge.className = 'medical-status-badge taken';
      statusBadge.innerText = '✅ Wykonano dzisiaj';
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span class="material-symbols-outlined">check</span> Rutyna zaliczona (${todayRecord.time || 'OK'})`;
    }
  } else {
    if (statusBadge) {
      statusBadge.className = 'medical-status-badge pill-day';
      statusBadge.innerText = '⏳ Do zrobienia dzisiaj';
    }
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `<span class="material-symbols-outlined">fitness_center</span> Potwierdź wykonanie rutyny`;
    }
  }
}

window.confirmRegenerationRoutine = async function() {
  const todayOp = getOperationalDate();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  const history = await getRegenerationHistory();
  history[todayOp] = {
    completed: true,
    timestamp: now.getTime(),
    time: timeStr
  };
  await saveRegenerationHistory(history);
  await updateRegenerationUI();
  showBannerNotification(`Świetnie! Zarejestrowano regenerację (kolana + łopatki + lędźwie) na dobę ${todayOp}! 🧘`);
};


// --- STREAK & DATE ROLLOVER ENGINE ---
async function checkDailyRollover() {
  const today = getTodayDateString();
  const lastActive = streakState.lastActiveDate;

  if (today === lastActive) {
    return; // Same day, no rollover needed
  }

  // Calculate day difference
  const dateDiff = Math.round((new Date(today) - new Date(lastActive)) / (1000 * 60 * 60 * 24));

  if (dateDiff === 1) {
    // Rollover to the next day
    if (streakState.isStreakMaintainedToday) {
      // User succeeded yesterday!
      streakState.isStreakMaintainedToday = false;
      // If grace period was active, they successfully saved it
      streakState.gracePeriodActive = false;
    } else {
      // User failed yesterday!
      if (streakState.shieldsAvailable > 0) {
        // 1. Consume a shield
        streakState.shieldsAvailable--;
        showBannerNotification('Tarcza Serii (Shield) została zużyta! Twój streak ocalał! 🛡️');
      } else if (!streakState.gracePeriodActive) {
        // 2. No shields, enter grace period
        streakState.gracePeriodActive = true;
      } else {
        // 3. Failed during grace period -> reset streak
        streakState.currentStreak = 0;
        streakState.gracePeriodActive = false;
      }
    }
  } else if (dateDiff > 1) {
    // Multiple days missed - reset streak or consume shield if they had enough (can only consume one per day, so multiple days breaks streak)
    if (streakState.shieldsAvailable >= dateDiff) {
      streakState.shieldsAvailable -= dateDiff;
      streakState.isStreakMaintainedToday = false;
      showBannerNotification(`Zużyto ${dateDiff} Tarcz Serii. Streak ocalał! 🛡️`);
    } else {
      streakState.currentStreak = 0;
      streakState.shieldsAvailable = 0;
      streakState.gracePeriodActive = false;
      streakState.isStreakMaintainedToday = false;
    }
  }

  // Reset daily tasks
  await resetDailyTaskCompletionStates(today);

  // Update date
  streakState.lastActiveDate = today;
  await saveStreakState();
  updateUI();
}

async function resetDailyTaskCompletionStates(newDateStr) {
  // Reset personal routines
  const routines = await dbGetAll('routines');
  for (const r of routines) {
    r.isCompletedToday = false;
    await dbPut('routines', r);
  }

  // Clean old business tasks and carry over unchecked ones
  const bTasks = await dbGetAll('businessTasks');
  for (const t of bTasks) {
    if (t.status === 'todo') {
      // Carry over to the new date
      t.date = newDateStr;
      await dbPut('businessTasks', t);
    }
  }
}

function playSuccessSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const playNote = (frequency, startTime, duration) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, startTime);
      gain.gain.setValueAtTime(0.08, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    const now = audioCtx.currentTime;
    playNote(523.25, now, 0.12); // C5 note
    playNote(659.25, now + 0.08, 0.12); // E5 note
    playNote(783.99, now + 0.16, 0.22); // G5 note
  } catch (e) {
    console.warn('Web Audio API is not supported or blocked:', e);
  }
}

async function markTaskCompleted(storeName, id, isCompleted) {
  const task = await dbGet(storeName, id);
  if (!task) return;

  if (storeName === 'routines') {
    task.isCompletedToday = isCompleted;
  } else {
    task.status = isCompleted ? 'done' : 'todo';
  }
  await dbPut(storeName, task);

  // Trigger success sound on complete
  if (isCompleted) {
    playSuccessSound();
  }

  // Handle streak updates
  await evaluateStreakProgress();
  updateUI();
}

async function evaluateStreakProgress() {
  const routines = await dbGetAll('routines');
  const bTasks = await dbGetAll('businessTasks');
  const todayStr = getTodayDateString();

  // Wymóg Główny (Core Quest): Jeśli wygenerowano dziś zadania biznesowe, 
  // MUSISZ wykonać chociaż jedno, żeby utrzymać streak. 
  // Nawyki zdrowotne dają streak tylko, gdy nie masz na dziś misji biznesowej.
  const todaysBusiness = bTasks.filter(t => t.date === todayStr);
  const completedBusiness = todaysBusiness.some(t => t.status === 'done');
  const completedRoutines = routines.some(r => r.isCompletedToday);
  const completedProjectTaskToday = (typeof projectTasksList !== 'undefined' && Array.isArray(projectTasksList))
    ? projectTasksList.some(t => t.status === 'done' && t.completedAt && t.completedAt.startsWith(todayStr))
    : false;

  const hasDoneSomething = (todaysBusiness.length > 0 
    ? completedBusiness 
    : completedRoutines) || completedProjectTaskToday;

  const previouslyMaintained = streakState.isStreakMaintainedToday;

  if (hasDoneSomething && !previouslyMaintained) {
    // Streak just secured for today!
    streakState.isStreakMaintainedToday = true;
    
    if (streakState.gracePeriodActive) {
      // Saved from grace period
      streakState.gracePeriodActive = false;
    }
    
    // Increment streak
    streakState.currentStreak++;
    
    // Check longest streak
    if (streakState.currentStreak > streakState.longestStreak) {
      streakState.longestStreak = streakState.currentStreak;
    }

    // Award a Shield every 7 days (max 3)
    if (streakState.currentStreak % 7 === 0) {
      if (streakState.shieldsAvailable < 3) {
        streakState.shieldsAvailable++;
        showBannerNotification('Gratulacje! 7-dniowa seria daje Ci nową Tarczę Serii! 🛡️🔥');
      }
    }
  } else if (!hasDoneSomething && previouslyMaintained) {
    // User unchecked the only completed task - revert streak
    streakState.isStreakMaintainedToday = false;
    streakState.currentStreak = Math.max(0, streakState.currentStreak - 1);
    
    // Revert shield if granted on this number
    if ((streakState.currentStreak + 1) % 7 === 0 && streakState.shieldsAvailable > 0) {
      streakState.shieldsAvailable--;
    }
  }

  await saveStreakState();
}

async function saveStreakState() {
  await dbPut('streakState', streakState);
  // Schedule debounced state sync to cloud (so other devices can pick up changes)
  scheduleStateSync();
}

// Debounced state sync — exports state to server after changes
let stateSyncTimer = null;
function scheduleStateSync() {
  if (stateSyncTimer) clearTimeout(stateSyncTimer);
  stateSyncTimer = setTimeout(async () => {
    if (window.syncAppStateToServer) {
      await window.syncAppStateToServer();
    }
  }, 5000); // 5 second debounce
}

// Banner notification inside UI
function showBannerNotification(text) {
  const banner = document.getElementById('coach-banner-el');
  const textEl = document.getElementById('coach-text-el');
  if (banner && textEl) {
    textEl.innerText = text;
    banner.style.border = '1px solid var(--checked-color)';
    setTimeout(() => {
      banner.style.border = '1px dashed rgba(99, 102, 241, 0.25)';
    }, 6000);
  }
}

// --- DYNAMIC RENDERING / UI UPDATES ---
async function updateUI() {
  // Update Date
  document.getElementById('current-date-el').innerText = getPolishDateString();

  // Update Calendar Events Banner
  const calendarBanner = document.getElementById('calendar-banner-el');
  const calendarEventsList = document.getElementById('calendar-events-list-el');
  
  if (calendarBanner && calendarEventsList) {
    const calendarEventsPref = await dbGet('preferences', 'google_calendar_events_today');
    const events = (calendarEventsPref && calendarEventsPref.value) || [];
    
    if (events.length > 0) {
      calendarBanner.classList.remove('hidden');
      calendarEventsList.innerHTML = '';
      const titleEl = document.createElement('div');
      titleEl.className = 'calendar-events-title';
      titleEl.textContent = 'Dzisiejsze wydarzenia z kalendarza 📅';
      calendarEventsList.appendChild(titleEl);

      events.forEach(ev => {
        const itemEl = document.createElement('div');
        itemEl.className = 'calendar-event-item';
        const timeEl = document.createElement('span');
        timeEl.className = 'calendar-event-time';
        timeEl.textContent = ev.time;
        const summaryEl = document.createElement('span');
        summaryEl.className = 'calendar-event-summary';
        summaryEl.textContent = ev.summary;
        itemEl.appendChild(timeEl);
        itemEl.appendChild(summaryEl);
        calendarEventsList.appendChild(itemEl);
      });
    } else {
      calendarBanner.classList.add('hidden');
      calendarEventsList.innerHTML = '';
    }
  }

  // Update Streak Card
  const streakCard = document.getElementById('streak-card-el');
  const streakNum = document.getElementById('streak-number-el');
  streakNum.innerText = streakState.currentStreak;

  if (streakState.isStreakMaintainedToday) {
    streakCard.style.background = 'rgba(249, 115, 22, 0.2)';
    streakCard.style.borderColor = 'var(--streak-color)';
    streakCard.style.boxShadow = '0 0 15px var(--streak-glow)';
  } else {
    streakCard.style.background = 'rgba(255, 255, 255, 0.02)';
    streakCard.style.borderColor = 'var(--border)';
    streakCard.style.boxShadow = 'none';
  }

  // Punish UI if streak is dead
  const container = document.querySelector('.app-container');
  if (streakState.currentStreak === 0) {
    container.classList.add('streak-punished');
  } else {
    container.classList.remove('streak-punished');
  }

  // Update Shields
  for (let i = 1; i <= 3; i++) {
    const shieldEl = document.getElementById(`shield-${i}`);
    if (i <= streakState.shieldsAvailable) {
      shieldEl.classList.remove('empty');
      shieldEl.classList.add('active');
    } else {
      shieldEl.classList.remove('active');
      shieldEl.classList.add('empty');
    }
  }

  // Update Grace Period Alert
  const graceAlert = document.getElementById('grace-alert-el');
  if (streakState.gracePeriodActive) {
    graceAlert.classList.remove('hidden');
  } else {
    graceAlert.classList.add('hidden');
  }

  // Render Personal Routines
  const routines = await dbGetAll('routines');
  const morningList = document.getElementById('morning-routines-el');
  const eveningList = document.getElementById('evening-routines-el');
  
  morningList.innerHTML = '';
  eveningList.innerHTML = '';

  const activeRoutines = routines.filter(r => r.isActive);
  
  activeRoutines.forEach(r => {
    const item = document.createElement('div');
    item.className = `task-item ${r.isCompletedToday ? 'completed' : ''}`;
    item.innerHTML = `
      <div class="checkbox-container">
        <input type="checkbox" ${r.isCompletedToday ? 'checked' : ''}>
        <span class="checkmark"></span>
      </div>
      <div class="task-item-content">
        <span class="task-title">${r.title}</span>
        <span class="task-time">
          <span class="material-symbols-outlined">alarm</span> ${r.scheduledTime}
        </span>
      </div>
      ${r.description ? `
        <button class="help-btn" title="Wyjaśnienie i instrukcja">
          <span class="material-symbols-outlined" style="font-size: 18px;">help</span>
        </button>
      ` : ''}
    `;

    // Click event to toggle checkbox
    item.addEventListener('click', (e) => {
      e.preventDefault();
      markTaskCompleted('routines', r.id, !r.isCompletedToday);
    });

    // Help button logic
    if (r.description) {
      const helpBtn = item.querySelector('.help-btn');
      if (helpBtn) {
        helpBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          showHelpModal(r.title, r.description);
        });
      }
    }

    if (r.type === 'morning') {
      morningList.appendChild(item);
    } else {
      eveningList.appendChild(item);
    }
  });

  // Render Business Tasks
  const todayStr = getTodayDateString();
  const businessTasks = await dbGetAll('businessTasks');
  const businessList = document.getElementById('business-tasks-el');
  
  businessList.innerHTML = '';

  const todaysBusiness = businessTasks.filter(t => t.date === todayStr);

  if (todaysBusiness.length === 0) {
    businessList.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined">cloud_sync</span>
        <p>Brak zadań biznesowych na dziś. Synchronizuj pliki lub wygeneruj plan z AI.</p>
        <button class="btn btn-primary" id="generate-today-btn-inner">
          <span class="material-symbols-outlined">autorenew</span> Wygeneruj Plan na Dziś
        </button>
      </div>
    `;
  } else {
    // Show active project header tag from first active task if available
    const activeProjectContainer = document.getElementById('active-project-container-el');
    const activeProjectBadge = document.getElementById('active-project-badge-el');
    
    if (todaysBusiness.length > 0) {
      activeProjectContainer.classList.remove('hidden');
      activeProjectBadge.innerText = todaysBusiness[0].projectAssociation;
    } else {
      activeProjectContainer.classList.add('hidden');
    }

    todaysBusiness.forEach(t => {
      const isDone = t.status === 'done';
      const item = document.createElement('div');
      item.className = `task-item business-quest ${isDone ? 'completed' : ''}`;
      
      item.innerHTML = `
        <div class="business-header-row">
          <div class="checkbox-container">
            <input type="checkbox" ${isDone ? 'checked' : ''}>
            <span class="checkmark"></span>
          </div>
          <div class="badge-row">
            <span class="badge badge-leverage-${t.leverageLevel}">Dźwignia ${t.leverageLevel}/4</span>
          </div>
        </div>
        <div class="task-item-content">
          <span class="task-title" style="font-size: 15px; font-weight: 600;">${t.title}</span>
          <p class="task-desc">${t.description}</p>
          <span class="task-time">
            <span class="material-symbols-outlined">hourglass_top</span> Szacowany czas: ${t.estimatedMinutes} min
          </span>
        </div>
      `;

      item.addEventListener('click', (e) => {
        // Prevent toggle if clicking links or nested details, though here it's fine
        e.preventDefault();
        markTaskCompleted('businessTasks', t.id, t.status !== 'done');
      });

      businessList.appendChild(item);
    });
  }
}
// Placeholder for AI generation triggers
async function triggerAIGeneration() {
  const container = document.querySelector('.app-container');
  container.classList.add('is-loading');
  showBannerNotification('Wysyłanie zapytania do Gemini... <span class="spinner"></span>');
  
  try {
    if (window.generatePlanWithAI) {
      await window.generatePlanWithAI();
    } else {
      setTimeout(() => {
        showBannerNotification('Brak skonfigurowanego klucza API Gemini. Otwórz ustawienia, aby podać klucz. 🔑');
      }, 1500);
    }
  } finally {
    container.classList.remove('is-loading');
  }
}

// --- NOTIFICATIONS SYSTEM ---
let notifiedRoutinesToday = {};

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('Ta przeglądarka nie obsługuje powiadomień systemowych.');
    return;
  }
  const permission = await Notification.requestPermission();
  updateNotificationsUI(permission);
}

function updateNotificationsUI(permission) {
  const btn = document.getElementById('request-notifications-btn');
  const statusEl = document.getElementById('notifications-status-el');
  if (!btn || !statusEl) return;

  if (permission === 'granted') {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">notifications_active</span> Powiadomienia Aktywne';
    statusEl.classList.remove('hidden');
    statusEl.innerText = 'Zezwolono na powiadomienia!';
    statusEl.style.color = 'var(--checked-color)';
  } else if (permission === 'denied') {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">notifications_off</span> Powiadomienia Zablokowane';
    statusEl.classList.remove('hidden');
    statusEl.innerText = 'Zablokowano w przeglądarce.';
    statusEl.style.color = 'var(--danger)';
  } else {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">notifications</span> Włącz Powiadomienia';
    statusEl.classList.add('hidden');
  }
}

function startNotificationTimer() {
  // Check every 30 seconds
  setInterval(checkScheduledReminders, 30000);
  // Run once immediately
  checkScheduledReminders();
}

async function checkScheduledReminders() {
  if (Notification.permission !== 'granted') return;

  const now = new Date();
  const currentHourMin = now.toTimeString().split(' ')[0].substring(0, 5); // "08:15"
  const todayStr = getTodayDateString();

  // Reset tracking if the day changed
  if (streakState.lastActiveDate !== todayStr) {
    notifiedRoutinesToday = {};
  }

  // Check routines
  const routines = await dbGetAll('routines');
  const activeRoutines = routines.filter(r => r.isActive && !r.isCompletedToday);

  for (const r of activeRoutines) {
    if (r.scheduledTime === currentHourMin && !notifiedRoutinesToday[`routine-${r.id}`]) {
      notifiedRoutinesToday[`routine-${r.id}`] = true;
      triggerBrowserNotification(
        'Life Coach: Czas na rutynę!',
        {
          body: `Zadanie: ${r.title}. Zadbasz dzisiaj o swoją bazę? 🧘🧴`,
          icon: 'icon-192.png',
          tag: `routine-${r.id}`
        }
      );
    }
  }

  // Evening streak warning
  if (currentHourMin === '21:00' && !streakState.isStreakMaintainedToday && !notifiedRoutinesToday['streak-warning']) {
    notifiedRoutinesToday['streak-warning'] = true;
    triggerBrowserNotification(
      'Life Coach: Twój ogień wygasa! 🔥',
      {
        body: 'Nie ukończyłeś dzisiaj żadnego zadania. Kliknij chociaż jedną rzecz, by utrzymać streak!',
        icon: 'icon-192.png',
        tag: 'streak-warning'
      }
    );
  }

  // Monday reminder at 13:00 (user wakes late)
  const isMonday = now.getDay() === 1;
  if (isMonday && currentHourMin === '13:00' && !notifiedRoutinesToday['monday-reminder']) {
    notifiedRoutinesToday['monday-reminder'] = true;
    triggerBrowserNotification(
      'Life Coach: Cotygodniowy przegląd! 📋',
      {
        body: 'Nowy tydzień! Sprawdź 00_Aktywne_Projekty.md i 00_Kontekst.md na Dysku — czy coś się zmieniło w skryptach, lekach lub projektach?',
        icon: 'icon-192.png',
        tag: 'monday-reminder'
      }
    );
  }
}

function triggerBrowserNotification(title, options) {
  if (Notification.permission === 'granted') {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, options);
      });
    } else {
      new Notification(title, options);
    }
  }
}


// ==========================================================================
// PROJECT TASKS ENGINE (HOME VIEW & PROTOKÓŁ ŚWIATEŁ & OFFLINE MAGAZYN)
// ==========================================================================

const LOCAL_STORAGE_TASKS_KEY = 'life_coach_user_tasks_v28';
const LOCAL_STORAGE_TASKS_META_KEY = 'life_coach_user_tasks_meta_v28';
let projectTasksList = [];
let currentFilter = 'all';
let currentSearch = '';
let isDoneSectionCollapsed = false;

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTaskMarkdown(text) {
  if (!text) return '';
  const escaped = escapeHTML(text);
  return escaped
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\s*-\s+(.*)$/gm, '&bull; $1');
}

// 1. Dual-Storage Load (Instant synchronous localStorage + IndexedDB + server sync)
async function loadProjectTasks() {
  // A. Immediate instant hydration from localStorage (0 ms delay in warehouse!)
  const localCached = localStorage.getItem(LOCAL_STORAGE_TASKS_KEY);
  if (localCached) {
    try {
      projectTasksList = JSON.parse(localCached);
      renderProjectTasks();
      updateSyncStatusUIBadge(false, 'Lokalnie (Offline Gotowe)');
    } catch (e) {
      console.warn('Błąd parsowania localStorage tasks:', e);
    }
  }

  // B. IndexedDB Sync
  try {
    const dbTasks = await dbGetAll('projectTasks');
    if (dbTasks && dbTasks.length > 0) {
      projectTasksList = dbTasks;
      localStorage.setItem(LOCAL_STORAGE_TASKS_KEY, JSON.stringify(projectTasksList));
      renderProjectTasks();
    } else if (!localCached || projectTasksList.length === 0) {
      const reRead = await dbGetAll('projectTasks');
      if (reRead && reRead.length > 0) {
        projectTasksList = reRead;
        localStorage.setItem(LOCAL_STORAGE_TASKS_KEY, JSON.stringify(projectTasksList));
        renderProjectTasks();
      }
    }
  } catch (err) {
    console.warn('IndexedDB read error for projectTasks:', err);
  }

  // C. Background Server Sync with tasks.md (if online)
  syncTasksWithServer(true);
}

// 2. Dual-Storage Save
async function saveProjectTasksToStorage(triggerServerPush = true) {
  localStorage.setItem(LOCAL_STORAGE_TASKS_KEY, JSON.stringify(projectTasksList));
  
  try {
    const allDbTasks = await dbGetAll('projectTasks');
    for (const t of allDbTasks) {
      await dbDelete('projectTasks', t.id);
    }
    for (const t of projectTasksList) {
      await dbPut('projectTasks', t);
    }
  } catch (err) {
    console.warn('IndexedDB save error for projectTasks:', err);
  }

  if (triggerServerPush) {
    pushTasksToServer();
  }
}

let currentSourceRevision = localStorage.getItem('tasks_source_revision') || '';
let hasPendingTasksSync = localStorage.getItem('tasks_pending_sync') === 'true';

// Push tasks to server endpoint /api/tasks/save (with source_revision & conflict 409 handling)
async function pushTasksToServer() {
  try {
    const response = await fetch('/api/tasks/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: projectTasksList,
        source_revision: currentSourceRevision
      })
    });

    if (response.status === 409) {
      // 409 Conflict: Server file changed!
      const errData = await response.json().catch(() => ({}));
      console.warn('[SYNC 409] Version conflict detected:', errData);
      
      // Smart non-destructive merge: re-fetch latest from server and reapply our local task statuses
      try {
        const getResp = await fetch('/api/tasks');
        if (getResp.ok) {
          const freshData = await getResp.json();
          if (freshData && Array.isArray(freshData.tasks)) {
            const localMap = new Map();
            for (const t of projectTasksList) {
              if (t && t.id) {
                localMap.set(String(t.id), { status: t.status, completedAt: t.completedAt, subtasks: t.subtasks });
              }
            }
            for (const ft of freshData.tasks) {
              const local = localMap.get(String(ft.id));
              if (local) {
                if (local.status && local.status !== 'todo') {
                  ft.status = local.status;
                  ft.completedAt = local.completedAt;
                }
                if (local.subtasks && Array.isArray(ft.subtasks)) {
                  for (const fst of ft.subtasks) {
                    const lst = local.subtasks.find(s => String(s.id) === String(fst.id));
                    if (lst && typeof lst.done === 'boolean') {
                      fst.done = lst.done;
                    }
                  }
                }
              }
            }
            projectTasksList = freshData.tasks;
            currentSourceRevision = freshData.source_revision || errData.server_revision || '';
            localStorage.setItem('tasks_source_revision', currentSourceRevision);
            await saveProjectTasksToStorage(false);
            renderProjectTasks();
            
            // Retry push with the fresh revision!
            const retryResp = await fetch('/api/tasks/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tasks: projectTasksList,
                source_revision: currentSourceRevision
              })
            });
            if (retryResp.ok) {
              const retryData = await retryResp.json().catch(() => ({}));
              if (retryData.source_revision) {
                currentSourceRevision = retryData.source_revision;
                localStorage.setItem('tasks_source_revision', currentSourceRevision);
              }
              hasPendingTasksSync = false;
              localStorage.setItem('tasks_pending_sync', 'false');
              updateSyncStatusUIBadge(true, 'Zsynchronizowano po scaleniu wersji ✅');
              showBannerNotification('Zsynchronizowano i scalono zadania z serwerem! ✅');
              return;
            }
          }
        }
      } catch (mergeErr) {
        console.warn('[SYNC 409] Merge failed:', mergeErr);
      }
      
      showBannerNotification('Wykryto konflikt wersji na serwerze! Pobieranie najnowszych zadań... ⚠️');
      updateSyncStatusUIBadge(false, 'Konflikt wersji (Pobieranie...) ⚠️');
      await syncTasksWithServer(true);
      return;
    }

    if (response.ok) {
      const respData = await response.json().catch(() => ({}));
      if (respData.source_revision) {
        currentSourceRevision = respData.source_revision;
        localStorage.setItem('tasks_source_revision', currentSourceRevision);
      }
      hasPendingTasksSync = false;
      localStorage.setItem('tasks_pending_sync', 'false');
      updateSyncStatusUIBadge(true, 'Zsynchronizowano z tasks_uzytkownika.md ✅');
    } else {
      hasPendingTasksSync = true;
      localStorage.setItem('tasks_pending_sync', 'true');
      updateSyncStatusUIBadge(false, 'Lokalnie (Oczekuje na sync ⏳)');
    }
  } catch (e) {
    hasPendingTasksSync = true;
    localStorage.setItem('tasks_pending_sync', 'true');
    updateSyncStatusUIBadge(false, 'Lokalnie (Offline Gotowe ⏳)');
  }
}

// Sync tasks from server endpoint /api/tasks (with tasks.json fallback for static hosting/GitHub Pages)
async function syncTasksWithServer(silent = false) {
  // If there are unpushed local changes, push them first before pulling
  if (hasPendingTasksSync) {
    await pushTasksToServer();
    if (hasPendingTasksSync) {
      // Push still failed (e.g. offline)
      return false;
    }
  }

  // 1. Try backend server endpoint /api/tasks (dynamic tasks_uzytkownika.md sync)
  try {
    const response = await fetch('/api/tasks');
    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.tasks)) {
        projectTasksList = data.tasks;
        if (data.source_revision) {
          currentSourceRevision = data.source_revision;
          localStorage.setItem('tasks_source_revision', currentSourceRevision);
        }
        hasPendingTasksSync = false;
        localStorage.setItem('tasks_pending_sync', 'false');
        localStorage.setItem(LOCAL_STORAGE_TASKS_META_KEY, JSON.stringify({
          timestamp: data.timestamp || Date.now(),
          version: data.version || 29
        }));
        await saveProjectTasksToStorage(false);
        renderProjectTasks();
        updateSyncStatusUIBadge(true, 'Zsynchronizowano z tasks_uzytkownika.md ✅');
        if (!silent) {
          showBannerNotification('Pobrano aktualną listę zadań użytkownika! 📋');
        }
        return true;
      }
    }
  } catch (apiErr) {
    // API not reachable (e.g. GitHub Pages static host or offline)
  }

  // 2. Fallback to static tasks.json (essential for GitHub Pages and offline pre-cache)
  try {
    const staticResp = await fetch('tasks.json?t=' + Date.now());
    if (staticResp.ok) {
      const staticData = await staticResp.json();
      const loadedTasks = Array.isArray(staticData)
        ? staticData
        : (staticData && Array.isArray(staticData.tasks) ? staticData.tasks : null);

      if (loadedTasks && loadedTasks.length > 0) {
        const isDemo = staticData.demo || (loadedTasks.length <= 5 && loadedTasks[0].title.includes('medytacja'));

        // Never overwrite real user tasks with public demo tasks!
        if (isDemo && projectTasksList.length > 5) {
          updateSyncStatusUIBadge(false, 'Zadania lokalne zachowane (Tryb offline)');
          if (!silent) showBannerNotification('Zadania prywatne zachowane w pamięci urządzenia. 🔒');
          return true;
        }

        const storedMetaRaw = localStorage.getItem(LOCAL_STORAGE_TASKS_META_KEY);
        let storedTimestamp = 0;
        if (storedMetaRaw) {
          try {
            storedTimestamp = JSON.parse(storedMetaRaw).timestamp || 0;
          } catch (e) {}
        }
        const incomingTimestamp = staticData.timestamp || 0;

        // If local storage is empty, or user requested sync (!silent), or tasks.json is newer:
        if (projectTasksList.length === 0 || !silent || incomingTimestamp > storedTimestamp) {
          projectTasksList = loadedTasks;
          localStorage.setItem(LOCAL_STORAGE_TASKS_META_KEY, JSON.stringify({
            timestamp: incomingTimestamp,
            version: staticData.version || 29
          }));
          await saveProjectTasksToStorage(false);
          renderProjectTasks();
          if (isDemo) {
            updateSyncStatusUIBadge(true, 'Tryb Demonstracyjny (Public Demo) 🎭');
            if (!silent) showBannerNotification('Załadowano bazę demonstracyjną (Public Demo)! 🎭');
          } else {
            updateSyncStatusUIBadge(true, 'Załadowano zadania (tasks.json v29) 📋');
            if (!silent) showBannerNotification('Załadowano listę zadań (tasks.json)! 📋');
          }
          return true;
        } else {
          // Local tasks exist, offline-ready
          updateSyncStatusUIBadge(false, hasPendingTasksSync ? 'Lokalnie (Oczekuje na sync ⏳)' : 'Lokalnie (Offline Gotowe)');
          return true;
        }
      }
    }
  } catch (staticErr) {
    console.warn('Fallback to tasks.json failed:', staticErr);
  }

  // 3. Fallback when neither source is accessible
  updateSyncStatusUIBadge(false, hasPendingTasksSync ? 'Lokalnie (Oczekuje na sync ⏳)' : 'Lokalnie (Offline Gotowe)');
  if (!silent) {
    showBannerNotification('Tryb Offline — używasz lokalnej bazy zadań. 📴');
  }
  return false;
}

// Auto-flush pending sync when device comes back online
window.addEventListener('online', async () => {
  console.log('[NETWORK] Device is back online. Syncing pending changes...');
  if (hasPendingTasksSync) {
    await pushTasksToServer();
  } else {
    await syncTasksWithServer(true);
  }
});

function updateSyncStatusUIBadge(isOnline, text) {
  const dot = document.getElementById('task-sync-dot');
  const label = document.getElementById('task-sync-text');
  if (dot && label) {
    dot.className = isOnline ? 'status-dot online' : 'status-dot offline';
    label.innerText = text;
  }
}

// --- 4-STOPNIOWY KOMPARATOR SORTOWANIA ZADAŃ ---
function extractDeadline(title) {
  if (!title) return null;
  const m = title.match(/\[DEADLINE:\s*(\d{4}-\d{2}-\d{2})\]/);
  return m ? m[1] : null;
}

function extractPriority(title) {
  if (!title) return 5;
  if (title.includes('[DEADLINE:')) return 11;
  const m = title.match(/\[(\d{1,2})\/10\]/);
  return m ? parseInt(m[1], 10) : 5;
}

function compareTasks4Step(a, b) {
  // 1. Status: 🔵 Hero (in_progress) zawsze na szczycie
  const isHeroA = a.status === 'in_progress' ? 1 : 0;
  const isHeroB = b.status === 'in_progress' ? 1 : 0;
  if (isHeroA !== isHeroB) return isHeroB - isHeroA;

  // 2. Twarde terminy: [DEADLINE: YYYY-MM-DD] rosnąco chronologicznie
  const dlA = a.deadline || extractDeadline(a.title);
  const dlB = b.deadline || extractDeadline(b.title);
  if (dlA && dlB) {
    if (dlA !== dlB) return dlA.localeCompare(dlB);
  } else if (dlA && !dlB) {
    return -1;
  } else if (!dlA && dlB) {
    return 1;
  }

  // 3. Ważność: malejąco od 11/10 do 1/10
  const prioA = typeof a.priority === 'number' ? a.priority : extractPriority(a.title);
  const prioB = typeof b.priority === 'number' ? b.priority : extractPriority(b.title);
  if (prioA !== prioB) return prioB - prioA;

  // 4. Stabilny indeks linii z pliku
  const numA = parseInt(String(a.id).replace(/\D/g, ''), 10) || 0;
  const numB = parseInt(String(b.id).replace(/\D/g, ''), 10) || 0;
  return numA - numB;
}

// 3. Render Project Tasks (Traffic light logic, 4-stopniowy komparator, Dulsevia & subtasks)
function renderProjectTasks() {
  updateDulseviaUI();
  updateRegenerationUI();

  const countAll = projectTasksList.length;
  const inProgressTasks = projectTasksList.filter(t => t.status === 'in_progress');
  const todoTasks = projectTasksList.filter(t => t.status === 'todo');
  const pendingTasks = projectTasksList.filter(t => t.status === 'pending');
  const doneTasks = projectTasksList.filter(t => t.status === 'done');

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };
  setEl('count-all', countAll);
  setEl('count-in_progress', inProgressTasks.length);
  setEl('count-todo', todoTasks.length);
  setEl('count-pending', pendingTasks.length);
  setEl('count-done', doneTasks.length);
  setEl('badge-todo-count', todoTasks.length);
  setEl('badge-pending-count', pendingTasks.length);
  setEl('badge-done-count', doneTasks.length);
  setEl('tasks-count-badge', countAll);

  // Active Hero Task Card (Zasada Jednego 🔵)
  const heroProject = document.getElementById('hero-task-project');
  const heroTitle = document.getElementById('hero-task-title');
  const heroDesc = document.getElementById('hero-task-desc');
  const heroActions = document.getElementById('hero-task-actions');

  if (inProgressTasks.length > 0) {
    const activeTask = inProgressTasks[0];
    if (heroProject) heroProject.innerText = (activeTask.size ? `[${activeTask.size}] ` : '') + (activeTask.project || 'Zadanie Główne');
    if (heroTitle) heroTitle.innerText = activeTask.title;
    if (heroDesc) heroDesc.innerHTML = activeTask.description ? formatTaskMarkdown(activeTask.description) : '(Brak opisu szczegółowego — kliknij Edytuj aby dodać notatkę)';
    
    if (heroActions) {
      heroActions.innerHTML = `
        <button class="btn btn-sm btn-done-task" onclick="completeProjectTask('${activeTask.id}')">
          <span class="material-symbols-outlined">check_circle</span> Oznacz jako Zrobione (🟢)
        </button>
        <button class="btn btn-sm btn-pause-task" onclick="pauseProjectTask('${activeTask.id}')">
          <span class="material-symbols-outlined">pause_circle</span> Wstrzymaj (🟡)
        </button>
        <button class="btn btn-sm btn-outline" onclick="resetProjectTask('${activeTask.id}')">
          <span class="material-symbols-outlined">undo</span> Cofnij do Do Zrobienia (🔴)
        </button>
        <button class="btn btn-sm btn-secondary" onclick="openEditTaskModal('${activeTask.id}')">
          <span class="material-symbols-outlined">edit</span> Edytuj
        </button>
      `;
    }
  } else {
    if (heroProject) heroProject.innerText = 'Protokół Świateł';
    if (heroTitle) heroTitle.innerText = 'Brak aktywnego zadania (0/1 🔵)';
    if (heroDesc) heroDesc.innerText = 'Wybierz jedno zadanie z poniższej listy „Do Zrobienia” i kliknij „Rozpocznij (🔵)”, aby skupić całą energię na jego realizacji!';
    if (heroActions) heroActions.innerHTML = '';
  }

  const matchesSearch = (t) => {
    if (!currentSearch) return true;
    const q = currentSearch.toLowerCase();
    return (t.title && t.title.toLowerCase().includes(q)) ||
           (t.description && t.description.toLowerCase().includes(q)) ||
           (t.project && t.project.toLowerCase().includes(q));
  };

  const showSection = (status) => currentFilter === 'all' || currentFilter === status;

  const secTodo = document.getElementById('section-todo');
  const secPending = document.getElementById('section-pending');
  const secDone = document.getElementById('section-done');

  if (secTodo) secTodo.style.display = showSection('todo') ? 'flex' : 'none';
  if (secPending) secPending.style.display = showSection('pending') ? 'flex' : 'none';
  if (secDone) secDone.style.display = showSection('done') ? 'flex' : 'none';

  // 🔴 DO ZROBIENIA (posortowane 4-stopniowym komparatorem)
  const listTodo = document.getElementById('list-todo');
  if (listTodo) {
    const filtered = todoTasks.filter(matchesSearch).sort(compareTasks4Step);
    if (filtered.length === 0) {
      listTodo.innerHTML = '<div class="task-empty-state">Brak zadań w stanie Do Zrobienia 🔴</div>';
    } else {
      listTodo.innerHTML = filtered.map(t => createTaskCardHTML(t)).join('');
    }
  }

  // 🟡 OCZEKUJE / ZABLOKOWANE
  const listPending = document.getElementById('list-pending');
  if (listPending) {
    const filtered = pendingTasks.filter(matchesSearch).sort(compareTasks4Step);
    if (filtered.length === 0) {
      listPending.innerHTML = '<div class="task-empty-state">Brak zadań w stanie Oczekuje 🟡</div>';
    } else {
      listPending.innerHTML = filtered.map(t => createTaskCardHTML(t)).join('');
    }
  }

  // 🟢 ZROBIONE
  const listDone = document.getElementById('list-done');
  if (listDone) {
    if (isDoneSectionCollapsed) {
      listDone.innerHTML = '<div class="task-empty-state">Sekcja zwinięta. Kliknij Rozwiń powyżej.</div>';
    } else {
      const filtered = doneTasks.filter(matchesSearch).sort(compareTasks4Step);
      if (filtered.length === 0) {
        listDone.innerHTML = '<div class="task-empty-state">Brak ukończonych zadań 🟢</div>';
      } else {
        listDone.innerHTML = filtered.map(t => createTaskCardHTML(t)).join('');
      }
    }
  }
}

function createTaskCardHTML(t) {
  const isDone = t.status === 'done';
  const sizeBadge = t.size ? `<span class="task-badge-size">[${escapeHTML(t.size)}]</span>` : '';
  const projectBadge = t.project ? `<span class="task-badge-project">${escapeHTML(t.project)}</span>` : '';
  
  const prioVal = typeof t.priority === 'number' ? t.priority : extractPriority(t.title);
  const prioBadge = prioVal ? `<span class="task-badge-prio">[${prioVal}/10]</span>` : '';
  const dlVal = t.deadline || extractDeadline(t.title);
  const dlBadge = dlVal ? `<span class="task-badge-deadline">⏳ ${escapeHTML(dlVal)}</span>` : '';
  const isEpic = t.is_epic || (t.title && t.title.includes('[EPIC]'));
  const epicBadge = isEpic ? `<span class="task-badge-epic">[EPIC]</span>` : '';
  const descHTML = t.description ? `<div class="task-card-desc">${formatTaskMarkdown(t.description)}</div>` : '';

  let subtasksHTML = '';
  if (t.subtasks && t.subtasks.length > 0) {
    subtasksHTML = `
      <div class="task-subtasks-list">
        ${t.subtasks.map(st => `
          <label class="task-subtask-item ${st.done ? 'subtask-done' : ''}">
            <input type="checkbox" ${st.done ? 'checked' : ''} onchange="toggleProjectSubtaskCheck('${t.id}', '${st.id}', this.checked)">
            <span>${escapeHTML(st.title)}</span>
          </label>
        `).join('')}
      </div>
    `;
  }

  let actionBtns = '';
  if (t.status === 'todo') {
    actionBtns = `
      <button class="btn-xs btn-start-task" onclick="startProjectTask('${t.id}')" title="Ustaw jako jedyne aktywne zadanie 🔵">
        Rozpocznij (🔵)
      </button>
      <button class="btn-xs btn-pause-task" onclick="pauseProjectTask('${t.id}')">
        Oczekuje (🟡)
      </button>
      <button class="btn-xs btn-done-task" onclick="completeProjectTask('${t.id}')">
        Zrobione (🟢)
      </button>
      <button class="btn-xs btn-secondary" onclick="openEditTaskModal('${t.id}')">
        Edytuj
      </button>
      <button class="btn-xs btn-delete-task" onclick="deleteProjectTask('${t.id}')">
        Usuń
      </button>
    `;
  } else if (t.status === 'pending') {
    actionBtns = `
      <button class="btn-xs btn-start-task" onclick="startProjectTask('${t.id}')">
        Rozpocznij (🔵)
      </button>
      <button class="btn-xs btn-outline" onclick="resetProjectTask('${t.id}')">
        Cofnij (🔴)
      </button>
      <button class="btn-xs btn-done-task" onclick="completeProjectTask('${t.id}')">
        Zrobione (🟢)
      </button>
      <button class="btn-xs btn-secondary" onclick="openEditTaskModal('${t.id}')">
        Edytuj
      </button>
      <button class="btn-xs btn-delete-task" onclick="deleteProjectTask('${t.id}')">
        Usuń
      </button>
    `;
  } else if (t.status === 'done') {
    actionBtns = `
      <button class="btn-xs btn-outline" onclick="resetProjectTask('${t.id}')">
        Przywróć (🔴)
      </button>
      <button class="btn-xs btn-delete-task" onclick="deleteProjectTask('${t.id}')">
        Usuń
      </button>
    `;
  } else if (t.status === 'in_progress') {
    actionBtns = `
      <button class="btn-xs btn-done-task" onclick="completeProjectTask('${t.id}')">
        Zakończ (🟢)
      </button>
      <button class="btn-xs btn-pause-task" onclick="pauseProjectTask('${t.id}')">
        Wstrzymaj (🟡)
      </button>
    `;
  }

  return `
    <div class="task-card status-${t.status}" id="task-card-${t.id}">
      <div class="task-card-header">
        <div class="task-title-wrap">
          <input type="checkbox" class="task-checkbox" ${isDone ? 'checked' : ''} onchange="toggleProjectTaskCheck('${t.id}', this.checked)">
          <span class="task-card-title">${escapeHTML(t.title)}</span>
        </div>
        <div class="task-card-meta">
          ${prioBadge}
          ${dlBadge}
          ${epicBadge}
          ${sizeBadge}
          ${projectBadge}
        </div>
      </div>
      ${descHTML}
      ${subtasksHTML}
      <div class="task-card-actions">
        ${actionBtns}
      </div>
    </div>
  `;
}

// Start a task -> Enforce Zasada Jednego 🔵
window.startProjectTask = async function(id) {
  const task = projectTasksList.find(t => String(t.id) === String(id));
  if (!task) return;

  for (const t of projectTasksList) {
    if (t.status === 'in_progress' && String(t.id) !== String(id)) {
      t.status = 'todo';
    }
  }

  task.status = 'in_progress';
  task.updatedAt = new Date().toISOString();
  await saveProjectTasksToStorage();
  renderProjectTasks();
  showBannerNotification(`Zadanie aktywne (🔵): ${task.title}`);
};

// Complete a task
window.completeProjectTask = async function(id) {
  const task = projectTasksList.find(t => String(t.id) === String(id));
  if (!task) return;

  task.status = 'done';
  task.completedAt = new Date().toISOString();
  playSuccessSound();
  await evaluateStreakProgress();
  await saveProjectTasksToStorage();
  renderProjectTasks();
  showBannerNotification(`Ukończono zadanie (🟢)! Świetna robota.`);
};

// Pause a task to pending (🟡)
window.pauseProjectTask = async function(id) {
  const task = projectTasksList.find(t => String(t.id) === String(id));
  if (!task) return;

  task.status = 'pending';
  task.updatedAt = new Date().toISOString();
  await saveProjectTasksToStorage();
  renderProjectTasks();
  showBannerNotification(`Zadanie wstrzymane (🟡 Oczekuje).`);
};

// Reset a task back to todo (🔴)
window.resetProjectTask = async function(id) {
  const task = projectTasksList.find(t => String(t.id) === String(id));
  if (!task) return;

  task.status = 'todo';
  task.updatedAt = new Date().toISOString();
  await saveProjectTasksToStorage();
  renderProjectTasks();
};

// Checkbox toggle
window.toggleProjectTaskCheck = async function(id, isChecked) {
  if (isChecked) {
    await completeProjectTask(id);
  } else {
    await resetProjectTask(id);
  }
};

// Subtask checkbox toggle (Epics dwukierunkowy sync)
window.toggleProjectSubtaskCheck = async function(taskId, subtaskId, isChecked) {
  const task = projectTasksList.find(t => String(t.id) === String(taskId));
  if (!task || !task.subtasks) return;
  const sub = task.subtasks.find(s => String(s.id) === String(subtaskId));
  if (sub) {
    sub.done = isChecked;
    task.updatedAt = new Date().toISOString();
    await saveProjectTasksToStorage();
    renderProjectTasks();
    showBannerNotification('Zaktualizowano krok w Epiku! ✅');
  }
};

// Delete a task
window.deleteProjectTask = async function(id) {
  const task = projectTasksList.find(t => String(t.id) === String(id));
  if (!task) return;

  if (confirm(`Na pewno usunąć zadanie:\n"${task.title}"?`)) {
    projectTasksList = projectTasksList.filter(t => String(t.id) !== String(id));
    await saveProjectTasksToStorage();
    renderProjectTasks();
    showBannerNotification('Usunięto zadanie.');
  }
};

// Open Modal for New Task
function openNewTaskModal() {
  const modal = document.getElementById('task-modal-el');
  const titleEl = document.getElementById('task-modal-title');
  const idInput = document.getElementById('task-id-input');
  const form = document.getElementById('task-form');

  if (modal && form) {
    form.reset();
    idInput.value = '';
    titleEl.innerText = 'Nowe Zadanie';
    document.getElementById('task-status-select').value = 'todo';
    document.getElementById('task-size-select').value = 'S';
    document.getElementById('task-project-input').value = 'Life Coach';
    modal.classList.remove('hidden');
    document.getElementById('task-title-input').focus();
  }
}

// Open Modal for Edit Task
window.openEditTaskModal = function(id) {
  const task = projectTasksList.find(t => t.id === id);
  if (!task) return;

  const modal = document.getElementById('task-modal-el');
  const titleEl = document.getElementById('task-modal-title');
  const idInput = document.getElementById('task-id-input');

  if (modal) {
    idInput.value = task.id;
    titleEl.innerText = 'Edycja Zadania';
    document.getElementById('task-title-input').value = task.title || '';
    document.getElementById('task-desc-input').value = task.description || '';
    document.getElementById('task-status-select').value = task.status || 'todo';
    document.getElementById('task-size-select').value = task.size || 'S';
    document.getElementById('task-project-input').value = task.project || '';
    modal.classList.remove('hidden');
  }
};

// Tab Navigation Switching
function switchView(viewId) {
  const viewTasks = document.getElementById('view-tasks');
  const viewCoach = document.getElementById('view-coach');
  const tabTasksBtn = document.getElementById('tab-tasks-btn');
  const tabCoachBtn = document.getElementById('tab-coach-btn');
  const fabReview = document.getElementById('start-review-fab');

  if (viewId === 'view-coach') {
    if (viewCoach) viewCoach.classList.remove('hidden');
    if (viewTasks) viewTasks.classList.add('hidden');
    if (tabCoachBtn) tabCoachBtn.classList.add('active');
    if (tabTasksBtn) tabTasksBtn.classList.remove('active');
    if (fabReview) fabReview.style.display = 'flex';
    window.location.hash = '#coach';
  } else {
    if (viewTasks) viewTasks.classList.remove('hidden');
    if (viewCoach) viewCoach.classList.add('hidden');
    if (tabTasksBtn) tabTasksBtn.classList.add('active');
    if (tabCoachBtn) tabCoachBtn.classList.remove('active');
    if (fabReview) fabReview.style.display = 'none';
    window.location.hash = '#tasks';
  }
}

// Backup & Raw Export/Import Handlers
function openTasksBackupModal() {
  const modal = document.getElementById('tasks-backup-modal-el');
  const textarea = document.getElementById('tasks-raw-textarea');
  if (modal && textarea) {
    textarea.value = JSON.stringify(projectTasksList, null, 2);
    modal.classList.remove('hidden');
  }
}

function exportTasksJSON() {
  const textarea = document.getElementById('tasks-raw-textarea');
  if (textarea) {
    textarea.value = JSON.stringify(projectTasksList, null, 2);
    showBannerNotification('Wygenerowano JSON zadań.');
  }
}

function exportTasksMarkdown() {
  const textarea = document.getElementById('tasks-raw-textarea');
  if (!textarea) return;
  
  let md = `# 📋 Zadania Użytkownika: Life Coach\n\n`;
  const inProgress = projectTasksList.filter(t => t.status === 'in_progress');
  const todo = projectTasksList.filter(t => t.status === 'todo');
  const pending = projectTasksList.filter(t => t.status === 'pending');
  const done = projectTasksList.filter(t => t.status === 'done');

  const formatTask = (t, isDone = false) => {
    const box = isDone ? '[x]' : '[ ]';
    const proj = t.project ? `(${t.project}) ` : '';
    let res = `- ${box} [${t.size || 'M'}] ${proj}${t.title}\n`;
    if (t.description) {
      for (const d of t.description.split('\n')) {
        if (d.trim()) res += `  ${d.trim()}\n`;
      }
    }
    return res;
  };

  md += `## 🔵 W toku (Maksymalnie 1)\n\n`;
  if (inProgress.length > 0) {
    for (const t of inProgress) md += formatTask(t, false);
  } else {
    md += `*(Brak zadań w toku)*\n`;
  }

  md += `\n---\n\n## 🔴 Do zrobienia\n\n`;
  for (const t of todo) md += formatTask(t, false);

  md += `\n---\n\n## 🟡 Oczekuje na ocenę człowieka\n\n`;
  for (const t of pending) md += formatTask(t, false);

  md += `\n---\n\n## 🟢 Zrobione\n\n`;
  for (const t of done) md += formatTask(t, true);

  textarea.value = md;
  showBannerNotification('Wygenerowano Markdown zadań użytkownika (Protokół Świateł).');
}

async function importTasksRaw() {
  const textarea = document.getElementById('tasks-raw-textarea');
  if (!textarea) return;
  const raw = textarea.value.trim();
  if (!raw) return;

  try {
    if (raw.startsWith('[') || raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      projectTasksList = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
    } else {
      const lines = raw.split('\n');
      const imported = [];
      let currentStatus = 'todo';
      let idCounter = Date.now();

      for (const line of lines) {
        const str = line.trim();
        if (str.includes('## 🔵') || str.includes('W toku')) currentStatus = 'in_progress';
        else if (str.includes('## 🔴') || str.includes('Do zrobienia')) currentStatus = 'todo';
        else if (str.includes('## 🟡') || str.includes('Oczekuje')) currentStatus = 'pending';
        else if (str.includes('## 🟢') || str.includes('Zrobione')) currentStatus = 'done';
        else if (str.startsWith('- [')) {
          const isDone = str.startsWith('- [x]') || str.startsWith('- [X]');
          const status = isDone ? 'done' : currentStatus;
          const sizeMatch = str.match(/\[([SML])\]/);
          const size = sizeMatch ? sizeMatch[1] : 'M';
          const cleanTitle = str.replace(/^-\s*\[[ xX]\]\s*(\[[SML]\])?\s*/, '').trim();
          if (cleanTitle && !cleanTitle.startsWith('*(')) {
            imported.push({
              id: idCounter++,
              title: cleanTitle,
              description: '',
              status: status,
              size: size,
              project: 'Life Coach'
            });
          }
        }
      }
      if (imported.length > 0) {
        projectTasksList = imported;
      }
    }
    await saveProjectTasksToStorage();
    renderProjectTasks();
    document.getElementById('tasks-backup-modal-el').classList.add('hidden');
    showBannerNotification('Zaimportowano zadania pomyślnie! ✅');
  } catch (e) {
    alert('Błąd importu: ' + e.message);
  }
}

// --- EVENT LISTENERS & MODAL HANDLERS ---
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Database and check status
  await initDB();
  await seedDefaultData();
  window.dispatchEvent(new CustomEvent('db-ready'));
  await checkDailyRollover();
  
  // Auto-import state from server on startup (so phone picks up PC's data)
  try {
    if (window.importAppStateFromServer) {
      await window.importAppStateFromServer();
    }
  } catch (e) {
    console.warn('Auto-sync on startup failed:', e);
  }
  
  await updateUI();
  // Load Project Tasks (Home view)
  await loadProjectTasks();

  // Tab Navigation Listeners
  const tabTasksBtn = document.getElementById('tab-tasks-btn');
  const tabCoachBtn = document.getElementById('tab-coach-btn');
  if (tabTasksBtn) tabTasksBtn.addEventListener('click', () => switchView('view-tasks'));
  if (tabCoachBtn) tabCoachBtn.addEventListener('click', () => switchView('view-coach'));

  // Header streak card switches to Trener RPG
  const streakCard = document.getElementById('streak-card-el');
  if (streakCard) streakCard.addEventListener('click', () => switchView('view-coach'));

  // Check URL hash routing
  if (window.location.hash === '#coach') {
    switchView('view-coach');
  } else {
    switchView('view-tasks');
  }
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#coach') switchView('view-coach');
    else switchView('view-tasks');
  });

  // Task Filters Chips
  document.querySelectorAll('.filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter');
      renderProjectTasks();
    });
  });

  // Task Search Input
  const searchInput = document.getElementById('tasks-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearch = e.target.value.trim();
      renderProjectTasks();
    });
  }

  // Add Task Button & Modal
  const btnAddTask = document.getElementById('btn-add-task');
  if (btnAddTask) btnAddTask.addEventListener('click', openNewTaskModal);

  const closeTaskModalBtn = document.getElementById('close-task-modal-btn');
  const cancelTaskBtn = document.getElementById('cancel-task-btn');
  const taskModal = document.getElementById('task-modal-el');
  if (closeTaskModalBtn) closeTaskModalBtn.addEventListener('click', () => taskModal.classList.add('hidden'));
  if (cancelTaskBtn) cancelTaskBtn.addEventListener('click', () => taskModal.classList.add('hidden'));
  if (taskModal) {
    taskModal.addEventListener('click', (e) => {
      if (e.target === taskModal) taskModal.classList.add('hidden');
    });
  }

  // Task Form Submit
  const taskForm = document.getElementById('task-form');
  if (taskForm) {
    taskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const idVal = document.getElementById('task-id-input').value;
      const titleVal = document.getElementById('task-title-input').value.trim();
      const descVal = document.getElementById('task-desc-input').value.trim();
      const statusVal = document.getElementById('task-status-select').value;
      const sizeVal = document.getElementById('task-size-select').value;
      const projectVal = document.getElementById('task-project-input').value.trim() || 'Life Coach';

      if (!titleVal) return;

      if (idVal) {
        // Edit existing
        const task = projectTasksList.find(t => String(t.id) === String(idVal));
        if (task) {
          if (statusVal === 'in_progress' && task.status !== 'in_progress') {
            for (const t of projectTasksList) {
              if (t.status === 'in_progress') t.status = 'todo';
            }
          }
          task.title = titleVal;
          task.description = descVal;
          task.status = statusVal;
          task.size = sizeVal;
          task.project = projectVal;
          task.updatedAt = new Date().toISOString();
        }
      } else {
        // Create new
        if (statusVal === 'in_progress') {
          for (const t of projectTasksList) {
            if (t.status === 'in_progress') t.status = 'todo';
          }
        }
        const newTask = {
          id: Date.now(),
          title: titleVal,
          description: descVal,
          status: statusVal,
          size: sizeVal,
          project: projectVal,
          createdAt: new Date().toISOString()
        };
        projectTasksList.unshift(newTask);
      }

      await saveProjectTasksToStorage();
      renderProjectTasks();
      taskModal.classList.add('hidden');
      showBannerNotification('Zapisano zadanie! ✅');
    });
  }

  // Sync tasks.md Button
  const btnSyncTasks = document.getElementById('btn-sync-tasks');
  if (btnSyncTasks) {
    btnSyncTasks.addEventListener('click', async () => {
      btnSyncTasks.classList.add('loading');
      await syncTasksWithServer(false);
      btnSyncTasks.classList.remove('loading');
    });
  }

  // Backup / Raw Modal Buttons
  const btnBackupTasks = document.getElementById('btn-backup-tasks');
  const closeBackupModalBtn = document.getElementById('close-backup-modal-btn');
  const backupModal = document.getElementById('tasks-backup-modal-el');
  if (btnBackupTasks) btnBackupTasks.addEventListener('click', openTasksBackupModal);
  if (closeBackupModalBtn) closeBackupModalBtn.addEventListener('click', () => backupModal.classList.add('hidden'));
  if (backupModal) {
    backupModal.addEventListener('click', (e) => {
      if (e.target === backupModal) backupModal.classList.add('hidden');
    });
  }

  const btnExportJson = document.getElementById('btn-export-json');
  const btnExportMd = document.getElementById('btn-export-md');
  const btnImportRaw = document.getElementById('btn-import-raw');
  if (btnExportJson) btnExportJson.addEventListener('click', exportTasksJSON);
  if (btnExportMd) btnExportMd.addEventListener('click', exportTasksMarkdown);
  if (btnImportRaw) btnImportRaw.addEventListener('click', importTasksRaw);

  // Toggle Done Section
  const toggleDoneBtn = document.getElementById('toggle-done-tasks-btn');
  if (toggleDoneBtn) {
    toggleDoneBtn.addEventListener('click', () => {
      isDoneSectionCollapsed = !isDoneSectionCollapsed;
      toggleDoneBtn.innerText = isDoneSectionCollapsed ? 'Rozwiń' : 'Zwiń';
      renderProjectTasks();
    });
  }

  // Settings Server Sync Pull & Push
  const serverPullBtn = document.getElementById('server-sync-pull-btn');
  const serverPushBtn = document.getElementById('server-sync-push-btn');
  const serverSyncStatus = document.getElementById('server-sync-status-el');

  if (serverPullBtn) {
    serverPullBtn.addEventListener('click', async () => {
      if (window.importAppStateFromServer) {
        await window.importAppStateFromServer();
      }
      await syncTasksWithServer(false);
      if (serverSyncStatus) {
        serverSyncStatus.innerText = 'Pobrano stan i zadania z serwera!';
        serverSyncStatus.classList.remove('hidden');
        setTimeout(() => serverSyncStatus.classList.add('hidden'), 3000);
      }
    });
  }

  if (serverPushBtn) {
    serverPushBtn.addEventListener('click', async () => {
      if (window.syncAppStateToServer) {
        await window.syncAppStateToServer();
      }
      await pushTasksToServer();
      if (serverSyncStatus) {
        serverSyncStatus.innerText = 'Wysłano stan i zadania na serwer!';
        serverSyncStatus.classList.remove('hidden');
        setTimeout(() => serverSyncStatus.classList.add('hidden'), 3000);
      }
    });
  }


  // Initialize Notifications UI and Start Timer
  if ('Notification' in window) {
    updateNotificationsUI(Notification.permission);
  }
  startNotificationTimer();

  // Settings Modal Selectors
  const settingsModal = document.getElementById('settings-modal-el');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const overlay = document.getElementById('settings-modal-el');

  // Open settings
  openSettingsBtn.addEventListener('click', async () => {
    settingsModal.classList.remove('hidden');
    // Load saved API Key and Client ID into input
    const savedKeyObj = await dbGet('preferences', 'gemini_api_key');
    if (savedKeyObj && savedKeyObj.value) {
      document.getElementById('gemini-key-input').value = savedKeyObj.value;
    }
    const savedModelObj = await dbGet('preferences', 'ai_model_id');
    if (savedModelObj && savedModelObj.value) {
      document.getElementById('ai-model-input').value = savedModelObj.value;
    }
    const savedUrlObj = await dbGet('preferences', 'ai_api_url');
    if (savedUrlObj && savedUrlObj.value) {
      document.getElementById('ai-url-input').value = savedUrlObj.value;
    } else {
      const currentModel = document.getElementById('ai-model-input').value;
      document.getElementById('ai-url-input').value = getApiUrlForModel(currentModel);
    }
    const savedClientIdObj = await dbGet('preferences', 'google_client_id');
    if (savedClientIdObj) {
      document.getElementById('google-client-id-input').value = savedClientIdObj.value;
    }
    // Update notification button UI
    if ('Notification' in window) {
      updateNotificationsUI(Notification.permission);
    }
  });

  function getApiUrlForModel(model) {
    if (model === 'gpt-oss-120b' || model === 'gemma-4-31b') {
      return 'https://api.cerebras.ai/v1/chat/completions';
    } else if (model === 'llama-3.3-70b-versatile') {
      return 'https://api.groq.com/openai/v1/chat/completions';
    } else if (model.startsWith('google/gemini') || model.includes('gemini-2.5') || model.includes('gemini-1.5')) {
      return ''; // Google API uses direct Gemini endpoint, no custom URL needed
    } else {
      return 'https://openrouter.ai/api/v1/chat/completions';
    }
  }

  // Auto-fill URL based on model selection
  document.getElementById('ai-model-input').addEventListener('change', (e) => {
    const val = e.target.value;
    document.getElementById('ai-url-input').value = getApiUrlForModel(val);
  });

  // Close settings
  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });
  
  // Close settings on overlay click
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
    }
  });

  // Close Info/Help Modal
  const infoModal = document.getElementById('info-modal-el');
  const closeInfoBtn = document.getElementById('close-info-btn');
  if (closeInfoBtn) {
    closeInfoBtn.addEventListener('click', () => {
      infoModal.classList.add('hidden');
    });
  }
  if (infoModal) {
    infoModal.addEventListener('click', (e) => {
      if (e.target === infoModal) {
        infoModal.classList.add('hidden');
      }
    });
  }

  // Save AI Settings
  const saveBtn = document.getElementById('save-ai-settings-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const keyVal = document.getElementById('gemini-key-input').value.trim();
      const modelVal = document.getElementById('ai-model-input').value;
      const urlVal = document.getElementById('ai-url-input').value.trim();

      await dbPut('preferences', { key: 'gemini_api_key', value: keyVal });
      await dbPut('preferences', { key: 'ai_model_id', value: modelVal });
      await dbPut('preferences', { key: 'ai_api_url', value: urlVal });

      const statusMsg = document.getElementById('key-status-el');
      statusMsg.innerText = 'Zapisano ustawienia AI!';
      statusMsg.classList.remove('hidden');
      setTimeout(() => {
        statusMsg.classList.add('hidden');
      }, 3000);
      
      // Sync state to server so phone picks up the API key
      if (window.syncAppStateToServer) {
        window.syncAppStateToServer();
      }
    });
  }

  // Request notifications permission button
  document.getElementById('request-notifications-btn').addEventListener('click', requestNotificationPermission);

  // Global generate buttons via event delegation
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('#generate-today-btn, #generate-today-btn-inner');
    if (btn) {
      triggerAIGeneration();
    }
  });

  // --- EVENING REVIEW UI LOGIC ---
  const reviewModal = document.getElementById('review-modal-el');
  document.getElementById('start-review-fab').addEventListener('click', () => {
    reviewModal.classList.remove('hidden');
    if (window.startEveningReview) {
      window.startEveningReview();
    }
  });

  document.getElementById('close-review-btn').addEventListener('click', () => {
    reviewModal.classList.add('hidden');
  });

  // Close review on overlay click
  reviewModal.addEventListener('click', (e) => {
    if (e.target === reviewModal) {
      reviewModal.classList.add('hidden');
    }
  });

  const chatInput = document.getElementById('chat-input-el');
  const chatSendBtn = document.getElementById('chat-send-btn');

  const handleSendChat = () => {
    const text = chatInput.value.trim();
    if (text && window.sendReviewMessage) {
      window.sendReviewMessage(text);
      chatInput.value = '';
    }
  };

  chatSendBtn.addEventListener('click', handleSendChat);

  // Auto-expand textarea as user types
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  });

  // --- DEVELOPER / MOCK TESTING ACTIONS ---
  
  // Complete all tasks today
  document.getElementById('test-complete-all-btn').addEventListener('click', async () => {
    const routines = await dbGetAll('routines');
    for (const r of routines) {
      r.isCompletedToday = true;
      await dbPut('routines', r);
    }
    
    const todayStr = getTodayDateString();
    const bTasks = await dbGetAll('businessTasks');
    for (const t of bTasks) {
      if (t.date === todayStr) {
        t.status = 'done';
        await dbPut('businessTasks', t);
      }
    }
    await evaluateStreakProgress();
    updateUI();
    showBannerNotification('Sukces: Wszystkie dzisiejsze zadania ukończone! ✅');
  });

  // Simulate Next Day Rollover (Subtracts 1 day from everything to check rollover logic)
  document.getElementById('test-next-day-btn').addEventListener('click', async () => {
    // 1. Shift lastActiveDate back by 1 day in state
    const currentActiveDate = new Date(streakState.lastActiveDate);
    currentActiveDate.setDate(currentActiveDate.getDate() - 1);
    streakState.lastActiveDate = currentActiveDate.toISOString().split('T')[0];
    await saveStreakState();

    // 2. Shift business tasks date back by 1 day
    const bTasks = await dbGetAll('businessTasks');
    const todayStr = getTodayDateString();
    for (const t of bTasks) {
      if (t.date === todayStr) {
        t.date = streakState.lastActiveDate; // set to yesterday
        await dbPut('businessTasks', t);
      }
    }

    showBannerNotification('Przesunięto czas o 1 dzień wstecz. Przeładuj aplikację, aby uruchomić rollover.');
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  });

  // Reset Streak to 0
  document.getElementById('test-reset-streak-btn').addEventListener('click', async () => {
    streakState.currentStreak = 0;
    streakState.isStreakMaintainedToday = false;
    streakState.gracePeriodActive = false;
    await saveStreakState();
    updateUI();
    showBannerNotification('Reset: Licznik serii wyzerowany.');
  });

  // Add 1 Streak Shield
  document.getElementById('test-add-shield-btn').addEventListener('click', async () => {
    if (streakState.shieldsAvailable < 3) {
      streakState.shieldsAvailable++;
      await saveStreakState();
      updateUI();
      showBannerNotification('Dodano 1 Tarczę Serii 🛡️');
    } else {
      showBannerNotification('Błąd: Masz już maksymalną liczbę tarcz (3).');
    }
  });

  // Reset entire local database
  document.getElementById('reset-database-btn').addEventListener('click', async () => {
    if (!confirm('Na pewno chcesz wyczyścić całą lokalną bazę? Stracisz streak, rutyny i zadania. Klucz API Gemini zostanie zachowany.')) {
      return;
    }
    // Save API key and Google credentials before reset
    const savedApiKey = await dbGet('preferences', 'gemini_api_key');
    const savedClientId = await dbGet('preferences', 'google_client_id');
    const savedToken = await dbGet('preferences', 'google_access_token');
    const savedExpires = await dbGet('preferences', 'google_token_expires');

    // Delete and recreate all stores except preferences
    const storesToClear = ['routines', 'businessTasks', 'streakState', 'victoryJournal', 'projectTasks'];
    for (const storeName of storesToClear) {
      const items = await dbGetAll(storeName);
      for (const item of items) {
        const key = item.id || item.date || item.key;
        if (key !== undefined) {
          await dbDelete(storeName, key);
        }
      }
    }
    localStorage.removeItem(LOCAL_STORAGE_TASKS_KEY);
    localStorage.removeItem(LOCAL_STORAGE_TASKS_META_KEY);
    projectTasksList = [];

    // Clear cached Drive files from preferences but keep credentials
    const allPrefs = await dbGetAll('preferences');
    for (const pref of allPrefs) {
      if (pref.key.startsWith('file_') || pref.key === 'gdrive_last_sync' || pref.key === 'gdrive_active_projects_list') {
        await dbDelete('preferences', pref.key);
      }
    }

    showBannerNotification('Baza danych wyczyszczona. Przeładowuję aplikację... 🔄');
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  });
});

// Help Modal and Markdown Parsing Helpers
function showHelpModal(title, description) {
  const infoModal = document.getElementById('info-modal-el');
  const infoTitle = document.getElementById('info-modal-title');
  const infoBody = document.getElementById('info-modal-body');
  
  if (infoModal && infoTitle && infoBody) {
    infoTitle.innerText = title;
    infoBody.innerHTML = parseSimpleMarkdown(description);
    infoModal.classList.remove('hidden');
  }
}

function parseSimpleMarkdown(text) {
  if (!text) return '';
  // Escape HTML before parsing Markdown
  const escapedText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  return escapedText
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\*\s(.*)$/gm, '&bull; $1')
    .replace(/\n/g, '<br>');
}

// Helper to get tomorrow's date string
function getTomorrowDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0]; // "YYYY-MM-DD"
}

// ==========================================================================
// STATE SYNC ENGINE (PC ↔ Phone via Server — same as Fitatu approach)
// ==========================================================================

// Export current app state to server
window.syncAppStateToServer = async function() {
  try {
    const todayStr = getTodayDateString();
    
    const apiKeyObj = await dbGet('preferences', 'gemini_api_key');
    const modelObj = await dbGet('preferences', 'ai_model_id');
    const urlObj = await dbGet('preferences', 'ai_api_url');
    
    const routines = await dbGetAll('routines');
    const bTasks = await dbGetAll('businessTasks');
    const reviewHistoryObj = await dbGet('preferences', 'review_chat_history');
    const lastReviewDateObj = await dbGet('preferences', 'last_review_date');
    
    const state = {
      lastUpdated: Date.now(),
      device: navigator.userAgent.includes('Mobile') ? 'phone' : 'pc',
      apiKey: apiKeyObj ? apiKeyObj.value : '',
      modelId: modelObj ? modelObj.value : '',
      apiUrl: urlObj ? urlObj.value : '',
      streakState: streakState,
      date: todayStr,
      routines: routines,
      businessTasks: bTasks.filter(t => t.date === todayStr),
      reviewChatHistory: reviewHistoryObj ? reviewHistoryObj.value : [],
      lastReviewDate: lastReviewDateObj ? lastReviewDateObj.value : '',
      projectTasks: projectTasksList
    };
    
    const response = await fetch('/sync/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
    
    if (response.ok) {
      await dbPut('preferences', { key: 'last_state_sync', value: Date.now() });
      console.log('[SYNC] State saved to server.');
    }
    return state;
  } catch (err) {
    console.error('[SYNC] Save error:', err);
    return null;
  }
};

// Import app state from server
window.importAppStateFromServer = async function() {
  try {
    const response = await fetch('/sync/get');
    if (!response.ok) {
      if (response.status === 404) {
        console.log('[SYNC] No server state yet.');
        return false;
      }
      return false;
    }
    
    const cloudState = await response.json();
    if (!cloudState || !cloudState.lastUpdated) return false;
    
    const localSyncObj = await dbGet('preferences', 'last_state_sync');
    const localTimestamp = localSyncObj ? localSyncObj.value : 0;
    
    if (cloudState.lastUpdated <= localTimestamp) {
      console.log('[SYNC] Server state is older than local — skipping import.');
      return false;
    }
    
    console.log(`[SYNC] Importing state from server (from: ${cloudState.device})...`);
    
    // Import AI Settings
    if (cloudState.apiKey) {
      await dbPut('preferences', { key: 'gemini_api_key', value: cloudState.apiKey });
    }
    if (cloudState.modelId) {
      await dbPut('preferences', { key: 'ai_model_id', value: cloudState.modelId });
    }
    if (cloudState.apiUrl) {
      await dbPut('preferences', { key: 'ai_api_url', value: cloudState.apiUrl });
    }
    
    // Import Streak State
    if (cloudState.streakState) {
      streakState = cloudState.streakState;
      await saveStreakState();
    }
    
    // Import Today's Tasks (only if same date)
    const todayStr = getTodayDateString();
    if (cloudState.date === todayStr) {
      if (cloudState.routines) {
        const localRoutines = await dbGetAll('routines');
        for (const cloudR of cloudState.routines) {
          const localR = localRoutines.find(r => r.title === cloudR.title);
          if (localR) {
            localR.isCompletedToday = cloudR.isCompletedToday;
            await dbPut('routines', localR);
          }
        }
      }
      
      if (cloudState.businessTasks) {
        const localBTasks = await dbGetAll('businessTasks');
        const todayLocal = localBTasks.filter(t => t.date === todayStr);
        for (const t of todayLocal) {
          await dbDelete('businessTasks', t.id);
        }
        for (const t of cloudState.businessTasks) {
          delete t.id;
          await dbPut('businessTasks', t);
        }
      }
    }
    
    // Import Chat History
    if (cloudState.reviewChatHistory) {
      await dbPut('preferences', { key: 'review_chat_history', value: cloudState.reviewChatHistory });
    }
    if (cloudState.lastReviewDate) {
      await dbPut('preferences', { key: 'last_review_date', value: cloudState.lastReviewDate });
    }
    
    await dbPut('preferences', { key: 'last_state_sync', value: cloudState.lastUpdated });
    
    // Import Project Tasks
    if (cloudState.projectTasks && Array.isArray(cloudState.projectTasks)) {
      projectTasksList = cloudState.projectTasks;
      await saveProjectTasksToStorage(false);
    }
    
    if (typeof updateUI !== 'undefined') {
      await updateUI();
    }
    if (typeof renderProjectTasks !== 'undefined') {
      renderProjectTasks();
    }
    
    showBannerNotification('Stan pobrany z serwera! ✅');
    return true;
  } catch (err) {
    console.error('[SYNC] Import error:', err);
    return false;
  }
};
