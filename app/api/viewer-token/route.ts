import { APS_BASE_URL, type TokenSource } from 'aec-auth'
import { apsOAuth, memoryVaultStore, vaultTokenSource } from 'aec-auth/vault'
import { connection } from 'next/server'

const VIEWER_SCOPES = ['viewables:read'] as const
const tokenSources = new Map<string, TokenSource>()

// Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every deployment, so a one-click
// deploy has a trusted origin before its owner knows the URL.
function deploymentOrigin(): string | undefined {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return vercel ? `https://${vercel}` : undefined
}

function apiBase(origin: string): string {
  const configured = process.env.APS_AUTH_BASE_URL
  if (!configured) return APS_BASE_URL
  if (!configured.startsWith('/')) return configured
  const trusted = deploymentOrigin()
  if (!trusted && process.env.NODE_ENV === 'production') {
    throw new Error('APP_ORIGIN is required with a relative APS_AUTH_BASE_URL in production')
  }
  return `${trusted ? new URL(trusted).origin : origin}${configured}`
}

function getViewerTokenSource(base: string): TokenSource {
  const existing = tokenSources.get(base)
  if (existing) return existing
  const clientId = process.env.APS_CLIENT_ID
  const clientSecret = process.env.APS_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('APS viewer credentials are not configured')
  const source = vaultTokenSource({
    store: memoryVaultStore(),
    providers: {
      aps: apsOAuth({ clientId, clientSecret, baseUrl: base === APS_BASE_URL ? undefined : base }),
    },
  })
  tokenSources.set(base, source)
  return source
}

/** A 2-legged viewer token with the minimum Model Derivative read scope. */
export async function GET(request: Request): Promise<Response> {
  await connection()
  try {
    const base = apiBase(new URL(request.url).origin)
    const token = await getViewerTokenSource(base).getToken({
      provider: 'aps',
      subject: { type: 'app' },
      scopes: VIEWER_SCOPES,
      forceRefresh: true,
    })
    return Response.json(
      {
        accessToken: token.token,
        expiresInSeconds: Math.max(1, Math.floor((token.expiresAt - Date.now()) / 1000)),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('Viewer token request failed', error)
    return Response.json(
      { error: 'The viewer token is unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
