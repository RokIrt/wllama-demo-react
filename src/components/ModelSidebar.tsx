import type { DownloadProgress, AppStatus } from '../hooks/useWllama'
import {
  CTX_OPTIONS,
  MAX_TOKENS_OPTIONS,
  MODELS,
  type InferenceSettings,
  type ModelDef,
} from '../config'
import { formatBytes } from '../lib/format'

interface Props {
  status: AppStatus
  activeUrl: string | null
  progress: DownloadProgress | null
  cachedUrls: string[]
  settings: InferenceSettings
  onLoad: (model: ModelDef) => void
  onDeleteCache: (url: string) => void
  onSettings: (patch: Partial<InferenceSettings>) => void
}

function ModelCard({
  model,
  isActive,
  isLoading,
  isCached,
  progress,
  disabled,
  onLoad,
  onDeleteCache,
}: {
  model: ModelDef
  isActive: boolean
  isLoading: boolean
  isCached: boolean
  progress: DownloadProgress | null
  disabled: boolean
  onLoad: () => void
  onDeleteCache: () => void
}) {
  const downloading = isLoading && progress !== null && progress.loaded < progress.total
  const pct = downloading ? Math.round((progress.loaded / progress.total) * 100) : null

  return (
    <div className={`model-card${isActive ? ' active' : ''}`}>
      <div className="model-card-head">
        <span className="model-name">{model.name}</span>
        {isCached && (
          <span className="badge badge-cached" title="Model file is cached in browser storage (OPFS)">
            <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
              <path
                d="M3 8.5 6.5 12 13 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Cached
          </span>
        )}
      </div>
      <div className="model-meta">
        {model.params} · {model.quant} · {formatBytes(model.size)}
        {model.shards && ` · ${model.shards} files`}
      </div>
      {model.note && <div className="model-note">{model.note}</div>}
      {isLoading ? (
        <div className="model-progress">
          <div
            className="meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
            aria-label={downloading ? 'Downloading model' : 'Loading model'}
          >
            <div
              className={`meter-fill${pct === null ? ' indeterminate' : ''}`}
              style={pct !== null ? { width: `${pct}%` } : undefined}
            />
          </div>
          <span className="model-progress-label">
            {downloading
              ? `Downloading ${pct}% · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
              : 'Loading into memory…'}
          </span>
        </div>
      ) : (
        <div className="model-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={disabled}
            onClick={onLoad}
          >
            {isActive ? 'Reload' : 'Load'}
          </button>
          {isCached && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={disabled}
              onClick={onDeleteCache}
              title="Remove from browser cache"
            >
              Delete cache
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ModelSidebar({
  status,
  activeUrl,
  progress,
  cachedUrls,
  settings,
  onLoad,
  onDeleteCache,
  onSettings,
}: Props) {
  const busy = status === 'loading' || status === 'generating'

  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <h2 className="sidebar-title">Models</h2>
        <div className="model-list">
          {MODELS.map((m) => (
            <ModelCard
              key={m.url}
              model={m}
              isActive={m.url === activeUrl && status !== 'loading'}
              isLoading={status === 'loading' && m.url === activeUrl}
              isCached={cachedUrls.includes(m.url)}
              progress={m.url === activeUrl ? progress : null}
              disabled={busy}
              onLoad={() => onLoad(m)}
              onDeleteCache={() => onDeleteCache(m.url)}
            />
          ))}
        </div>
      </section>

      <section className="sidebar-section">
        <h2 className="sidebar-title">Settings</h2>
        <div className="settings">
          <label className="setting">
            <span className="setting-label">
              Temperature <span className="setting-value">{settings.temperature.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.temperature}
              onChange={(e) => onSettings({ temperature: Number(e.target.value) })}
            />
          </label>
          <label className="setting">
            <span className="setting-label">Max response tokens</span>
            <select
              value={settings.maxTokens}
              onChange={(e) => onSettings({ maxTokens: Number(e.target.value) })}
            >
              {MAX_TOKENS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="setting">
            <span className="setting-label">Context size</span>
            <select
              value={settings.nCtx}
              onChange={(e) => onSettings({ nCtx: Number(e.target.value) })}
            >
              {CTX_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="setting setting-row">
            <input
              type="checkbox"
              checked={settings.useWebGPU}
              onChange={(e) => onSettings({ useWebGPU: e.target.checked })}
            />
            <span className="setting-label">Use WebGPU when available</span>
          </label>
          <p className="setting-hint">Context size and WebGPU apply on the next model load.</p>
        </div>
      </section>
    </aside>
  )
}
