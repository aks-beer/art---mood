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
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MuseumArtwork, ArtCardData, LLMPaintingSuggestion, PaintingHistoryEntry } from './types';

const EMOJIS = [
  "😊", "😢", "🔥", "🌌", "😱", "❤️", "🤔", "🌊", 
  "⚡", "🍂", "🎭", "🕊️", "💥", "🪐", "🍷", "🎧", 
  "🌵", "☁️", "🏃", "🍔"
];

const MAX_MEMORY = 100;

export default function App() {
  const [groqKey, setGroqKey] = useState<string>('');
  const [isKeyVisible, setIsKeyVisible] = useState<boolean>(false);
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
    const savedKey = localStorage.getItem('groqApiKey');
    if (savedKey) {
      setGroqKey(savedKey);
    }

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
  const handleKeyChange = (val: string) => {
    const cleaned = val.trim();
    setGroqKey(cleaned);
    localStorage.setItem('groqApiKey', cleaned);
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

  // Core 4-Stage Pipeline
  const processAIArt = async (isAppend: boolean = false) => {
    const currentUserState = `${selectedEmojis.join(' ')} ${moodInput}`.trim();

    if (selectedEmojis.length === 0 && !moodInput) {
      setErrorMsg("Укажите ваши эмоции (выберите эмодзи или напишите текст в поле ввода)!");
      return;
    }

    if (!groqKey || !groqKey.startsWith('gsk_')) {
      setErrorMsg("Укажите верный ключ доступа Groq API (начинается с gsk_).");
      return;
    }

    setErrorMsg('');
    setIsLoading(true);

    try {
      // ==========================================
      // ЭТАП 1: ГЕНЕРАЦИЯ КЛЮЧЕВЫХ СЛОВ (llama-3.1-8b-instant)
      // ==========================================
      setLoadingStep("Шаг 1: Семантический разбор эмоций...");

      const keywordPrompt = `Пользователь ввел: "${currentUserState}".
ТВОЯ ЗАДАЧА: Сгенерируй 4 КОНКРЕТНЫХ английских существительных для поиска картин.
ЖЕСТКИЕ ПРАВИЛА:
1. Ищи ПРЕДМЕТЫ и СЮЖЕТЫ, а не абстрактные эмоции.
2. Если "хочу есть" -> ищи food, bread, fruit, fish. НЕ ИЩИ соборы или абстракции.
3. Если "хочу бегать/спорт" -> ищи horse, running, wind, hunt.
4. Если "злюсь/всё бесит" -> ищи storm, battle, fire, sword.
5. Если "плачу/грустно" -> ищи rain, ruins, tear, widow.
Верни строго JSON: { "keywords": ["word1", "word2", "word3", "word4"] }`;

      const keywordRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${groqKey}`, 
          "Content-Type": "application/json" 
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: keywordPrompt }],
          response_format: { type: "json_object" }
        })
      });

      if (!keywordRes.ok) {
        throw new Error("Ошибка API Groq (слишком много запросов или неверный ключ).");
      }
      
      const keywordData = await keywordRes.json();
      const parsedKeywords = extractJSON(keywordData.choices[0].message.content).keywords as string[];

      if (!parsedKeywords || !Array.isArray(parsedKeywords) || parsedKeywords.length === 0) {
        throw new Error("ИИ не вернул ключевые слова для поиска.");
      }

      // ==========================================
      // ЭТАП 2: LLM ПРЕДЛАГАЕТ КОНКРЕТНЫЕ КАРТИНЫ (llama-3.3-70b-versatile)
      // ==========================================
      setLoadingStep("Шаг 2: ИИ-Куратор подбирает шедевры...");

      let historyBlock = "Нет истории — это первый запрос.";
      if (paintingHistory.length > 0) {
        historyBlock = paintingHistory
          .map(h => `- "${h.title}" — ${h.artist}`)
          .join('\n');
      }

      const suggestPrompt = `Ты — куратор классической живописи.
Пользователь описал свои эмоции: "${currentUserState}".
Ключевые слова для поиска: ${parsedKeywords.join(', ')}.

ЗАДАЧА: Предложи 12 КОНКРЕТНЫХ классических картин, сюжет которых буквально резонирует с этими эмоциями.

ПРАВИЛА:
1. Называй РЕАЛЬНЫЕ известные картины с точным английским названием и именем автора.
2. Предпочитай картины из коллекций Art Institute of Chicago и The Metropolitan Museum of Art (The Met).
3. Сюжет картины должен БУКВАЛЬНО подходить под эмоции. Запрещено выдумывать тайный смысл.
4. Каждая картина должна быть от РАЗНОГО автора.
5. НЕ генерируй описания — только название, автор и поисковый запрос.

ИСТОРИЯ (эти картины уже были показаны, НЕ ПРЕДЛАГАЙ их снова):
${historyBlock}

Верни строго JSON:
{
  "paintings": [
    {
      "title": "Точное название на английском",
      "artist": "Имя автора на английском",
      "search_query": "краткий поисковый запрос для поиска в музее"
    }
  ]
}`;

      const suggestRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${groqKey}`, 
          "Content-Type": "application/json" 
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: suggestPrompt }],
          response_format: { type: "json_object" },
          temperature: 0.7
        })
      });

      if (!suggestRes.ok) {
        throw new Error("Сбой на этапе ИИ-куратора. Попробуйте еще раз.");
      }

      const suggestResult = await suggestRes.json();
      const suggestions = extractJSON(suggestResult.choices[0].message.content).paintings as LLMPaintingSuggestion[];

      if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
        throw new Error("Куратор не смог предложить картины. Попробуйте изменить запрос.");
      }

      // ==========================================
      // ЭТАП 3: ПОИСК В МУЗЕЕ + ПОЛУЧЕНИЕ ДЕТАЛЬНЫХ ДАННЫХ
      // ==========================================
      setLoadingStep("Шаг 3: Ищем картины в коллекции музея...");

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
        source: 'chicago' | 'met';
      }

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

            if (matchesTitle && matchesArtist) {
              return {
                id: obj.objectID,
                title: obj.title,
                author: obj.artistDisplayName || suggestion.artist,
                year: obj.objectDate || "Период неизвестен",
                imageUrl: `/api/met/image?url=${encodeURIComponent(obj.primaryImage)}`,
                museumDescription: '',
                medium: obj.medium || '',
                source: 'met' as const
              };
            }

            // Fallback: title-only match
            if (matchesTitle) {
              return {
                id: obj.objectID,
                title: obj.title,
                author: obj.artistDisplayName || suggestion.artist,
                year: obj.objectDate || "Период неизвестен",
                imageUrl: `/api/met/image?url=${encodeURIComponent(obj.primaryImage)}`,
                museumDescription: '',
                medium: obj.medium || '',
                source: 'met' as const
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

        // === TRY ART INSTITUTE OF CHICAGO FIRST ===
        const queries = [suggestion.title, suggestion.search_query, `${suggestion.artist} ${suggestion.title}`];
        let matchedArt: MuseumArtwork | null = null;

        for (const query of queries) {
          if (matchedArt) break;
          try {
            const res = await fetch(`/api/museum/search?q=${encodeURIComponent(query)}&fields=id,title,artist_display,image_id,artwork_type_title,date_display`);
            if (!res.ok) continue;
            const data = await res.json();
            const results = (data.data || []) as MuseumArtwork[];

            matchedArt = results.find(a =>
              a.image_id &&
              titlesMatch(suggestion.title, a.title) &&
              artistsMatch(suggestion.artist, a.artist_display)
            ) || null;

            if (!matchedArt) {
              matchedArt = results.find(a =>
                a.image_id &&
                titlesMatch(suggestion.title, a.title)
              ) || null;
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

        // === FALLBACK: TRY MET MUSEUM ===
        if (!found) {
          for (const query of queries) {
            found = await searchMet(query, suggestion);
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
      // ЭТАП 4: LLM ГЕНЕРИРУЕТ ОПИСАНИЯ НА ОСНОВЕ РЕАЛЬНЫХ ДАННЫХ МУЗЕЯ
      // ==========================================
      setLoadingStep("Шаг 4: Генерируем описания на основе данных музея...");

      const paintingsInfo = foundPaintings.map((p, i) => {
        let info = `${i + 1}. "${p.title}" — ${p.author} (${p.year})`;
        if (p.medium) info += `\nМатериалы: ${p.medium}`;
        if (p.museumDescription) info += `\nОписание из музея: ${p.museumDescription.substring(0, 500)}`;
        return info;
      }).join('\n\n');

      const descPrompt = `Настроение пользователя: "${currentUserState}".

Вот ${foundPaintings.length} реальных картин из коллекций мировых музеев (Art Institute of Chicago, The Metropolitan Museum of Art) с их данными:

${paintingsInfo}

ЗАДАЧА: Для каждой картины напиши два текста на русском языке.

1. "why_fits" — Коротко (1-2 предложения): почему эта картина подходит под настроение пользователя. Без воды, только суть.

2. "about" — Развёрнутое описание картины. Напиши простым, живым языком, как будто рассказываешь другу за кофе. Три абзаца:
   - Первый абзац: Что изображено на картине, цвета, настроение, атмосфера. 2-3 предложения.
   - Второй абзац: Чем цепляет эта работа — техника, стиль, контекст эпохи, эмоции. 3-4 предложения. НЕ начинай с "Почему это круто" или похожих заголовков — просто расскажи.
   - Третий абзац: Один удивительный факт о создании или судьбе картины. 1-2 предложения.

ВАЖНО ПО СТИЛЮ:
- НИКАКИХ эмодзи в тексте (🖼 ✨ 💡 и т.д.).
- НИКАКИХ повторяющихся заголовков типа "Описание:", "Почему это круто:", "Интересный факт:".
- Просто пиши три абзаца подряд, разделённых переносом строки (\\n\\n). Без заголовков, без маркеров.
- НЕ используй шаблонные фразы: "что делает её особенной", "это ценный пример", "демонстрирует мастерство".
- Каждую картину описывай в уникальном стиле — меняй структуру предложений, интонацию, ритм.
- Пиши так, будто это живой разговор, а не энциклопедия.

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

      const descRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${groqKey}`, 
          "Content-Type": "application/json" 
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: descPrompt }],
          response_format: { type: "json_object" },
          temperature: 0.3
        })
      });

      if (!descRes.ok) {
        throw new Error("Сбой при генерации описаний. Попробуйте еще раз.");
      }

      const descResult = await descRes.json();
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
          about: desc?.about || "Произведение из коллекции Чикагского института искусств.",
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

      <main className="max-w-7xl mx-auto px-6 pt-16 md:pt-24 relative z-10">
        
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

        {/* API Key Configuration Block */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="max-w-3xl mx-auto mb-10"
        >
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden transition-all duration-200">
            <button 
              onClick={() => setIsKeyVisible(!isKeyVisible)}
              className="w-full flex items-center justify-between p-5 text-sm text-zinc-300 hover:text-white transition-colors select-none"
            >
              <span className="flex items-center gap-3 font-medium">
                <Key className="w-4 h-4 text-yellow-400" />
                Ключ доступа Groq API
                {groqKey && groqKey.startsWith('gsk_') ? (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">
                    <Check className="w-2.5 h-2.5" /> подключен
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 px-2 py-0.5 rounded">
                    требуется ключ
                  </span>
                )}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isKeyVisible ? 'rotate-180' : ''} text-zinc-500`} />
            </button>
            
            <AnimatePresence>
              {isKeyVisible && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="border-t border-zinc-850 bg-zinc-950/40 p-5"
                >
                  <label className="block text-xs text-zinc-400 font-semibold uppercase tracking-wider mb-2">
                    Groq API Key (gsk_...)
                  </label>
                  <input 
                    type="password" 
                    value={groqKey}
                    onChange={(e) => handleKeyChange(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700/60 rounded-xl px-5 py-3.5 text-sm focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-zinc-200 placeholder-zinc-600 font-mono"
                    placeholder="Вставьте ваш gsk_... ключ (хранится локально в вашем браузере)"
                  />
                  <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                    Ключ используется для прямых запросов к Groq моделям <code className="text-zinc-400 font-mono">llama-3.1-8b</code> и <code className="text-zinc-400 font-mono">llama-3.3-70b</code> прямо из вашего браузера. Получить ключ можно бесплатно на <a href="https://console.groq.com/" target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline">console.groq.com</a>.
                  </p>
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
              {EMOJIS.map(emoji => {
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
