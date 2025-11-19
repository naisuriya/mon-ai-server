// server/server.js
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ⭐ Gemini import (ONE TIME ONLY)
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: "*",
    methods: "GET,POST,PUT,DELETE",
    allowedHeaders: "Content-Type",
  })
);

app.use(express.json());

// --- SQLite setup ---
const dbPath = path.join(__dirname, 'mon_ai.db');
const db = new sqlite3.Database(dbPath);

// Default vocabulary
const DEFAULT_VOCAB = {
  "i": "အဲ",
  "you": "မၞး",
  "he": "ဍေံ",
  "she": "ဍေံ",
  "it": "ဂှ်",
  "we": "ပိုဲ",
  "they": "ဍေံတအ်",
  "go": "အာ",
  "eat": "စ",
  "book": "လိက်",
  "school": "ဘာ",
  "tell": "လဴထ္ၜး",
  "am": "ဒှ်",
  "is": "ဒှ်",
  "are": "ဒှ်",
  "tired": "ဍောၚ်ၜိုတ်",
  "home": "သ္ၚိ",
  "house": "သ္ၚိ",
  "banana": "ဗြာတ်",
  "wait for": "မၚ်",
  "waiting for": "မၚ်",
  "look for": "ဂၠာဲ",
  "looking for": "ဂၠာဲ",
  "like to": "ဒး",
  "need to": "ဒး",
  "soon": "ခြာဟွံလအ်",
};

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS vocabulary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT UNIQUE NOT NULL,
      translation TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      en TEXT NOT NULL,
      mnw TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO vocabulary (word, translation) VALUES (?, ?)`
  );
  for (const [word, translation] of Object.entries(DEFAULT_VOCAB)) {
    stmt.run(word.toLowerCase(), translation);
  }
  stmt.finalize();
});

// -------------------- VOCABULARY ROUTES ----------------------

app.get('/api/vocab', (req, res) => {
  db.all(`SELECT word, translation FROM vocabulary`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch vocabulary' });
    const vocab = {};
    rows.forEach(row => vocab[row.word] = row.translation);
    res.json(vocab);
  });
});

app.post('/api/vocab', (req, res) => {
  const { word, translation } = req.body || {};
  if (!word || !translation) return res.status(400).json({ error: 'word and translation are required' });

  const lowerWord = String(word).toLowerCase();

  db.get(`SELECT translation FROM vocabulary WHERE word = ?`, [lowerWord], (err, row) => {
    if (row) {
      return res.json({ word: lowerWord, translation: row.translation, learned: false });
    }
    db.run(
      `INSERT INTO vocabulary (word, translation) VALUES (?, ?)`,
      [lowerWord, translation],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'Failed to insert vocabulary' });
        res.status(201).json({ word: lowerWord, translation, learned: true });
      }
    );
  });
});

app.put('/api/vocab/:word', (req, res) => {
  const word = req.params.word.toLowerCase();
  const { translation } = req.body || {};
  if (!translation) return res.status(400).json({ error: 'translation is required' });

  db.run(
    `UPDATE vocabulary SET translation = ?, updated_at = CURRENT_TIMESTAMP WHERE word = ?`,
    [translation, word],
    function (err) {
      if (err) return res.status(500).json({ error: 'Failed to update vocabulary' });
      if (this.changes === 0) return res.status(404).json({ error: 'Word not found' });
      res.json({ word, translation });
    }
  );
});

app.delete('/api/vocab/:word', (req, res) => {
  const word = req.params.word.toLowerCase();
  db.run(`DELETE FROM vocabulary WHERE word = ?`, [word], function (err) {
    if (this.changes === 0) return res.status(404).json({ error: 'Word not found' });
    res.json({ deleted: true, word });
  });
});

// ----------------------- HISTORY ROUTES ----------------------

app.post('/api/history', (req, res) => {
  const { en, mnw } = req.body || {};
  if (!en || !mnw) return res.status(400).json({ error: 'en and mnw are required' });

  db.run(`INSERT INTO history (en, mnw) VALUES (?, ?)`, [en, mnw], function (err) {
    if (err) return res.status(500).json({ error: 'Failed to store history' });
    res.status(201).json({ id: this.lastID, en, mnw });
  });
});

app.get('/api/history', (req, res) => {
  db.all(
    `SELECT id, en, mnw, created_at FROM history ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Failed to load history" });
      res.json(rows);
    }
  );
});

// ------------------------------------------------------------
// ⭐ SECURE SERVER-SIDE TRANSLATION ENDPOINT
// ------------------------------------------------------------
app.post('/api/translate', async (req, res) => {
  const { sentence, vocabulary, grammarRules } = req.body;

  if (!sentence) {
    return res.status(400).json({ error: "Sentence is required" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY on server" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
Translate to Mon using grammar rules:
Sentence: ${sentence}
Vocabulary: ${JSON.stringify(vocabulary)}
Rules: ${JSON.stringify(grammarRules)}

Return ONLY JSON:
{"translation":"...", "unknownWord":"..."}
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return res.json(JSON.parse(text));
  } catch (err) {
    console.error("Translation error:", err);
    res.status(500).json({ error: "Translation failed" });
  }
});

app.get("/debug-key", (req, res) => {
  res.send("Key loaded = " + (process.env.GEMINI_API_KEY ? "YES" : "NO"));
});

// ------------------------------------------------------------
// START SERVER (MUST BE LAST)
// ------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Mon A.I server running on port ${PORT}`);
});
