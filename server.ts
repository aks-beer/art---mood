import express from "express";
import path from "path";
import { readFileSync, existsSync } from "fs";
import { createServer as createViteServer } from "vite";

// ===========================================================================
// Локальный каталог картин (data/catalog.json, собирается scripts/build-catalog.mjs).
// Позволяет матчить предложения куратора локально, не проверяя наличие в рантайме.
// ===========================================================================
const catNorm = (s: string): string =>
  (s || "").toLowerCase().replace(/[^a-zà-ÿ0-9\s]/gi, " ").replace(/\s+/g, " ").trim();

const CAT_STOP = new Set(["the","a","an","of","in","at","on","and","with","for","to","by","de","la","le","les","du","des","el","los","las"]);

const catTitleMatch = (q: string, t: string, threshold = 0.6): boolean => {
  if (!q || !t) return false;
  if (q === t) return true;
  if (t.includes(q) || q.includes(t)) return true;
  const qw = q.split(" ").filter((w) => w.length > 1 && !CAT_STOP.has(w));
  if (!qw.length) return false;
  const matched = qw.filter((w) => t.includes(w));
  return matched.length / qw.length >= threshold;
};

interface CatalogItem { source: string; id: number; title: string; artist: string; year: string; image: string; _t?: string; _a?: string; }
let CATALOG: CatalogItem[] = [];
const loadCatalog = () => {
  try {
    const p = path.join(process.cwd(), "data", "catalog.json");
    if (!existsSync(p)) { console.log("Каталог data/catalog.json не найден — работаем только рантайм-поиском."); return; }
    const j = JSON.parse(readFileSync(p, "utf8"));
    CATALOG = (j.items || []).map((r: CatalogItem) => ({ ...r, _t: catNorm(r.title), _a: catNorm(r.artist) }));
    console.log(`Каталог загружен: ${CATALOG.length} картин`, j.bySource || {});
  } catch (e) {
    console.error("Не удалось загрузить каталог:", e);
  }
};

// ===========================================================================
// Rijksmuseum (Amsterdam) — новая Linked Open Data платформа (без API-ключа).
// Метаданные приходят в формате Linked Art, поэтому название/автора/год нужно
// вытаскивать из вложенных структур. Картинка достаётся цепочкой резолвов:
// объект -> VisualItem (shows) -> DigitalObject (digitally_shown_by) -> IIIF.
// ===========================================================================
const MUSEUM_UA = "ArtAndMoodCurator/1.0 (maryaksonova@gmail.com)";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const AAT_EN = "http://vocab.getty.edu/aat/300388277";       // язык: английский
const AAT_PREFERRED = "http://vocab.getty.edu/aat/300404670"; // предпочитаемый термин
const AAT_CREATOR = "http://vocab.getty.edu/aat/300435416";   // имя автора

const rijksFetchJson = async (url: string): Promise<any | null> => {
  try {
    const r = await fetch(url, { headers: { Accept: "application/ld+json", "User-Agent": MUSEUM_UA } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};

const langOf = (n: any): string[] => (n?.language || []).map((l: any) => l.id);
const classOf = (n: any): string[] => (n?.classified_as || []).map((c: any) => c.id);

const rijksTitle = (obj: any): string | null => {
  const names = (obj.identified_by || []).filter((n: any) => n.type === "Name" && n.content);
  const enPref = names.find((n: any) => langOf(n).includes(AAT_EN) && classOf(n).includes(AAT_PREFERRED));
  const en = names.find((n: any) => langOf(n).includes(AAT_EN));
  const pick = enPref || en || names[0];
  return pick ? pick.content : null;
};

const rijksArtist = (obj: any): string | null => {
  const pools = [obj.produced_by?.referred_to_by, obj.referred_to_by];
  for (const pool of pools) {
    const refs = (pool || []).filter((r: any) => r.content);
    const en = refs.find((r: any) => classOf(r).includes(AAT_CREATOR) && langOf(r).includes(AAT_EN));
    const any = refs.find((r: any) => classOf(r).includes(AAT_CREATOR));
    if (en || any) return (en || any).content;
  }
  for (const p of (obj.produced_by?.part || [])) {
    for (const person of (p.carried_out_by || [])) {
      const en = (person.notation || []).find((n: any) => n["@language"] === "en");
      if (en) return en["@value"];
      if (person.notation && person.notation[0]) return person.notation[0]["@value"];
    }
  }
  return null;
};

const rijksYear = (obj: any): string | null => {
  const n = (obj.produced_by?.timespan?.identified_by || [])[0];
  return n ? n.content : null;
};

// Рекурсивно собирает прозу (LinguisticObject.content), игнорируя заголовки (Name).
const rijksCollectContents = (node: any, out: any[]): void => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((n) => rijksCollectContents(n, out)); return; }
  if (node.type === "LinguisticObject" && typeof node.content === "string" && node.content.length > 0) {
    const langs = langOf(node);
    out.push({ content: node.content, en: langs.includes(AAT_EN), len: node.content.length });
  }
  for (const k of Object.keys(node)) {
    if (k === "content" || k === "language") continue;
    rijksCollectContents(node[k], out);
  }
};

const rijksDescription = (obj: any): string => {
  const out: any[] = [];
  rijksCollectContents(obj.subject_of, out);
  const long = out.filter((x) => x.len >= 60);
  const en = long.filter((x) => x.en).sort((a, b) => b.len - a.len)[0];
  const any = long.sort((a, b) => b.len - a.len)[0];
  return (en || any)?.content || "";
};

// ===========================================================================
// Wikipedia / Wikidata — источник достоверных описаний для картин без музейной
// прозы (прежде всего Met). Met даёт точную ссылку objectWikidata_URL на
// КОНКРЕТНУЮ картину, поэтому путь через Wikidata не может перепутать работу.
// Для остальных — поиск по Wikipedia со строгой проверкой имени автора.
// ===========================================================================
const wikiFetchJson = async (url: string): Promise<any | null> => {
  try {
    const r = await fetch(url, { headers: { "User-Agent": MUSEUM_UA, "Accept": "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};

// Имя файла Commons из URL превью/оригинала.
const wikiCommonsFilename = (url: string): string => {
  const thumb = url.match(/\/commons\/thumb\/[^/]+\/[^/]+\/([^/]+)\//);
  if (thumb) return thumb[1];
  const orig = url.match(/\/commons\/[^/]+\/[^/]+\/([^/?]+)$/);
  return orig ? orig[1] : "";
};

// REST summary за один запрос отдаёт и вводный текст, и картинку (Wikimedia Commons).
const wikiSummary = async (title: string): Promise<{ extract: string; image: string }> => {
  const j = await wikiFetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!j || j.type === "disambiguation") return { extract: "", image: "" };
  const raw = j.thumbnail?.source || j.originalimage?.source || "";
  // Прямые thumb-URL фиксированной ширины ненадёжны (для гигапиксельных оригиналов
  // Wikimedia рендерит лишь часть размеров). Special:FilePath?width= работает всегда.
  let image = "";
  if (raw) {
    const fname = wikiCommonsFilename(raw);
    image = fname
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fname)}?width=1024`
      : raw;
  }
  return { extract: (j.extract || "").trim(), image };
};

const wikiTitleFromWikidata = async (qid: string): Promise<string | null> => {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&format=json`;
  const j = await wikiFetchJson(url);
  return j?.entities?.[qid]?.sitelinks?.enwiki?.title || null;
};

// Имя автора встречается в тексте? (защита от неверной страницы при поиске)
const ARTIST_STOPWORDS = new Set([
  "attributed", "after", "studio", "circle", "follower", "workshop", "manner",
  "copy", "style", "school", "possibly", "probably", "painter", "le", "douanier"
]);
const wikiVerifyArtist = (text: string, artist: string): boolean => {
  const lc = text.toLowerCase();
  const tokens = (artist.toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []).filter((t) => !ARTIST_STOPWORDS.has(t));
  if (tokens.length === 0) return false;
  return tokens.some((t) => lc.includes(t));
};

// Значимое слово из названия встречается? (если значимых нет, напр. "Self-Portrait", не блокируем)
const TITLE_STOPWORDS = new Set([
  "the", "with", "and", "portrait", "painting", "study", "self", "untitled", "young", "woman", "man"
]);
const wikiVerifyTitle = (text: string, title: string): boolean => {
  const lc = text.toLowerCase();
  const tokens = (title.toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []).filter((t) => !TITLE_STOPWORDS.has(t));
  if (tokens.length === 0) return true;
  return tokens.some((t) => lc.includes(t));
};

// Страница про ПРОИЗВЕДЕНИЕ, а не биографию автора? (биографии пишут "was a painter")
const wikiLooksLikeArtwork = (extract: string): boolean =>
  /\b(painting|oil on canvas|oil on panel|oil on|tempera|watercolou?r|gouache|fresco|canvas|panel|depicts|artwork|altarpiece|triptych|etching|drawing)\b/i.test(extract);

const rijksIdToNum = (uri: string): number => {
  const m = (uri || "").match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : Math.floor(Math.random() * 1e9);
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  loadCatalog();

  // API Route: локальный поиск по каталогу. Требует совпадения НАЗВАНИЯ и (если
  // автор задан) АВТОРА — чтобы не выдать одноимённую работу другого художника.
  app.get("/api/catalog/search", (req, res) => {
    const title = catNorm((req.query.title as string) || "");
    const artist = catNorm((req.query.artist as string) || "");
    // relaxed (для "Подобрать ещё"): ниже порог по названию и автор не обязателен.
    const relaxed = req.query.relaxed === "1";
    if (!title || CATALOG.length === 0) { res.json({ data: [] }); return; }

    const threshold = relaxed ? 0.4 : 0.6;
    const artistTokens = artist.split(" ").filter((w) => w.length >= 4);
    const matches: { r: CatalogItem; score: number }[] = [];
    for (const r of CATALOG) {
      if (!catTitleMatch(title, r._t || "", threshold)) continue;
      const artistOk = artistTokens.length === 0 || artistTokens.some((w) => (r._a || "").includes(w));
      // В обычном режиме при заданном авторе требуем совпадение автора (чтобы не
      // выдать одноимённую работу другого художника). В relaxed — не требуем.
      if (!relaxed && artistTokens.length > 0 && !artistOk) continue;
      const score = (r._t === title ? 2 : 0) + (artistOk ? 1 : 0);
      matches.push({ r, score });
    }
    matches.sort((a, b) => b.score - a.score);
    const data = matches.slice(0, 3).map((m) => ({
      source: m.r.source, id: m.r.id, title: m.r.title, artist: m.r.artist, year: m.r.year, image: m.r.image,
    }));
    res.json({ data });
  });

  // API Route: Proxy search requests to avoid potential CORS and sandboxing issues
  app.get("/api/museum/search", async (req, res) => {
    try {
      const { q, fields } = req.query;
      if (!q) {
        res.status(400).json({ error: "Query parameter 'q' is required" });
        return;
      }

      const targetUrl = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q as string)}&query[term][is_public_domain]=true&limit=25&fields=${encodeURIComponent((fields as string) || "id,title,artist_display,image_id,artwork_type_title,date_display")}`;
      
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "ArtAndMoodCurator/1.0 (maryaksonova@gmail.com)"
        }
      });

      if (!response.ok) {
        res.status(response.status).json({ error: `Museum API returned error: ${response.statusText}` });
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error proxying search to Museum API:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // API Route: Fetch detailed artwork info by ID
  app.get("/api/museum/artwork/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const targetUrl = `https://api.artic.edu/api/v1/artworks/${id}?fields=id,title,artist_display,date_display,medium_display,description,short_description,dimensions,credit_line,image_id,artwork_type_title`;
      
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "ArtAndMoodCurator/1.0 (maryaksonova@gmail.com)"
        }
      });

      if (!response.ok) {
        res.status(response.status).json({ error: `Museum API returned error: ${response.statusText}` });
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error fetching artwork detail:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // API Route: Met Museum search (returns objectIDs)
  app.get("/api/met/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) {
        res.status(400).json({ error: "Query parameter 'q' is required" });
        return;
      }

      const targetUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(q as string)}&hasImages=true&isPublicDomain=true`;
      
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "ArtAndMoodCurator/1.0 (maryaksonova@gmail.com)"
        }
      });

      if (!response.ok) {
        res.status(response.status).json({ error: `Met API returned error: ${response.statusText}` });
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error proxying search to Met API:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // API Route: Met Museum object detail
  app.get("/api/met/object/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const targetUrl = `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`;
      
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "ArtAndMoodCurator/1.0 (maryaksonova@gmail.com)"
        }
      });

      if (!response.ok) {
        res.status(response.status).json({ error: `Met API returned error: ${response.statusText}` });
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error fetching Met object:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // API Route: Proxy Met Museum images
  app.get("/api/met/image", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        res.status(400).end();
        return;
      }

      const response = await fetch(url as string, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Referer": "https://www.metmuseum.org/"
        }
      });

      if (!response.ok) {
        res.status(response.status).end();
        return;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (error) {
      console.error("Error proxying Met image:", error);
      res.status(500).end();
    }
  });

  // API Route: Cleveland Museum of Art (CMA) search — open access, no key, CC0 images
  app.get("/api/cma/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) {
        res.status(400).json({ error: "Query parameter 'q' is required" });
        return;
      }

      const fields = "id,title,creators,creation_date,images,type,description,technique,tombstone";
      const targetUrl = `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q as string)}&has_image=1&cc0=1&limit=20&fields=${fields}`;

      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "ArtAndMoodCurator/1.0 (maryaksonova@gmail.com)"
        }
      });

      if (!response.ok) {
        res.status(response.status).json({ error: `CMA API returned error: ${response.statusText}` });
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error proxying search to CMA API:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // API Route: Proxy Cleveland Museum of Art images
  app.get("/api/cma/image", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        res.status(400).end();
        return;
      }

      const response = await fetch(url as string, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Referer": "https://www.clevelandart.org/"
        }
      });

      if (!response.ok) {
        res.status(response.status).end();
        return;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (error) {
      console.error("Error proxying CMA image:", error);
      res.status(500).end();
    }
  });

  // API Route: Rijksmuseum search — Linked Open Data, без ключа. Поиск по
  // названию, затем резолв топ-кандидатов в нормализованный вид для клиента.
  app.get("/api/rijks/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) {
        res.status(400).json({ error: "Query parameter 'q' is required" });
        return;
      }

      const searchUrl = `https://data.rijksmuseum.nl/search/collection?title=${encodeURIComponent(q as string)}&type=painting&imageAvailable=true`;
      const searchData = await rijksFetchJson(searchUrl);
      if (!searchData) {
        res.status(502).json({ error: "Rijksmuseum search failed" });
        return;
      }

      const ids = (searchData.orderedItems || []).slice(0, 4).map((i: any) => i.id);
      const objects = await Promise.all(ids.map((id: string) => rijksFetchJson(id)));

      const data = objects
        .filter(Boolean)
        .map((o: any) => ({
          id: rijksIdToNum(o.id),
          title: rijksTitle(o),
          artist: rijksArtist(o),
          year: rijksYear(o),
          description: rijksDescription(o),
          visualId: (o.shows || [])[0]?.id || null
        }))
        .filter((x: any) => x.title && x.visualId);

      res.json({ data });
    } catch (error: any) {
      console.error("Error proxying search to Rijksmuseum API:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // API Route: Rijksmuseum image proxy — резолвит VisualItem -> DigitalObject ->
  // IIIF access_point, ограничивает размер до 843px и отдаёт JPEG.
  app.get("/api/rijks/image", async (req, res) => {
    try {
      const { visual } = req.query;
      if (!visual) {
        res.status(400).end();
        return;
      }

      const visualData = await rijksFetchJson(visual as string);
      const digiId = (visualData?.digitally_shown_by || [])[0]?.id;
      if (!digiId) {
        res.status(404).end();
        return;
      }

      const digiData = await rijksFetchJson(digiId);
      let accessPoint = (digiData?.access_point || [])[0]?.id;
      if (!accessPoint) {
        res.status(404).end();
        return;
      }
      // IIIF: full/max может быть в десятки МБ — ограничиваем ширину до 843px.
      accessPoint = accessPoint.replace("/full/max/", "/full/843,/");

      const response = await fetch(accessPoint, {
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
      });

      if (!response.ok) {
        res.status(response.status).end();
        return;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (error) {
      console.error("Error proxying Rijksmuseum image:", error);
      res.status(500).end();
    }
  });

  // API Route: Wikipedia/Wikidata — достоверное описание И картинка (Wikimedia
  // Commons). Покрывает любую известную работу, даже не из наших музеев.
  // Возвращает { extract, image, source } или { extract: "", image: "" }.
  app.get("/api/wiki/describe", async (req, res) => {
    try {
      const title = (req.query.title as string) || "";
      const artist = (req.query.artist as string) || "";
      const wikidata = (req.query.wikidata as string) || "";

      // 1) Точный путь: Q-id из ссылки музея (Met objectWikidata_URL).
      const qidMatch = wikidata.match(/Q\d+/);
      if (qidMatch) {
        const enTitle = await wikiTitleFromWikidata(qidMatch[0]);
        if (enTitle) {
          const { extract, image } = await wikiSummary(enTitle);
          if (extract.length >= 40) {
            res.json({ extract: extract.slice(0, 1200), image, source: "wikidata", title: enTitle });
            return;
          }
        }
      }

      // 2) Поиск по Wikipedia + строгая проверка имени автора.
      if (title) {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(`${title} ${artist} painting`)}`;
        const sj = await wikiFetchJson(searchUrl);
        const hit = sj?.query?.search?.[0]?.title;
        if (hit) {
          const { extract, image } = await wikiSummary(hit);
          // Тройная защита: имя автора + слово из названия + это страница о произведении.
          const ok = extract.length >= 40
            && wikiVerifyArtist(extract, artist)
            && wikiVerifyTitle(`${hit} ${extract}`, title)
            && wikiLooksLikeArtwork(extract);
          if (ok) {
            res.json({ extract: extract.slice(0, 1200), image, source: "search", title: hit });
            return;
          }
        }
      }

      res.json({ extract: "", image: "" });
    } catch (error: any) {
      console.error("Error in wiki describe:", error);
      res.json({ extract: "", image: "" });
    }
  });

  // API Route: прокси картинок Wikimedia Commons (требует User-Agent).
  app.get("/api/wiki/image", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || !/^https:\/\/(upload|commons)\.wikimedia\.org\//.test(url as string)) {
        res.status(400).end();
        return;
      }
      const response = await fetch(url as string, {
        headers: { "User-Agent": BROWSER_UA, "Accept": "image/*,*/*;q=0.8" }
      });
      if (!response.ok) { res.status(response.status).end(); return; }
      res.setHeader("Content-Type", response.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error("Error proxying Wikimedia image:", error);
      res.status(500).end();
    }
  });

  // ===== Victoria and Albert Museum (V&A) — открытый API без ключа =====
  // Поиск: возвращает нормализованных кандидатов с IIIF-картинкой.
  app.get("/api/va/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) { res.status(400).json({ error: "Query parameter 'q' is required" }); return; }
      // q_object_type в API не фильтрует надёжно (возвращает ноты/постеры/ткани),
      // поэтому фильтруем по objectType на нашей стороне.
      const url = `https://api.vam.ac.uk/v2/objects/search?q=${encodeURIComponent(q as string)}&images_exist=true&page_size=15`;
      const response = await fetch(url, { headers: { "User-Agent": MUSEUM_UA } });
      if (!response.ok) { res.status(response.status).json({ error: `V&A API ${response.statusText}` }); return; }
      const j = await response.json();
      const isPainting = (t: string) => /painting|watercolou?r|tempera|gouache/i.test(t || "");
      const data = (j.records || [])
        .filter((r: any) => isPainting(r.objectType))
        .map((r: any) => {
          const imgId = r._primaryImageId;
          return {
            id: r.systemNumber,
            title: (r._primaryTitle || "").replace(/<[^>]*>/g, ""),
            artist: r._primaryMaker?.name || "",
            year: r._primaryDate || "",
            image: imgId ? `https://framemark.vam.ac.uk/collections/${imgId}/full/!843,843/0/default.jpg` : "",
          };
        })
        .filter((x: any) => x.title && x.image);
      res.json({ data });
    } catch (error: any) {
      console.error("Error proxying search to V&A API:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // V&A: описание конкретного объекта.
  app.get("/api/va/detail", async (req, res) => {
    try {
      const { id } = req.query;
      if (!id) { res.status(400).json({ error: "id required" }); return; }
      const r = await fetch(`https://api.vam.ac.uk/v2/object/${encodeURIComponent(id as string)}`, { headers: { "User-Agent": MUSEUM_UA } });
      if (!r.ok) { res.json({ description: "" }); return; }
      const j = await r.json();
      const rec = j.record || {};
      const desc = (rec.summaryDescription || rec.physicalDescription || "").replace(/<[^>]*>/g, "").trim();
      res.json({ description: desc });
    } catch {
      res.json({ description: "" });
    }
  });

  // V&A: прокси картинок (IIIF framemark CDN).
  app.get("/api/va/image", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || !/^https:\/\/framemark\.vam\.ac\.uk\//.test(url as string)) { res.status(400).end(); return; }
      const response = await fetch(url as string, { headers: { "User-Agent": BROWSER_UA, "Accept": "image/*,*/*;q=0.8" } });
      if (!response.ok) { res.status(response.status).end(); return; }
      res.setHeader("Content-Type", response.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error("Error proxying V&A image:", error);
      res.status(500).end();
    }
  });

  // API Route: Proxy image requests to serve them directly from our server (avoiding iframe block and referrer policies)
  app.get("/api/museum/image/:image_id", async (req, res) => {
    try {
      const { image_id } = req.params;
      const imageUrl = `https://www.artic.edu/iiif/2/${image_id}/full/843,/0/default.jpg`;

      const response = await fetch(imageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Referer": "https://www.artic.edu/",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });

      if (!response.ok) {
        res.status(response.status).end();
        return;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400"); // cache for 1 day
      
      // Convert response body to buffer and send
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (error) {
      console.error("Error proxying image:", error);
      res.status(500).end();
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
