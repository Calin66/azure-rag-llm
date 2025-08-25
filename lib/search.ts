import { SearchClient } from '@azure/search-documents'

export type BookDoc = { id: string; title: string; summary_short: string; summary_long: string; themes: string[]; contentVector: number[] }

export async function vectorSearchWithVector(client: SearchClient<BookDoc>, queryVector: number[], queryText: string, k: number = 5) {
  const results = await client.search(queryText || '*', {
    vectorSearchOptions: { queries: [{ kind: 'vector', vector: queryVector, fields: ['contentVector'], kNearestNeighborsCount: k }] },
    searchFields: ['title', 'summary_short', 'themes'],
    select: ['id', 'title', 'summary_short', 'themes'],
    top: k,
  })
  const out: BookDoc[] = []
  for await (const r of results.results) out.push(r.document as BookDoc)
  return out
}

export async function getLongSummaryByTitle(client: SearchClient<BookDoc>, title: string) {
  const results = await client.search(`\"${title}\"`, { searchFields: ['title'], select: ['id', 'title', 'summary_long'], top: 1 })
  for await (const r of results.results) return (r.document as BookDoc).summary_long
  return 'No detailed summary found for this title.'
}