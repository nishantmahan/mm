import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Metadata fetching
  app.get("/api/metadata", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        },
        timeout: 5000,
      });

      const $ = cheerio.load(response.data);
      const title =
        $('meta[property="og:title"]').attr("content") ||
        $('meta[name="twitter:title"]').attr("content") ||
        $("title").text() ||
        new URL(url).hostname;

      let favicon =
        $('link[rel="apple-touch-icon"]').attr("href") ||
        $('link[rel="icon"]').attr("href") ||
        $('link[rel="shortcut icon"]').attr("href") ||
        "/favicon.ico";

      if (favicon && !favicon.startsWith("http")) {
        const urlObj = new URL(url);
        favicon = new URL(favicon, urlObj.origin).href;
      }

      res.json({ title: title.trim(), favicon });
    } catch (error) {
      console.error("Metadata fetch error:", error);
      res.json({
        title: new URL(url).hostname,
        favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`,
      });
    }
  });

  // API Route: Gas Tracker
  app.get("/api/gas", async (req, res) => {
    const apiKey = process.env.ETHERSCAN_API_KEY || "2M1WXTYFPYCYJ4HMB4BJ61EIUI8JTZ8C9H"; // Fallback to user's key if not in env
    try {
      const response = await axios.get(
        `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${apiKey}`
      );
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch gas price" });
    }
  });

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
