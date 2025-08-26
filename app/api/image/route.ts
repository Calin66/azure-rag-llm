import { NextRequest, NextResponse } from 'next/server'
import { createLLM, getDeployment } from '@/lib/azure'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Payload = {
  query: string
  kind?: 'scene' | 'theme'
  style?: 'illustration' | 'digital' | 'oil' | 'watercolor' | 'photoreal' | 'pixel'
}

const DEFAULT_SIZE = process.env.IMAGE_SIZE || '1024x1024'

// --- Helpers
const IP_BLOCKLIST = [
  'hobbit','hobbits','shire','tolkien','lord of the rings','middle-earth',
  'harry potter','hogwarts','jk rowling','star wars','jedi','sith','stormtrooper',
  'marvel','dc comics','batman','superman','dune','arrakis','pokemon','disney','pixar',
]
const stripIP = (s?: string) => (s ? IP_BLOCKLIST.reduce(
  (out, t) => out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'), ''), s
).replace(/["“”‘’]+/g,'').replace(/\s+/g,' ').trim() : '')

function guessThemes(q: string) {
  const t = (q||'').toLowerCase(), out = new Set<string>()
  if (/(adventure|journey|quest)/.test(t)) out.add('adventure')
  if (/(friend|companionship|fellowship|team)/.test(t)) out.add('friendship')
  if (/(fantasy|magic|elves|dragons|wizard)/.test(t)) out.add('fantasy')
  if (/(mystery|detective|crime|whodunit)/.test(t)) out.add('mystery')
  if (/(dystopia|totalitarian|surveillance)/.test(t)) out.add('dystopia')
  if (/(romance|love|relationship)/.test(t)) out.add('romance')
  if (/(courage|bravery|hero|heroine)/.test(t)) out.add('courage')
  return Array.from(out.size ? out : new Set(['literary']))
}

function promptFromUserQuery(p: Payload) {
  const q = stripIP(p.query || '')
  const themes = guessThemes(q).join(', ')
  const mode = p.kind === 'scene'
    ? 'Create a cinematic illustration of a safe, family-friendly scene inspired by the request.'
    : 'Create a symbolic illustration that embodies the main themes of the request.'
  return [
    mode,
    q ? `Inspiration from the user request (paraphrased): ${q}.` : '',
    `Reflect these safe themes: ${themes}.`,
    `Style: ${p.style || 'illustration'}, richly textured, soft cinematic lighting.`,
    'Composition: single clear focal point, clean background, tasteful negative space.',
    'No text, no logos, no brand iconography, no recognizable copyrighted characters.',
    'Family-friendly, non-violent, non-sexual.',
  ].filter(Boolean).join(' ')
}

function promptGenericSoft(p: Payload) {
  const themes = guessThemes(p.query || '').join(', ')
  const mode = p.kind === 'scene'
    ? 'Create a cinematic illustration of a serene, family-friendly outdoor scene.'
    : 'Create a symbolic illustration emphasizing universal literary themes.'
  return [
    mode,
    themes ? `Key themes: ${themes}.` : 'Key themes: wonder, journey, companionship.',
    'Atmosphere: uplifting, inviting, imaginative.',
    `Style: ${p.style || 'illustration'}, richly textured, soft cinematic lighting.`,
    'Composition: single clear focal point, clean background, tasteful negative space.',
    'No text, no logos, no brand iconography, no real people.',
  ].join(' ')
}

const isBlocked = (m: string) => /blocked|policy|safety|unsafe|violation|content\s*filter/i.test(m)
const pickSize = (k?: Payload['kind']) => (k === 'scene' ? '1792x1024' : DEFAULT_SIZE)

async function dalleB64(model: string, prompt: string, size: string, reqId: string) {
  const client = createLLM('dall-e-3')
  console.log('[IMAGE]', reqId, 'generate start', { model, size })
  const result = await client.images.generate({
    model, prompt, size, quality: 'hd', n: 1, response_format: 'b64_json',
  } as any)
  const b64 = (result as any)?.data?.[0]?.b64_json
  if (!b64) throw new Error('No image data returned')
  console.log('[IMAGE]', reqId, 'generate ok')
  return `data:image/png;base64,${b64}`
}

export async function POST(req: NextRequest) {
  const reqId = Math.random().toString(36).slice(2,8)
  try {
    const body = (await req.json()) as Payload
    const model = getDeployment('image')
    const size = pickSize(body?.kind)
    const base = { reqId, model, size }

    if (!body?.query?.trim()) {
      console.warn('[IMAGE]', reqId, 'missing query')
      return NextResponse.json({ ok:false, message:'Missing "query"', ...base })
    }

    // Attempt 1
    try {
      const p1 = promptFromUserQuery(body)
      console.log('[IMAGE]', reqId, 'attempt1 prompt=', p1)
      const img1 = await dalleB64(model, p1, size, reqId)
      return NextResponse.json({ ok:true, image:img1, promptUsed:p1, attempt:1, ...base })
    } catch (e: any) {
      const msg = String(e?.message || e); const status = e?.status ?? e?.code ?? e?.response?.status
      console.warn('[IMAGE]', reqId, 'attempt1 error', { status, msg })
      if (!isBlocked(msg)) throw e
    }

    // Attempt 2 (softer)
    try {
      const p2 = promptGenericSoft(body)
      console.log('[IMAGE]', reqId, 'attempt2 prompt=', p2)
      const img2 = await dalleB64(model, p2, size, reqId)
      return NextResponse.json({ ok:true, image:img2, promptUsed:p2, attempt:2, note:'generic-soft', ...base })
    } catch (e: any) {
      const msg = String(e?.message || e); const status = e?.status ?? e?.code ?? e?.response?.status
      console.warn('[IMAGE]', reqId, 'attempt2 error', { status, msg })
      if (!isBlocked(msg)) throw e
      // => BLOCKED after softening
      return NextResponse.json({
        ok: false,
        blocked: true,
        message: 'Image request was blocked by safety filters. Please try again.',
        attempt: 2,
        ...base
      })
    }
  } catch (err: any) {
    const msg = String(err?.message || err); const status = err?.status ?? err?.code ?? err?.response?.status
    console.error('[IMAGE]', reqId, 'FATAL', { status, msg })
    return NextResponse.json({ ok:false, message:'Image generation failed. Please try again.', detail:{status,msg}, reqId })
  }
}
