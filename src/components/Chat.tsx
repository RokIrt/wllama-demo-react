import { useEffect, useRef, useState } from 'react'
import type { AppStatus, ChatMsg } from '../hooks/useWllama'
import { formatDuration, formatInt, formatRate } from '../lib/format'

interface Props {
  status: AppStatus
  messages: ChatMsg[]
  onSend: (text: string) => void
  onStop: () => void
}

/** Split out a leading <think>…</think> block (DeepSeek R1 / Qwen3 style). */
function splitThink(content: string): {
  think: string | null
  rest: string
  thinking: boolean
} {
  const open = content.indexOf('<think>')
  if (open === -1) return { think: null, rest: content, thinking: false }
  const close = content.indexOf('</think>', open)
  if (close === -1) {
    return { think: content.slice(open + 7).trim(), rest: '', thinking: true }
  }
  return {
    think: content.slice(open + 7, close).trim(),
    rest: content.slice(close + 8).replace(/^\s+/, ''),
    thinking: false,
  }
}

function MessageStats({ msg }: { msg: ChatMsg }) {
  const s = msg.stats
  if (!s || s.genTokens === 0) return null
  return (
    <div className="msg-stats">
      {formatInt(s.genTokens)} tok
      {s.genTps !== null && <> · {formatRate(s.genTps)} tok/s</>}
      {s.ttftMs !== null && <> · first token {formatDuration(s.ttftMs)}</>}
      {' · '}
      {formatDuration(s.totalMs)}
      {msg.interrupted && ' · stopped'}
    </div>
  )
}

function AssistantMessage({ msg, streaming }: { msg: ChatMsg; streaming: boolean }) {
  const { think, rest, thinking } = splitThink(msg.content)
  const empty = msg.content.trim() === ''
  return (
    <div className="msg msg-assistant">
      <div className="msg-body">
        {think !== null && (
          <details className="think" open={thinking}>
            <summary>{thinking ? 'Reasoning…' : 'Reasoning'}</summary>
            <div className="think-body">{think}</div>
          </details>
        )}
        {empty && streaming ? (
          <span className="typing" aria-label="Generating">
            <span />
            <span />
            <span />
          </span>
        ) : (
          rest && <div className="msg-text">{rest}</div>
        )}
        {msg.error && <div className="msg-error">Error: {msg.error}</div>}
      </div>
      <MessageStats msg={msg} />
    </div>
  )
}

export function Chat({ status, messages, onSend, onStop }: Props) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Auto-scroll while streaming, unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const canSend = status === 'ready' && draft.trim().length > 0
  const send = () => {
    if (!canSend) return
    stickToBottom.current = true
    onSend(draft.trim())
    setDraft('')
  }

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            {status === 'idle' ? (
              <>
                <h2>No model loaded</h2>
                <p>
                  Pick a model from the sidebar. It downloads once into browser
                  storage and then runs fully locally — no server, no API key.
                </p>
              </>
            ) : status === 'loading' ? (
              <>
                <h2>Loading model…</h2>
                <p>The GGUF file is being downloaded and loaded into the WASM runtime.</p>
              </>
            ) : (
              <>
                <h2>Ready</h2>
                <p>Say something — inference runs entirely in your browser.</p>
              </>
            )}
          </div>
        ) : (
          <div className="chat-messages">
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={m.id} className="msg msg-user">
                  <div className="msg-text">{m.content}</div>
                </div>
              ) : (
                <AssistantMessage
                  key={m.id}
                  msg={m}
                  streaming={status === 'generating' && i === messages.length - 1}
                />
              ),
            )}
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          rows={1}
          value={draft}
          placeholder={
            status === 'idle'
              ? 'Load a model to start chatting'
              : status === 'loading'
                ? 'Loading model…'
                : 'Message the model… (Enter to send, Shift+Enter for newline)'
          }
          disabled={status === 'idle' || status === 'loading'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        {status === 'generating' ? (
          <button type="button" className="btn btn-stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!canSend} onClick={send}>
            Send
          </button>
        )}
      </div>
    </div>
  )
}
