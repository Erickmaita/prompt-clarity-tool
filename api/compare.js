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
  return (
    data?.choices?.[0]?.message?.content ??
    data?.output_text ??
    data?.output ??
    ""
  );
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

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    if (!process.env.JUNE_API_KEY) return res.status(500).json({ error: "JUNE_API_KEY missing" });
    if (!process.env.JUNE_API_URL) return res.status(500).json({ error: "JUNE_API_URL missing" });

    const envModels = (process.env.JUNE_MODELS || "deepseek/deepseek-v3.2")
      .split(",").map(s => s.trim()).filter(Boolean);

    const reqModels = Array.isArray(body.models)
      ? body.models.map(m => String(m).trim()).filter(Boolean)
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
            "Authorization": `Bearer ${process.env.JUNE_API_KEY}`
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

        if (r.ok) {
          const outer = JSON.parse(raw);
          parsed = extractJson(extractText(outer));
          ok = !!(parsed && typeof parsed.clarity_score === "number");
          if (!ok) error = "Invalid structured output";
        } else {
          error = `Upstream HTTP ${r.status}`;
        }
      } catch (e) {
        error = e.message;
      }

      const latency_ms = Date.now() - started;
      const clarity = ok ? Number(parsed.clarity_score) : 0;
      const benchmark_score = ok ? Math.min(100, Math.round(clarity * 90 + (latency_ms <= 2500 ? 10 : 0))) : 0;

      ranking.push({
        model,
        ok,
        benchmark_score,
        latency_ms,
        status,
        clarity_score: clarity,
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
