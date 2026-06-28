import { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Palette, 
  Eraser, 
  Key, 
  AlertCircle, 
  ChevronDown, 
  Check, 
  Loader2, 
  Info, 
  X, 
  Bookmark, 
  Maximize2,
  Zap,
  RotateCcw,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MuseumArtwork, ArtCardData, LLMPaintingSuggestion, PaintingHistoryEntry, ProviderStatus } from './types';
import TestPage from './TestPage';

const ALL_ART_EMOJIS = [
  // Эмоции и состояния
  "😊", "😢", "❤️", "💔", "😱", "🤔", "😌", "🤩", "😠", "😭", 
  // Природа и стихии (пейзажи, марины)
  "🌊", "☁️", "🍂", "🔥", "⚡", "🌪️", "❄️", "🌞", "🌙", "🌌", "🏔️", "🌿",
  // Жизнь, смерть и символизм (натюрморты, memento mori)
  "💀", "⏳", "🕯️", "🥀", "🌹", "🕊️", "🍎", "🍷", "🦋", "👁️",
  // Общество, история, драма
  "🎭", "⚔️", "🏰", "👑", "🎻", "🎨", "🚢", "🎪", "⛪"
];

const MAX_MEMORY = 100;

export default function App() {
  const [currentView, setCurrentView] = useState<'main' | 'test'>('main');

  const [groqKey, setGroqKey] = useState<string>('');
  const [cerebrasKey, setCerebrasKey] = useState<string>('');
  const [openRouterKey, setOpenRouterKey] = useState<string>('');

  const [groqStatus, setGroqStatus] = useState<ProviderStatus>('idle');
  const [cerebrasStatus, setCerebrasStatus] = useState<ProviderStatus>('idle');
  const [openRouterStatus, setOpenRouterStatus] = useState<ProviderStatus>('idle');

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isKeyVisible, setIsKeyVisible] = useState<boolean>(false);
  const [displayedEmojis, setDisplayedEmojis] = useState<string[]>([]);
  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([]);
  const [moodInput, setMoodInput] = useState<string>('');
  const [paintingHistory, setPaintingHistory] = useState<PaintingHistoryEntry[]>([]);
  const [gallery, setGallery] = useState<ArtCardData[]>([]);
  
  // Loading & Pipeline State
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  // UI Interaction States
  const [activeModalArt, setActiveModalArt] = useState<ArtCardData | null>(null);
  const [failedImageIds, setFailedImageIds] = useState<Set<number>>(new Set());

  // Load configuration and history on mount
  useEffect(() => {
    // Pick 18 random art-related emojis to display
    const shuffled = [...ALL_ART_EMOJIS].sort(() => 0.5 - Math.random());
    setDisplayedEmojis(shuffled.slice(0, 18));

    const savedGroq = localStorage.getItem('groqApiKey');
    if (savedGroq) setGroqKey(savedGroq);

    const savedCerebras = localStorage.getItem('cerebrasApiKey');
    if (savedCerebras) setCerebrasKey(savedCerebras);

    const savedOpenRouter = localStorage.getItem('openRouterApiKey');
    if (savedOpenRouter) setOpenRouterKey(savedOpenRouter);

    const savedMemory = localStorage.getItem('artHistory');
    if (savedMemory) {
      try {
        setPaintingHistory(JSON.parse(savedMemory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Save key on change
  const handleKeyChange = (provider: 'groq' | 'cerebras' | 'openrouter', val: string) => {
    const cleaned = val.trim();
    if (provider === 'groq') {
      setGroqKey(cleaned);
      localStorage.setItem('groqApiKey', cleaned);
    } else if (provider === 'cerebras') {
      setCerebrasKey(cleaned);
      localStorage.setItem('cerebrasApiKey', cleaned);
    } else if (provider === 'openrouter') {
      setOpenRouterKey(cleaned);
      localStorage.setItem('openRouterApiKey', cleaned);
    }
  };

  const toggleEmoji = (emoji: string) => {
    if (selectedEmojis.includes(emoji)) {
      setSelectedEmojis(prev => prev.filter(e => e !== emoji));
    } else {
      if (selectedEmojis.length >= 3) return; // limit to 3
      setSelectedEmojis(prev => [...prev, emoji]);
    }
  };

  // Safe JSON Extractor from LLM responses
  const extractJSON = (rawText: string): any => {
    try {
      return JSON.parse(rawText);
    } catch (e) {
      const start = rawText.indexOf('{');
      const end = rawText.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        try {
          return JSON.parse(rawText.substring(start, end + 1));
        } catch (innerError: any) {
          throw new Error("Не удалось разобрать JSON от ИИ: " + innerError.message);
        }
      }
      throw new Error("Не удалось найти правильный JSON в ответе ИИ.");
    }
  };

  // Key validation
  const validateKeys = async () => {
    const testKey = async (url: string, key: string, setStatus: (status: ProviderStatus) => void) => {
      if (!key) {
        setStatus('idle');
        return;
      }
      setStatus('testing');
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
        if (res.ok) {
          setStatus('ok');
        } else {
          setStatus('error');
        }
      } catch (e) {
        setStatus('error');
      }
    };

    const p1 = testKey("https://api.groq.com/openai/v1/models", groqKey, setGroqStatus);
    const p2 = testKey("https://api.cerebras.ai/v1/models", cerebrasKey, setCerebrasStatus);
    const p3 = testKey("https://openrouter.ai/api/v1/models", openRouterKey, setOpenRouterStatus);
    await Promise.all([p1, p2, p3]);
  };

  // Generic LLM fetcher with Fallback: Groq -> Cerebras -> OpenRouter
  const fetchLLM = async (
    prompt: string, 
    isJson: boolean, 
    temperature: number, 
    groqModel: string, 
    cerebrasModel: string
  ): Promise<any> => {
    let lastError = "";

    // 1. Try Groq
    if (groqKey && groqStatus !== 'error') {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: groqModel,
            messages: [{ role: "user", content: prompt }],
            response_format: isJson ? { type: "json_object" } : undefined,
            temperature
          })
        });
        if (res.ok) return await res.json();
        lastError = `Groq ${res.status}`;
      } catch (e: any) { lastError = `Groq Net Err`; }
    }

    // 2. Try Cerebras
    if (cerebrasKey && cerebrasStatus !== 'error') {
      try {
        const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${cerebrasKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: cerebrasModel,
            messages: [{ role: "user", content: prompt }],
            response_format: isJson ? { type: "json_object" } : undefined,
            temperature
          })
        });
        if (res.ok) return await res.json();
        lastError += ` | Cerebras ${res.status}`;
      } catch (e: any) { lastError += ` | Cerebras Net Err`; }
    }

    // 3. Try OpenRouter (with fallback across free models on 429)
    if (openRouterKey && openRouterStatus !== 'error') {
      const openRouterModels = [
        // openrouter/free — официальный роутер OpenRouter: сам выбирает доступную
        // бесплатную модель из ~24 и фильтрует по нужным фичам (JSON/structured outputs).
        // Это обходит ситуацию, когда конкретная free-модель временно rate-limited upstream.
        "openrouter/free",
        // Запасные конкретные free-модели на случай, если роутер вернёт ошибку.
        "meta-llama/llama-3.3-70b-instruct:free",
        "openai/gpt-oss-120b:free"
      ];

      // Кол-во повторов при 429. Бесплатные модели часто отдают временный
      // "rate-limited upstream", но openrouter/free при каждом повторе
      // перевыбирает другую модель, поэтому короткий ретрай обычно срабатывает.
      const MAX_429_RETRIES = 3;
      let stopOpenRouter = false;

      for (const orModel of openRouterModels) {
        if (stopOpenRouter) break;
        const modelLabel = orModel.split('/')[1] || orModel;

        for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
          try {
            const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${openRouterKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": window.location.href,
                "X-Title": "Art and Mood"
              },
              body: JSON.stringify({
                model: orModel,
                messages: [{ role: "user", content: prompt }],
                response_format: isJson ? { type: "json_object" } : undefined,
                temperature
              })
            });
            if (res.ok) return await res.json();
            lastError += ` | OR(${modelLabel}) ${res.status}`;

            if (res.status === 429) {
              // Временный rate-limit: ждём ~1.5с и повторяем (роутер re-roll).
              if (attempt < MAX_429_RETRIES) {
                await new Promise(r => setTimeout(r, 1500));
                continue;
              }
              break; // ретраи исчерпаны — пробуем следующую модель из списка
            }

            // Не-429 ошибка (auth/bad request) — нет смысла продолжать OpenRouter.
            stopOpenRouter = true;
            break;
          } catch (e: any) {
            lastError += ` | OpenRouter Net Err`;
            stopOpenRouter = true;
            break; // Network error, stop trying OpenRouter
          }
        }
      }
    }

    throw new Error(`Все доступные провайдеры недоступны. Ошибки: ${lastError}`);
  };

  // Core 3-Stage Pipeline: (1) куратор эмоция->картины, (2) поиск в музеях, (3) описания по данным музея
  const processAIArt = async (isAppend: boolean = false) => {
    const currentUserState = `${selectedEmojis.join(' ')} ${moodInput}`.trim();

    if (selectedEmojis.length === 0 && !moodInput) {
      setErrorMsg("Укажите ваши эмоции (выберите эмодзи или напишите текст в поле ввода)!");
      return;
    }

    if (!groqKey && !cerebrasKey && !openRouterKey) {
      setErrorMsg("Укажите хотя бы один API ключ в настройках (Groq, Cerebras или OpenRouter).");
      return;
    }

    setErrorMsg('');
    setIsLoading(true);

    try {
      await validateKeys();
      // ==========================================
      // ЭТАП 1: ИИ-КУРАТОР НАПРЯМУЮ СОПОСТАВЛЯЕТ ЭМОЦИЮ -> 12 КАРТИН (llama-3.3-70b-versatile)
      // Раньше был лишний промежуточный шаг "эмоция -> 4 ключевых слова", который
      // терял смысл (например 🌌 -> "rain, ruins"). Теперь мощная модель работает
      // с эмоцией напрямую — это и точнее, и на один запрос меньше.
      // ==========================================
      setLoadingStep("Шаг 1: ИИ-Куратор подбирает картины под настроение...");

      let historyBlock = "Нет истории — это первый запрос.";
      if (paintingHistory.length > 0) {
        historyBlock = paintingHistory
          .map(h => `- "${h.title}" — ${h.artist}`)
          .join('\n');
      }

      const suggestPrompt = `Ты — опытный куратор живописи. Твоя задача — точно сопоставить эмоцию человека с конкретными реальными картинами.

Настроение/эмоции пользователя: "${currentUserState}".

ЗАДАЧА: подбери 12 КОНКРЕТНЫХ реальных картин, чьи ТЕМА, СЮЖЕТ и АТМОСФЕРА буквально и образно резонируют с этим настроением.

КАК СОПОСТАВЛЯТЬ ЭМОЦИЮ И КАРТИНУ:
- Сначала пойми, какие ОБРАЗЫ и СЮЖЕТЫ стоят за эмоцией, и ищи картины именно с такими образами.
- Космос / звёзды / 🌌 -> звёздное небо, ночь, луна, кометы (например Vincent van Gogh "The Starry Night", "Starry Night Over the Rhône", "Cypresses").
- Море / шторм -> марины, корабли, волны (Turner, Aivazovsky, Winslow Homer, Hokusai).
- Грусть / слёзы -> дождь, руины, одиночество, вдовы, сумерки.
- Гнев / всё бесит -> бури, битвы, огонь.
- Голод -> натюрморты с едой: хлеб, фрукты, рыба, дичь.
- Спокойствие / умиротворение -> тихие пейзажи, светлые интерьеры, сады.
Подбирай ОБРАЗ под эмоцию, а не абстракцию.

ПРАВИЛА:
1. Только РЕАЛЬНЫЕ существующие картины, точное английское название + имя автора.
2. Первые 4-5 — всемирно известные хрестоматийные шедевры (Van Gogh, Monet, Renoir, Seurat, Rembrandt, Vermeer, El Greco, Hopper, Caillebotte, Degas, Cézanne, Frans Hals, Turner), реально хранящиеся в The Met, Art Institute of Chicago, Cleveland Museum of Art или Rijksmuseum — именно по ним идёт поиск. Ставь их ПЕРВЫМИ.
3. Сюжет/тема картины должны ПРЯМО соответствовать эмоции. Не выдумывай надуманные связи.
4. Каждая картина — от РАЗНОГО автора.
5. Только название, автор и поисковый запрос. Без описаний.

ИСТОРИЯ (эти картины уже были показаны, НЕ ПРЕДЛАГАЙ их снова):
${historyBlock}

Верни строго JSON:
{
  "paintings": [
    { "title": "Точное название на английском", "artist": "Имя автора на английском", "search_query": "краткий поисковый запрос для поиска в музее" }
  ]
}`;

      const suggestResult = await fetchLLM(suggestPrompt, true, 0.7, "llama-3.3-70b-versatile", "gpt-oss-120b");
      const suggestions = extractJSON(suggestResult.choices[0].message.content).paintings as LLMPaintingSuggestion[];

      if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
        throw new Error("Куратор не смог предложить картины. Попробуйте изменить запрос.");
      }

      // ==========================================
      // ЭТАП 2: ПОИСК В МУЗЕЯХ + ПОЛУЧЕНИЕ ДЕТАЛЬНЫХ ДАННЫХ
      // ==========================================
      setLoadingStep("Шаг 2: Ищем картины в коллекциях музеев...");

      // Helpers for matching
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, '').trim();

      const titlesMatch = (llmTitle: string, museumTitle: string): boolean => {
        const llmNorm = normalize(llmTitle);
        const museumNorm = normalize(museumTitle);
        if (llmNorm === museumNorm) return true;
        if (museumNorm.includes(llmNorm) || llmNorm.includes(museumNorm)) return true;
        const stopWords = new Set(['the', 'a', 'an', 'of', 'in', 'at', 'on', 'and', 'with', 'for', 'to', 'by', 'de', 'la', 'le', 'les', 'du', 'des', 'el', 'los', 'las']);
        const llmWords = llmNorm.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
        if (llmWords.length === 0) return false;
        const matched = llmWords.filter(w => museumNorm.includes(w));
        return matched.length / llmWords.length >= 0.5;
      };

      const artistsMatch = (llmArtist: string, museumArtist: string | null): boolean => {
        if (!museumArtist) return false;
        const llmParts = normalize(llmArtist).split(/\s+/).filter(w => w.length > 2);
        const museumNorm = normalize(museumArtist.split('\n')[0]);
        return llmParts.some(w => museumNorm.includes(w));
      };

      interface FoundPainting {
        id: number;
        title: string;
        author: string;
        year: string;
        imageUrl: string; // final image URL (proxied)
        museumDescription: string;
        medium: string;
        source: 'chicago' | 'met' | 'cleveland' | 'rijks';
        wikidataUrl?: string; // точная ссылка Met на картину в Wikidata (для заземления через Wikipedia)
      }

      // Helper to check if image actually loads
      const checkImage = (url: string): Promise<boolean> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
      };

      // Helper: search Met Museum for a painting matching the suggestion
      const searchMet = async (query: string, suggestion: LLMPaintingSuggestion): Promise<FoundPainting | null> => {
        try {
          const searchRes = await fetch(`/api/met/search?q=${encodeURIComponent(query)}`);
          if (!searchRes.ok) return null;
          const searchData = await searchRes.json();
          const objectIDs = (searchData.objectIDs || []).slice(0, 5) as number[];
          if (objectIDs.length === 0) return null;

          // Fetch details for top 5 IDs in parallel
          const detailPromises = objectIDs.map(async (oid) => {
            try {
              const r = await fetch(`/api/met/object/${oid}`);
              if (!r.ok) return null;
              return await r.json();
            } catch { return null; }
          });
          const objects = (await Promise.all(detailPromises)).filter(Boolean);

          // Find match: must have image, be a painting, and match title+artist
          for (const obj of objects) {
            if (!obj.primaryImage || !obj.isPublicDomain) continue;
            if (obj.classification !== 'Paintings' && obj.objectName !== 'Painting') continue;

            const matchesTitle = titlesMatch(suggestion.title, obj.title || '');
            const matchesArtist = artistsMatch(suggestion.artist, obj.artistDisplayName || '');

            if (matchesTitle || matchesArtist) {
              const imageUrl = `/api/met/image?url=${encodeURIComponent(obj.primaryImage)}`;
              // Verify the image is actually accessible
              const isImageValid = await checkImage(imageUrl);
              if (!isImageValid) continue;

              // У Met нет текстового описания, но есть предметные теги — это реальные
              // данные музея о том, ЧТО изображено. Используем их для заземления (anti-hallucination).
              const metTags = (obj.tags || []).map((t: any) => t.term).filter(Boolean);
              const metDesc = metTags.length
                ? `Изображённые объекты и темы (по данным музея Met): ${metTags.join(', ')}.`
                : '';

              return {
                id: obj.objectID,
                title: obj.title,
                author: obj.artistDisplayName || suggestion.artist,
                year: obj.objectDate || "Период неизвестен",
                imageUrl,
                museumDescription: metDesc,
                medium: obj.medium || '',
                source: 'met' as const,
                wikidataUrl: obj.objectWikidata_URL || undefined
              };
            }
          }
          return null;
        } catch { return null; }
      };

      // Helper: search Cleveland Museum of Art (CMA) — open access, CC0 images
      const searchCleveland = async (query: string, suggestion: LLMPaintingSuggestion): Promise<FoundPainting | null> => {
        try {
          const res = await fetch(`/api/cma/search?q=${encodeURIComponent(query)}`);
          if (!res.ok) return null;
          const data = await res.json();
          const results = (data.data || []) as any[];

          for (const a of results) {
            if (a.type !== 'Painting') continue;
            const webUrl = a.images?.web?.url || a.images?.print?.url;
            if (!webUrl) continue;

            const artistDesc: string = (a.creators && a.creators[0]?.description) || suggestion.artist;
            const matchesTitle = titlesMatch(suggestion.title, a.title || '');
            const matchesArtist = artistsMatch(suggestion.artist, artistDesc);

            if (matchesTitle || matchesArtist) {
              const imageUrl = `/api/cma/image?url=${encodeURIComponent(webUrl)}`;
              const isImageValid = await checkImage(imageUrl);
              if (!isImageValid) continue;

              // "Rembrandt van Rijn (Dutch, 1606–1669)" -> "Rembrandt van Rijn"
              const cleanArtist = artistDesc.split('(')[0].trim();
              const museumDescription = (a.description || a.tombstone || '').replace(/<[^>]*>/g, '');

              return {
                id: a.id,
                title: a.title,
                author: cleanArtist || suggestion.artist,
                year: a.creation_date || "Период неизвестен",
                imageUrl,
                museumDescription,
                medium: a.technique || '',
                source: 'cleveland' as const
              };
            }
          }
          return null;
        } catch { return null; }
      };

      // Helper: search Rijksmuseum (Amsterdam) — Linked Open Data, без ключа.
      // Сервер уже отдаёт нормализованные кандидаты {id,title,artist,year,visualId}.
      const searchRijks = async (query: string, suggestion: LLMPaintingSuggestion): Promise<FoundPainting | null> => {
        try {
          const res = await fetch(`/api/rijks/search?q=${encodeURIComponent(query)}`);
          if (!res.ok) return null;
          const data = await res.json();
          const results = (data.data || []) as any[];

          for (const a of results) {
            if (!a.title || !a.visualId) continue;

            const matchesTitle = titlesMatch(suggestion.title, a.title);
            const matchesArtist = artistsMatch(suggestion.artist, a.artist || '');

            if (matchesTitle || matchesArtist) {
              const imageUrl = `/api/rijks/image?visual=${encodeURIComponent(a.visualId)}`;
              const isImageValid = await checkImage(imageUrl);
              if (!isImageValid) continue;

              return {
                id: a.id,
                title: a.title,
                author: a.artist || suggestion.artist,
                year: a.year || "Период неизвестен",
                imageUrl,
                museumDescription: a.description || '',
                medium: '',
                source: 'rijks' as const
              };
            }
          }
          return null;
        } catch { return null; }
      };

      const foundPaintings: FoundPainting[] = [];
      const newHistory = [...paintingHistory];

      for (const suggestion of suggestions) {
        if (foundPaintings.length >= 3) break;

        let found: FoundPainting | null = null;

        // === TRY MET MUSEUM FIRST ===
        const queries = [suggestion.title, suggestion.search_query, `${suggestion.artist} ${suggestion.title}`];
        
        for (const query of queries) {
          found = await searchMet(query, suggestion);
          if (found) break;
        }

        // === FALLBACK: TRY ART INSTITUTE OF CHICAGO ===
        if (!found) {
          let matchedArt: MuseumArtwork | null = null;

          for (const query of queries) {
            if (matchedArt) break;
            try {
              const res = await fetch(`/api/museum/search?q=${encodeURIComponent(query)}&fields=id,title,artist_display,image_id,artwork_type_title,date_display`);
              if (!res.ok) continue;
              const data = await res.json();
              const results = (data.data || []) as MuseumArtwork[];

              // Filter to find the first valid match with a working image
              for (const a of results) {
                if (!a.image_id) continue;
                
                const matchesTitle = titlesMatch(suggestion.title, a.title);
                const matchesArtist = artistsMatch(suggestion.artist, a.artist_display);

                if (matchesTitle) { // Title match is good enough for fallback
                  const imageUrl = `/api/museum/image/${a.image_id}`;
                  const isImageValid = await checkImage(imageUrl);
                  if (isImageValid) {
                    matchedArt = a;
                    break;
                  }
                }
              }
            } catch { continue; }
          }

          if (matchedArt) {
            const author = matchedArt.artist_display ? matchedArt.artist_display.split('\n')[0].trim() : suggestion.artist;

            // Fetch Chicago detail
            let museumDescription = '';
            let medium = '';
            try {
              const detailRes = await fetch(`/api/museum/artwork/${matchedArt.id}`);
              if (detailRes.ok) {
                const detailData = await detailRes.json();
                const d = detailData.data;
                if (d) {
                  museumDescription = d.description || d.short_description || '';
                  medium = d.medium_display || '';
                  museumDescription = museumDescription.replace(/<[^>]*>/g, '');
                }
              }
            } catch { /* continue */ }

            found = {
              id: matchedArt.id,
              title: matchedArt.title,
              author,
              year: matchedArt.date_display || "Период неизвестен",
              imageUrl: `/api/museum/image/${matchedArt.image_id}`,
              museumDescription,
              medium,
              source: 'chicago'
            };
          }
        }

        // === FALLBACK 2: TRY CLEVELAND MUSEUM OF ART ===
        if (!found) {
          for (const query of queries) {
            found = await searchCleveland(query, suggestion);
            if (found) break;
          }
        }

        // === FALLBACK 3: TRY RIJKSMUSEUM (европейские шедевры: Rembrandt, Vermeer) ===
        if (!found) {
          for (const query of queries) {
            found = await searchRijks(query, suggestion);
            if (found) break;
          }
        }

        if (!found) continue;

        // Skip duplicates
        const isDuplicate = newHistory.some(h => h.title.toLowerCase() === found!.title.toLowerCase());
        if (isDuplicate) continue;

        foundPaintings.push(found);
        newHistory.push({ title: found.title, artist: found.author });
      }

      if (foundPaintings.length === 0) {
        throw new Error("Не удалось найти предложенные картины в коллекции музея. Попробуйте другое настроение.");
      }

      // ==========================================
      // ОБОГАЩЕНИЕ: достоверное описание из Wikipedia/Wikidata для картин со
      // слабыми музейными данными (прежде всего Met — у него только теги).
      // Met передаёт точную ссылку wikidataUrl, остальные — поиск с верификацией.
      // ==========================================
      setLoadingStep("Шаг 2: Уточняем факты по энциклопедии...");
      await Promise.all(foundPaintings.map(async (p) => {
        // Картины с длинной музейной прозой (Chicago/Cleveland/Rijks) не трогаем.
        if (p.museumDescription && p.museumDescription.length >= 120) return;
        try {
          const params = new URLSearchParams({ title: p.title, artist: p.author });
          if (p.wikidataUrl) params.set('wikidata', p.wikidataUrl);
          const r = await fetch(`/api/wiki/describe?${params.toString()}`);
          if (!r.ok) return;
          const d = await r.json();
          if (d.extract) {
            p.museumDescription = p.museumDescription
              ? `${p.museumDescription} ${d.extract}`
              : d.extract;
          }
        } catch { /* мягко игнорируем — описание не критично */ }
      }));

      // ==========================================
      // ЭТАП 3: LLM ГЕНЕРИРУЕТ ОПИСАНИЯ СТРОГО НА ОСНОВЕ РЕАЛЬНЫХ ДАННЫХ МУЗЕЯ
      // Ключевое: модель НЕ видит картину, поэтому ей запрещено выдумывать сюжет.
      // Для Met грузятся предметные теги, для Chicago/Cleveland/Rijks — описания.
      // ==========================================
      setLoadingStep("Шаг 3: Генерируем описания на основе данных музея...");

      const paintingsInfo = foundPaintings.map((p, i) => {
        let info = `${i + 1}. "${p.title}" — ${p.author} (${p.year})`;
        if (p.medium) info += `\nМатериалы: ${p.medium}`;
        if (p.museumDescription) {
          info += `\nДанные музея о картине: ${p.museumDescription.substring(0, 700)}`;
        } else {
          info += `\nДанные музея о сюжете ОТСУТСТВУЮТ — сюжет НЕ описывать.`;
        }
        return info;
      }).join('\n\n');

      const descPrompt = `Настроение пользователя: "${currentUserState}".

Ниже — ${foundPaintings.length} РЕАЛЬНЫХ картин из музеев (The Met, Art Institute of Chicago, Cleveland Museum of Art, Rijksmuseum) с фактическими данными:

${paintingsInfo}

ЗАДАЧА: для каждой картины напиши два текста на русском языке.

ГЛАВНОЕ ПРАВИЛО — НИКАКИХ ВЫДУМОК:
- Опирайся ТОЛЬКО на приведённые фактические данные (название, автор, год, материалы, "Данные музея о картине").
- СТРОГО ЗАПРЕЩЕНО придумывать сюжет, действие, цвета, число и поведение персонажей, детали пейзажа, которых нет в данных. Например, нельзя превращать теги "Lions, Forests" в "лев мирно пьёт из реки в окружении зверей".
- Если указано "Данные музея о сюжете ОТСУТСТВУЮТ" — НЕ описывай, что изображено, и не строй догадок. Вместо этого расскажи об авторе, технике, стиле и эпохе в достоверных терминах.
- Лучше короче, но правда, чем красиво и неверно.

1. "why_fits" — 1-2 предложения: как тема/атмосфера картины перекликается с эмоцией пользователя. Без воды.

2. "about" — живой рассказ простым языком, как другу за кофе. 2-3 коротких абзаца, разделённых переносом строки (\\n\\n):
   - Если есть данные о сюжете: первый абзац — что изображено (СТРОГО по данным музея) и общая атмосфера.
   - Далее: об авторе, технике/стиле и эпохе; один достоверный любопытный факт — только если уверен в нём, иначе пропусти.

ВАЖНО ПО СТИЛЮ:
- СТРОГО ЧИСТЫЙ РУССКИЙ ЯЗЫК. Запрещены китайские иероглифы и любой нерусский текст в ответе. Данные музея могут быть на английском или нидерландском — передай их смысл по-русски.
- Никаких эмодзи.
- Никаких заголовков типа "Описание:", "Почему это круто:", "Интересный факт:". Просто абзацы.
- НЕ используй шаблоны: "что делает её особенной", "это ценный пример", "демонстрирует мастерство".
- Меняй стиль, интонацию и ритм от картины к картине.

Верни строго JSON:
{
  "descriptions": [
    {
      "index": 0,
      "why_fits": "...",
      "about": "..."
    }
  ]
}`;

      const descResult = await fetchLLM(descPrompt, true, 0.3, "llama-3.3-70b-versatile", "gpt-oss-120b");
      const descriptions = extractJSON(descResult.choices[0].message.content).descriptions as { index: number; why_fits: string; about: string }[];

      // Build final cards
      const selectedCards: ArtCardData[] = [];

      for (let i = 0; i < foundPaintings.length; i++) {
        const p = foundPaintings[i];
        const desc = descriptions?.find(d => d.index === i);

        selectedCards.push({
          id: p.id,
          title: p.title,
          author: p.author,
          year: p.year,
          image: p.imageUrl,
          why_fits: desc?.why_fits || "Картина подобрана ИИ-куратором под ваше настроение.",
          about: desc?.about || "Произведение из коллекции мирового музея, подобранное под ваше настроение.",
          userState: currentUserState
        });
      }

      // Trim history if it exceeds limit
      if (newHistory.length > MAX_MEMORY) {
        newHistory.splice(0, newHistory.length - MAX_MEMORY);
      }

      setPaintingHistory(newHistory);
      localStorage.setItem('artHistory', JSON.stringify(newHistory));

      if (isAppend) {
        setGallery(prev => [...prev, ...selectedCards]);
      } else {
        setGallery(selectedCards);
      }

      // Automatically scroll to the gallery on new search
      setTimeout(() => {
        const galleryElement = document.getElementById('gallery-section');
        if (galleryElement) {
          galleryElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || "Произошла непредвиденная ошибка в пайплайне куратора.");
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const handleImageError = (id: number) => {
    setFailedImageIds(prev => {
      const updated = new Set(prev);
      updated.add(id);
      return updated;
    });
  };

  const resetMemory = () => {
    if (window.confirm("Вы уверены, что хотите сбросить всю сохраненную историю просмотренных картин?")) {
      setPaintingHistory([]);
      localStorage.removeItem('artHistory');
      setGallery([]);
      setSelectedEmojis([]);
      setMoodInput('');
      setFailedImageIds(new Set());
      setErrorMsg('');
    }
  };

  // Keep all cards in the gallery so we can show custom placeholders instead of hiding them
  const visibleGallery = gallery;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans pb-24">
      {/* Background Accent Gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-yellow-400/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[30rem] h-[30rem] bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      <main className="max-w-7xl mx-auto px-6 pt-8 md:pt-12 relative z-10">
        
        {/* Navigation */}
        <nav className="flex justify-center mb-8 space-x-4">
          <button 
            onClick={() => setCurrentView('main')}
            className={`px-6 py-2 rounded-full text-sm font-bold tracking-wide transition-colors border ${currentView === 'main' ? 'bg-zinc-800 text-yellow-400 border-zinc-700 shadow-md' : 'bg-transparent text-zinc-500 border-transparent hover:text-zinc-300'}`}
          >
            Art & Mood App
          </button>
          <button 
            onClick={() => setCurrentView('test')}
            className={`px-6 py-2 rounded-full text-sm font-bold tracking-wide transition-colors border ${currentView === 'test' ? 'bg-zinc-800 text-yellow-400 border-zinc-700 shadow-md' : 'bg-transparent text-zinc-500 border-transparent hover:text-zinc-300'}`}
          >
            API Test Lab
          </button>
        </nav>

        {currentView === 'test' ? (
          <TestPage 
            groqKey={groqKey} 
            cerebrasKey={cerebrasKey} 
            openRouterKey={openRouterKey} 
          />
        ) : (
          <>
        {/* Header Block */}
        <header className="text-center mb-16">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-bold tracking-widest uppercase text-yellow-400 mb-6 shadow-[0_0_15px_rgba(250,204,21,0.08)]"
          >
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            ULTRA-THINKING АГЕНТ (v5.0)
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="font-serif text-5xl md:text-8xl font-black mb-6 tracking-tight bg-gradient-to-b from-white via-zinc-100 to-zinc-400 bg-clip-text text-transparent"
          >
            Art & Mood
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto font-light leading-relaxed"
          >
            Строгое соответствие вашим истинным эмоциям. Умная память до {MAX_MEMORY} картин. Никаких повторяющихся авторов и галлюцинаций.
          </motion.p>
        </header>

        {/* API Keys Configuration Block */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="max-w-3xl mx-auto mb-10"
        >
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden transition-all duration-200">
            <button 
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="w-full flex items-center justify-between p-5 text-sm text-zinc-300 hover:text-white transition-colors select-none"
            >
              <span className="flex items-center gap-3 font-medium">
                <Settings className="w-4 h-4 text-yellow-400" />
                Настройки AI-моделей (Резервные ключи)
                {(groqKey || cerebrasKey || openRouterKey) ? (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">
                    <Check className="w-2.5 h-2.5" /> ключи настроены
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 px-2 py-0.5 rounded">
                    требуются ключи
                  </span>
                )}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isSettingsOpen ? 'rotate-180' : ''} text-zinc-500`} />
            </button>
            
            <AnimatePresence>
              {isSettingsOpen && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="border-t border-zinc-850 bg-zinc-950/40 p-5 space-y-4"
                >
                  <p className="text-xs text-zinc-500 leading-relaxed mb-4">
                    Укажите API ключи для бесперебойной работы. Система будет использовать их по очереди: <b>Groq → Cerebras → OpenRouter</b>. Перед генерацией система проверит каждый ключ.
                  </p>

                  {/* Groq Key */}
                  <div>
                    <label className="flex items-center justify-between text-xs text-zinc-400 font-semibold uppercase tracking-wider mb-2">
                      <span>1. Groq API Key (Основной)</span>
                      {groqStatus === 'ok' && <span className="text-emerald-400 text-[10px]">✅ Готов</span>}
                      {groqStatus === 'error' && <span className="text-red-400 text-[10px]">❌ Ошибка</span>}
                      {groqStatus === 'testing' && <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />}
                    </label>
                    <input 
                      type="password" 
                      value={groqKey}
                      onChange={(e) => handleKeyChange('groq', e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700/60 rounded-xl px-5 py-3.5 text-sm focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-zinc-200 placeholder-zinc-600 font-mono mb-1"
                      placeholder="gsk_..."
                    />
                  </div>

                  {/* Cerebras Key */}
                  <div>
                    <label className="flex items-center justify-between text-xs text-zinc-400 font-semibold uppercase tracking-wider mb-2">
                      <span>2. Cerebras API Key (Резерв 1)</span>
                      {cerebrasStatus === 'ok' && <span className="text-emerald-400 text-[10px]">✅ Готов</span>}
                      {cerebrasStatus === 'error' && <span className="text-red-400 text-[10px]">❌ Ошибка</span>}
                      {cerebrasStatus === 'testing' && <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />}
                    </label>
                    <input 
                      type="password" 
                      value={cerebrasKey}
                      onChange={(e) => handleKeyChange('cerebras', e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700/60 rounded-xl px-5 py-3.5 text-sm focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-zinc-200 placeholder-zinc-600 font-mono mb-1"
                      placeholder="csk_..."
                    />
                  </div>

                  {/* OpenRouter Key */}
                  <div>
                    <label className="flex items-center justify-between text-xs text-zinc-400 font-semibold uppercase tracking-wider mb-2">
                      <span>3. OpenRouter API Key (Резерв 2)</span>
                      {openRouterStatus === 'ok' && <span className="text-emerald-400 text-[10px]">✅ Готов</span>}
                      {openRouterStatus === 'error' && <span className="text-red-400 text-[10px]">❌ Ошибка</span>}
                      {openRouterStatus === 'testing' && <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />}
                    </label>
                    <input 
                      type="password" 
                      value={openRouterKey}
                      onChange={(e) => handleKeyChange('openrouter', e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700/60 rounded-xl px-5 py-3.5 text-sm focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-zinc-200 placeholder-zinc-600 font-mono mb-1"
                      placeholder="sk-or-v1-..."
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Mood Input & Emotion Controls */}
        <motion.section 
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="max-w-3xl mx-auto bg-zinc-900/40 backdrop-blur-xl border border-zinc-800 p-8 md:p-10 rounded-[2rem] shadow-2xl"
        >
          {/* Emojis selection */}
          <div className="mb-10">
            <h2 className="text-xs uppercase tracking-widest text-zinc-400 font-bold flex items-center gap-2 mb-4">
              <span className="text-yellow-400 text-lg">😊</span> Выберите ваши эмоции (до 3)
            </h2>
            <div className="flex flex-wrap gap-2.5 justify-center md:justify-start">
              {displayedEmojis.map(emoji => {
                const isActive = selectedEmojis.includes(emoji);
                return (
                  <button
                    key={emoji}
                    onClick={() => toggleEmoji(emoji)}
                    className={`text-2xl md:text-3xl w-12 h-12 md:w-14 md:h-14 flex items-center justify-center rounded-xl bg-zinc-900/80 border transition-all duration-200 cursor-pointer select-none
                      ${isActive 
                        ? 'bg-yellow-400 text-zinc-950 scale-110 rotate-3 border-transparent shadow-[0_0_15px_rgba(250,204,21,0.25)]' 
                        : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 hover:scale-105 hover:rotate-1'
                      }`}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text Input */}
          <div className="mb-10">
            <h2 className="text-xs uppercase tracking-widest text-zinc-400 font-bold flex items-center gap-2 mb-4">
              <span className="text-yellow-400 text-lg">✍️</span> Что у вас сейчас на душе?
            </h2>
            <input 
              type="text" 
              value={moodInput}
              onChange={(e) => setMoodInput(e.target.value)}
              className="w-full bg-zinc-950/60 border border-zinc-800 rounded-xl px-6 py-4.5 text-base md:text-lg text-white focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all placeholder-zinc-600"
              placeholder="Например: Всё надоело, дедлайны горят, хочется тишины и умиротворения..."
            />
          </div>

          {/* Action and Error Feedback */}
          {errorMsg && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-xl bg-red-950/40 border border-red-500/30 text-red-400 text-sm flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-red-200">Внимание</h4>
                <p className="font-light">{errorMsg}</p>
              </div>
            </motion.div>
          )}

          <button 
            disabled={isLoading}
            onClick={() => processAIArt(false)}
            className={`w-full py-5 rounded-xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3 active:scale-[0.98] cursor-pointer
              ${isLoading 
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                : 'bg-yellow-400 hover:bg-yellow-300 text-black shadow-lg hover:shadow-yellow-400/10'
              }`}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-yellow-400" />
                <span>{loadingStep}</span>
              </>
            ) : (
              <>
                <Palette className="w-5 h-5" />
                <span>Найти созвучные картины</span>
              </>
            )}
          </button>
        </motion.section>

        {/* Gallery Exhibition Section */}
        <section id="gallery-section" className={`mt-24 transition-opacity duration-500 ${gallery.length > 0 ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6 border-b border-zinc-800/80 pb-8">
            <div>
              <h2 className="font-serif text-4xl md:text-6xl font-black mb-3">Ваша галерея</h2>
              <p className="text-zinc-400 font-light text-base md:text-lg flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-yellow-400" />
                Строгий отбор. В памяти сохранено <span className="text-yellow-400 font-bold">{paintingHistory.length}</span> / {MAX_MEMORY} просмотренных картин.
              </p>
            </div>
            
            <button 
              onClick={resetMemory} 
              className="text-zinc-400 hover:text-white transition-all text-sm font-medium flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 px-5 py-3 rounded-xl border border-zinc-800 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 text-zinc-500" />
              Сбросить память
            </button>
          </div>
          
          {/* Art Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {visibleGallery.map((art, index) => (
              <motion.div
                key={`${art.id}-${index}`}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                whileHover={{ y: -8 }}
                onClick={() => setActiveModalArt(art)}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden cursor-pointer group shadow-xl hover:shadow-2xl hover:border-zinc-700/60 transition-all duration-300 flex flex-col h-full"
              >
                {/* Image Frame */}
                <div className="relative h-72 md:h-80 overflow-hidden bg-zinc-950 shrink-0 flex items-center justify-center">
                  {failedImageIds.has(art.id) ? (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-zinc-950/80 border-b border-zinc-800">
                      <Palette className="w-12 h-12 text-zinc-700 mb-3 animate-pulse" />
                      <span className="text-xs text-zinc-500 font-medium">
                        Изображение временно недоступно
                      </span>
                      <span className="text-[10px] text-zinc-600 font-light mt-1">
                        (Ограничено сервером музея)
                      </span>
                    </div>
                  ) : (
                    <>
                      <img 
                        src={art.image} 
                        alt={art.title} 
                        onError={() => handleImageError(art.id)}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/10 to-transparent opacity-80 group-hover:opacity-40 transition-opacity duration-300" />
                    </>
                  )}
                  
                  {/* Image Overlay details indicator */}
                  <div className="absolute top-4 right-4 bg-zinc-950/80 border border-zinc-800/80 p-2.5 rounded-full text-zinc-400 group-hover:text-yellow-400 transition-colors backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <Maximize2 className="w-4 h-4" />
                  </div>
                </div>

                {/* Info Box */}
                <div className="p-6 flex flex-col justify-between flex-grow">
                  <div>
                    <h3 className="font-serif text-2xl font-bold mb-2 text-zinc-100 group-hover:text-yellow-400 transition-colors line-clamp-2 leading-tight">
                      {art.title}
                    </h3>
                    <p className="text-zinc-400 text-sm font-light truncate">
                      {art.author}
                    </p>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-zinc-850 flex items-center justify-between text-zinc-500 text-xs">
                    <span>{art.year}</span>
                    <span className="flex items-center gap-1.5 text-zinc-400 font-light italic">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      Курировано
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Load More Trigger */}
          <div className="mt-16 flex justify-center">
            <button 
              disabled={isLoading}
              onClick={() => processAIArt(true)}
              className={`bg-zinc-900 hover:bg-zinc-850 text-white font-bold py-4 px-10 rounded-xl transition-all duration-300 flex items-center gap-3 border border-zinc-800 active:scale-95 shadow-lg cursor-pointer
                ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-yellow-400" />
                  <span>Поиск новых картин...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                  <span>Подобрать ещё (без повторов)</span>
                </>
              )}
            </button>
          </div>
        </section>
        </>
        )}
      </main>

      {/* Full-Screen Exhibition Modal */}
      <AnimatePresence>
        {activeModalArt && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => setActiveModalArt(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-zinc-950/95 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={{ duration: 0.3, type: "spring", damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col lg:flex-row relative shadow-2xl"
            >
              {/* Close Button */}
              <button 
                onClick={() => setActiveModalArt(null)}
                className="absolute top-4 right-4 lg:top-6 lg:right-6 z-20 w-11 h-11 bg-zinc-950/80 hover:bg-zinc-950 border border-zinc-800 text-white rounded-full flex items-center justify-center transition-all backdrop-blur-md cursor-pointer shadow-lg"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Left Column: Massive High-Fidelity Painting */}
              <div className="w-full lg:w-1/2 xl:w-3/5 bg-zinc-950 flex items-center justify-center p-4 lg:p-8 min-h-[35vh] lg:min-h-[75vh] relative border-b lg:border-b-0 lg:border-r border-zinc-850">
                {failedImageIds.has(activeModalArt.id) ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-500">
                    <Palette className="w-16 h-16 text-zinc-800 mb-4 animate-pulse" />
                    <p className="text-sm font-light max-w-xs">
                      Сервер Чикагского института искусств ограничил прямой просмотр этого изображения через сторонние платформы.
                    </p>
                  </div>
                ) : (
                  <img 
                    src={activeModalArt.image} 
                    alt={activeModalArt.title} 
                    className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-[0_0_35px_rgba(0,0,0,0.6)]"
                  />
                )}
              </div>

              {/* Right Column: Deep Structured Text Details */}
              <div className="w-full lg:w-1/2 xl:w-2/5 p-6 md:p-10 lg:p-12 overflow-y-auto max-h-[50vh] lg:max-h-[92vh] flex flex-col">
                
                {/* Block 0: Original Emotion State Context */}
                <div className="mb-6">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 font-bold">
                    Твой запрос
                  </span>
                  <div className="text-zinc-300 text-sm font-light italic bg-zinc-950/60 px-4 py-3 rounded-xl border border-zinc-850/50">
                    {activeModalArt.userState || "Выбранное настроение"}
                  </div>
                </div>

                {/* Block 1 & 2: Massive Headline Titles */}
                <div className="mb-8">
                  <h2 className="font-serif text-3xl md:text-5xl font-black uppercase text-white tracking-wide leading-tight mb-3">
                    {activeModalArt.title}
                  </h2>
                  <p className="text-yellow-400 text-base md:text-lg font-light tracking-wide">
                    Автор: {activeModalArt.author} <span className="text-zinc-500 ml-1">({activeModalArt.year})</span>
                  </p>
                </div>
                
                {/* Block 3: About & History — main content block */}
                <div className="mb-6">
                  <div className="bg-zinc-900/60 rounded-xl p-5 md:p-6 border border-zinc-800/50">
                    <h4 className="text-yellow-400 font-bold mb-4 uppercase tracking-widest text-xs flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-yellow-400" />
                      Детальное описание картины
                    </h4>
                    <p className="text-zinc-200 text-base leading-relaxed font-light whitespace-pre-line">
                      {activeModalArt.about}
                    </p>
                  </div>
                </div>

                {/* Block 4: Why Fits (short connection note) */}
                <div className="mt-auto">
                  <p className="text-zinc-400 text-sm leading-relaxed font-light italic">
                    <Zap className="w-3 h-3 text-yellow-500 inline mr-1.5 -mt-0.5" />
                    {activeModalArt.why_fits}
                  </p>
                </div>

              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
