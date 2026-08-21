import type { GenStats, RuntimeInfo } from '../hooks/useWllama'
import { formatBytes, formatDuration, formatInt, formatRate } from '../lib/format'

interface Props {
  runtime: RuntimeInfo
  genStats: GenStats | null
  memBytes: number | null
}

function Tile({
  label,
  value,
  unit,
  title,
}: {
  label: string
  value: string
  unit?: string
  title?: string
}) {
  return (
    <div className="stat-tile" title={title}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit && <span className="stat-unit"> {unit}</span>}
      </span>
    </div>
  )
}

export function StatsBar({ runtime, genStats, memBytes }: Props) {
  const nCtx = runtime.ctx.n_ctx
  const ctxUsed = genStats
    ? genStats.cacheTokens + genStats.promptTokens + genStats.genTokens
    : 0
  const ctxPct = Math.min(100, Math.round((ctxUsed / nCtx) * 100))

  return (
    <div className="stats-bar" aria-label="Inference statistics">
      <Tile
        label="Generation speed"
        value={genStats?.genTps !== null && genStats?.genTps !== undefined ? formatRate(genStats.genTps) : '—'}
        unit="tok/s"
        title="Decode speed of the current / last response"
      />
      <Tile
        label="Prompt speed"
        value={genStats?.promptTps !== null && genStats?.promptTps !== undefined ? formatRate(genStats.promptTps) : '—'}
        unit="tok/s"
        title="Prompt (prefill) processing speed"
      />
      <Tile
        label="Tokens out"
        value={genStats ? formatInt(genStats.genTokens) : '—'}
        title="Tokens generated in the current / last response"
      />
      <Tile
        label="First token"
        value={genStats?.ttftMs !== null && genStats?.ttftMs !== undefined ? formatDuration(genStats.ttftMs) : '—'}
        title="Time from send to first generated token"
      />
      <div className="stat-tile stat-tile-ctx" title={`Context used: ${formatInt(ctxUsed)} of ${formatInt(nCtx)} tokens`}>
        <span className="stat-label">Context</span>
        <span className="stat-value">
          {formatInt(ctxUsed)}
          <span className="stat-unit"> / {formatInt(nCtx)}</span>
        </span>
        <div className="meter meter-mini" aria-hidden="true">
          <div className="meter-fill" style={{ width: `${ctxPct}%` }} />
        </div>
      </div>
      <Tile
        label="Page memory"
        value={memBytes !== null ? formatBytes(memBytes) : 'n/a'}
        title="Total memory used by this page (JS + WASM + workers), sampled every 5 s"
      />
      <Tile
        label="Threads"
        value={`${runtime.threads}${runtime.multithread ? '' : ' (single)'}`}
        title="Inference threads in the WASM runtime"
      />
      <Tile
        label="WebGPU"
        value={runtime.webgpuSupported ? 'available' : 'no'}
        title="Whether this browser supports WebGPU acceleration"
      />
    </div>
  )
}
