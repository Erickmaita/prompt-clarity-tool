# Prompt Clarity Tool (Community)

Community-built tool powered by June API for:
- Prompt optimization (`/optimize`)
- Model benchmarking and ranking (`/compare`)

## Why this matters

This project complements normal chat usage by adding team workflows:
- Multi-model comparison
- Benchmark scoring
- Latency tracking
- Structured QA output for prompts

## Live Demo

- Web: https://prompt-clarity-tool.vercel.app
- (Optional) GitHub Pages: https://erickmaita.github.io/prompt-clarity-tool/

## Endpoints

### 1) Health
**GET** `/health`

Example:
```bash
curl -i https://prompt-clarity-tool.vercel.app/health
