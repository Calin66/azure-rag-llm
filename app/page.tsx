'use client'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

// Verbose logging helpers
const LOG = {
  info: (...a: any[]) => console.log('[SPEECH]', ...a),
  warn: (...a: any[]) => console.warn('[SPEECH]', ...a),
  err:  (...a: any[]) => console.error('[SPEECH]', ...a),
}
const stamp = () => new Date().toISOString()

// Lazy-load Speech SDK only in the browser
let SpeechSDK: any
async function ensureSDK() {
  if (SpeechSDK) return SpeechSDK
  const t0 = performance.now()
  const mod = await import('microsoft-cognitiveservices-speech-sdk')
  SpeechSDK = mod
  LOG.info('SDK loaded in', Math.round(performance.now() - t0), 'ms')
  return SpeechSDK
}

type Hit = { id: string; title: string; summary_short: string; themes: string[] }

export default function Page() {
  const [q, setQ] = useState('Recommend a fantasy adventure about friendship and courage')
  const [hits, setHits] = useState<Hit[]>([])
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)

  // Speech state
  const [listening, setListening] = useState(false)
  const [partial, setPartial] = useState('')      // live partial transcript

  // Refs
  const recoRef = useRef<any>(null)               // current SpeechRecognizer
  const tokenRef = useRef<{ token: string; region: string; expiresAt: number } | null>(null)

  const [deviceId, setDeviceId] = useState<string | undefined>(undefined)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [imgLoading, setImgLoading] = useState(false)

  function pickDoc() {
    return hits?.[0] ?? null
  }

  useEffect(() => {
    async function load() {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }); // prompt once
        const list = await navigator.mediaDevices.enumerateDevices();
        const mics = list.filter(d => d.kind === 'audioinput');
        setDevices(mics);

        // Auto-pick your WH-1000XM4 if present; else leave undefined (default)
        const xm4 = mics.find(d => /WH-1000XM4/i.test(d.label));
        if (xm4) setDeviceId(xm4.deviceId);
      } catch (e) { /* ignore */ }
    }
    load();
  }, []);


  // Diagnostics on mount
  useEffect(() => {
    LOG.info('Page mounted at', stamp(), '| env:', process.env.NODE_ENV, '| secureContext:', (typeof window !== 'undefined' ? (window.isSecureContext ? 'yes' : 'no') : 'n/a'))
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.enumerateDevices()
        .then(list => {
          const mics = list.filter(d => d.kind === 'audioinput')
          LOG.info('MediaDevices present. audioinput count =', mics.length, mics.map(m => m.label || m.deviceId))
        })
        .catch(e => LOG.warn('enumerateDevices failed:', e?.message))
      // Try permissions API (not supported everywhere)
      // @ts-ignore
      navigator.permissions?.query?.({ name: 'microphone' as PermissionName }).then((res: any) => {
        LOG.info('Permissions.microphone ->', res?.state)
      }).catch(() => {})
    } else {
      LOG.warn('navigator.mediaDevices not available')
    }
  }, [])

  const [imgMsg,   setImgMsg]   = useState<string | null>(null)

  async function generateImageFromQuery(type: 'scene' | 'theme') {
    const query = q.trim()
    if (!query) return
    setImgMsg(null)
    setImgLoading(true)
    try {
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, kind: type, style: 'illustration' }),
      })
      const data = await res.json()
      console.log('[IMG]', res.status, data)
      if (data?.ok && data?.image) {
        setCoverUrl(data.image)
      } else {
        setCoverUrl(null)
        setImgMsg(data?.message || 'Image request was blocked. Try a safer, more generic prompt.')
      }
    } catch {
      setCoverUrl(null)
      setImgMsg('Image generation failed. Please try again.')
    } finally {
      setImgLoading(false)
    }
  }

  // Chat (RAG)
  async function doChat(textOverride?: string) {
    const query = (textOverride ?? q).trim()
    if (!query) return
    setLoading(true)
    setAnswer('')
    setHits([])
    LOG.info('CHAT start ->', query)
    console.time('[SPEECH] chat')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ q: query }),
        headers: { 'Content-Type': 'application/json' },
      })
      LOG.info('CHAT fetch status:', res.status, res.statusText)
      const txt = await res.text()
      let data: any = {}
      try {
        data = JSON.parse(txt)
      } catch {
        LOG.err('CHAT non-JSON response body (likely error HTML):', txt.slice(0, 300))
        throw new Error('Server returned non-JSON (see console).')
      }
      if (data.hits) {
        LOG.info('CHAT hits:', data.hits.length)
        setHits(data.hits)
      }
      if (data.answer) {
        LOG.info('CHAT answer length:', data.answer.length)
        setAnswer(data.answer)
      }
      if (data.error) {
        LOG.err('CHAT error:', data.error)
        alert(data.error)
      }
    } catch (e: any) {
      LOG.err('CHAT exception:', e?.message)
      alert(e?.message || 'Error')
    } finally {
      console.timeEnd('[SPEECH] chat')
      setLoading(false)
    }
  }

  // ====== Speech: Token management (cache & refresh) ======
  async function getSpeechConfig() {
    const now = Date.now()
    if (!tokenRef.current || tokenRef.current.expiresAt - now < 60_000) {
      LOG.info('TOKEN fetch… (existing:', !!tokenRef.current, 'expiresInSec:', tokenRef.current ? Math.round((tokenRef.current.expiresAt - now)/1000) : 'n/a', ')')
      const r = await fetch('/api/speech/token', { cache: 'no-store' })
      LOG.info('TOKEN status:', r.status, r.statusText)
      const { token, region, error } = await r.json()
      if (error || !token || !region) {
        LOG.err('TOKEN failed:', error)
        throw new Error(error || 'Speech token fetch failed')
      }
      tokenRef.current = { token, region, expiresAt: now + 9.5 * 60_000 } // ~9.5 min
      LOG.info('TOKEN ok. region=', region, 'tokenLen=', token.length)
    }
    const sdk = await ensureSDK()
    const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(tokenRef.current.token, tokenRef.current.region)

    // Tweak timeouts (useful for pauses)
    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
      '6000'
    )
    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
      '800'
    )

    // Language (change to 'ro-RO' if you want Romanian)
    speechConfig.speechRecognitionLanguage = 'en-US'
    LOG.info('CONFIG ready. lang=', speechConfig.speechRecognitionLanguage)

    return speechConfig
  }

  // Speech: STT
  async function startMic() {
    LOG.info('startMic() called. listening=', listening)
    if (listening) return
    const sdk = await ensureSDK()

    try {
    const speechConfig = await getSpeechConfig();
    const audioCfg = deviceId
      ? sdk.AudioConfig.fromMicrophoneInput(deviceId)
      : sdk.AudioConfig.fromDefaultMicrophoneInput();
    LOG.info('Using mic deviceId =', deviceId || '(default)');
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioCfg);

      recoRef.current = recognizer
      setPartial('')
      setListening(true)

      LOG.info('Recognizer created. Starting continuous recognition…')

      // More verbose eventing
      recognizer.sessionStarted = (_s: any, e: any) => {
        LOG.info('sessionStarted. sessionId=', e?.sessionId)
      }
      recognizer.sessionStopped = async (_s: any, e: any) => {
        LOG.info('sessionStopped. sessionId=', e?.sessionId)
        await stopMic()
      }
      recognizer.speechStartDetected = () => {
        LOG.info('speechStartDetected')
      }
      recognizer.speechEndDetected = () => {
        LOG.info('speechEndDetected')
      }

      recognizer.recognizing = (_s: any, e: any) => {
        const text = e?.result?.text || ''
        LOG.info('PARTIAL:', JSON.stringify(text))
        if (text) setPartial(text)
      }

      recognizer.recognized = async (_s: any, e: any) => {
        const reason = e?.result?.reason
        const text = e?.result?.text || ''  
        LOG.info('RECOGNIZED. reason=', reason, 'text=', JSON.stringify(text))
        if (reason === sdk.ResultReason.RecognizedSpeech && text.trim()) {
          const finalText = text.trim()
          setQ(finalText)
          LOG.info('Final text → stopMic() then doChat() with:', JSON.stringify(finalText))
          await stopMic()
          await doChat(finalText)
        } else if (reason === sdk.ResultReason.NoMatch) {
          const nm = e?.result?.noMatchDetails?.reason
          LOG.warn('NoMatch. reason=', nm)
        }
      }

      recognizer.canceled = async (_s: any, e: any) => {
        LOG.warn('CANCELED. reason=', e?.reason, 'errorDetails=', e?.errorDetails)
        await stopMic()
      }

      // Start with callbacks so we can log success/failure explicitly
      recognizer.startContinuousRecognitionAsync(
        () => LOG.info('startContinuousRecognitionAsync: SUCCESS'),
        (err: any) => {
          LOG.err('startContinuousRecognitionAsync: ERROR', err)
          setListening(false)
        }
      )
    } catch (err: any) {
      LOG.err('startMic exception:', err?.message || err)
      setListening(false)
    }
  }

  async function stopMic() {
    const sdk = await ensureSDK()
    LOG.info('stopMic() called. listening=', listening, 'recoRef?', !!recoRef.current)
    return new Promise<void>((resolve) => {
      const r = recoRef.current as any
      recoRef.current = null
      setListening(false)
      setPartial('')

      if (!r) {
        LOG.info('No recognizer to stop.')
        return resolve()
      }
      try {
        r.stopContinuousRecognitionAsync(
          () => {
            LOG.info('stopContinuousRecognitionAsync: SUCCESS')
            try { r.close?.() } catch {}
            resolve()
          },
          (err: any) => {
            LOG.err('stopContinuousRecognitionAsync: ERROR', err)
            try { r.close?.() } catch {}
            resolve()
          }
        )
      } catch (err) {
        LOG.err('stopMic() outer catch:', err)
        try { r.close?.() } catch {}
        resolve()
      }
    })
  }

  async function toggleMic() {
    LOG.info('toggleMic()', 'listening=', listening)
    if (listening) {
      await stopMic()
    } else {
      await startMic()
    }
  }

  // TTS
  async function ttsSpeak(text: string) {
    if (!text) return
    const sdk = await ensureSDK()
    LOG.info('TTS speak len=', text.length)
    const t0 = performance.now()
    try {
      const tokRes = await fetch('/api/speech/token', { cache: 'no-store' })
      LOG.info('TTS token status:', tokRes.status, tokRes.statusText)
      const { token, region, error } = await tokRes.json()
      if (error) throw new Error(error)
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region)
      speechConfig.speechSynthesisVoiceName = 'en-US-AvaMultilingualNeural'
      const synth = new sdk.SpeechSynthesizer(speechConfig)
      await new Promise<void>((resolve) => {
        synth.speakTextAsync(
          text,
          () => {
            LOG.info('TTS done in', Math.round(performance.now() - t0), 'ms')
            synth.close()
            resolve()
          },
          (err: any) => {
            LOG.err('TTS error:', err)
            synth.close()
            resolve()
          }
        )
      })
    } catch (e: any) {
      LOG.err('TTS exception:', e?.message)
    }
  }

  // ====== UI ======
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-bold">Azure RAG Librarian</h1>
        <p className="text-sm text-gray-600">Azure AI Search + Azure OpenAI + Azure Speech (STT/TTS)</p>
        <select
          className="border rounded px-2 py-1 mt-4"
          value={deviceId || ''}
          onChange={(e) => setDeviceId(e.target.value || undefined)}
          title="Microphone"
        >
          <option value="">Default mic</option>
          {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
        </select>


        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1">
            <input
              className="w-full rounded-xl border bg-white px-4 py-3 shadow-sm focus:outline-none focus:ring"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask for a book..."
              onFocus={() => LOG.info('INPUT focus')}
              onKeyDown={(e) => { if (e.key === 'Enter' && !(loading || imgLoading || listening)) { e.preventDefault(); doChat() } }}
              onBlur={() => LOG.info('INPUT blur')}
            />
            {/* Live partial transcript while speaking */}
            {listening && (
              <div className="text-xs text-gray-500">
                <span className="mr-2">🎙️</span>
                {partial || <span className="italic">listening…</span>}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => doChat()}
              disabled={loading || imgLoading || listening}
              className={clsx(
                'rounded-xl px-4 py-3 text-white disabled:cursor-not-allowed',
                (loading || imgLoading || listening) ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'
              )}
            >
              Ask
            </button>
            <button
              onClick={toggleMic}
              disabled={loading || imgLoading}
              className={clsx(
                'rounded-xl px-4 py-3',
                (listening) ? 'bg-red-100 text-red-700' : 'bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              title={listening ? 'Stop microphone' : 'Start microphone'}
            >
              {listening ? 'Stop' : '🎙️ Voice'}
            </button>
          </div>
        </div>

        {hits?.length > 0 && (
          <div className="mt-6">
            <h2 className="font-semibold">Top matches</h2>
            <ul className="mt-2 grid gap-2">
              {hits.map((h) => (
                <li key={h.id} className="rounded-lg border bg-white p-3 shadow-sm">
                  <div className="font-medium">{h.title}</div>
                  <div className="text-sm text-gray-600">{h.summary_short}</div>
                  <div className="text-xs mt-1">Themes: {h.themes?.join(', ')}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {answer && (
          <div className="mt-6 rounded-xl border bg-white p-4 shadow">
            <div className="prose prose-sm max-w-none whitespace-pre-wrap">{answer}</div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => ttsSpeak(answer)} className="rounded-lg bg-gray-100 px-3 py-2">🔊 Listen</button>
              <button onClick={()=>generateImageFromQuery('scene')} disabled={loading || imgLoading || listening} className={clsx("rounded-lg bg-gray-100 px-3 py-2", 'disabled:opacity-50 disabled:cursor-not-allowed')}>🖼️ Scene</button>
              <button onClick={()=>generateImageFromQuery('theme')} disabled={loading || imgLoading || listening} className={clsx("rounded-lg bg-gray-100 px-3 py-2", 'disabled:opacity-50 disabled:cursor-not-allowed')}>🖼️ Theme</button>

            </div>

            {imgMsg && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status" aria-live="polite">
                {imgMsg}
              </div>
            )}

            {coverUrl && (
              <div className="mt-4">
                <img
                  src={coverUrl}
                  alt="AI generated illustration"
                  className="w-full max-w-lg rounded-lg border shadow-sm"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
