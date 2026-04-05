const promptInput = document.getElementById('promptInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const scoreCard = document.getElementById('scoreCard');
const feedbackList = document.getElementById('feedbackList');
const improvedOutput = document.getElementById('improvedOutput');

const MIN_WORDS = 18;

function analyzePrompt(promptText) {
  const trimmed = promptText.trim();

  if (!trimmed) {
    return {
      score: 0,
      feedback: ['Prompt is empty. Add your request so it can be analyzed.'],
    };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const sentenceCount = trimmed.split(/[.!?]+/).filter(Boolean).length;

  const hasConstraints = /(must|avoid|only|without|required|format|limit|exactly)/i.test(trimmed);
  const hasFormat = /(json|table|bullets?|markdown|list|steps?)/i.test(trimmed);
  const hasAudience = /(for|audience|role|client|stakeholder)/i.test(trimmed);

  let score = 40;
  const feedback = [];

  if (words.length >= MIN_WORDS) score += 15;
  else feedback.push(`Add more detail. Aim for at least ${MIN_WORDS} words.`);

  if (sentenceCount >= 2) score += 10;
  else feedback.push('Split into at least two sentences.');

  if (hasConstraints) score += 10;
  else feedback.push('Add constraints like tone, limits, or requirements.');

  if (hasFormat) score += 10;
  else feedback.push('Specify output format.');

  if (hasAudience) score += 10;
  else feedback.push('Clarify who this is for.');

  score = Math.max(0, Math.min(100, score));

  if (!feedback.length) {
    feedback.push('Well structured prompt.');
  }

  return { score, feedback };
}

function generateImprovedVersion(original) {
  const trimmed = original.trim();
  if (!trimmed) return '';

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
  scoreCard.classList.remove('hidden', 'score-good', 'score-mid', 'score-low');

  let label = 'Needs Work';
  let styleClass = 'score-low';

  if (result.score >= 75) {
    label = 'Strong';
    styleClass = 'score-good';
  } else if (result.score >= 50) {
    label = 'Fair';
    styleClass = 'score-mid';
  }

  scoreCard.classList.add(styleClass);
  scoreCard.textContent = `Clarity Score: ${result.score}/100 (${label})`;

  feedbackList.innerHTML = '';
  result.feedback.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    feedbackList.appendChild(li);
  });
}

analyzeBtn.addEventListener('click', () => {
  const original = promptInput.value;
  const result = analyzePrompt(original);

  renderAnalysis(result);
  improvedOutput.value = generateImprovedVersion(original);
});