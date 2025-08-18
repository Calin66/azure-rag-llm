import { NextRequest, NextResponse } from 'next/server'
import { createLLM, getDeployment, createSearchClients } from '@/lib/azure'
import { getLongSummaryByTitle, vectorSearchWithVector } from '@/lib/search'
import createClient from '@azure-rest/ai-content-safety'
import { AzureKeyCredential } from '@azure/core-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT =
  'You are Smart Librarian: a precise, friendly book recommender.\n\n' +
  'Given the retrieved CONTEXT, do the following:\n' +
  '1) Pick exactly ONE book title from the CONTEXT (best thematic match).\n' +
  '2) Explain briefly (2–4 sentences) why it fits the request.\n' +
  '3) THEN, CALL the function get_summary_by_title with the exact title you chose.\n' +
  'Rules:\n- Only choose a title that appears in the CONTEXT.\n- If the request is vague, ask one clarifying question, but still propose a best guess.\n- Keep the recommendation concise; the tool output will provide the long summary.'

async function moderate(text: string) {
  const endpoint = process.env.CONTENT_SAFETY_ENDPOINT
  const key = process.env.CONTENT_SAFETY_KEY
  if (!endpoint || !key) return { allowed: true }
  const client = createClient(endpoint, new AzureKeyCredential(key))
  const res = await client.path('/contentsafety/text:analyze').post({
    body: { text, categories: ['Hate', 'SelfHarm', 'Sexual', 'Violence'], outputType: 'FourSeverityLevels' }
  })
  if (res.status !== '200') return { allowed: true }
  const d: any = res.body
  const max = Math.max(d?.hateResult?.severity||0, d?.selfHarmResult?.severity||0, d?.sexualResult?.severity||0, d?.violenceResult?.severity||0)
  return { allowed: max < 3 }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const q: string = body?.q || ''

    const mod = await moderate(q)
    if (!mod.allowed) return NextResponse.json({ error: 'Request blocked by content safety.' }, { status: 400 })

    const { search } = createSearchClients()
    const llm = createLLM()

    // RAG: embed query then vector KNN in Azure Search
    const emb = await llm.embeddings.create({ model: getDeployment('embed'), input: q })
    const vector = emb.data[0].embedding as number[]
    const hits = await vectorSearchWithVector(search, vector, q, 4)

    const context = hits
      .map((h) => ['---', `Title: ${h.title}`, `Summary: ${h.summary_short}`, `Themes: ${(h.themes ?? []).join(', ')}`].join('\n'))
      .join('\n\n');

    const tools = [
      { type: 'function', function: { name: 'get_summary_by_title', description: 'Return the detailed summary for an exact book title.', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } }
    ] as const

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: `CONTEXT:
${context}` },
      { role: 'user', content: q }
    ] as const

    const first = await llm.chat.completions.create({ model: getDeployment('chat'), messages: messages as any, tools: tools as any, tool_choice: 'auto', temperature: 0.4 })
    const msg = first.choices[0].message as any
    const toolCalls = msg.tool_calls as any[] | undefined

    if (toolCalls && toolCalls.length > 0) {
      const toolMsgs: any[] = [{ role: 'assistant', content: msg.content || '', tool_calls: toolCalls }]
      for (const tc of toolCalls) {
        if (tc.function.name === 'get_summary_by_title') {
          const args = JSON.parse(tc.function.arguments || '{}')
          const title = String(args.title || '')
          const long = await getLongSummaryByTitle(search, title)
          toolMsgs.push({ role: 'tool', tool_call_id: tc.id, content: long })
        }
      }
      const follow = await llm.chat.completions.create({ model: getDeployment('chat'), messages: [...(messages as any), ...toolMsgs], temperature: 0.4 })
      return NextResponse.json({ hits, answer: follow.choices[0].message.content })
    }

    return NextResponse.json({ hits, answer: msg.content })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Chat error' }, { status: 500 })
  }
}