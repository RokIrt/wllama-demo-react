# wllama demo — React

A demo chat app running LLMs **fully in the browser** with
[wllama](https://github.com/ngxson/wllama) (WebAssembly bindings for llama.cpp).
No server, no API key — models are downloaded once from Hugging Face into
browser storage (OPFS) and inference runs locally via WASM, with WebGPU
acceleration when the browser supports it.

## Features

- **Model picker** — current-generation small models (Qwen3.5 0.8B–4B,
  LFM2.5 1.2B–2.6B, Gemma 4 E2B), with download progress, cache status, and
  cache deletion
- **Streaming chat** — token-by-token output, multi-turn history, stop button,
  collapsible `<think>` reasoning blocks for reasoning models
- **Live stats** — generation speed (tok/s), prompt/prefill speed, tokens
  generated, time to first token, context usage, page memory (via
  `performance.measureUserAgentSpecificMemory`), thread count, WebGPU support
- **Inference settings** — temperature, max response tokens, context size,
  WebGPU toggle

## Run it

```bash
npm install
npm run dev
```

Other scripts: `npm run build` (type-check + production build),
`npm run preview` (serve the build), `npm run lint`.

## Notes

- Multi-threaded WASM needs cross-origin isolation. `vite.config.ts` sets
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` for both dev and preview
  servers — if you deploy, your host must send the same headers.
- Model files are 0.7–2 GB; the first load downloads the file(s), later
  loads read them from the OPFS cache (works offline). wllama's limits shape
  the catalog: single files must be under 2 GB (ArrayBuffer cap; gguf-split
  shards under 2 GB each also work) and the 32-bit WASM runtime caps total
  memory at 4 GB. Gemma 4 E2B ships as a custom 3-shard split
  ([888rok/gemma-4-E2B-it-wllama-split](https://huggingface.co/888rok/gemma-4-E2B-it-wllama-split))
  because no publisher offers a file under 2 GB. Still excluded: Gemma 4 E4B
  and up (over the limits even at IQ2), LFM2.5-8B-A1B (no quant under 2 GB per
  file), and gpt-oss-20b / 9B+ dense / large MoE models (over the 4 GB heap) —
  no matter how much system RAM is available.
- Best experienced in a Chromium-based browser (WebGPU + memory measurement);
  Firefox and Safari fall back to CPU/WASM.
