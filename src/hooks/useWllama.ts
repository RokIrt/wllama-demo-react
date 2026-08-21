import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LoggerWithoutDebug,
  ModelManager,
  Wllama,
  type LoadedContextInfo,
  type ResultTimings,
  type WllamaChatMessage,
} from '@wllama/wllama/esm/index.js'
import {
  DEFAULT_SETTINGS,
  WLLAMA_CONFIG_PATHS,
  type InferenceSettings,
  type ModelDef,
} from '../config'

export type AppStatus = 'idle' | 'loading' | 'ready' | 'generating'

export interface GenStats {
  promptTokens: number
  promptTps: number | null
  genTokens: number
  genTps: number | null
  cacheTokens: number
  ttftMs: number | null
  totalMs: number
}

export interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  content: string
  stats?: GenStats
  interrupted?: boolean
  error?: string
}

export interface RuntimeInfo {
  modelName: string
  multithread: boolean
  threads: number
  webgpuSupported: boolean
  ctx: LoadedContextInfo
}

export interface DownloadProgress {
  loaded: number
  total: number
}

// performance.measureUserAgentSpecificMemory needs cross-origin isolation,
// which we enable anyway for wllama's multi-threading. Fall back to the
// legacy Chrome-only performance.memory.
type PerfWithMemory = Performance & {
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>
  memory?: { usedJSHeapSize: number }
}

async function measureMemoryBytes(): Promise<number | null> {
  const perf = performance as PerfWithMemory
  if (crossOriginIsolated && perf.measureUserAgentSpecificMemory) {
    try {
      const res = await perf.measureUserAgentSpecificMemory()
      return res.bytes
    } catch {
      // fall through to legacy API
    }
  }
  return perf.memory?.usedJSHeapSize ?? null
}

function statsFromTimings(
  t: ResultTimings | undefined,
  ttftMs: number | null,
  totalMs: number,
): GenStats {
  return {
    promptTokens: t?.prompt_n ?? 0,
    promptTps: t?.prompt_per_second ?? null,
    genTokens: t?.predicted_n ?? 0,
    genTps: t?.predicted_per_second ?? null,
    cacheTokens: t?.cache_n ?? 0,
    ttftMs,
    totalMs,
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

export function useWllama() {
  const [status, setStatus] = useState<AppStatus>('idle')
  const [activeModel, setActiveModel] = useState<ModelDef | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [genStats, setGenStats] = useState<GenStats | null>(null)
  const [memBytes, setMemBytes] = useState<number | null>(null)
  const [cachedUrls, setCachedUrls] = useState<string[]>([])
  const [settings, setSettings] = useState<InferenceSettings>(DEFAULT_SETTINGS)
  const [error, setError] = useState<string | null>(null)

  const wllamaRef = useRef<Wllama | null>(null)
  const managerRef = useRef<ModelManager | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const messagesRef = useRef<ChatMsg[]>([])
  const settingsRef = useRef(settings)
  const idRef = useRef(0)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const getManager = () =>
    (managerRef.current ??= new ModelManager({ logger: LoggerWithoutDebug }))

  const refreshCached = useCallback(async () => {
    try {
      const models = await getManager().getModels()
      setCachedUrls(models.map((m) => m.url))
    } catch {
      setCachedUrls([])
    }
  }, [])

  useEffect(() => {
    void refreshCached()
  }, [refreshCached])

  // Poll memory usage while a model is loaded.
  const modelLoaded = status !== 'idle'
  useEffect(() => {
    if (!modelLoaded) return
    let disposed = false
    let measuring = false
    const tick = async () => {
      if (measuring) return
      measuring = true
      const bytes = await measureMemoryBytes()
      if (!disposed && bytes !== null) setMemBytes(bytes)
      measuring = false
    }
    void tick()
    const iv = setInterval(tick, 5000)
    return () => {
      disposed = true
      clearInterval(iv)
    }
  }, [modelLoaded])

  const loadModel = useCallback(
    async (model: ModelDef) => {
      if (busyRef.current) return
      busyRef.current = true
      abortRef.current?.abort()
      setError(null)
      setStatus('loading')
      setActiveModel(model)
      setProgress(null)
      setRuntime(null)
      setMessages([])
      setGenStats(null)
      setMemBytes(null)
      try {
        if (wllamaRef.current) {
          await wllamaRef.current.exit().catch(() => {})
          wllamaRef.current = null
        }
        const wllama = new Wllama(WLLAMA_CONFIG_PATHS, {
          logger: LoggerWithoutDebug,
          allowOffline: true,
        })
        wllamaRef.current = wllama
        const s = settingsRef.current
        await wllama.loadModelFromUrl(model.url, {
          n_ctx: s.nCtx,
          ...(s.useWebGPU ? {} : { n_gpu_layers: 0 }),
          progressCallback: ({ loaded, total }) => setProgress({ loaded, total }),
        })
        const ctx = wllama.getLoadedContextInfo()
        setRuntime({
          modelName: ctx.metadata['general.name'] ?? model.name,
          multithread: wllama.isMultithread(),
          threads: wllama.getNumThreads(),
          webgpuSupported: wllama.isSupportWebGPU(),
          ctx,
        })
        setStatus('ready')
        void refreshCached()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStatus('idle')
        setActiveModel(null)
        if (wllamaRef.current) {
          await wllamaRef.current.exit().catch(() => {})
          wllamaRef.current = null
        }
      } finally {
        busyRef.current = false
        setProgress(null)
      }
    },
    [refreshCached],
  )

  const unloadModel = useCallback(async () => {
    abortRef.current?.abort()
    const w = wllamaRef.current
    wllamaRef.current = null
    setStatus('idle')
    setActiveModel(null)
    setRuntime(null)
    setMessages([])
    setGenStats(null)
    setMemBytes(null)
    setError(null)
    if (w) await w.exit().catch(() => {})
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    const wllama = wllamaRef.current
    if (!wllama || busyRef.current) return
    busyRef.current = true
    setError(null)

    const history: WllamaChatMessage[] = [
      ...messagesRef.current
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]
    const userMsg: ChatMsg = { id: ++idRef.current, role: 'user', content: text }
    const asstId = ++idRef.current
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: asstId, role: 'assistant', content: '' },
    ])
    setStatus('generating')

    const ctrl = new AbortController()
    abortRef.current = ctrl
    const t0 = performance.now()
    let ttft: number | null = null
    let content = ''
    let timings: ResultTimings | undefined

    const updateAssistant = (patch: Partial<ChatMsg>) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === asstId ? { ...m, ...patch } : m)),
      )

    try {
      const s = settingsRef.current
      const stream = await wllama.createChatCompletion({
        messages: history,
        stream: true,
        abortSignal: ctrl.signal,
        temperature: s.temperature,
        max_tokens: s.maxTokens,
        cache_prompt: true,
        timings_per_token: true,
      })
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ''
        if (delta && ttft === null) ttft = performance.now() - t0
        content += delta
        if (chunk.timings) timings = chunk.timings
        const stats = statsFromTimings(timings, ttft, performance.now() - t0)
        setGenStats(stats)
        updateAssistant({ content, stats })
      }
      updateAssistant({
        stats: statsFromTimings(timings, ttft, performance.now() - t0),
      })
    } catch (e) {
      if (isAbortError(e)) {
        updateAssistant({
          content,
          interrupted: true,
          stats: statsFromTimings(timings, ttft, performance.now() - t0),
        })
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        updateAssistant({ content, error: msg })
        setError(msg)
      }
    } finally {
      abortRef.current = null
      busyRef.current = false
      setStatus('ready')
    }
  }, [])

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearChat = useCallback(() => {
    setMessages([])
    setGenStats(null)
  }, [])

  const deleteCachedModel = useCallback(
    async (url: string) => {
      try {
        const models = await getManager().getModels({ includeInvalid: true })
        const model = models.find((m) => m.url === url)
        if (model) await model.remove()
      } finally {
        await refreshCached()
      }
    },
    [refreshCached],
  )

  return {
    status,
    activeModel,
    progress,
    runtime,
    messages,
    genStats,
    memBytes,
    cachedUrls,
    settings,
    error,
    loadModel,
    unloadModel,
    sendMessage,
    stopGeneration,
    clearChat,
    deleteCachedModel,
    setSettings,
  }
}
