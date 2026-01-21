import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";

const app = express();

// --- pour __dirname en ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- middlewares ---
app.use(cors());
app.use(express.json());

// --- servir le frontend (public/index.html) ---
app.use(express.static(path.join(__dirname, "public")));

// Si ton dossier assets est à la racine (à côté de public)
app.use("/assets", express.static(path.join(__dirname, "assets")));

// --- Vérification env + init sql ---
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL manquant. Mets-le dans .env");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

// --- DB schema (Postgres) ---
async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      email TEXT NOT NULL,
      client_name TEXT NOT NULL,
      project TEXT NOT NULL,

      reactivity INT NOT NULL CHECK (reactivity BETWEEN 1 AND 5),
      reactivity_suggestion TEXT,

      deadlines INT NOT NULL CHECK (deadlines BETWEEN 1 AND 5),
      deadlines_suggestion TEXT,

      deliverables INT NOT NULL CHECK (deliverables BETWEEN 1 AND 5),
      deliverables_suggestion TEXT,

      professionalism INT NOT NULL CHECK (professionalism BETWEEN 1 AND 5),
      professionalism_suggestion TEXT,

      global_comment TEXT,

      CONSTRAINT uniq_client_project UNIQUE (client_name, project)
    );
  `;
}

// --- health check (optionnel) ---
app.get("/api/health", async (_req, res) => {
  try {
    const r = await sql`SELECT version() AS version;`;
    res.json({ ok: true, version: r[0].version });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --- Create feedback ---
app.post("/api/feedback", async (req, res) => {
  try {
    const body = req.body;

    const required = ["email", "client_name", "project", "reactivity", "deadlines", "deliverables", "professionalism"];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || body[k] === "") {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }

    await sql`
      INSERT INTO feedback (
        email, client_name, project,
        reactivity, reactivity_suggestion,
        deadlines, deadlines_suggestion,
        deliverables, deliverables_suggestion,
        professionalism, professionalism_suggestion,
        global_comment
      ) VALUES (
        ${String(body.email).trim()},
        ${String(body.client_name).trim()},
        ${String(body.project).trim()},
        ${Number(body.reactivity)},
        ${body.reactivity_suggestion || null},
        ${Number(body.deadlines)},
        ${body.deadlines_suggestion || null},
        ${Number(body.deliverables)},
        ${body.deliverables_suggestion || null},
        ${Number(body.professionalism)},
        ${body.professionalism_suggestion || null},
        ${body.global_comment || null}
      );
    `;

    return res.json({ ok: true, message: "Feedback enregistré." });
  } catch (e) {
    const msg = String(e?.message || e);

    // violation contrainte unique (Postgres)
    if (msg.includes("uniq_client_project") || msg.toLowerCase().includes("duplicate key")) {
      return res.status(409).json({
        error: "Ce client a déjà noté ce projet. Merci de choisir un autre projet.",
      });
    }

    return res.status(500).json({ error: "Erreur serveur.", details: msg });
  }
});

// --- Monthly stats + action plan ---
app.get("/api/stats", async (req, res) => {
  try {
    const month = req.query.month; // "YYYY-MM"
    if (!month) return res.status(400).json({ error: "month is required, e.g. 2026-01" });

    const start = `${month}-01`;

    const rows = await sql`
      SELECT
        project,
        COUNT(*)::int AS responses,
        AVG(reactivity)::float AS avg_reactivity,
        AVG(deadlines)::float AS avg_deadlines,
        AVG(deliverables)::float AS avg_deliverables,
        AVG(professionalism)::float AS avg_professionalism,
        AVG((reactivity+deadlines+deliverables+professionalism)/4.0)::float AS avg_total
      FROM feedback
      WHERE created_at >= (${start}::date)
        AND created_at <  ((${start}::date) + INTERVAL '1 month')
      GROUP BY project
      ORDER BY avg_total ASC;
    `;

    const threshold = 4;
    const action_plan = rows
      .map((r) => {
        const a = [];
        if (r.avg_reactivity < threshold) a.push("Réactivité: définir SLA (ex: réponse < 24h), point hebdo, canal unique.");
        if (r.avg_deadlines < threshold) a.push("Délais: jalons, buffer, suivi régulier, gestion risques.");
        if (r.avg_deliverables < threshold) a.push("Livrables: checklist qualité, revue interne, templates.");
        if (r.avg_professionalism < threshold) a.push("Pro/Innovation: REX mensuel, formation, partage bonnes pratiques.");
        return a.length ? { project: r.project, recommendations: a } : null;
      })
      .filter(Boolean);

    return res.json({ month, start, projects: rows, action_plan });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur.", details: String(e?.message || e) });
  }
});

// --- Start server ---
// (async () => {
//   await initDb();

//   const PORT = process.env.PORT || 3000;
//   app.listen(PORT, () => {
//     console.log(`Web + API: http://localhost:${PORT}`);
//   });
// })();

(async () => {
  await initDb();

  const PORT = process.env.PORT || 10000; // 10000 en local si tu veux coller à Render
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Web + API listening on port ${PORT}`);
  });
})();


