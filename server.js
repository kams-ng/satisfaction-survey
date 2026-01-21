import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

// --- pour __dirname en ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- middlewares ---
app.use(cors());
app.use(express.json());

// --- servir le frontend (public/index.html) ---
app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "assets")));

const db = new Database("satisfaction.db");

// --- DB schema ---
db.exec(`
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  email TEXT NOT NULL,
  client_name TEXT NOT NULL,
  project TEXT NOT NULL,

  reactivity INTEGER NOT NULL,
  reactivity_suggestion TEXT,

  deadlines INTEGER NOT NULL,
  deadlines_suggestion TEXT,

  deliverables INTEGER NOT NULL,
  deliverables_suggestion TEXT,

  professionalism INTEGER NOT NULL,
  professionalism_suggestion TEXT,

  global_comment TEXT,

  UNIQUE(client_name, project)
);
`);

function monthRange(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

// --- Create feedback ---
app.post("/api/feedback", (req, res) => {
  const body = req.body;

  const required = ["email", "client_name", "project", "reactivity", "deadlines", "deliverables", "professionalism"];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === "") {
      return res.status(400).json({ error: `Missing field: ${k}` });
    }
  }

  const stmt = db.prepare(`
    INSERT INTO feedback (
      created_at, email, client_name, project,
      reactivity, reactivity_suggestion,
      deadlines, deadlines_suggestion,
      deliverables, deliverables_suggestion,
      professionalism, professionalism_suggestion,
      global_comment
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?
    )
  `);

  try {
    stmt.run(
      new Date().toISOString(),
      body.email.trim(),
      body.client_name.trim(),
      body.project.trim(),
      Number(body.reactivity),
      body.reactivity_suggestion || null,
      Number(body.deadlines),
      body.deadlines_suggestion || null,
      Number(body.deliverables),
      body.deliverables_suggestion || null,
      Number(body.professionalism),
      body.professionalism_suggestion || null,
      body.global_comment || null
    );

    return res.json({ ok: true, message: "Feedback enregistré." });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({
        error: "Ce client a déjà noté ce projet. Merci de choisir un autre projet.",
      });
    }
    return res.status(500).json({ error: "Erreur serveur.", details: e.message });
  }
});

// --- Monthly stats + action plan ---
app.get("/api/stats", (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: "month is required, e.g. 2026-01" });

  const { start, end } = monthRange(month);

  const rows = db.prepare(`
    SELECT
      project,
      COUNT(*) as responses,
      AVG(reactivity) as avg_reactivity,
      AVG(deadlines) as avg_deadlines,
      AVG(deliverables) as avg_deliverables,
      AVG(professionalism) as avg_professionalism,
      AVG((reactivity+deadlines+deliverables+professionalism)/4.0) as avg_total
    FROM feedback
    WHERE created_at >= ? AND created_at < ?
    GROUP BY project
    ORDER BY avg_total ASC
  `).all(start, end);

  const threshold = 4;
  const actions = [];
  for (const r of rows) {
    const a = [];
    if (r.avg_reactivity < threshold) a.push("Réactivité: définir SLA (ex: réponse < 24h), point hebdo, canal unique.");
    if (r.avg_deadlines < threshold) a.push("Délais: jalons, buffer, suivi régulier, gestion risques.");
    if (r.avg_deliverables < threshold) a.push("Livrables: checklist qualité, revue interne, templates.");
    if (r.avg_professionalism < threshold) a.push("Pro/Innovation: REX mensuel, formation, partage bonnes pratiques.");
    if (a.length) actions.push({ project: r.project, recommendations: a });
  }

  res.json({ month, start, end, projects: rows, action_plan: actions });
});

app.listen(3000, () => {
  console.log("Web + API: http://localhost:3000");
});

