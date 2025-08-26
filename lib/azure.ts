import { AzureOpenAI } from 'openai'
import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents'
import { BookDoc } from './search'

export function createLLM(type? : string) {
  if (type === 'dall-e-3') {
    const endpoint = process.env.AZURE_AIFOUNDRY_ENDPOINT_3!
    const apiKey = process.env.AZURE_AIFOUNDRY_API_KEY_3!
    const apiVersion = '2024-02-01'
    return new AzureOpenAI({ endpoint, apiKey, apiVersion })
  } else {
    const endpoint = process.env.AZURE_AIFOUNDRY_ENDPOINT!
    const apiKey = process.env.AZURE_AIFOUNDRY_API_KEY!
    const apiVersion = process.env.AZURE_AIFOUNDRY_API_VERSION || '2024-10-21'
    return new AzureOpenAI({ endpoint, apiKey, apiVersion })
  }
}

export function getDeployment(kind: 'chat' | 'embed' | 'image') {
  if (kind === 'chat')  return process.env.AZURE_AIFOUNDRY_DEPLOYMENT_CHAT!
  if (kind === 'embed') return process.env.AZURE_AIFOUNDRY_DEPLOYMENT_EMBED!
  return process.env.AZURE_AIFOUNDRY_DEPLOYMENT_IMAGE!
}

export function createSearchClients() {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT!
  const key = process.env.AZURE_SEARCH_API_KEY!
  return {
    search: new SearchClient<BookDoc>(endpoint, process.env.AZURE_SEARCH_INDEX!, new AzureKeyCredential(key)),
    index: new SearchIndexClient(endpoint, new AzureKeyCredential(key)),
  }
}