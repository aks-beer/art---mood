import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

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
