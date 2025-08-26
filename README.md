# Azure RAG Librarian

A full-stack Next.js (App Router, TypeScript, Tailwind) app that does:

- RAG over books with Azure AI Search
- Chat via Azure AI Foundry
- Speech-to-Text via microphone and Text-to-Speech playback
- Image generation for a scene/theme via DALL·E 3 on Azure Foundry
- Content moderation via Azure Content Safety


---

```

app/
  api/
    chat/route.ts         # Chat + tool calling (uses Search + Chat model + Content Safety)
    search/route.ts       # Vector search; computes query embedding; returns top matches
    image/route.ts        # DALL·E 3 image generation from user's prompt (Foundry-first)
    speech/
      token/route.ts      # Exchanges Speech key for 10-min token
  globals.css             # Implementing tailwind
  layout.tsx              # Imports globals.css for Tailwind
  page.tsx                # UI: input, Ask, Voice, Listen, Generate image
data/
  book_summaries.json     # Sample dataset (title, themes, summaries)
lib/
  azure.ts                # createLLM(), getDeployment(), createSearchClients()
  search.ts               # vectorSearchWithVector(), getLongSummaryByTitle()
scripts/
  seed.ts                 # Create index, embed, and upload docs to Azure AI Search

```

#### Prerequisites

- Azure AI Foundry. Deploy Chat (e.g., gpt-4o-mini), Embeddings (e.g., text-embedding-3-small), and Images (dall-e-3)
- Azure AI Content Safety, Azure AI Search, Azure Speech


#### Environment variables

```

AZURE_AIFOUNDRY_ENDPOINT
AZURE_AIFOUNDRY_API_KEY
AZURE_AIFOUNDRY_API_VERSION=2024-10-21
AZURE_AIFOUNDRY_DEPLOYMENT_CHAT=gpt-4o-mini
AZURE_AIFOUNDRY_DEPLOYMENT_EMBED=text-embedding-3-small

AZURE_AIFOUNDRY_ENDPOINT_3=<dall-e-3 endpoint>
AZURE_AIFOUNDRY_API_KEY_3=<dall-e-3 api key>
AZURE_AIFOUNDRY_DEPLOYMENT_IMAGE=dall-e-3
IMAGE_SIZE=1792x1024

AZURE_SEARCH_ENDPOINT
AZURE_SEARCH_API_KEY
AZURE_SEARCH_INDEX=books
EMBED_DIM=1536

AZURE_SPEECH_KEY
AZURE_SPEECH_REGION=westeurope

CONTENT_SAFETY_ENDPOINT
CONTENT_SAFETY_KEY
  
```

#### Install & run (local)

```
npm i
npm run seed # creates index + uploads docs to Azure AI Search
npm run dev  # http://localhost:3000
```


#### UI usage

- Ask: Type a query or press Enter (input handler triggers doChat()).
- 🎙 Voice: click to start/stop mic. Continuous recognition shows partial text; on first final result it auto-submits to chat.
- 🔊 Listen: TTS for the answer (Speech SDK).
- 🖼️ Scene/Theme: uses your original prompt to produce a scene/theme image via DALL·E 3 (Foundry).


For now, you can find the application deployed here: https://azure-rag-llm.vercel.app/.
