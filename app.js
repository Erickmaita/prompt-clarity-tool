const promptInput = document.getElementById("promptInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const scoreCard = document.getElementById("scoreCard");
const feedbackList = document.getElementById("feedbackList");
const improvedOutput = document.getElementById("improvedOutput");

const MIN_WORDS = 18;

// En local usa tu backend express. En producción (Vercel) usa misma URL del sitio.
const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "";

function safeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function setLoading(isLoading) {
  analyzeBtn.disabled = isLoading;
  analyzeBtn.textContent = isLoading ? "Analyzing..." : "Analyze";
}

function clearUI() {
  scoreCard.className = "hidden";
  scoreCard.textContent = "";
  feedbackList.innerHTML = "";
  improvedOutput.value = "";
}

function localAnalyzePrompt(promptText) {
  const trimmed = promptText.trim();

  if (!trimmed) {
    return {
      score: 0,
      feedback: ["Prompt is empty. Add your request so it can be analyzed."],
    };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const sentenceCount = trimmed.split(/[.!?]+/).filter(Boolean).length;

  const hasConstraints = /(must|avoid|only|without|required|format|limit|exactly|tone|length)/i.test(trimmed);
  const hasFormat = /(json|table|bullets?|markdown|list|steps?|structure)/i.test(trimmed);
  const hasAudience = /(for|audience|role|client|stakeholder|customer|buyer|team)/i.test(trimmed);

  let score = 40;
  const feedback = [];

  if (words.length >= MIN_WORDS) score += 15;
  else feedback.push(`Add more detail. Aim for at least ${MIN_WORDS} words.`);

  if (sentenceCount >= 2) score += 10;
  else feedback.push("Split into at least two sentences.");

  if (hasConstraints) score += 10;
  else feedback.push("Add constraints like tone, limits, or requirements.");

  if (hasFormat) score += 10;
  else feedback.push("Specify output format.");

  if (hasAudience) score += 10;
  else feedback.push("Clarify who this is for.");

  score = Math.max(0, Math.min(100, score));

  if (!feedback.length) feedback.push("Well structured prompt.");

  return { score, feedback };
}

function localImprovedVersion(original) {
  const trimmed = original.trim();
  if (!trimmed) return "";

  return `Objective:
${trimmed}

Context:
Specify who this is for and why it matters.

Constraints:
- Define tone
- Set length limits
- Specify what to avoid

Output Format:
Clearly define structure (e.g., bullet list, JSON, table).`;
}

function renderAnalysis(result) {
  scoreCard.classList.remove("hidden", "score-good", "score-mid", "score-low");

  let label = "Needs Work";
  let styleClass = "score-low";

  if (result.score >= 75) {
    label = "Strong";
    styleClass = "score-good";
  } else if (result.score >= 50) {
    label = "Fair";
    styleClass = "score-mid";
  }

  scoreCard.classList.add(styleClass);
  scoreCard.textContent = `Clarity Score: ${result.score}/100 (${label})`;

  feedbackList.innerHTML = "";
  result.feedback.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    feedbackList.appendChild(li);
  });
}

async function optimizeWithAPI(promptText) {
  const res = await fetch(`${API_BASE}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: promptText }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = safeText(data.error, `HTTP ${res.status}`);
    throw new Error(msg);
  }

  // Esperado del backend:
  // { intent, clarity_score, optimized_prompt, short_prompt, ... }
  const clarity = Number(data.clarity_score);
  const score = Number.isFinite(clarity) ? Math.round(clarity * 100) : 0;

  return {
    score: Math.max(0, Math.min(100, score)),
    feedback: [
      `Intent: ${safeText(data.intent, "N/A")}`,
      `Short prompt: ${safeText(data.short_prompt, "N/A")}`,
      `Model: ${safeText(data.model_used, "N/A")}`,
    ],
    improved: safeText(data.optimized_prompt, ""),
  };
}

analyzeBtn.addEventListener("click", async () => {
  const original = promptInput.value;

  if (!original.trim()) {
    clearUI();
    renderAnalysis({
      score: 0,
      feedback: ["Prompt is empty. Please write something first."],
    });
    return;
  }

  setLoading(true);

  try {
    // 1) intenta backend
    const apiResult = await optimizeWithAPI(original);
    renderAnalysis({ score: apiResult.score, feedback: apiResult.feedback });
    improvedOutput.value = apiResult.improved || localImprovedVersion(original);
  } catch (err) {
    // 2) fallback local si falla API
    const localResult = localAnalyzePrompt(original);
    localResult.feedback.unshift(`API unavailable, using local analysis (${err.message}).`);
    renderAnalysis(localResult);
    improvedOutput.value = localImprovedVersion(original);
  } finally {
    setLoading(false);
  }
});
