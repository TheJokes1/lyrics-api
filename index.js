// index.js
console.log("🚀 Express start: index.js geladen");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 8080;

/* --- HARDENED CORS GUARD (eerste middleware) --- */
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* --- optioneel: daarnaast ook de officiële cors() --- */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(morgan("dev"));

// --- database init
const dbPath = process.env.DB_PATH || 'lyrics.sqlite';
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Tabellen aanmaken (als ze er nog niet zijn)
db.exec(`
  CREATE TABLE IF NOT EXISTS Performers (
    PerformerId INTEGER PRIMARY KEY AUTOINCREMENT,
    Name        TEXT NOT NULL CHECK(length(Name) <= 100),
    Genre       TEXT
  );

  CREATE TABLE IF NOT EXISTS Lyrics (
    LyricId      INTEGER PRIMARY KEY AUTOINCREMENT,
    Words        TEXT NOT NULL CHECK(length(Words) <= 500),
    SongTitle    TEXT NOT NULL CHECK(length(SongTitle) <= 100),
    Language     TEXT NOT NULL,
    SpotLink     TEXT,
    ImageUrl     TEXT,
    PreviewLink  TEXT,
    PerformerId  INTEGER NOT NULL,
    FOREIGN KEY (PerformerId) REFERENCES Performers(PerformerId)
      ON UPDATE CASCADE
      ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_lyrics_performer ON Lyrics(PerformerId);
`);

// Eventueel wat seed-data (alleen als leeg)
const hasData = db.prepare("SELECT COUNT(*) as c FROM Performers").get().c > 0;
if (!hasData) {
  const insertPerformer = db.prepare(
    "INSERT INTO Performers (Name, Genre) VALUES (?, ?)"
  );
  const p1 = insertPerformer.run("Nirvana", "Grunge").lastInsertRowid;
  const p2 = insertPerformer.run("Adele", "Pop").lastInsertRowid;

  const insertLyric = db.prepare(`
    INSERT INTO Lyrics (Words, SongTitle, Language, SpotLink, ImageUrl, PreviewLink, PerformerId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertLyric.run(
    "Here we are now, entertain us...",
    "Smells Like Teen Spirit",
    "en",
    null,
    null,
    null,
    p1
  );
  insertLyric.run("Hello, it's me...", "Hello", "en", null, null, null, p2);
}

// --- helpers
function mapLyric(row) {
  if (!row) return null;
  return {
    lyricId: row.LyricId,
    words: row.Words,
    songTitle: row.SongTitle,
    language: row.Language,
    spotLink: row.SpotLink,
    imageUrl: row.ImageUrl,
    previewLink: row.PreviewLink,
    performerId: row.PerformerId,
  };
}

function mapPerformer(row) {
  if (!row) return null;
  return {
    performerId: row.PerformerId,
    name: row.Name,
    genre: row.Genre,
  };
}

app.post("/admin/reset-db", (req, res) => {
  try {
    const Database = require("better-sqlite3");
    const db = new Database("data/app.db");

    db.pragma("foreign_keys = ON");

    db.exec(`
      DELETE FROM lyrics;
      DELETE FROM performers;
      DELETE FROM sqlite_sequence WHERE name='lyrics';
      DELETE FROM sqlite_sequence WHERE name='performers';
    `);

    res.json({ ok: true, message: "Database cleared successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/__headers", (req, res) => {
  res.json({
    corsHeaders: {
      A_C_A_Origin: res.getHeader("Access-Control-Allow-Origin"),
      A_C_A_Methods: res.getHeader("Access-Control-Allow-Methods"),
      A_C_A_Headers: res.getHeader("Access-Control-Allow-Headers")
    },
    note: "Als deze velden null zijn, is de CORS-middleware niet geraakt."
  });
});


// --- routes: performers (CRUD)
app.get("/api/performers", (req, res) => {
  const rows = db.prepare("SELECT * FROM Performers ORDER BY Name").all();
  res.json(rows.map(mapPerformer));
});

app.get("/api/performers/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare("SELECT * FROM Performers WHERE PerformerId = ?")
    .get(id);
  if (!row) return res.status(404).json({ message: "Performer not found" });
  res.json(mapPerformer(row));
});

app.post("/api/performers", (req, res) => {
  const { name, genre } = req.body || {};
  if (!name || name.length > 100) {
    return res
      .status(400)
      .json({ message: "name is verplicht (<= 100 chars)" });
  }
  const stmt = db.prepare("INSERT INTO Performers (Name, Genre) VALUES (?, ?)");
  const result = stmt.run(name, genre ?? null);
  const created = db
    .prepare("SELECT * FROM Performers WHERE PerformerId = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(mapPerformer(created));
});

app.put("/api/performers/:id", (req, res) => {
  const id = Number(req.params.id);
  const exists = db
    .prepare("SELECT 1 FROM Performers WHERE PerformerId = ?")
    .get(id);
  if (!exists) return res.status(404).json({ message: "Performer not found" });

  const { name, genre } = req.body || {};
  if (!name || name.length > 100) {
    return res
      .status(400)
      .json({ message: "name is verplicht (<= 100 chars)" });
  }
  db.prepare(
    "UPDATE Performers SET Name = ?, Genre = ? WHERE PerformerId = ?"
  ).run(name, genre ?? null, id);

  const updated = db
    .prepare("SELECT * FROM Performers WHERE PerformerId = ?")
    .get(id);
  res.json(mapPerformer(updated));
});

app.delete("/api/performers/:id", (req, res) => {
  const id = Number(req.params.id);
  try {
    const info = db
      .prepare("DELETE FROM Performers WHERE PerformerId = ?")
      .run(id);
    if (info.changes === 0)
      return res.status(404).json({ message: "Performer not found" });
    res.status(204).send();
  } catch (e) {
    // FK restrict: als er lyrics zijn, krijg je hier een constraint error
    if (String(e).includes("FOREIGN KEY constraint failed")) {
      return res
        .status(409)
        .json({
          message:
            "Kan performer niet verwijderen: er zijn nog gekoppelde lyrics",
        });
    }
    throw e;
  }
});

// --- routes: lyrics (CRUD)
app.get("/api/lyrics", (req, res) => {
  // inclusief performer info via JOIN
  const rows = db
    .prepare(
      `
    SELECT l.*, p.PerformerId as PId, p.Name as PName, p.Genre as PGenre
    FROM Lyrics l
    JOIN Performers p ON p.PerformerId = l.PerformerId
    ORDER BY l.LyricId DESC
  `
    )
    .all();

  const data = rows.map((r) => ({
    ...mapLyric(r),
    performer: { performerId: r.PId, name: r.PName, genre: r.PGenre },
  }));
  res.json(data);
});

app.get("/api/lyrics/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(
      `
    SELECT l.*, p.PerformerId as PId, p.Name as PName, p.Genre as PGenre
    FROM Lyrics l
    JOIN Performers p ON p.PerformerId = l.PerformerId
    WHERE l.LyricId = ?
  `
    )
    .get(id);

  if (!row) return res.status(404).json({ message: "Lyric not found" });
  res.json({
    ...mapLyric(row),
    performer: { performerId: row.PId, name: row.PName, genre: row.PGenre },
  });
});

app.get("/api/performers/:id/lyrics", (req, res) => {
  const id = Number(req.params.id);
  const rows = db
    .prepare("SELECT * FROM Lyrics WHERE PerformerId = ? ORDER BY LyricId DESC")
    .all(id);
  res.json(rows.map(mapLyric));
});

app.post("/api/lyrics", (req, res) => {
  const {
    words,
    songTitle,
    language,
    spotLink,
    imageUrl,
    previewLink,
    performerId,
  } = req.body || {};

  // Validaties n.a.v. je C#-attributen
  if (!words || words.length > 500)
    return res
      .status(400)
      .json({ message: "words is verplicht (<= 500 chars)" });
  if (!songTitle || songTitle.length > 100)
    return res
      .status(400)
      .json({ message: "songTitle is verplicht (<= 100 chars)" });
  if (!language)
    return res.status(400).json({ message: "language is verplicht" });
  if (!Number.isInteger(performerId))
    return res
      .status(400)
      .json({ message: "performerId is verplicht (integer)" });

  // FK check
  const existsPerformer = db
    .prepare("SELECT 1 FROM Performers WHERE PerformerId = ?")
    .get(performerId);
  if (!existsPerformer)
    return res.status(404).json({ message: "Performer bestaat niet" });

  const stmt = db.prepare(`
    INSERT INTO Lyrics (Words, SongTitle, Language, SpotLink, ImageUrl, PreviewLink, PerformerId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    words,
    songTitle,
    language,
    spotLink ?? null,
    imageUrl ?? null,
    previewLink ?? null,
    performerId
  );
  const created = db
    .prepare("SELECT * FROM Lyrics WHERE LyricId = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(mapLyric(created));
});

app.put("/api/lyrics/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM Lyrics WHERE LyricId = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Lyric not found" });

  const {
    words = existing.Words,
    songTitle = existing.SongTitle,
    language = existing.Language,
    spotLink = existing.SpotLink,
    imageUrl = existing.ImageUrl,
    previewLink = existing.PreviewLink,
    performerId = existing.PerformerId,
  } = req.body || {};

  if (!words || words.length > 500)
    return res
      .status(400)
      .json({ message: "words is verplicht (<= 500 chars)" });
  if (!songTitle || songTitle.length > 100)
    return res
      .status(400)
      .json({ message: "songTitle is verplicht (<= 100 chars)" });
  if (!language)
    return res.status(400).json({ message: "language is verplicht" });
  if (!Number.isInteger(performerId))
    return res
      .status(400)
      .json({ message: "performerId is verplicht (integer)" });

  const existsPerformer = db
    .prepare("SELECT 1 FROM Performers WHERE PerformerId = ?")
    .get(performerId);
  if (!existsPerformer)
    return res.status(404).json({ message: "Performer bestaat niet" });

  db.prepare(
    `
    UPDATE Lyrics
    SET Words = ?, SongTitle = ?, Language = ?, SpotLink = ?, ImageUrl = ?, PreviewLink = ?, PerformerId = ?
    WHERE LyricId = ?
  `
  ).run(
    words,
    songTitle,
    language,
    spotLink ?? null,
    imageUrl ?? null,
    previewLink ?? null,
    performerId,
    id
  );

  const updated = db.prepare("SELECT * FROM Lyrics WHERE LyricId = ?").get(id);
  res.json(mapLyric(updated));
});

app.delete("/api/lyrics/:id", (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM Lyrics WHERE LyricId = ?").run(id);
  if (info.changes === 0)
    return res.status(404).json({ message: "Lyric not found" });
  res.status(204).send();
});

// --- health
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Lyrics API",
    endpoints: ["/api/performers", "/api/lyrics"],
  });
});

// --- error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

// --- start
app.listen(PORT, () => {
  console.log(`Lyrics API running on http://localhost:${PORT}`);
});
