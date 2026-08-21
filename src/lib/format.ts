/** 386404992 -> "386 MB", 1055609536 -> "1.06 GB" */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2).replace(/\.?0+$/, '')} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`
  return `${bytes} B`
}

/** 18.345 -> "18.3", 123.4 -> "123" */
export function formatRate(n: number): string {
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1)
}

/** 1234 -> "1,234" */
export function formatInt(n: number): string {
  return n.toLocaleString('en-US')
}

/** 220 -> "220 ms", 65000 -> "1m 5s" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}
