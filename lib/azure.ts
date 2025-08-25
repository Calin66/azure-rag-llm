import { AzureOpenAI } from 'openai'
import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents'
import { BookDoc } from './search'

export function getAzureProvider() {
  return (process.env.AZURE_PROVIDER || 'openai').toLowerCase()
}

export function createLLM(type? : string) {
  const provider = getAzureProvider()
  if (provider === 'foundry') {
    if (type === 'dall-e-3') {
      const endpoint = process.env.AZURE_AIFOUNDRY_ENDPOINT_3!
      const apiKey = process.env.AZURE_AIFOUNDRY_API_KEY_3!
      const apiVersion = '2024-02-01'
      return new AzureOpenAI({ endpoint, apiKey, apiVersion })
    } else {
      const endpoint = process.env.AZURE_AIFOUNDRY_ENDPOINT!
      const apiKey = process.env.AZURE_AIFOUNDRY_API_KEY || process.env.AZURE_INFERENCE_CREDENTIAL || process.env.AZURE_OPENAI_API_KEY!
      const apiVersion = process.env.AZURE_AIFOUNDRY_API_VERSION || '2024-10-21'
      return new AzureOpenAI({ endpoint, apiKey, apiVersion })
    }
  }
  // default: Azure OpenAI classic endpoint
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT!
  const apiKey = process.env.AZURE_OPENAI_API_KEY!
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
  return new AzureOpenAI({ endpoint, apiKey, apiVersion })
}

export function getDeployment(kind: 'chat' | 'embed' | 'image') {
  const provider = (process.env.AZURE_PROVIDER || 'openai').toLowerCase()
  if (provider === 'foundry') {
    if (kind === 'chat')  return process.env.AZURE_AIFOUNDRY_DEPLOYMENT_CHAT!
    if (kind === 'embed') return process.env.AZURE_AIFOUNDRY_DEPLOYMENT_EMBED!
    return process.env.AZURE_AIFOUNDRY_DEPLOYMENT_IMAGE!
  }
  // openai branch – not used by us
  if (kind === 'chat')  return process.env.AZURE_OPENAI_DEPLOYMENT_CHAT!
  if (kind === 'embed') return process.env.AZURE_OPENAI_DEPLOYMENT_EMBED!
  return process.env.AZURE_OPENAI_DEPLOYMENT_IMAGE!
}

export function createSearchClients() {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT!
  const key = process.env.AZURE_SEARCH_API_KEY!
  return {
    search: new SearchClient<BookDoc>(endpoint, process.env.AZURE_SEARCH_INDEX!, new AzureKeyCredential(key)),
    index: new SearchIndexClient(endpoint, new AzureKeyCredential(key)),
  }
}