require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { z } = require("zod");

const app = express();

/**
 * CORS profesional:
 * - Permite localhost (desarrollo)
 * - Permite tu GitHub Pages
 * - Permite dominios extra desde FRONTEND_ORIGINS (coma separada)
 */
const envOrigins = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://erickmaita.github.io",
  ...envOrigins
];

app.use(
  cors({
    origin(origin, callback) {
      // Permite herramientas sin origin (curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  })
);

app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3001;

console.log(
  "🔑 JUNE_API_KEY →",
  process.env.JUNE_API_KEY ? process.env.JUNE_API_KEY.slice(0, 10) + "…" : "NO CARGADA"
);
console.log("🌐 JUNE_API_URL →", process.env.JUNE_API_URL || "NO CONFIGURADA");

// Schema modo ahorro
const schema = z.object({
  intent: z.string().min(1),
  clarity_score: z.number().min(0).max(1),
  optimized_prompt: z.string().min(1),
  short_prompt: z.string().min(1)
});

// Recomendado en .env:
// JUNE_MODELS=deepseek/deepseek-v3.2
const MODEL_CANDIDATES = (process.env.JUNE_MODELS || "deepseek/deepseek-v3.2")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

function extractModelText(data) {
  return (
    data?.choices?.[0]?.message?.content ??
    data?.output_text ??
    data?.output ??
    data?.message?.content ??
    null
  );
}

function extractJsonFromText(text) {
  if (typeof text !== "string") return null;

  // Limpia bloques markdown si vinieran
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function buildOptimizerPrompt(userPrompt) {
  return `Optimiza el texto del usuario para convertirlo en un prompt profesional.
Responde SOLO JSON válido (sin markdown) con esta forma exacta:
{
  "intent": "string",
  "clarity_score": number,
  "optimized_prompt": "string",
  "short_prompt": "string"
}

Reglas:
- clarity_score entre 0 y 1
- optimized_prompt máximo 70 palabras
- short_prompt máximo 25 palabras
- mantén la intención original
- si falta contexto usa placeholders [entre corchetes]
- no agregues texto fuera del JSON

Texto del usuario:
${userPrompt}`;
}

app.get("/", (req, res) => {
  res.json({ ok: true, service: "prompt-clarity-tool", status: "running" });
});

app.get("/health", (req, res) => {
  return res.json({
    ok: true,
    service: "prompt-clarity-tool",
    models: MODEL_CANDIDATES
  });
});

app.post("/optimize", async (req, res) => {
  try {
    const { prompt } = req.body || {};

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3 || prompt.trim().length > 1000) {
      return res.status(400).json({ error: "Invalid prompt (3-1000 chars required)" });
    }

    if (!process.env.JUNE_API_KEY) {
      return res.status(500).json({ error: "JUNE_API_KEY is missing in .env" });
    }

    if (!process.env.JUNE_API_URL) {
      return res.status(500).json({ error: "JUNE_API_URL is missing in .env" });
    }

    const errors = [];
    const inputPrompt = prompt.trim();

    for (const model of MODEL_CANDIDATES) {
      const payload = {
        model,
        messages: [{ role: "user", content: buildOptimizerPrompt(inputPrompt) }],
        temperature: 0,
        max_tokens: 260
      };

      let response;
      let raw = "";
      let requestId = null;

      try {
        response = await fetch(process.env.JUNE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.JUNE_API_KEY}`
          },
          body: JSON.stringify(payload)
        });

        raw = await response.text();
        const headersObj = Object.fromEntries(response.headers.entries());
        requestId = headersObj["x-request-id"] || null;
      } catch (networkErr) {
        errors.push({
          model,
          error: "Network error calling upstream API",
          message: networkErr.message
        });
        continue;
      }

      console.log(`UPSTREAM STATUS [${model}] ->`, response.status, "| request_id:", requestId);

      if (!response.ok) {
        errors.push({ model, status: response.status, request_id: requestId, raw });
        continue;
      }

      let outer;
      try {
        outer = JSON.parse(raw);
      } catch {
        errors.push({
          model,
          status: response.status,
          request_id: requestId,
          error: "Invalid outer JSON",
          raw
        });
        continue;
      }

      const finishReason = outer?.choices?.[0]?.finish_reason || null;
      const modelText = extractModelText(outer);

      if (finishReason === "length" || !modelText) {
        errors.push({
          model,
          status: response.status,
          request_id: requestId,
          error: "Output truncated or empty (increase max_tokens or simplify prompt)",
          finish_reason: finishReason
        });
        continue;
      }

      const cleanData = extractJsonFromText(modelText);

      if (!cleanData) {
        errors.push({
          model,
          status: response.status,
          request_id: requestId,
          error: "No valid JSON found in model output",
          raw: typeof modelText === "string" ? modelText.slice(0, 1000) : modelText
        });
        continue;
      }

      const parsed = schema.safeParse(cleanData);
      if (!parsed.success) {
        errors.push({
          model,
          status: response.status,
          request_id: requestId,
          error: "Schema validation failed",
          issues: parsed.error.issues,
          raw: cleanData
        });
        continue;
      }

      return res.json({
        model_used: model,
        request_id: requestId,
        ...parsed.data
      });
    }

    return res.status(502).json({
      error: "All models failed",
      tried_models: MODEL_CANDIDATES,
      details: errors
    });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});






