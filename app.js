const input = document.getElementById("promptInput");
const button = document.getElementById("analyzeBtn");
const result = document.getElementById("result");

button.addEventListener("click", () => {
  const text = input.value.trim();

  if (!text) {
    result.textContent = "Prompt is empty.";
    return;
  }

  const words = text.split(/\s+/).length;

  if (words < 15) {
    result.textContent = "Add more detail. Prompt is too short.";
  } else {
    result.textContent = "Good length. Prompt looks clear.";
  }
});