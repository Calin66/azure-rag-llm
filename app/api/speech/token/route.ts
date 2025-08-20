import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const key = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION

  if (!key || !region) {
    return NextResponse.json(
      { error: 'Missing speech config (AZURE_SPEECH_KEY / AZURE_SPEECH_REGION).' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    // Exchange key -> short-lived token (~10 min)
    const url = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      cache: 'no-store',
    })

    const body = await res.text()
    if (!res.ok) {
      return NextResponse.json(
        { error: `Token exchange failed: ${res.status} ${body}` },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    return NextResponse.json(
      { token: body, region },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Speech token error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}

// (optional) allow POST to behave the same
export async function POST() {
  return GET()
}
