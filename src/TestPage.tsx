import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Check, Loader2, Play, Image as ImageIcon } from 'lucide-react';

interface TestPageProps {
  groqKey: string;
  cerebrasKey: string;
  openRouterKey: string;
}

export default function TestPage({ groqKey, cerebrasKey, openRouterKey }: TestPageProps) {
  // LLM Test State
  const [llmProvider, setLlmProvider] = useState<'groq' | 'cerebras' | 'openrouter'>('groq');
  const [llmPrompt, setLlmPrompt] = useState<string>('Say hello in 3 words.');
  const [llmResponse, setLlmResponse] = useState<string>('');
  const [llmIsLoading, setLlmIsLoading] = useState<boolean>(false);

  // Museum Test State
  const [museumProvider, setMuseumProvider] = useState<'chicago' | 'met'>('chicago');
  const [museumQuery, setMuseumQuery] = useState<string>('cats');
  const [museumResponse, setMuseumResponse] = useState<string>('');
  const [museumIsLoading, setMuseumIsLoading] = useState<boolean>(false);

  // Pipeline Test State
  const [pipeLlm, setPipeLlm] = useState<'groq' | 'cerebras' | 'openrouter'>('groq');
  const [pipeMuseum, setPipeMuseum] = useState<'chicago' | 'met'>('chicago');
  const [pipeEmotion, setPipeEmotion] = useState<string>('грустно 🌧️');
  const [pipeIsLoading, setPipeIsLoading] = useState<boolean>(false);
  const [pipeLog, setPipeLog] = useState<string>('');
  const [pipeImage, setPipeImage] = useState<string>('');
  const [pipeTitle, setPipeTitle] = useState<string>('');

  const testLLM = async () => {
    setLlmIsLoading(true);
    setLlmResponse('');
    try {
      let url = "";
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      let body: any = {
        messages: [{ role: "user", content: llmPrompt }],
        temperature: 0.7
      };

      if (llmProvider === 'groq') {
        if (!groqKey) throw new Error("Groq API key is missing");
        url = "https://api.groq.com/openai/v1/chat/completions";
        headers["Authorization"] = `Bearer ${groqKey}`;
        body.model = "llama-3.1-8b-instant";
      } else if (llmProvider === 'cerebras') {
        if (!cerebrasKey) throw new Error("Cerebras API key is missing");
        url = "https://api.cerebras.ai/v1/chat/completions";
        headers["Authorization"] = `Bearer ${cerebrasKey}`;
        body.model = "gpt-oss-120b";
      } else if (llmProvider === 'openrouter') {
        if (!openRouterKey) throw new Error("OpenRouter API key is missing");
        url = "https://openrouter.ai/api/v1/chat/completions";
        headers["Authorization"] = `Bearer ${openRouterKey}`;
        headers["HTTP-Referer"] = window.location.href;
        headers["X-Title"] = "Art and Mood Test";
        body.model = "openrouter/free";
      }

      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
      
      const data = await res.json();
      setLlmResponse(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setLlmResponse(`Error: ${e.message}`);
    } finally {
      setLlmIsLoading(false);
    }
  };

  const testMuseum = async () => {
    setMuseumIsLoading(true);
    setMuseumResponse('');
    try {
      let url = "";
      if (museumProvider === 'chicago') {
        url = `/api/museum/search?q=${encodeURIComponent(museumQuery)}`;
      } else {
        url = `/api/met/search?q=${encodeURIComponent(museumQuery)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
      
      const data = await res.json();
      setMuseumResponse(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setMuseumResponse(`Error: ${e.message}`);
    } finally {
      setMuseumIsLoading(false);
    }
  };

  const checkImage = (url: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  };

  const testPipeline = async () => {
    setPipeIsLoading(true);
    setPipeLog('Шаг 1: Анализ эмоций LLM...\n');
    setPipeImage('');
    setPipeTitle('');
    
    try {
      // 1. LLM call to get keyword
      let url = "";
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      let body: any = {
        messages: [{ 
          role: "user", 
          content: `You are an expert art curator. Analyze this emotion/text: "${pipeEmotion}". 
Provide a single, highly relevant English noun or concept (e.g. "melancholy", "joy", "storm", "love") to search in a museum database. 
Return strictly JSON format: {"query": "keyword"}` 
        }],
        temperature: 0.8,
        response_format: { type: "json_object" }
      };

      if (pipeLlm === 'groq') {
        if (!groqKey) throw new Error("Groq key missing");
        url = "https://api.groq.com/openai/v1/chat/completions";
        headers["Authorization"] = `Bearer ${groqKey}`;
        body.model = "llama-3.1-8b-instant";
      } else if (pipeLlm === 'cerebras') {
        if (!cerebrasKey) throw new Error("Cerebras key missing");
        url = "https://api.cerebras.ai/v1/chat/completions";
        headers["Authorization"] = `Bearer ${cerebrasKey}`;
        body.model = "gpt-oss-120b";
      } else if (pipeLlm === 'openrouter') {
        if (!openRouterKey) throw new Error("OpenRouter key missing");
        url = "https://openrouter.ai/api/v1/chat/completions";
        headers["Authorization"] = `Bearer ${openRouterKey}`;
        headers["HTTP-Referer"] = window.location.href;
        body.model = "openrouter/free";
      }

      const resLlm = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!resLlm.ok) throw new Error(`LLM Error: ${resLlm.status}`);
      
      const dataLlm = await resLlm.json();
      const content = dataLlm.choices[0].message.content;
      const parsed = JSON.parse(content);
      const query = parsed.query;
      
      if (!query) throw new Error(`LLM did not return a 'query' field. Raw: ${content}`);
      
      setPipeLog(prev => prev + `Успешно! Ключевое слово для поиска: "${query}"\nШаг 2: Поиск в музее ${pipeMuseum}...\n`);

      // Helper to shuffle array
      const shuffle = (arr: any[]) => arr.sort(() => 0.5 - Math.random());

      // 2. Museum search
      let foundImage = "";
      let foundTitle = "";
      
      if (pipeMuseum === 'met') {
        const resSearch = await fetch(`/api/met/search?q=${encodeURIComponent(query)}`);
        if (!resSearch.ok) throw new Error("Met Search failed");
        const dataSearch = await resSearch.json();
        
        // Grab top 15 and shuffle them to get varied results
        const objectIDs = shuffle((dataSearch.objectIDs || []).slice(0, 15));
        if (objectIDs.length === 0) throw new Error(`No Met objects found for "${query}".`);
        
        let match = null;
        for (const oid of objectIDs) {
          const r = await fetch(`/api/met/object/${oid}`);
          if (!r.ok) continue;
          const obj = await r.json();
          if (obj.primaryImage && obj.isPublicDomain) {
            const imgUrl = `/api/met/image?url=${encodeURIComponent(obj.primaryImage)}`;
            if (await checkImage(imgUrl)) {
              match = { img: imgUrl, title: obj.title };
              break;
            }
          }
        }
        if (!match) throw new Error("No public domain images found in top results.");
        foundImage = match.img;
        foundTitle = match.title;
      } else {
        const resSearch = await fetch(`/api/museum/search?q=${encodeURIComponent(query)}&fields=id,title,image_id&limit=15`);
        if (!resSearch.ok) throw new Error("Chicago Search failed");
        const dataSearch = await resSearch.json();
        
        // Shuffle the 15 results
        const results = shuffle(dataSearch.data || []);
        
        let match = null;
        for (const a of results) {
          if (a.image_id) {
            const imgUrl = `/api/museum/image/${a.image_id}`;
            if (await checkImage(imgUrl)) {
              match = { img: imgUrl, title: a.title };
              break;
            }
          }
        }
        if (!match) throw new Error("No images found in top results.");
        foundImage = match.img;
        foundTitle = match.title;
      }
      
      setPipeImage(foundImage);
      setPipeTitle(foundTitle);
      setPipeLog(prev => prev + `Успешно! Картина найдена: ${foundTitle}\nТест завершен.`);
      
    } catch (e: any) {
      setPipeLog(prev => prev + `\nОШИБКА: ${e.message}`);
    } finally {
      setPipeIsLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-5xl mx-auto px-6 py-12 space-y-12"
    >
      <div className="text-center">
        <h2 className="text-3xl font-black mb-2 tracking-tight text-white">API Test Lab</h2>
        <p className="text-zinc-400">Песочница для тестирования внешних интеграций.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        
        {/* LLM Test Panel */}
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex flex-col h-full">
          <h3 className="text-lg font-bold text-yellow-400 mb-6 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> Test LLM Providers
          </h3>
          
          <div className="space-y-4 flex-grow">
            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Provider</label>
              <select 
                value={llmProvider} 
                onChange={(e) => setLlmProvider(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-yellow-400"
              >
                <option value="groq">Groq (llama-3.1-8b-instant)</option>
                <option value="cerebras">Cerebras (gpt-oss-120b)</option>
                <option value="openrouter">OpenRouter (openrouter/free)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Prompt</label>
              <textarea 
                value={llmPrompt}
                onChange={(e) => setLlmPrompt(e.target.value)}
                className="w-full h-24 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-200 outline-none focus:border-yellow-400 resize-none font-mono"
              />
            </div>

            <button 
              onClick={testLLM}
              disabled={llmIsLoading}
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {llmIsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Send Request
            </button>

            <div className="mt-4">
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Response / Error</label>
              <div className="bg-black border border-zinc-800 rounded-lg p-4 h-64 overflow-y-auto">
                <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-words">
                  {llmResponse || "Waiting for request..."}
                </pre>
              </div>
            </div>
          </div>
        </div>

        {/* Museum Test Panel */}
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex flex-col h-full">
          <h3 className="text-lg font-bold text-yellow-400 mb-6 flex items-center gap-2">
            <Check className="w-5 h-5" /> Test Museum APIs
          </h3>
          
          <div className="space-y-4 flex-grow">
            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Museum</label>
              <select 
                value={museumProvider} 
                onChange={(e) => setMuseumProvider(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-yellow-400"
              >
                <option value="chicago">Art Institute of Chicago</option>
                <option value="met">The Metropolitan Museum of Art</option>
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Search Query</label>
              <input 
                type="text"
                value={museumQuery}
                onChange={(e) => setMuseumQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-yellow-400 font-mono"
              />
            </div>

            <button 
              onClick={testMuseum}
              disabled={museumIsLoading}
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {museumIsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Send Search Request
            </button>

            <div className="mt-4">
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Response JSON / Error</label>
              <div className="bg-black border border-zinc-800 rounded-lg p-4 h-[18.5rem] overflow-y-auto">
                <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-words">
                  {museumResponse || "Waiting for request..."}
                </pre>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Pipeline Test Panel */}
      <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex flex-col">
        <h3 className="text-lg font-bold text-yellow-400 mb-6 flex items-center gap-2">
          <ImageIcon className="w-5 h-5" /> End-to-End Pipeline Test
        </h3>
        
        <div className="grid md:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Emotion Input</label>
              <input 
                type="text"
                value={pipeEmotion}
                onChange={(e) => setPipeEmotion(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-yellow-400"
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">LLM Provider</label>
              <select 
                value={pipeLlm} 
                onChange={(e) => setPipeLlm(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-yellow-400"
              >
                <option value="groq">Groq</option>
                <option value="cerebras">Cerebras</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Museum</label>
              <select 
                value={pipeMuseum} 
                onChange={(e) => setPipeMuseum(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-yellow-400"
              >
                <option value="chicago">Art Institute of Chicago</option>
                <option value="met">The Met</option>
              </select>
            </div>

            <button 
              onClick={testPipeline}
              disabled={pipeIsLoading}
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {pipeIsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Test Pipeline
            </button>
          </div>

          <div className="md:col-span-2 space-y-4">
            <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Output</label>
            
            <div className="bg-black border border-zinc-800 rounded-lg p-4 h-32 overflow-y-auto mb-4">
              <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-words">
                {pipeLog || "Waiting for test..."}
              </pre>
            </div>

            {pipeImage && (
              <div className="relative h-64 md:h-80 w-full overflow-hidden rounded-xl border border-zinc-800 flex items-center justify-center bg-zinc-950">
                <img src={pipeImage} alt={pipeTitle} className="object-contain w-full h-full" />
                <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-3 backdrop-blur-md">
                  <p className="text-sm text-white font-bold truncate">{pipeTitle}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
