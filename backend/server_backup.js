require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { z } = require("zod");

const app = express();
app.use(cors());
app.use(express.json());

console.log(
  "🔑 JUNE_API_KEY →",
  process.env.JUNE_API_KEY ? process.env.JUNE_API_KEY.slice(0, 10) + "…" : "NO CARGADA"
);
console.log("🌐 JUNE_API_URL →", process.env.JUNE_API_URL || "NO CONFIGURADA");

// Valida el JSON final que queremos devolver
const schema = z.object({
  intent: z.string(),
  clarity_score: z.number(),
  issues: z.array(z.string()),
  optimized_prompt: z.string(),
  variations: z.array(z.string())
});

app.post("/optimize", async (req, res) => {
  try {
    const { prompt } = req.body;

    // 1) Validar input
    if (!prompt || typeof prompt !== "string" || prompt.length > 500) {
      return res.status(400).json({ error: "Invalid prompt" });
    }

    // 2) Validar env
    if (!process.env.JUNE_API_KEY) {
      return res.status(500).json({ error: "JUNE_API_KEY is missing in .env" });
    }
    if (!process.env.JUNE_API_URL) {
      return res.status(500).json({ error: "JUNE_API_URL is missing in .env" });
    }

    // 3) Payload para /chat/completions
    const payload = {
      model: "z-ai/glm-5",
      messages: [
        {
          role: "user",
          content: `Responde SOLO con JSON válido (sin markdown, sin texto extra) con esta forma exacta:
{
  "intent": "string",
  "clarity_score": number,
  "issues": ["string"],
  "optimized_prompt": "string",
  "variations": ["string","string","string"]
}

Prompt original:
${prompt}`
        }
      ]
    };

    // 4) Llamada API
    const response = await fetch(process.env.JUNE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.JUNE_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const raw = await response.text();
    const headersObj = Object.fromEntries(response.headers.entries());

    console.log("UPSTREAM STATUS:", response.status);
    console.log("X-REQUEST-ID:", headersObj["x-request-id"]);
    console.log("RAW TEXT:", raw);

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Upstream API error",
        raw,
        headers: headersObj
      });
    }

    // 5) Parse JSON externo
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: "Invalid JSON from API", raw });
    }

    // 6) Extraer contenido del modelo (chat/completions)
    let modelText =
      data?.choices?.[0]?.message?.content ??
      data?.output_text ??
      data?.output ??
      data?.message?.content ??
      data;

    if (typeof modelText !== "string") {
      modelText = JSON.stringify(modelText);
    }

    // 7) Extraer objeto JSON del texto
    const match = modelText.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(500).json({
        error: "No JSON object found in model output",
        raw: modelText
      });
    }

    let cleanData;
    try {
      cleanData = JSON.parse(match[0]);
    } catch {
      return res.status(500).json({
        error: "Extracted JSON is invalid",
        raw: match[0]
      });
    }

    // 8) Validar schema
    const parsed = schema.safeParse(cleanData);
    if (!parsed.success) {
      return res.status(500).json({
        error: "Invalid AI response schema",
        issues: parsed.error.issues,
        raw: cleanData
      });
    }

    return res.json(parsed.data);
  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});




