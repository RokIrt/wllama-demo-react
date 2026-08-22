import { ModelManager } from '@wllama/wllama/esm/index.js'
import type { CacheManager } from '@wllama/wllama/esm/index.js'

// Downloads model shards with HTTP Range resume. Partial data is persisted
// in OPFS, so an interrupted download continues where it left off — both on
// automatic retry and when the user re-clicks the model later.

const RESUME_DIR = 'wllama-resume'
const RETRY_DELAY_MS = 3000
const MAX_RETRY_DELAY_MS = 30000
// abort + retry when no bytes arrive for this long
const STALL_TIMEOUT_MS = 30000

interface PartMeta {
  etag: string
}

async function getResumeDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(RESUME_DIR, { create: true })
}

async function readPartState(
  dir: FileSystemDirectoryHandle,
  partName: string,
): Promise<{ offset: number; etag: string } | null> {
  try {
    const fh = await dir.getFileHandle(partName)
    const size = (await fh.getFile()).size
    const mf = await dir.getFileHandle(partName + '.meta')
    const meta = JSON.parse(await (await mf.getFile()).text()) as PartMeta
    if (size > 0 && meta.etag) return { offset: size, etag: meta.etag }
  } catch {
    // no usable partial data
  }
  return null
}

async function removePart(dir: FileSystemDirectoryHandle, partName: string) {
  await dir.removeEntry(partName).catch(() => {})
  await dir.removeEntry(partName + '.meta').catch(() => {})
}

/** Download one shard into the wllama cache, resuming partial data if any. */
async function downloadShard(
  cm: CacheManager,
  url: string,
  signal: AbortSignal | undefined,
  onShardLoaded: (bytes: number) => void,
): Promise<void> {
  const name = await cm.getNameFromURL(url)

  // already fully cached?
  const meta = await cm.getMetadata(name)
  const cachedSize = await cm.getSize(name)
  if (meta && cachedSize > 0 && cachedSize === meta.originalSize) {
    onShardLoaded(cachedSize)
    return
  }

  const dir = await getResumeDir()
  const partName = name + '.part'
  const prev = await readPartState(dir, partName)

  // Only CORS-safelisted headers here: If-Range would trigger a preflight
  // that the HF CDN rejects, killing every resume with "Failed to fetch".
  // Instead we validate the ETag after the response arrives.
  const headers: Record<string, string> = {}
  if (prev) headers['Range'] = `bytes=${prev.offset}-`

  // watchdog: abort the fetch if the stream stalls, so retry can kick in
  const ctrl = new AbortController()
  let stalled = false
  const onOuterAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onOuterAbort)
  let watchdog = setTimeout(() => {
    stalled = true
    ctrl.abort()
  }, STALL_TIMEOUT_MS)
  const kick = () => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      stalled = true
      ctrl.abort()
    }, STALL_TIMEOUT_MS)
  }

  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    if (!(res.ok || res.status === 206) || !res.body)
      throw new Error(`HTTP ${res.status} for ${url}`)

    const etag = res.headers.get('etag') ?? ''
    const resuming = res.status === 206 && prev !== null
    if (resuming && prev && etag && prev.etag && etag !== prev.etag) {
      // remote file changed since the partial was saved — start over
      ctrl.abort()
      await removePart(dir, partName)
      throw new Error('remote file changed, restarting download')
    }
    const start = resuming ? prev!.offset : 0

    const fh = await dir.getFileHandle(partName, { create: true })
    const mf = await dir.getFileHandle(partName + '.meta', { create: true })
    const mw = await mf.createWritable()
    await mw.write(JSON.stringify({ etag } satisfies PartMeta))
    await mw.close()

    const writable = await fh.createWritable({ keepExistingData: resuming })
    let written = start
    onShardLoaded(written)
    try {
      if (resuming) await writable.seek(start)
      else await writable.truncate(0)
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        kick()
        await writable.write(value)
        written += value.byteLength
        onShardLoaded(written)
      }
    } finally {
      // close() commits the data written so far, keeping it for the next resume
      await writable.close().catch(() => {})
    }

    // move the finished shard into the wllama cache (streamed, not buffered)
    const blob = await fh.getFile()
    await cm.write(name, blob.stream(), {
      etag,
      originalSize: blob.size,
      originalURL: url,
    })
    await removePart(dir, partName)
  } catch (e) {
    // a stall-triggered abort must be retryable, not treated as user abort
    if (stalled && isAbort(e)) throw new Error('download stalled, retrying')
    throw e
  } finally {
    clearTimeout(watchdog)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

/** Resolve once the browser reports connectivity (no-op if already online). */
const waitForOnline = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (navigator.onLine !== false) return resolve()
    const onOnline = () => {
      cleanup()
      resolve()
    }
    const onAbort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const cleanup = () => {
      window.removeEventListener('online', onOnline)
      signal?.removeEventListener('abort', onAbort)
    }
    window.addEventListener('online', onOnline)
    signal?.addEventListener('abort', onAbort)
  })

export function supportsResumableDownload(): boolean {
  return typeof navigator.storage?.getDirectory === 'function'
}

/**
 * Download all shards of a model with resume + auto-retry, storing them in
 * the wllama cache so `getModelOrDownload` finds them afterwards.
 */
export async function downloadModelResumable(opts: {
  manager: ModelManager
  url: string
  totalSize: number
  signal?: AbortSignal
  onProgress: (p: { loaded: number; total: number }) => void
}): Promise<void> {
  const { manager, url, totalSize, signal, onProgress } = opts
  const cm = manager.cacheManager
  const shardUrls = ModelManager.parseModelUrl(url)

  let base = 0
  for (const shardUrl of shardUrls) {
    // retry indefinitely (the user can cancel) — network outages can easily
    // outlast any fixed retry budget. Backoff resets whenever bytes flow.
    let delay = RETRY_DELAY_MS
    for (;;) {
      try {
        let shardBytes = 0
        await downloadShard(cm, shardUrl, signal, (bytes) => {
          if (bytes > shardBytes) delay = RETRY_DELAY_MS
          shardBytes = bytes
          onProgress({ loaded: base + bytes, total: totalSize })
        })
        base += shardBytes
        break
      } catch (e) {
        if (isAbort(e)) throw e
        await sleep(delay, signal)
        delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)
        await waitForOnline(signal)
      }
    }
  }
}
