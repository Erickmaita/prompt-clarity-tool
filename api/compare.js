function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function buildPrompt(userPrompt) {
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
- no agregues texto fuera del JSON

Texto del usuario:
${userPrompt}`;
}

function extractText(data) {
  return data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.output ?? "";
}

function extractJson(text) {
  const cleaned = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function isValidStructured(x) {
  if (!x || typeof x !== "object") return false;
  if (typeof x.intent !== "string" || !x.intent.trim()) return false;
  if (typeof x.optimized_prompt !== "string" || !x.optimized_prompt.trim()) return false;
  if (typeof x.short_prompt !== "string" || !x.short_prompt.trim()) return false;
  if (typeof x.clarity_score !== "number") return false;
  if (x.clarity_score < 0 || x.clarity_score > 1) return false;
  return true;
}

function calcBenchmark(valid, clarity, latencyMs) {
  if (!valid) return 0;
  const quality = Math.round(clarity * 100); // 0..100
  const latencyBonus = latencyMs <= 2500 ? 10 : latencyMs <= 5000 ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(quality * 0.9 + latencyBonus)));
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const prompt = String(body.prompt || "").trim();

    if (!prompt || prompt.length < 3 || prompt.length > 1000) {
      return res.status(400).json({ error: "Invalid prompt (3-1000 chars required)" });
    }

    if (!process.env.JUNE_API_KEY) return res.status(500).json({ error: "JUNE_API_KEY missing" });
    if (!process.env.JUNE_API_URL) return res.status(500).json({ error: "JUNE_API_URL missing" });

    const envModels = (process.env.JUNE_MODELS || "deepseek/deepseek-v3.2")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const reqModels = Array.isArray(body.models)
      ? body.models.map((m) => String(m).trim()).filter(Boolean)
      : [];

    const models = (reqModels.length ? reqModels : envModels).slice(0, 4);

    const ranking = [];

    for (const model of models) {
      const started = Date.now();
      let ok = false;
      let status = 0;
      let parsed = null;
      let error = null;

      try {
        const r = await fetch(process.env.JUNE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.JUNE_API_KEY}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: buildPrompt(prompt) }],
            temperature: 0,
            max_tokens: 260
          })
        });

        status = r.status;
        const raw = await r.text();

        if (!r.ok) {
          error = `Upstream HTTP ${r.status}`;
        } else {
          const outer = JSON.parse(raw);
          const maybeJson = extractJson(extractText(outer));
          if (isValidStructured(maybeJson)) {
            ok = true;
            parsed = maybeJson;
          } else {
            error = "Invalid structured output";
          }
        }
      } catch (e) {
        error = e.message || "Unknown error";
      }

      const latency_ms = Date.now() - started;
      const clarity_score = ok ? parsed.clarity_score : 0;
      const benchmark_score = calcBenchmark(ok, clarity_score, latency_ms);

      ranking.push({
        model,
        ok,
        benchmark_score,
        latency_ms,
        status,
        clarity_score,
        intent: ok ? parsed.intent : null,
        short_prompt: ok ? parsed.short_prompt : null,
        optimized_prompt: ok ? parsed.optimized_prompt : null,
        error
      });
    }

    ranking.sort((a, b) => b.benchmark_score - a.benchmark_score || a.latency_ms - b.latency_ms);

    return res.status(200).json({
      ok: true,
      prompt,
      compared_models: models,
      winner: ranking[0] || null,
      ranking
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

