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
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function isValidOutput(x) {
  if (!x || typeof x !== "object") return false;
  if (typeof x.intent !== "string" || !x.intent.trim()) return false;
  if (typeof x.optimized_prompt !== "string" || !x.optimized_prompt.trim()) return false;
  if (typeof x.short_prompt !== "string" || !x.short_prompt.trim()) return false;
  if (typeof x.clarity_score !== "number") return false;
  if (x.clarity_score < 0 || x.clarity_score > 1) return false;
  return true;
}

function setCors(req, res) {
  const extra = (process.env.FRONTEND_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowed = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "https://erickmaita.github.io",
    ...extra
  ];

  const origin = req.headers.origin || "";
  if (!origin || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const prompt = body.prompt;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3 || prompt.trim().length > 1000) {
      return res.status(400).json({ error: "Invalid prompt (3-1000 chars required)" });
    }

    if (!process.env.JUNE_API_KEY) {
      return res.status(500).json({ error: "JUNE_API_KEY is missing" });
    }
    if (!process.env.JUNE_API_URL) {
      return res.status(500).json({ error: "JUNE_API_URL is missing" });
    }

    const models = (process.env.JUNE_MODELS || "deepseek/deepseek-v3.2")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    const errors = [];

    for (const model of models) {
      const payload = {
        model,
        messages: [{ role: "user", content: buildOptimizerPrompt(prompt.trim()) }],
        temperature: 0,
        max_tokens: 260
      };

      let r, raw, requestId;
      try {
        r = await fetch(process.env.JUNE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.JUNE_API_KEY}`
          },
          body: JSON.stringify(payload)
        });
        raw = await r.text();
        requestId = r.headers.get("x-request-id");
      } catch (e) {
        errors.push({ model, error: "Network error", message: e.message });
        continue;
      }

      if (!r.ok) {
        errors.push({ model, status: r.status, request_id: requestId, raw });
        continue;
      }

      let outer;
      try {
        outer = JSON.parse(raw);
      } catch {
        errors.push({ model, status: r.status, request_id: requestId, error: "Invalid outer JSON", raw });
        continue;
      }

      const finishReason = outer?.choices?.[0]?.finish_reason || null;
      const modelText = extractModelText(outer);
      if (finishReason === "length" || !modelText) {
        errors.push({
          model,
          status: r.status,
          request_id: requestId,
          error: "Output truncated or empty",
          finish_reason: finishReason
        });
        continue;
      }

      const cleanData = extractJsonFromText(modelText);
      if (!isValidOutput(cleanData)) {
        errors.push({
          model,
          status: r.status,
          request_id: requestId,
          error: "Schema validation failed",
          raw: cleanData || modelText
        });
        continue;
      }

      return res.status(200).json({
        model_used: model,
        request_id: requestId || null,
        ...cleanData
      });
    }

    return res.status(502).json({
      error: "All models failed",
      tried_models: models,
      details: errors
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};
