import { ModelManager } from '@wllama/wllama/esm/index.js'
import type { CacheManager } from '@wllama/wllama/esm/index.js'

// Downloads model shards with HTTP Range resume. Partial data is persisted
// in OPFS, so an interrupted download continues where it left off — both on
// automatic retry and when the user re-clicks the model later.

const RESUME_DIR = 'wllama-resume'
const MAX_RETRIES = 8
const RETRY_DELAY_MS = 3000

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

  const headers: Record<string, string> = {}
  if (prev) {
    headers['Range'] = `bytes=${prev.offset}-`
    // server sends 206 only if the file is unchanged, otherwise full 200
    headers['If-Range'] = prev.etag
  }
  const res = await fetch(url, { headers, signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)

  const resuming = res.status === 206 && prev !== null
  const start = resuming ? prev.offset : 0
  const etag = res.headers.get('etag') ?? ''

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
    let lastError: unknown = null
    let done = false
    for (let attempt = 0; attempt <= MAX_RETRIES && !done; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS, signal)
      try {
        let shardBytes = 0
        await downloadShard(cm, shardUrl, signal, (bytes) => {
          shardBytes = bytes
          onProgress({ loaded: base + bytes, total: totalSize })
        })
        base += shardBytes
        done = true
      } catch (e) {
        if (isAbort(e)) throw e
        lastError = e
      }
    }
    if (!done) throw lastError
  }
}
