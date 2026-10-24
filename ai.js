/* ==========================================================================
   LIFE COACH - GEMINI API INTEGRATION & PRIORITY CASCADE ENGINE
   ========================================================================== */

console.log('Gemini AI integration loaded.');

// Main generation trigger
window.generatePlanWithAI = async function() {
  const apiKeyObj = await dbGet('preferences', 'gemini_api_key');
  if (!apiKeyObj || !apiKeyObj.value) {
    showBannerNotification('Brak klucza API Gemini! Otwórz ustawienia i wpisz klucz, aby wygenerować plan. 🔑');
    return;
  }
  const apiKey = apiKeyObj.value;

  // 0. PRE-CHECK: Did we negotiate tasks yesterday evening in Rachunek Sumienia?
  const tomorrowWinsPref = await dbGet('preferences', 'file_00_Jutrzejsze_Zwyciestwa.md');
  if (tomorrowWinsPref && tomorrowWinsPref.value) {
    const text = tomorrowWinsPref.value;
    const todayStr = getTodayDateString();
    
    // Check if the file is explicitly targeted for TODAY
    if (text.includes(`Cel na: ${todayStr}`)) {
      showBannerNotification('Wczytywanie ustalonego wczorajszego planu z Dysku Google... 📥');
      try {
        // Extract JSON from the file
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
          const resultJson = JSON.parse(jsonMatch[1]);
          await saveGeneratedTasks(resultJson, todayStr);
          
          // Clear the file on Google Drive to avoid Groundhog Day
          if (window.createOrUpdateMarkdownFile && window.driveFolderId) {
            await window.createOrUpdateMarkdownFile(window.driveFolderId, '00_Jutrzejsze_Zwyciestwa.md', `Skonsumowano: ${todayStr}`);
          }
          // Also remove from local cache so we don't read it twice
          await dbPut('preferences', { key: 'file_00_Jutrzejsze_Zwyciestwa.md', value: `Skonsumowano: ${todayStr}` });
          
          return; // STOP EXECUTION! We loaded the plan, no need for Gemini API!
        }
      } catch (e) {
        console.error("Błąd podczas parsowania ustalonego planu z wczoraj:", e);
      }
    }
  }

  // 1. Load active projects configuration from cache
  const projectsFilePref = await dbGet('preferences', 'file_00_Aktywne_Projekty.md');
  if (!projectsFilePref || !projectsFilePref.value) {
    showBannerNotification('Brak plików priorytetów! Uruchom najpierw synchronizację z Dyskiem Google w ustawieniach. ☁️');
    return;
  }
  
  showBannerNotification('Life Coach analizuje Twoje projekty i priorytety... 🧠');

  try {
    const projectsMarkdown = projectsFilePref.value;
    const projects = parseActiveProjects(projectsMarkdown);
    
    if (projects.length === 0) {
      showBannerNotification('Błąd: Nie znaleziono żadnych projektów w pliku 00_Aktywne_Projekty.md. 📋');
      return;
    }

    // 2. Priority Cascade - Find the first ACTIVE project
    let activeProject = null;
    let blockedLog = [];

    for (const p of projects) {
      if (p.status === 'AKTYWNY') {
        activeProject = p;
        break;
      } else {
        blockedLog.push(`${p.name} (zablokowany: ${p.blockedReason})`);
      }
    }

    if (!activeProject) {
      showBannerNotification('Wszystkie projekty są ZABLOKOWANE! Zmień status chociaż jednego projektu na AKTYWNY. 🚫');
      return;
    }

    if (blockedLog.length > 0) {
      console.log('Kaskada priorytetów pominęła zablokowane projekty: ', blockedLog.join(', '));
    }

    // 3. Find details file for the active project
    const projectFile = await getProjectDetailFileContent(activeProject.name);
    if (!projectFile) {
      showBannerNotification(`Błąd: Nie znaleziono pliku szczegółowego (01_...) dla projektu "${activeProject.name}" na Dysku Google. ❌`);
      return;
    }

    console.log(`Wybrany aktywny projekt do generowania zadań: ${activeProject.name} (Plik: ${projectFile.fileName})`);

    // 4. Retrieve yesterday's unfinished business tasks
    const allBusinessTasks = await dbGetAll('businessTasks');
    const yesterdayStr = streakState.lastActiveDate; // rollover date
    const yesterdayUnfinished = allBusinessTasks.filter(t => t.date === yesterdayStr && t.status === 'todo');

    // 5. Construct API Request — ARCHITECTURE: Single Source of Truth
    // System prompt = ONLY RULES (never changes)
    // User facts = loaded from 00_Kontekst.md on Drive (editable without code changes)
    const systemPrompt = `Jesteś bezkompromisowym, zorientowanym na wyniki Trenerem Życiowym i Biznesowym (Life Coach).
Twoim zadaniem jest codziennie analizować priorytety użytkownika i generować DOKŁADNIE 1 do maksymalnie 3 mikro-zadań na dziś.

BEZWZGLĘDNE REGUŁY GENEROWANIA ZADAŃ:
1. Zadania MUSZĄ być możliwe do wykonania w maksymalnie 30 minut każde.
2. Zadania MUSZĄ być KONKRETNE i AKTYWNE — akcja, nie refleksja.
   DOBRY przykład: "Zweryfikuj jakość draftu aplikacji do firmy X z folderu Robocze/"
   ZŁY przykład: "Pomyśl o strategii marketingowej"
3. ZAKAZ generowania zadań typu: "poczytaj o...", "zastanów się nad...", "przygotuj plan...", "zrób research...", "szukaj ofert pracy w internecie". Użytkownik ma ROBIĆ, nie planować.
4. Użytkownik ma tendencję do ROZGRZEBYWANIA tematów i NIEDOMYKANIA ich. Pilnuj domykania spraw w toku — jeśli wczoraj zaczął coś, dzisiaj to KOŃCZY.
5. Jeśli użytkownik ma nieukończone zadania z wczoraj, uwzględnij je w pierwszej kolejności, o ile wciąż są aktualne.
6. Użytkownik posiada automatyczne skrypty Python opisane w pliku kontekstowym. Nie każ mu robić tego, co robią skrypty. Każ mu DZIAŁAĆ na wynikach skryptów.
7. UWAGA NA ZEPSUTE NARZĘDZIA: BARDZO WAŻNA ZASADA: Użytkownik to "Nadzorca/CEO", a nie pracownik wykonawczy!
Użytkownik nie pisze ręcznie kodu, nie pisze draftów, nie naprawia sam skryptów. Od tego ma agentów AI (np. Ciebie, Antigravity, Claude). 
Dlatego nigdy nie przydzielaj mu zadań typu "Napisz poprawkę do draftu" albo "Odpowiedz na posta". 
Zamiast tego przydzielaj zadania decyzyjne i weryfikacyjne, np.: "Sprawdź, czy AI dobrze napisało draft", "Zleć agentowi poprawę błędu", "Przeanalizuj odpowiedź".
Jeśli w notatkach jest napisane, że narzędzie jest ZEPSUTE, wygeneruj zadanie "Zleć agentowi naprawę narzędzia X".
8. ZAKAZ generowania zadań wysyłania draftów bez weryfikacji — drafty MUSZĄ być najpierw zweryfikowane i uznane za akceptowalne przez CEO.
9. ZAKAZ generowania zadań związanych z kampaniami reklamowymi na FB — produkt CV Generator nie jest jeszcze gotowy do masowej promocji.
10. ZAKAZ generowania zadań dla zepsutych narzędzi (fb_scout.py, scout.py) — jeśli narzędzie ma STATUS: ZEPSUTY, nie generuj zadań wymagających jego użycia.

KASKADA PRIORYTETÓW:
Jeśli projekt o najwyższym priorytecie ma status ZABLOKOWANY, automatycznie przejdź do następnego AKTYWNEGO projektu. Nigdy nie generuj zadań dla zablokowanych projektów.

HIERARCHIA DŹWIGNI (od najważniejszego):
1. Dostarczenie gotowego produktu klientowi / wysłanie gotowej aplikacji (leverageLevel: 4)
2. Praca z wynikami skryptów — odpowiedź na leady, wysłanie draftów (leverageLevel: 3)  
3. Aktywne pozyskiwanie klientów — organiczne budowanie marki eksperta (leverageLevel: 2)
4. Prace operacyjne / techniczne wspierające powyższe (leverageLevel: 1)`;

    // Load user context from Drive-synced file (single source of truth for facts)
    const contextFilePref = await dbGet('preferences', 'file_00_Kontekst.md');
    const contextSection = contextFilePref && contextFilePref.value
      ? `\n=== MÓJ KONTEKST ŻYCIOWY (z pliku 00_Kontekst.md) ===\n${contextFilePref.value}`
      : '\n(Brak pliku 00_Kontekst.md na Dysku — użytkownik nie zsynchronizował kontekstu)';

    // Load calendar events to feed into AI planner
    const calendarEventsPref = await dbGet('preferences', 'google_calendar_events_today');
    const calendarEvents = (calendarEventsPref && calendarEventsPref.value) || [];
    const calendarSection = calendarEvents.length > 0
      ? `\n=== MOJE WYDARZENIA Z KALENDARZA NA DZIŚ ===\n${calendarEvents.map(ev => `- [${ev.time}] ${ev.summary}`).join('\n')}`
      : '\n=== MOJE WYDARZENIA Z KALENDARZA NA DZIŚ ===\n- Brak zaplanowanych spotkań/wydarzeń w kalendarzu na dziś';

    const userMessage = `Dzisiaj jest: ${getTodayDateString()} (${new Date().toLocaleDateString('pl-PL', { weekday: 'long' })}).
Użytkownik wczoraj NIE ukończył następujących zadań biznesowych:
${yesterdayUnfinished.length > 0 ? yesterdayUnfinished.map(t => `- [${t.projectAssociation}] ${t.title}: ${t.description}`).join('\n') : '- Brak nieukończonych zadań z wczoraj'}

=== MOJE AKTYWNE PROJEKTY (Z KOLEJNOŚCIĄ PRIORYTETÓW) ===
${projectsMarkdown}

=== SZCZEGÓŁY DLA WYBRANEGO AKTYWNEGO PROJEKTU ("${activeProject.name}") ===
${projectFile.content}
${contextSection}
${calendarSection}`;

    // Show API loading status
    showBannerNotification('Łączenie z AI i planowanie dnia... 🌐🧠');

    const modelObj = await dbGet('preferences', 'ai_model_id');
    const modelId = (modelObj && modelObj.value) ? modelObj.value : 'openai/gpt-4o-mini';

    const urlObj = await dbGet('preferences', 'ai_api_url');
    const customUrl = (urlObj && urlObj.value) ? urlObj.value.trim() : '';

    let response, data, responseText;

    const isOpenAICompatible = customUrl !== '' || apiKey.startsWith('sk-or') || apiKey.startsWith('gsk_') || apiKey.startsWith('csk_') || apiKey.startsWith('csk-');
    
    // Google Gemini models go through Google API (not OpenAI compatible)
    const isGoogleGemini = modelId.startsWith('google/gemini') || modelId.startsWith('gemini-');

    if (isOpenAICompatible && !isGoogleGemini) {
      const apiEndpoint = customUrl || 'https://openrouter.ai/api/v1/chat/completions';
      
      response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: "system",
              content: systemPrompt + "\nWygeneruj wynik jako poprawny obiekt JSON. Użyj formatu:\n{\n\"activeProject\": \"...\",\n\"tasks\": [{\"title\": \"...\", \"description\": \"...\", \"leverageLevel\": 1, \"estimatedMinutes\": 15}],\n\"coachNote\": \"...\"\n}"
            },
            {
              role: "user",
              content: "[DANE WEJŚCIOWE UŻYTKOWNIKA]\n" + userMessage
            }
          ]
        })
      });
      data = await response.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      if (data.message && !data.choices) throw new Error(data.message); // Cerebras error format
      responseText = data.choices[0].message.content;

    } else {
      let googleModel = modelId || 'gemini-1.5-flash';
      if (googleModel.includes('/')) googleModel = googleModel.split('/')[1];

      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: systemPrompt + "\n\n[DANE WEJŚCIOWE UŻYTKOWNIKA]\n" + userMessage }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                activeProject: { type: "STRING" },
                tasks: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING" },
                      description: { type: "STRING" },
                      leverageLevel: { type: "INTEGER" },
                      estimatedMinutes: { type: "INTEGER" }
                    }
                  }
                },
                coachNote: { type: "STRING" }
              }
            }
          }
        })
      });
      data = await response.json();
      if (data.error) throw new Error(data.error.message);
      responseText = data.candidates[0].content.parts[0].text;
    }

    const resultJson = JSON.parse(responseText);

    await saveGeneratedTasks(resultJson, getTodayDateString());

  } catch (error) {
    console.error('Gemini Generation error:', error);
    showBannerNotification('Wystąpił błąd podczas generowania planu przez AI. Sprawdź klucz API i połączenie z siecią. ❌');
  }
};

async function saveGeneratedTasks(resultJson, targetDateStr) {
  // Clear old tasks for that date
  const currentTasks = await dbGetAll('businessTasks');
  for (const t of currentTasks) {
    if (t.date === targetDateStr) {
      await dbDelete('businessTasks', t.id);
    }
  }

  // Insert new tasks (HARD LIMIT TO 5)
  const tasksToSave = (resultJson.tasks || []).slice(0, 5);
  for (const t of tasksToSave) {
    await dbPut('businessTasks', {
      title: t.title,
      description: t.description,
      projectAssociation: resultJson.activeProject || 'Rachunek Sumienia',
      status: 'todo',
      date: targetDateStr,
      leverageLevel: t.leverageLevel || 1,
      estimatedMinutes: t.estimatedMinutes || 15
    });
  }

  streakState.coachNote = resultJson.coachNote || 'Plan został zaktualizowany.';
  await saveStreakState();

  showBannerNotification(streakState.coachNote);
  if (typeof updateUI !== 'undefined') {
    await updateUI();
  }
}

// --- EVENING REVIEW (RACHUNEK SUMIENIA) ENGINE ---
let reviewChatHistory = [];
let lastReviewDate = '';

window.startEveningReview = async function() {
  const apiKeyObj = await dbGet('preferences', 'gemini_api_key');
  if (!apiKeyObj || !apiKeyObj.value) {
    alert('Brak klucza API!');
    return;
  }
  const apiKey = apiKeyObj.value;

  const todayStr = getTodayDateString();
  const container = document.getElementById('chat-messages-container');

  // Load history from DB
  const savedDateObj = await dbGet('preferences', 'last_review_date');
  const savedDate = savedDateObj ? savedDateObj.value : '';

  const urlObj = await dbGet('preferences', 'ai_api_url');
  const customUrl = (urlObj && urlObj.value) ? urlObj.value.trim() : '';
  const isOpenAICompatible = customUrl !== '' || apiKey.startsWith('sk-or') || apiKey.startsWith('gsk_') || apiKey.startsWith('csk_') || apiKey.startsWith('csk-');

  if (savedDate !== todayStr) {
    // New day! Clear everything
    reviewChatHistory = [];
    await dbDelete('preferences', 'review_chat_history');
    await dbPut('preferences', { key: 'last_review_date', value: todayStr });
    lastReviewDate = todayStr;
    container.innerHTML = '';
  } else {
    const savedHistoryObj = await dbGet('preferences', 'review_chat_history');
    reviewChatHistory = savedHistoryObj ? savedHistoryObj.value : [];
    lastReviewDate = todayStr;
  }

  // Rebuild UI if history exists
  if (container.children.length === 0 && reviewChatHistory.length > 0) {
    for (const msg of reviewChatHistory) {
      if (msg.role === 'system') continue;
      
      const role = (msg.role === 'user') ? 'user' : 'coach';
      let content = msg.content || (msg.parts && msg.parts[0] ? msg.parts[0].text : '');
      
      if (content) {
        // Clean JSON blocks from displayed messages to keep UI clean
        const displayContent = content.replace(/```json\n[\s\S]*?\n```/, '').trim();
        if (displayContent) {
          appendChatMessage(role, displayContent);
        }
      }
    }
    return;
  }

  if (reviewChatHistory.length > 0) {
    return;
  }

  // Gather stats
  const routines = await dbGetAll('routines');
  const bTasks = await dbGetAll('businessTasks');

  const routinesDone = routines.filter(r => r.isCompletedToday).map(r => r.title);
  const routinesFailed = routines.filter(r => !r.isCompletedToday).map(r => r.title);
  
  const bTasksToday = bTasks.filter(t => t.date === todayStr);
  const bTasksDone = bTasksToday.filter(t => t.status === 'done').map(t => t.title);
  const bTasksFailed = bTasksToday.filter(t => t.status === 'todo').map(t => t.title);

  const projectsFilePref = await dbGet('preferences', 'file_00_Aktywne_Projekty.md');
  const projectsContext = projectsFilePref ? projectsFilePref.value : "Brak priorytetów";
  
  const currentTimeStr = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

  const systemPrompt = `Jesteś profesjonalnym i wspierającym, ale stanowczym "Life Coachem" (Trenerem personalnym).
Aktualna godzina to: ${currentTimeStr}.
BARDZO WAŻNE:
1. Nie bądź sztucznie pretensjonalny ani złośliwy. Zamiast nazywać każdą niedoskonałość "wymówką", wykaż się logicznym zrozumieniem dla technicznych problemów i ograniczeń użytkownika (np. jeśli projekt nie działa lub nie ma danych w scout/draftach). Skup się na faktach.
2. Jeśli jest jeszcze wcześnie (np. przed 20:00), przypomnij asertywnie, że dzień się nie skończył i ma jeszcze szansę popchnąć zaległe zadania.
3. Twoim celem jest wynegocjowanie od 1 do 5 konkretnych Zwycięstw na jutro. Konwersacja powinna być krótka i pragmatyczna (max 2-3 wiadomości).

Wiesz z systemu, że użytkownik dziś:
Zrobił rutyny: ${routinesDone.join(', ')} (Niezrobione: ${routinesFailed.join(', ')})
Zrobił zadania biznesowe: ${bTasksDone.length > 0 ? bTasksDone.join(', ') : 'BRAK'} (Zawalił: ${bTasksFailed.join(', ')})

Jego aktualne projekty i priorytety:
${projectsContext}

BEZWZGLĘDNE ZAKAZY (NIE ŁAM ICH POD ŻADNYM PRETEKSTEM):
A. ZAKAZ generowania zadań związanych z fb_scout.py i scout.py — te narzędzia są ZEPSUTE. Nie każ odpowiadać na posty, nie każ sprawdzać wyniki skauta.
B. ZAKAZ generowania zadań o kampaniach reklamowych na FB dla CV Generator — produkt nie jest jeszcze gotowy do masowej promocji.
C. ZAKAZ generowania zadań "wyślij drafty aplikacji" — drafty muszą być NAJPIERW ZWERYFIKOWANE i uznane za akceptowalne. Generuj: "zweryfikuj jakość draftu", "oceń czy draft jest gotowy do wysyłki".
D. ZAKAZ mieszania projektów — "KarolinaMercedes" dotyczy WYŁĄCZNIE spraw prawnych/finansowych (EPU, komornik, długi). Nie łącz go z nowym dowodem, zakwaterowaniem ani pracą.
E. ZAKAZ zadań pasywnych: "poczytaj", "zastanów się", "przygotuj plan". Tylko konkretne akcje.

Instrukcje:
1. Skomentuj bezlitośnie jego dzień (jeśli zawalił biznes, spytaj dlaczego, ale pamiętaj o aktualnej godzinie ${currentTimeStr} - jeśli jest wcześnie, zachęć do działania teraz!). Bądź krótki i zwięzły.
2. Pamiętaj, że użytkownik jest Nadzorcą (weryfikuje pracę AI, a nie pisze ją ręcznie). 
   - Jeśli użytkownik usiadł do zadania (np. weryfikacja niemieckich draftów) i podjął decyzję strategiczną (np. "brakuje wersji PL, zlecę agentom audyt tłumaczenia przed wysyłką"), to zadanie jest ZALICZONE! To jest esencja pracy CEO. Pochwal go za to i nie mów, że to "wymówka".
   - Jeśli zadanie ze Skauta nie mogło być zrobione, bo skaut nie jest jeszcze uruchomiony/wdrożony, usuń to zadanie z listy i nie każ mu odpowiadać na nieistniejące posty.
3. Jeśli użytkownik wspomni o konkretnych sprawach do zrobienia (np. zgłoszenie darowizny do urzędu, usunięcie rdzy, popchnięcie spraw), od razu uznaj to za zatwierdzone zadania na jutro.
4. KIEDY USTALICIE ZADANIA NA JUTRO (lub gdy użytkownik sam je wymieni), MUSISZ dołączyć na końcu wiadomości twardy blok JSON z wygenerowanymi zadaniami (klucz 'tasks' to tablica z obiektami: title, description, leverageLevel, estimatedMinutes), oraz 'coachNote' (np. "Ogień! Jutro walczymy.").
BARDZO WAŻNE: Ponieważ historia rozmowy z całego dnia jest zachowywana, Twój nowy blok JSON musi bezwzględnie zawierać WSZYSTKIE wspólnie wypracowane dzisiaj zadania (zarówno te ustalone we wcześniejszych wiadomościach z 15:00, jak i te nowo dopisane). Każdy nowy blok JSON całkowicie zastępuje stary, więc nie możesz zgubić wcześniej ustalonych celów!
Użyj formatu:
\`\`\`json
{
  "activeProject": "Nazwa Głównego Projektu",
  "tasks": [...],
  "coachNote": "..."
}
\`\`\`
Ważne: Wstawiaj blok JSON TYLKO WTEDY, gdy dyskusja dobiega końca i zadania są potwierdzone (lub użytkownik sam je zadeklarował wprost). Zawsze konsoliduj całą dzisiejszą listę. Zadania dla agentów formułuj jako zlecenia naprawy/weryfikacji (np. "Zleć agentowi naprawę fb_scout.py", "Zweryfikuj jakość draftu aplikacji").`;

  // Używamy już wcześniej zadeklarowanych zmiennych isOpenAICompatible

  if (isOpenAICompatible) {
      reviewChatHistory.push({ role: "system", content: systemPrompt });
    } else {
      reviewChatHistory.push({ role: "user", parts: [{ text: systemPrompt }] });
    }
  await dbPut('preferences', { key: 'review_chat_history', value: reviewChatHistory });
  
  appendChatMessage('coach', 'Piszę...');
  await callGeminiChatAPI('');
};

window.sendReviewMessage = async function(text) {
  if (!text) return;
  appendChatMessage('user', text);
  appendChatMessage('coach', 'Piszę...');
  await callGeminiChatAPI(text);
};

async function callGeminiChatAPI(userText) {
  const apiKeyObj = await dbGet('preferences', 'gemini_api_key');
  const apiKey = apiKeyObj.value;

  const urlObj = await dbGet('preferences', 'ai_api_url');
  const customUrl = (urlObj && urlObj.value) ? urlObj.value.trim() : '';
  const isOpenAICompatible = customUrl !== '' || apiKey.startsWith('sk-or') || apiKey.startsWith('gsk_') || apiKey.startsWith('csk_') || apiKey.startsWith('csk-');
  const isGoogleGeminiModel = (modelId) => modelId && (modelId.startsWith('google/gemini') || modelId.startsWith('gemini-'));

  if (userText !== '') {
    if (isOpenAICompatible) {
      reviewChatHistory.push({ role: "user", content: userText });
    } else {
      reviewChatHistory.push({ role: "user", parts: [{ text: userText }] });
    }
    await dbPut('preferences', { key: 'review_chat_history', value: reviewChatHistory });
  }

  try {
    let response, data, replyText;
    
    // modelId must be declared BEFORE the if/else — it's needed in both OpenAI and Google paths
    const modelObj = await dbGet('preferences', 'ai_model_id');
    const modelId = (modelObj && modelObj.value) ? modelObj.value : 'openai/gpt-4o-mini';
    
    if (isOpenAICompatible && !isGoogleGeminiModel(modelId)) {
      const apiEndpoint = customUrl || 'https://openrouter.ai/api/v1/chat/completions';

      response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          messages: reviewChatHistory
        })
      });
      data = await response.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      if (data.message && !data.choices) throw new Error(data.message); // Cerebras error format
      
      replyText = data.choices[0].message.content;
      reviewChatHistory.push({ role: "assistant", content: replyText });
    } else {
      let googleModel = modelId || 'gemini-1.5-flash';
      if (googleModel.includes('/')) googleModel = googleModel.split('/')[1];

      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: reviewChatHistory })
      });
      data = await response.json();
      if (data.error) throw new Error(data.error.message);
      
      replyText = data.candidates[0].content.parts[0].text;
      reviewChatHistory.push({ role: "model", parts: [{ text: replyText }] });
    }

    await dbPut('preferences', { key: 'review_chat_history', value: reviewChatHistory });

    // Remove the "Piszę..." bubble
    const bubbles = document.querySelectorAll('.chat-bubble.coach');
    if (bubbles.length > 0 && bubbles[bubbles.length - 1].innerText === 'Piszę...') {
      bubbles[bubbles.length - 1].remove();
    }

    // Check for JSON block
    const jsonMatch = replyText.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      const resultJson = JSON.parse(jsonMatch[1]);
      const cleanText = replyText.replace(/```json\n[\s\S]*?\n```/, '').trim();
      if (cleanText) appendChatMessage('coach', cleanText);
      
      appendChatMessage('coach', '🚀 Zapisano zadania na jutro w systemie! Możesz już zamknąć okno.');
      
      const tomorrowStr = getTomorrowDateString();
      await saveGeneratedTasks(resultJson, tomorrowStr);

      // SAVE TO GDRIVE FOR SINGLE SOURCE OF TRUTH
      if (window.queueOfflineDriveWrite && window.driveFolderId) {
        const fileContent = `# Cel na: ${tomorrowStr}\n\n` + 
                            "Wygenerowane na podst. Rachunku Sumienia:\n\n" +
                            "```json\n" + JSON.stringify(resultJson, null, 2) + "\n```\n";
        window.queueOfflineDriveWrite('00_Jutrzejsze_Zwyciestwa.md', fileContent);
        if (window.flushGDriveOfflineQueue) window.flushGDriveOfflineQueue();
      }

    } else {
      appendChatMessage('coach', replyText);
    }
  } catch (err) {
    console.error('Gemini Chat API Error:', err);
    // Remove the failed user message from history so we don't break the alternate roles rule
    if (reviewChatHistory.length > 0 && reviewChatHistory[reviewChatHistory.length - 1].role === 'user') {
      reviewChatHistory.pop();
    }
    
    const bubbles = document.querySelectorAll('.chat-bubble.coach');
    if (bubbles.length > 0 && bubbles[bubbles.length - 1].innerText === 'Piszę...') {
      bubbles[bubbles.length - 1].innerText = `Błąd API: ${err.message}. Spróbuj wysłać ponownie.`;
    }
  }
}

function appendChatMessage(role, text) {
  const container = document.getElementById('chat-messages-container');
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  div.innerHTML = parseSimpleMarkdown(text);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// --- MARKDOWN & PROJECT MATCHING HELPERS ---

function parseActiveProjects(markdownText) {
  const projects = [];
  // Split by ## Priorytet
  const sections = markdownText.split(/##\s+Priorytet/gi);
  
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');
    
    const titleLine = lines[0].trim(); // e.g. "1: KarolinaMercedes"
    const priorityMatch = titleLine.match(/^(\d+)\s*:\s*(.+)$/);
    if (!priorityMatch) continue;
    
    const priority = parseInt(priorityMatch[1]);
    const name = priorityMatch[2].trim();
    
    let status = 'AKTYWNY';
    let blockedReason = '';
    
    for (const line of lines) {
      if (line.toLowerCase().includes('status:')) {
        const statusText = line.split(/status:/i)[1].trim();
        if (statusText.toLowerCase().includes('zablokowany')) {
          status = 'ZABLOKOWANY';
          blockedReason = statusText;
        }
      }
    }
    
    projects.push({ priority, name, status, blockedReason });
  }
  
  return projects.sort((a, b) => a.priority - b.priority);
}

async function getProjectDetailFileContent(projectName) {
  const allPrefs = await dbGetAll('preferences');
  // Remove content in parentheses from project name (e.g., "Praca w Niemczech (Festanstellung)" → "Praca w Niemczech")
  const projBaseName = projectName.replace(/\([^)]*\)/g, '').trim();
  const cleanProj = projBaseName.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  for (const pref of allPrefs) {
    if (pref.key.startsWith('file_01_') || pref.key.startsWith('file_02_')) {
      // e.g. key = "file_01_Praca_w_Niemczech.md"
      // Strip prefix "file_01_"/"file_02_" AND extension ".md" BEFORE cleaning to avoid leftover "md" suffix
      let rawName = pref.key.replace(/^file_0[12]_/, '').replace(/\.md$/i, '');
      const cleanKey = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Check if project name matches file name parts
      if (cleanProj === cleanKey || cleanProj.includes(cleanKey) || cleanKey.includes(cleanProj)) {
        return { fileName: pref.key.replace('file_', ''), content: pref.value };
      }
    }
  }
  return null;
}
