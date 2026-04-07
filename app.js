const promptInput = document.getElementById("promptInput");
const optimizeBtn = document.getElementById("optimizeBtn");
const compareBtn = document.getElementById("compareBtn");
const statusText = document.getElementById("statusText");

const optimizeSection = document.getElementById("optimizeSection");
const intentText = document.getElementById("intentText");
const clarityText = document.getElementById("clarityText");
const shortPromptText = document.getElementById("shortPromptText");
const optimizedPromptText = document.getElementById("optimizedPromptText");
const optMeta = document.getElementById("optMeta");

const compareSection = document.getElementById("compareSection");
const winnerBox = document.getElementById("winnerBox");
const rankingBody = document.getElementById("rankingBody");

function setLoading(loading, msg = "Procesando...") {
  optimizeBtn.disabled = loading;
  compareBtn.disabled = loading;
  statusText.textContent = loading ? msg : "Listo.";
}

function safeScore(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "0.00";
  return n.toFixed(2);
}

async function postJson(url, payload) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

optimizeBtn.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return alert("Escribe un prompt primero.");

  try {
    setLoading(true, "Optimizando prompt...");
    const data = await postJson("/optimize", { prompt });

    optimizeSection.classList.remove("hidden");
    intentText.textContent = data.intent || "-";
    clarityText.textContent = safeScore(Number(data.clarity_score));
    shortPromptText.textContent = data.short_prompt || "-";
    optimizedPromptText.textContent = data.optimized_prompt || "-";
    optMeta.textContent = `Model: ${data.model_used || "-"} · Request ID: ${data.request_id || "-"}`;
  } catch (e) {
    alert(`Error optimize: ${e.message}`);
  } finally {
    setLoading(false);
  }
});

compareBtn.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return alert("Escribe un prompt primero.");

  try {
    setLoading(true, "Comparando modelos...");
    const data = await postJson("/compare", { prompt });

    compareSection.classList.remove("hidden");

    const w = data.winner || {};
    winnerBox.innerHTML = `
      <strong>Winner:</strong> ${w.model || "-"}<br/>
      <strong>Score:</strong> ${w.benchmark_score ?? 0} ·
      <strong>Latencia:</strong> ${w.latency_ms ?? 0} ms ·
      <strong>Clarity:</strong> ${safeScore(Number(w.clarity_score ?? 0))}
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
    alert(`Error compare: ${e.message}`);
  } finally {
    setLoading(false);
  }
});
