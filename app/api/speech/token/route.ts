import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const key = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION
  if (!key || !region) return NextResponse.json({ error: 'Missing speech config' }, { status: 500 })
  // Exchange key for a 10-minute auth token. Do NOT expose the key to the browser.
  const url = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`
  const res = await fetch(url, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/x-www-form-urlencoded' } })
  if (!res.ok) return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  const token = await res.text()
  return NextResponse.json({ token, region })
}