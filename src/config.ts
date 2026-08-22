import wllamaWasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url'
import type { AssetsPathConfig } from '@wllama/wllama/esm/index.js'

export const WLLAMA_CONFIG_PATHS: AssetsPathConfig = {
  default: wllamaWasmUrl,
}

export interface ModelDef {
  /** Display name */
  name: string
  /** Parameter count, e.g. "1.7B" */
  params: string
  /** Quantization, e.g. "Q4_K_M" */
  quant: string
  /** Download size in bytes */
  size: number
  /** Direct URL to the GGUF file (first shard for split models) */
  url: string
  /** Number of files for split GGUFs (wllama auto-resolves the rest) */
  shards?: number
  /** Short hint shown in the model card */
  note?: string
}

// Modern/SOTA models only, constrained by what wllama can physically run:
// single files must be < 2 GB (ArrayBuffer limit; splits with < 2 GB shards
// also work). Larger models are included via custom splits under the 888rok
// HF account since publishers don't ship wllama-compatible files.
export const MODELS: ModelDef[] = [
  {
    name: 'Qwen3.5 0.8B',
    params: '0.8B',
    quant: 'Q8_0',
    size: 811_843_840,
    url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q8_0.gguf',
    note: 'Tiny, latest Qwen — good first pick',
  },
  {
    name: 'LFM2.5 1.2B Instruct',
    params: '1.2B',
    quant: 'Q4_K_M',
    size: 730_895_168,
    url: 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q4_K_M.gguf',
    note: 'LiquidAI — extremely efficient on-device',
  },
  {
    name: 'Qwen3.5 2B',
    params: '2B',
    quant: 'Q4_K_M',
    size: 1_396_198_496,
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF/resolve/main/Qwen_Qwen3.5-2B-Q4_K_M.gguf',
    note: 'Quality/speed sweet spot',
  },
  {
    name: 'LFM2.5 2.6B',
    params: '2.6B',
    quant: 'Q4_K_M',
    size: 1_674_455_040,
    url: 'https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/LFM2.5-2.6B-Q4_K_M.gguf',
    note: 'Largest current Liquid dense model',
  },
  {
    name: 'Qwen3.5 4B',
    params: '4B',
    quant: 'Q2_K_XL',
    size: 1_940_825_248,
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-UD-Q2_K_XL.gguf',
    note: 'Primary small model — Q2 quant is the only one under the 2 GB file limit',
  },
  {
    name: 'Gemma 4 E2B IT',
    params: 'E2B',
    quant: 'IQ2_M',
    size: 2_290_860_448,
    url: 'https://huggingface.co/888rok/gemma-4-E2B-it-wllama-split/resolve/main/gemma-4-E2B-it-UD-IQ2_M-00001-of-00003.gguf',
    shards: 3,
    note: 'Latest Google edge model — needs ~6 GB free RAM',
  },
  {
    name: 'Qwen3.5 4B (Q4 split)',
    params: '4B',
    quant: 'Q4_K_M',
    size: 2_740_938_080,
    url: 'https://huggingface.co/888rok/Qwen3.5-4B-Q4_K_M-wllama-split/resolve/main/Qwen3.5-4B-Q4_K_M-00001-of-00002.gguf',
    shards: 2,
    note: 'Full-quality Q4 via split — needs ~6 GB free RAM',
  },
  {
    name: 'Gemma 4 E4B IT',
    params: 'E4B',
    quant: 'Q4_K_M',
    size: 4_977_172_000,
    url: 'https://huggingface.co/888rok/gemma-4-E4B-it-Q4_K_M-wllama-split/resolve/main/gemma-4-E4B-it-Q4_K_M-00001-of-00004.gguf',
    shards: 4,
    note: 'Google edge model, larger variant — needs ~10 GB free RAM',
  },
  {
    name: 'LFM2.5 8B A1B',
    params: '8B-A1B',
    quant: 'Q4_K_M',
    size: 5_155_565_120,
    url: 'https://huggingface.co/888rok/LFM2.5-8B-A1B-Q4_K_M-wllama-split/resolve/main/LFM2.5-8B-A1B-Q4_K_M-00001-of-00003.gguf',
    shards: 3,
    note: 'LiquidAI MoE — fast (1B active), needs ~10 GB free RAM',
  },
  {
    name: 'Gemma 4 12B IT',
    params: '12B',
    quant: 'Q4_K_M',
    size: 7_121_861_856,
    url: 'https://huggingface.co/888rok/gemma-4-12b-it-Q4_K_M-wllama-split/resolve/main/gemma-4-12b-it-Q4_K_M-00001-of-00004.gguf',
    shards: 4,
    note: 'Large dense model — needs ~12 GB free RAM',
  },
  {
    name: 'Gemma 4 26B A4B IT',
    params: '26B-A4B',
    quant: 'Q4_K_M',
    size: 16_947_543_040,
    url: 'https://huggingface.co/888rok/gemma-4-26B-A4B-it-UD-Q4_K_M-wllama-split/resolve/main/gemma-4-26B-A4B-it-UD-Q4_K_M-00001-of-00011.gguf',
    shards: 11,
    note: 'Flagship MoE (4B active) — needs ~20 GB free RAM',
  },
  {
    name: 'Qwen3.5 35B A3B',
    params: '35B-A3B',
    quant: 'Q3_K_XL',
    size: 16_601_177_888,
    url: 'https://huggingface.co/888rok/Qwen3.5-35B-A3B-UD-Q3_K_XL-wllama-split/resolve/main/Qwen3.5-35B-A3B-UD-Q3_K_XL-00001-of-00010.gguf',
    shards: 10,
    note: 'Qwen flagship MoE (3B active) — needs ~20 GB free RAM',
  },
]

export interface InferenceSettings {
  temperature: number
  maxTokens: number
  nCtx: number
  useWebGPU: boolean
}

export const DEFAULT_SETTINGS: InferenceSettings = {
  temperature: 0.7,
  maxTokens: 1024,
  nCtx: 4096,
  useWebGPU: true,
}

export const CTX_OPTIONS = [1024, 2048, 4096, 8192]
export const MAX_TOKENS_OPTIONS = [256, 512, 1024, 2048, 4096]
