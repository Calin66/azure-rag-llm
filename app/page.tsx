'use client'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

// Lazy import Speech SDK only on client
let SpeechSDK: any
if (typeof window !== 'undefined') {
  import('microsoft-cognitiveservices-speech-sdk').then(m => (SpeechSDK = m))
}

type Hit = { id: string; title: string; summary_short: string; themes: string[] }

export default function Page() {
  const [q, setQ] = useState('Recommend a fantasy adventure about friendship and courage')
  const [hits, setHits] = useState<Hit[]>([])
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const recoRef = useRef<any>(null)

  async function doChat() {
    setLoading(true)
    setAnswer('')
    try {
      const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ q }), headers: { 'Content-Type': 'application/json' } })
      const data = await res.json()
      if (data.hits) setHits(data.hits)
      if (data.answer) setAnswer(data.answer)
      if (data.error) alert(data.error)
    } catch (e: any) {
      alert(e?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  async function ttsSpeak(text: string) {
    if (!text || !SpeechSDK) return
    const tokRes = await fetch('/api/speech/token')
    const { token, region } = await tokRes.json()
    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region)
    speechConfig.speechSynthesisVoiceName = 'en-US-AvaMultilingualNeural'
    const synth = new SpeechSDK.SpeechSynthesizer(speechConfig)
    await new Promise<void>((resolve) => {
      synth.speakTextAsync(text, () => { synth.close(); resolve() }, (err: any) => { console.error(err); synth.close(); resolve() })
    })
  }

  async function toggleMic() {
    if (!SpeechSDK) return
    if (listening) {
      recoRef.current?.stopContinuousRecognitionAsync?.()
      setListening(false)
      return
    }
    const tokRes = await fetch('/api/speech/token')
    const { token, region } = await tokRes.json()
    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region)
    speechConfig.speechRecognitionLanguage = 'en-US'
    const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig)
    recoRef.current = recognizer
    recognizer.recognized = (_s: any, e: any) => {
      if (e?.result?.text) setQ(prev => (prev.trim() ? prev + ' ' + e.result.text : e.result.text))
    }
    recognizer.sessionStopped = () => setListening(false)
    recognizer.canceled = () => setListening(false)
    recognizer.startContinuousRecognitionAsync()
    setListening(true)
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-bold">Azure RAG Librarian</h1>
        <p className="text-sm text-gray-600">Azure AI Search + Azure OpenAI + Azure Speech (STT/TTS)</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            className="w-full rounded-xl border bg-white px-4 py-3 shadow-sm focus:outline-none focus:ring"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Ask for a book..."
          />
          <div className="flex gap-2">
            <button onClick={doChat} disabled={loading} className={clsx('rounded-xl px-4 py-3 text-white', loading ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700')}>Ask</button>
            <button onClick={toggleMic} className={clsx('rounded-xl px-4 py-3', listening ? 'bg-red-100 text-red-700' : 'bg-gray-100')}>{listening ? 'Stop' : '🎙️ Voice'}</button>
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
            <div className="mt-3">
              <button onClick={() => ttsSpeak(answer)} className="rounded-lg bg-gray-100 px-3 py-2">🔊 Listen</button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}