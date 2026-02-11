// index.js
console.log("🚀 Express start: index.js geladen");

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
   Performers
   ========================= */

// GET all performers
app.get("/api/performers", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `
      select
        "PerformerId" as "performerId",
        "Name"        as "name"
      from performers
      order by lower("Name")
      `
    );
    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// POST create/update performer (upsert on unique "Name")
app.post("/api/performers", async (req, res, next) => {
  try {
    const { name } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required (non-empty string)" });
    }
    const cleanName = name.trim();

    const { rows } = await db.query(
      `
      insert into performers ("Name")
      values ($1)
      on conflict ("Name") do update set "Name" = excluded."Name"
      returning
        "PerformerId" as "performerId",
        "Name"        as "name"
      `,
      [cleanName]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/* =========================
   Lyrics
   ========================= */

// POST add lyric
app.post("/api/lyrics", async (req, res, next) => {
  try {
    const {
      performerId,
      songTitle,
      words = null,
      language = null,
      spotLink = null,
      classic = null,
    } = req.body || {};

    if (!performerId || !songTitle || typeof songTitle !== "string" || !songTitle.trim()) {
      return res.status(400).json({ error: "performerId and songTitle are required" });
    }

    // Optional normalization: coerce classic to boolean if sent as "true"/"false"
    let classicValue = classic;
    if (typeof classicValue === "string") {
      const lc = classicValue.toLowerCase();
      if (lc === "true") classicValue = true;
      else if (lc === "false") classicValue = false;
    }

    const { rows } = await db.query(
      `
      insert into lyrics
        ("PerformerId", "SongTitle", "Words", "Language", "SpotLink", "Classic")
      values
        ($1, $2, $3, $4, $5, $6)
      returning
        "LyricId"     as "lyricId",
        "PerformerId" as "performerId",
        "SongTitle"   as "songTitle",
        "Words"       as "words",
        "Language"    as "language",
        "SpotLink"    as "spotLink",
        "Classic"     as "classic"
      `,
      [performerId, songTitle.trim(), words, language, spotLink, classicValue]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    // 23503 = foreign_key_violation
    if (e.code === "23503") {
      return res.status(409).json({ error: "Unknown performerId (FK violation)" });
    }
    next(e);
  }
});

// GET lyric by id
app.get("/api/lyrics/:id", async (req, res, next) => {
  try {
    // Keep numeric validation if your ids are integers; if they're UUIDs, remove this guard.
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid lyric id" });
    }

    
const { rows } = await db.query(
      `
      SELECT
        l."LyricId"     AS "lyricId",
        l."PerformerId" AS "performerId",
        p."Name"        AS "performer",     -- 👈 ADDED performer name!
        l."SongTitle"   AS "songTitle",
        l."Words"       AS "words",
        l."Language"    AS "language",
        l."SpotLink"    AS "spotLink",
        l."Classic"     AS "classic",
        l."Year"        AS "era",
        l."ImageUrl"    AS "imageUrl",
        l."PreviewUrl"  AS "previewUrl",
        l."Popularity"  AS "popularity"
      FROM lyrics l
      LEFT JOIN performers p ON p."PerformerId" = l."PerformerId"
      WHERE l."LyricId" = $1
      `,
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



app.get("/api/lyrics", async (req, res, next) => {
  try {
    // Normalize inputs: treat undefined/empty strings as null
    const norm = (v) => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s.length ? s : null;
    };

    // Accept both your new names and the older Angular ones
    let language = norm(req.query.language);
    let era = norm(req.query.era ?? req.query.releaseDate);
    let text = norm(req.query.text ?? req.query.SearchQueryTitle);

    // If frontend wrapped with "%20...%20", clean it safely
    if (text) {
      try {
        const dec = decodeURIComponent(text);
        text = dec.replace(/^%20|%20$/g, "").trim();
      } catch {
        // ignore decode errors, keep original trimmed text
      }
    }

    // Pagination
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "50", 10)));
    const offset = (page - 1) * pageSize;

    // Dynamic WHERE with parameterized SQL
    const where = [];
    const params = [];
    let idx = 1;

    if (language) {
      where.push(`l."Language" = $${idx++}`);
      params.push(language);
    }
    if (era) {
      where.push(`l."Era" = $${idx++}`);
      params.push(era);
    }
    if (text) {
      where.push(`(
        l."SongTitle" ILIKE $${idx}
        OR COALESCE(l."Words",'') ILIKE $${idx}
        OR COALESCE(p."Name",'') ILIKE $${idx}
      )`);
      params.push(`%${text}%`);
      idx++;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Main query (include performer name for convenience)
    const sql = `
      SELECT
        l."LyricId"     AS "lyricId",
        l."PerformerId" AS "performerId",
        p."Name"        AS "performer",     -- 👈 ADDED performer name!
        l."SongTitle"   AS "songTitle",
        l."Words"       AS "words",
        l."Language"    AS "language",
        l."SpotLink"    AS "spotLink",
        l."Classic"     AS "classic",
        l."Year"        AS "era",
        l."ImageUrl"    AS "imageUrl",
        l."PreviewUrl"  AS "previewUrl",
        l."Popularity"  AS "popularity"
      FROM lyrics l
      LEFT JOIN performers p ON p."PerformerId" = l."PerformerId"
      ${whereSql}
      ORDER BY l."LyricId" ASC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const mainParams = params.concat([pageSize, offset]);

    // Count query uses only filter params
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM lyrics l
      LEFT JOIN performers p ON p."PerformerId" = l."PerformerId"
      ${whereSql}
    `;

    const [countResult, rowsResult] = await Promise.all([
      db.query(countSql, params),
      db.query(sql, mainParams),
    ]);

    res.set("Cache-Control", "no-store");
    return res.json(rowsResult.rows ?? []);
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
