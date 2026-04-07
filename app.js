const promptInput = document.getElementById("promptInput");
const optimizeBtn = document.getElementById("optimizeBtn");
const compareBtn = document.getElementById("compareBtn");
const statusText = document.getElementById("statusText");

const modeSelect = document.getElementById("modeSelect");
const modeInfo = document.getElementById("modeInfo");
const modelsContainer = document.getElementById("modelsContainer");

const optimizeSection = document.getElementById("optimizeSection");
const intentText = document.getElementById("intentText");
const clarityText = document.getElementById("clarityText");
const shortPromptText = document.getElementById("shortPromptText");
const optimizedPromptText = document.getElementById("optimizedPromptText");
const optMeta = document.getElementById("optMeta");

const compareSection = document.getElementById("compareSection");
const winnerBox = document.getElementById("winnerBox");
const rankingBody = document.getElementById("rankingBody");

const QUICK_MODELS = [
  "blockchain/june",
  "xiaomi/mimo-v2-flash",
  "deepseek/deepseek-v3.2"
];

const FULL_MODELS = [
  "blockchain/june",
  "z-ai/glm-5",
  "deepseek/deepseek-v3.2",
  "moonshotai/kimi-k2.5",
  "minimax/minimax-m2.5",
  "qwen/qwen3.5-397b-a17b",
  "xiaomi/mimo-v2-flash",
  "openai/gpt-oss-120b",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.4",
  "openai/gpt-5-mini",
  "x-ai/grok-4.20",
  "x-ai/grok-4.1-fast",
  "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  "google/gemini-3.1-pro",
  "google/gemini-3-flash"
];

function setLoading(loading, msg = "Procesando...") {
  optimizeBtn.disabled = loading;
  compareBtn.disabled = loading;
  statusText.textContent = loading ? msg : "Lista.";
}

function safeScore(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}

  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderModelChecklist(selected = []) {
  modelsContainer.innerHTML = "";
  FULL_MODELS.forEach((model) => {
    const item = document.createElement("label");
    item.className = "model-item";
    item.innerHTML = `<input type="checkbox" value="${model}" ${selected.includes(model) ? "checked" : ""}> ${model}`;
    modelsContainer.appendChild(item);
  });
}

function applyMode(mode) {
  if (mode === "quick") {
    modeInfo.textContent = "Quick: benchmark rápido y estable.";
    renderModelChecklist(QUICK_MODELS);
  } else if (mode === "full") {
    modeInfo.textContent = "Full: benchmark amplio (más lento y algunos pueden fallar formato).";
    renderModelChecklist(FULL_MODELS);
  } else {
    modeInfo.textContent = "Custom: selecciona manualmente los modelos.";
    renderModelChecklist([]);
  }
}

function getSelectedModels() {
  return Array.from(modelsContainer.querySelectorAll("input[type='checkbox']:checked"))
    .map(i => i.value);
}

modeSelect.addEventListener("change", () => applyMode(modeSelect.value));
applyMode("quick");

optimizeBtn.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return alert("Escribe un prompt primero.");

  try {
    setLoading(true, "Optimizando...");
    const data = await postJson("/optimize", { prompt });

    optimizeSection.classList.remove("hidden");
    intentText.textContent = data.intent || "-";
    clarityText.textContent = safeScore(data.clarity_score);
    shortPromptText.textContent = data.short_prompt || "-";
    optimizedPromptText.textContent = data.optimized_prompt || "-";
    optMeta.textContent = `Modelo: ${data.model_used || "-"} · Request ID: ${data.request_id || "-"}`;
  } catch (e) {
    alert(`Error en optimize: ${e.message}`);
  } finally {
    setLoading(false);
  }
});

compareBtn.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return alert("Escribe un prompt primero.");

  const models = getSelectedModels();
  if (!models.length) return alert("Selecciona al menos 1 modelo.");

  try {
    setLoading(true, "Comparando modelos...");
    const data = await postJson("/compare", { prompt, models });

    compareSection.classList.remove("hidden");

    const w = data.winner || {};
    winnerBox.innerHTML = `
      <strong>Winner:</strong> ${w.model || "-"}<br>
      <strong>Score:</strong> ${w.benchmark_score ?? 0} ·
      <strong>Latencia:</strong> ${w.latency_ms ?? 0} ms ·
      <strong>Clarity:</strong> ${safeScore(w.clarity_score ?? 0)}
    `;

    rankingBody.innerHTML = "";
    (data.ranking || []).forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${row.model || "-"}</td>
        <td>${row.benchmark_score ?? 0}</td>
        <td>${row.latency_ms ?? 0}</td>
        <td>${row.ok ? '<span class="badge ok">OK</span>' : '<span class="badge err">ERROR</span>'}</td>
        <td>${row.error || "-"}</td>
      `;
      rankingBody.appendChild(tr);
    });
  } catch (e) {
    alert(`Error en compare: ${e.message}`);
  } finally {
    setLoading(false);
  }
});

