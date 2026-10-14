import { AGENT_MODEL as ALLOWED_MODEL } from '@/lib/agent-model'

const GATEWAY_ORIGIN = 'https://ai-gateway.vercel.sh'
const ALLOWED_ROUTES = new Map([
  ['/coding-agent/v1/models', 'GET'],
  ['/v4/ai/language-model', 'POST'],
])
const CATALOG_PATH = '/coding-agent/v1/models'
const CATALOG_TTL_MS = 10 * 60_000
const SESSION_HEADERS = ['x-session-affinity', 'x-session-id']
const SESSION_VALUE = /^[A-Za-z0-9_.:-]{1,128}$/
const MAX_BODY_BYTES = 1_048_576
const UPSTREAM_TIMEOUT_MS = 120_000
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const RESPONSE_HEADERS = [
  'content-type',
  'x-vercel-id',
  'x-generation-id',
  'x-model-id',
  'x-vercel-ai-gateway-provider',
]

export type GatewayErrorType =
  | 'not-found'
  | 'not-configured'
  | 'rate-limited'
  | 'too-large'
  | 'invalid-request'
  | 'model-not-allowed'
  | 'upstream-error'

const buckets = new Map<string, { count: number; resetAt: number }>()

interface CachedCatalog {
  body: ArrayBuffer
  contentType: string
  expiresAt: number
}

let catalog: CachedCatalog | null = null
let catalogRequest: Promise<CachedCatalog | null> | null = null

function catalogResponse(cached: CachedCatalog): Response {
  return new Response(cached.body.slice(0), {
    status: 200,
    headers: { 'content-type': cached.contentType, 'cache-control': 'no-store' },
  })
}

async function fetchCatalog(headers: Headers, signal: AbortSignal): Promise<CachedCatalog | null> {
  const upstream = await fetch(`${GATEWAY_ORIGIN}${CATALOG_PATH}`, {
    headers,
    redirect: 'error',
    signal,
  })
  if (!upstream.ok) {
    await upstream.body?.cancel()
    return null
  }
  return {
    body: await upstream.arrayBuffer(),
    contentType: upstream.headers.get('content-type') ?? 'application/json',
    expiresAt: Date.now() + CATALOG_TTL_MS,
  }
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  if (buckets.size > 10_000) {
    for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key)
  }
  const bucket = buckets.get(ip)
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT
}

function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    'local'
  )
}

function gatewayError(status: number, type: GatewayErrorType, message: string): Response {
  return Response.json(
    { error: { type, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}

async function readBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return null
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function requestedModel(body: Uint8Array): string | null | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
    if (!parsed || typeof parsed !== 'object') return undefined
    const model = (parsed as { model?: unknown }).model
    if (model === undefined) return null
    return typeof model === 'string' ? model : undefined
  } catch {
    return undefined
  }
}

async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params
  const pathname = `/${path.join('/')}`
  if (ALLOWED_ROUTES.get(pathname) !== request.method || new URL(request.url).search) {
    return gatewayError(404, 'not-found', 'This model endpoint is not available.')
  }
  const key = process.env.AI_GATEWAY_API_KEY
  if (!key) {
    return gatewayError(503, 'not-configured', 'The AI agent is not configured on this server.')
  }
  if (request.method === 'GET' && catalog && catalog.expiresAt > Date.now()) {
    return catalogResponse(catalog)
  }
  if (rateLimited(clientIp(request.headers))) {
    return gatewayError(429, 'rate-limited', 'Too many requests. Wait a minute and try again.')
  }

  let body: Uint8Array<ArrayBuffer> | undefined
  if (request.method === 'POST') {
    const raw = await readBody(request)
    if (!raw) {
      return gatewayError(413, 'too-large', 'This conversation is too long. Start a new one.')
    }
    const headerModel = request.headers.get('ai-language-model-id')
    const bodyModel = requestedModel(raw)
    if (bodyModel === undefined) {
      return gatewayError(400, 'invalid-request', 'The model request is not valid JSON.')
    }
    const models = [headerModel, bodyModel].filter((model) => model !== null)
    if (models.length === 0 || models.some((model) => model !== ALLOWED_MODEL)) {
      return gatewayError(
        400,
        'model-not-allowed',
        `Only ${ALLOWED_MODEL} is available through this server.`,
      )
    }
    body = raw
  }

  const headers = new Headers()
  for (const [name, value] of request.headers) {
    if (name.startsWith('ai-') || name === 'content-type' || name === 'accept') {
      headers.set(name, value)
    }
  }
  for (const name of SESSION_HEADERS) {
    const value = request.headers.get(name)
    if (value && SESSION_VALUE.test(value)) headers.set(name, value)
  }
  headers.set('authorization', `Bearer ${key}`)
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)])

  if (pathname === CATALOG_PATH) {
    try {
      catalogRequest ??= fetchCatalog(headers, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)).finally(
        () => {
          catalogRequest = null
        },
      )
      const fresh = await catalogRequest
      if (fresh) {
        catalog = fresh
        return catalogResponse(fresh)
      }
    } catch (error) {
      console.error('AI Gateway model catalog request failed', error)
    }
    return gatewayError(502, 'upstream-error', 'The model service did not respond. Try again.')
  }

  try {
    const upstream = await fetch(`${GATEWAY_ORIGIN}${pathname}`, {
      method: request.method,
      headers,
      body,
      redirect: 'error',
      signal,
    })
    const out = new Headers({ 'cache-control': 'no-store' })
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) out.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers: out })
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 })
    console.error('AI Gateway request failed', error)
    return gatewayError(502, 'upstream-error', 'The model service did not respond. Try again.')
  }
}

export { handle as GET, handle as POST }
