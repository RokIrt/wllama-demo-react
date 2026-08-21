import './App.css'
import { useWllama } from './hooks/useWllama'
import { ModelSidebar } from './components/ModelSidebar'
import { StatsBar } from './components/StatsBar'
import { Chat } from './components/Chat'

const STATUS_LABEL = {
  idle: 'No model',
  loading: 'Loading',
  ready: 'Ready',
  generating: 'Generating',
} as const

function App() {
  const {
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
  } = useWllama()

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            λ
          </span>
          <h1>
            wllama demo <span className="brand-sub">llama.cpp in your browser</span>
          </h1>
        </div>
        <div className="topbar-right">
          <span className={`status-pill status-${status}`}>
            <span className="status-dot" aria-hidden="true" />
            {STATUS_LABEL[status]}
          </span>
        </div>
      </header>

      <ModelSidebar
        status={status}
        activeUrl={activeModel?.url ?? null}
        progress={progress}
        cachedUrls={cachedUrls}
        settings={settings}
        onLoad={loadModel}
        onDeleteCache={deleteCachedModel}
        onSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
      />

      <main className="main">
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {runtime && (
          <div className="model-header">
            <div className="model-header-info">
              <span className="model-header-name">{runtime.modelName}</span>
              <span className="model-header-meta">
                {runtime.ctx.n_layer} layers · vocab {runtime.ctx.n_vocab.toLocaleString('en-US')} · trained ctx{' '}
                {runtime.ctx.n_ctx_train.toLocaleString('en-US')}
              </span>
            </div>
            <div className="model-header-actions">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={clearChat}
                disabled={status !== 'ready' || messages.length === 0}
              >
                Clear chat
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={unloadModel}
                disabled={status === 'loading'}
              >
                Unload
              </button>
            </div>
          </div>
        )}

        {runtime && <StatsBar runtime={runtime} genStats={genStats} memBytes={memBytes} />}

        <Chat status={status} messages={messages} onSend={sendMessage} onStop={stopGeneration} />
      </main>
    </div>
  )
}

export default App
