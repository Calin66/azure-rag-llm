// app/api/image/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createLLM, getDeployment } from '@/lib/azure'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Payload = {
  query: string                 // <-- user's original input (q)
  kind?: 'scene' | 'theme'
  style?: 'illustration' | 'digital' | 'oil' | 'watercolor' | 'photoreal' | 'pixel'
}

const SIZE = process.env.IMAGE_SIZE || '1024x1024' // portrait for DALL·E 3 on Foundry

// Minimal IP blocklist; expand as needed
const IP_BLOCKLIST = [
  'hobbit','hobbits','shire','tolkien','lord of the rings','middle-earth',
  'harry potter','hogwarts','jk rowling','star wars','jedi','sith','stormtrooper',
  'marvel','dc comics','batman','superman','dune','arrakis','pokemon','disney','pixar',
]

function stripIP(s?: string) {
  if (!s) return ''
  let out = s
  for (const t of IP_BLOCKLIST) out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '')
  // also strip quotes and extra whitespace
  out = out.replace(/["“”‘’]+/g, '').replace(/\s+/g, ' ')
  return out.trim()
}

// Cheap theme guesser from the query (purely heuristic)
function guessThemes(q: string) {
  const t = q.toLowerCase()
  const out = new Set<string>()
  if (/(adventure|journey|quest)/.test(t)) out.add('adventure')
  if (/(friend|companionship|fellowship|team)/.test(t)) out.add('friendship')
  if (/(fantasy|magic|elves|dragons|wizard)/.test(t)) out.add('fantasy')
  if (/(mystery|detective|crime|whodunit)/.test(t)) out.add('mystery')
  if (/(dystopia|totalitarian|surveillance)/.test(t)) out.add('dystopia')
  if (/(romance|love|relationship)/.test(t)) out.add('romance')
  if (/(courage|bravery|hero|heroine)/.test(t)) out.add('courage')
  if (out.size === 0) out.add('literary') // safe default
  return Array.from(out)
}

// 1) Specific (still genericized) – based on user query
function promptFromUserQuery(p: Payload) {
  const q = stripIP(p.query || '')
  const themes = guessThemes(q).join(', ')
  const mode =
    p.kind === 'scene' ? 'Create a cinematic illustration of a key scene inspired by the request.' : 'Create a symbolic illustration that embodies the main themes of the request.'
  return [
    mode,
    q ? `Inspiration from the user request (paraphrased): ${q}.` : '',
    `Reflect these safe themes: ${themes}.`,
    `Style: ${p.style || 'illustration'}, richly textured, soft cinematic lighting.`,
    'Composition: single clear focal point, clean background, tasteful negative space.',
    'Do not include any text, logos, brand iconography, or recognizable copyrighted characters.',
    'Family-friendly, non-violent, non-sexual.',
  ].filter(Boolean).join(' ')
}

// 2) Softer generic fallback (no explicit echo of the query text)
function promptGenericSoft(p: Payload) {
  const themes = guessThemes(p.query || '').join(', ')
  const mode =
    p.kind === 'scene' ? 'Create a cinematic illustration of a serene, family-friendly scene.' :
    p.kind === 'theme' ? 'Create a symbolic illustration emphasizing universal literary themes.' :
                         'Design a suggestive BOOK COVER style illustration (portrait).'
  return [
    mode,
    themes ? `Key themes: ${themes}.` : 'Key themes: wonder, journey, companionship.',
    'Atmosphere: uplifting, inviting, imaginative.',
    `Style: ${p.style || 'illustration'}, richly textured, soft cinematic lighting.`,
    'Composition: single clear focal point, clean background, tasteful negative space.',
    'No text, no logos, no brand iconography, no real people.',
  ].join(' ')
}

function isBlocked(msg: string) {
  return /blocked|policy|safety|unsafe|violation/i.test(msg)
}

async function dalleB64(model: string, prompt: string, size: string) {
  const client = createLLM('dall-e-3')
  const result = await client.images.generate({
    model,
    prompt,
    size,                 // DALL·E 3 on Foundry: 1024x1024 | 1024x1792 | 1792x1024
    quality: 'hd',
    n: 1,
    response_format: 'b64_json',
  } as any)
  const b64 = (result as any)?.data?.[0]?.b64_json
  if (!b64) throw new Error('No image data returned')
  return `data:image/png;base64,${b64}`
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Payload
  const model = getDeployment('image')
  const base = { size: SIZE, model }

  try {
    if (!body?.query || !body.query.trim()) throw new Error('Missing "query"')

    // Attempt 1: specific-from-query
    try {
      const p1 = promptFromUserQuery(body)
      const img1 = await dalleB64(model, p1, SIZE)
      return NextResponse.json({ ok: true, image: img1, promptUsed: p1, ...base })
    } catch (e: any) {
      if (!isBlocked(String(e?.message || ''))) throw e
      // fall through
    }


    const p2 = promptGenericSoft(body)
    const img2 = await dalleB64(model, p2, SIZE)
    return NextResponse.json({ ok: true, image: img2, promptUsed: p2, note: 'generic-soft', ...base })
    
  } catch (err: any) {
    // Last resort: still return 200 with no "error" field to keep UI clean
    return NextResponse.json({ ok: false, image: null, promptUsed: 'none', ...base })
  }
}
