import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { SearchIndexClient, SearchClient, AzureKeyCredential } from '@azure/search-documents'
import { createLLM, getDeployment } from '@/lib/azure'

const endpoint = process.env.AZURE_SEARCH_ENDPOINT!
const key = process.env.AZURE_SEARCH_API_KEY!
const indexName = process.env.AZURE_SEARCH_INDEX || 'books'
const embedDim = Number(process.env.EMBED_DIM || 1536)

const indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(key))
const searchClient = new SearchClient(endpoint, indexName, new AzureKeyCredential(key))

function buildIndexSchema() {
  return {
    name: indexName,
    fields: [
      { name: 'id', type: 'Edm.String', key: true, filterable: true },
      { name: 'title', type: 'Edm.String', searchable: true, filterable: true, sortable: true },
      { name: 'summary_short', type: 'Edm.String', searchable: true },
      { name: 'summary_long', type: 'Edm.String', searchable: true },
      { name: 'themes', type: 'Collection(Edm.String)', searchable: true, filterable: true },
      { name: 'contentVector', type: 'Collection(Edm.Single)', searchable: true, vectorSearchDimensions: embedDim, vectorSearchProfileName: 'vec-profile' },
    ],
    vectorSearch: {
      algorithms: [ { name: 'hnsw-config', kind: 'hnsw', parameters: { m: 4, efConstruction: 400, metric: 'cosine' } } ],
      profiles:   [ { name: 'vec-profile', algorithmConfigurationName: 'hnsw-config' } ],
    }
  }
}

async function createOrResetIndex() {
  const schema = buildIndexSchema()
  try { await indexClient.deleteIndex(indexName) } catch {}
  await indexClient.createIndex(schema as any)
  console.log('Index created:', indexName)
}

async function embed(texts: string[]) {
  const client = createLLM()
  const model = getDeployment('embed')
  const resp = await client.embeddings.create({ model, input: texts })
  return resp.data.map(d => d.embedding)
}

async function run() {
  await createOrResetIndex()
  const file = path.join(process.cwd(), 'data', 'book_summaries.json')
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))

  const docs = raw.map((r: any) => ({
    ...r,
    content: `Title: ${r.title}
Summary: ${r.summary_short}
Themes: ${(r.themes||[]).join(', ')}`
  }))

  const embs = await embed(docs.map((d: any) => d.content))
  const toUpload = docs.map((d: any, i: number) => ({
    id: d.id,
    title: d.title,
    summary_short: d.summary_short,
    summary_long: d.summary_long,
    themes: d.themes,
    contentVector: embs[i]
  }))

  const batch = await searchClient.uploadDocuments(toUpload as any)
  const ok = batch.results.every(r => r.succeeded)
  if (!ok) throw new Error('Some documents failed to index')
  console.log('Uploaded', toUpload.length, 'docs')
}

run().catch(err => { console.error(err); process.exit(1) })