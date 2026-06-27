import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

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

const rijksIdToNum = (uri: string): number => {
  const m = (uri || "").match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : Math.floor(Math.random() * 1e9);
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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
