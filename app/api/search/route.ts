import { NextRequest, NextResponse } from 'next/server'
import { createSearchClients } from '@/lib/azure'
import { vectorSearchWithVector } from '@/lib/search'
import { createLLM, getDeployment } from '@/lib/azure'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { q } = await req.json()
    if (!q || typeof q !== 'string') {
      return NextResponse.json({ error: 'Missing q' }, { status: 400 })
    }
    const { search } = createSearchClients()
    const llm = createLLM()
    const emb = await llm.embeddings.create({ model: getDeployment('embed'), input: q })
    if (!emb.data || !emb.data[0]?.embedding) {
      return NextResponse.json({ error: 'Embedding data not found' }, { status: 500 })
    }
    const vector = emb.data[0].embedding as number[]
    const hits = await vectorSearchWithVector(search, vector, q, 5)
    return NextResponse.json({ hits })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Search error' }, { status: 500 })
  }
}