function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function clamp01(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function buildPrompt(userPrompt, retry = false) {
  const strict = retry
    ? `IMPORTANTE: tu respuesta anterior no fue JSON válido.
Devuelve SOLO JSON válido, sin texto extra, sin markdown, sin \`\`\`.
`
    : "";

  return `${strict}Optimiza el texto del usuario para convertirlo en un prompt profesional.
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

function tryParseJsonBlock(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // Intento 1: parse directo
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Intento 2: primer bloque {...}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const block = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(block);
    } catch {}
  }

  return null;
}

function normalizeStructured(obj) {
  if (!obj || typeof obj !== "object") return null;

  const intent = typeof obj.intent === "string" ? obj.intent.trim() : "";
  const optimized_prompt =
    typeof obj.optimized_prompt === "string" ? obj.optimized_prompt.trim() : "";
  const short_prompt =
    typeof obj.short_prompt === "string" ? obj.short_prompt.trim() : "";

  let clarity_score = Number(obj.clarity_score);
  if (Number.isNaN(clarity_score)) return null;
  clarity_score = clamp01(clarity_score);

  if (!intent || !optimized_prompt || !short_prompt) return null;

  return { intent, clarity_score, optimized_prompt, short_prompt };
}

function calcBenchmark(ok, clarity, latencyMs) {
  if (!ok) return 0;
  const quality = Math.round(clamp01(clarity) * 100); // 0..100
  const latencyBonus = latencyMs <= 2500 ? 10 : latencyMs <= 5000 ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(quality * 0.9 + latencyBonus)));
}

async function callModelOnce({ model, prompt, apiUrl, apiKey, retry }) {
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildPrompt(prompt, retry) }],
      temperature: 0,
      max_tokens: 260
    })
  });

  const status = resp.status;
  const raw = await resp.text();

  if (!resp.ok) {
    return { ok: false, status, parsed: null, error: `Upstream HTTP ${status}` };
  }

  let parsedOuter;
  try {
    parsedOuter = JSON.parse(raw);
  } catch {
    return { ok: false, status, parsed: null, error: "Invalid upstream JSON" };
  }

  const modelText = extractText(parsedOuter);
  const parsed = normalizeStructured(tryParseJsonBlock(modelText));

  if (!parsed) {
    return { ok: false, status, parsed: null, error: "Invalid structured output" };
  }

  return { ok: true, status, parsed, error: null };
}

async function evaluateModel({ model, prompt, apiUrl, apiKey }) {
  const started = Date.now();

  // intento 1
  let r1;
  try {
    r1 = await callModelOnce({ model, prompt, apiUrl, apiKey, retry: false });
  } catch (e) {
    const latency_ms = Date.now() - started;
    return {
      model, ok: false, benchmark_score: 0, latency_ms,
      status: 0, clarity_score: 0, intent: null, short_prompt: null, optimized_prompt: null,
      error: e.message || "Request failed"
    };
  }

  // si falla formato, reintento 1 vez con instrucción más estricta
  let final = r1;
  if (!r1.ok && r1.error === "Invalid structured output") {
    try {
      const r2 = await callModelOnce({ model, prompt, apiUrl, apiKey, retry: true });
      if (r2.ok) final = r2;
      else final = r2;
    } catch (e) {
      final = { ok: false, status: r1.status || 0, parsed: null, error: e.message || r1.error };
    }
  }

  const latency_ms = Date.now() - started;
  const clarity_score = final.ok ? final.parsed.clarity_score : 0;
  const benchmark_score = calcBenchmark(final.ok, clarity_score, latency_ms);

  return {
    model,
    ok: final.ok,
    benchmark_score,
    latency_ms,
    status: final.status || 0,
    clarity_score,
    intent: final.ok ? final.parsed.intent : null,
    short_prompt: final.ok ? final.parsed.short_prompt : null,
    optimized_prompt: final.ok ? final.parsed.optimized_prompt : null,
    error: final.error
  };
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

    const apiKey = process.env.JUNE_API_KEY;
    const apiUrl = process.env.JUNE_API_URL;

    if (!apiKey) return res.status(500).json({ error: "JUNE_API_KEY missing" });
    if (!apiUrl) return res.status(500).json({ error: "JUNE_API_URL missing" });

    const envModels = (process.env.JUNE_MODELS || "deepseek/deepseek-v3.2")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const reqModels = Array.isArray(body.models)
      ? body.models.map((m) => String(m).trim()).filter(Boolean)
      : [];

    const models = (reqModels.length ? reqModels : envModels).slice(0, 4);

    const ranking = await Promise.all(
      models.map((model) => evaluateModel({ model, prompt, apiUrl, apiKey }))
    );

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

