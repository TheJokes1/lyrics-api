// index.js
console.log("🚀 Express start: index.js geladen");

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

// ⬇️ Postgres pool (Supabase TLS) uit ./db.js
const db = require("./db");

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const app = express();
const PORT = process.env.PORT || 8080;

/* --- CORS guard (eerste middleware) --- */
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* --- optioneel: ook de officiële cors() --- */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use(morgan("dev"));

/* =========================
   Health check
   ========================= */
app.get("/health", async (req, res, next) => {
  try {
    const r = await db.query("select 1 as ok");
    res.json({ ok: true, db: r.rows[0].ok === 1 });
  } catch (e) {
    next(e);
  }
});

// index.js (temporary)
app.get("/_debug/dns", async (req, res) => {
  try {
    const d = require("dns").promises;
    const url = new URL(process.env.DATABASE_URL);
    const host = url.hostname;

    const [a, aaaa] = await Promise.all([
      d.resolve4(host).catch(() => []),
      d.resolve6(host).catch(() => []),
    ]);

    res.json({ host, A: a, AAAA: aaaa });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* =========================
   Performers (zonder genre)
   ========================= */

// GET all performers
app.get("/api/performers", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select performer_id as "performerId", name
         from performers
        order by lower(name)`
    );
    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// POST create/update performer (upsert op unieke name)
app.post("/api/performers", async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    const { rows } = await db.query(
      `insert into performers (name)
       values ($1)
       on conflict (name) do nothing
       returning performer_id as "performerId", name`,
      [name.trim()]
    );

    // Als de naam al bestond, hebben we geen row terug. Haal dan bestaande op.
    if (!rows.length) {
      const existing = await db.query(
        `select performer_id as "performerId", name
           from performers
          where lower(name) = lower($1)`,
        [name.trim()]
      );
      if (existing.rows.length) return res.status(200).json(existing.rows[0]);
    }

    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE performer by id
app.delete("/api/performers/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.query(`delete from performers where performer_id = $1`, [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* =========================
   Lyrics (ongewijzigd schema)
   ========================= */

// POST add lyric
app.post("/api/lyrics", async (req, res, next) => {
  try {
    const {
      performerId,
      title,
      body = null,
      language = null,
      spotLink = null,
      classic = null,
    } = req.body || {};

    if (!performerId || !title) {
      return res
        .status(400)
        .json({ error: "performerId and title are required" });
    }

    const { rows } = await db.query(
      `insert into lyrics (performer_id, title, body, language, spotlink, classic)
       values ($1, $2, $3, $4, $5, $6)
       returning lyric_id as "lyricId",
                 performer_id as "performerId",
                 title, body, language, spotlink as "spotLink", classic`,
      [performerId, title, body, language, spotLink, classic]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23503") {
      // FK violation (performer bestaat niet)
      return res
        .status(409)
        .json({ error: "Unknown performerId (FK violation)" });
    }
    next(e);
  }
});

// GET lyrics by performer
app.get("/api/performers/:id/lyrics", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await db.query(
      `select lyric_id as "lyricId",
              performer_id as "performerId",
              title, body, language, spotlink as "spotLink", classic
         from lyrics
        where performer_id = $1
        order by lower(title)`,
      [id]
    );
    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// GET lyric by id
app.get("/api/lyrics/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid lyric id" });
    }

    const { rows } = await db.query(
      `select lyric_id   as "lyricId",
              performer_id as "performerId",
              title,
              body,
              language,
              spotlink    as "spotLink",
              classic
         from lyrics
        where lyric_id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Lyric not found" });
    }

    res.set("Cache-Control", "no-store");
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});


/* =========================
   Error handler
   ========================= */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res
    .status(500)
    .json({ error: "Internal Server Error", detail: err.message ?? String(err) });
});

app.listen(PORT, () => {
  console.log(`HTTP listening at http://localhost:${PORT}`);
});
