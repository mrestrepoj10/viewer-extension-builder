import { galleryConfigured, listGallery } from '@/lib/gallery/db'
import { PublishError, publishExtension, readPublishForm } from '@/lib/gallery/server'
import { LIMITS } from '@/lib/gallery/types'
import { clientIp, createRateLimiter } from '@/lib/rate-limit'

const publishLimited = createRateLimiter(10, 10 * 60_000)
const NO_STORE = { 'cache-control': 'no-store' }

function failure(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE })
}

export async function GET(request: Request): Promise<Response> {
  if (!galleryConfigured()) return failure(503, 'The gallery is not configured on this server.')
  const cursor = new URL(request.url).searchParams.get('cursor')
  try {
    return Response.json(await listGallery(cursor), { headers: NO_STORE })
  } catch (error) {
    console.error('Gallery list failed', error)
    return failure(502, 'The gallery could not be read. Try again.')
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!galleryConfigured()) return failure(503, 'The gallery is not configured on this server.')
  if (publishLimited(clientIp(request.headers))) {
    return failure(429, 'Too many publishes from here. Wait a few minutes and try again.')
  }
  if (Number(request.headers.get('content-length') ?? 0) > LIMITS.requestBytes) {
    return failure(413, 'The upload is too large.')
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return failure(400, 'The upload is not valid form data.')
  }
  try {
    const result = await publishExtension(await readPublishForm(form))
    return Response.json(result, { status: 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof PublishError) return failure(error.status, error.message)
    console.error('Gallery publish failed', error)
    return failure(502, 'The extension could not be published. Try again.')
  }
}
