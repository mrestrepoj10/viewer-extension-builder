import { deleteGalleryItem, getEditTokenHash, getGalleryItem } from '@/lib/gallery/db'
import { deleteBlobs, tokenMatches } from '@/lib/gallery/server'
import { clientIp, createRateLimiter } from '@/lib/rate-limit'

const deleteLimited = createRateLimiter(30, 10 * 60_000)
const NO_STORE = { 'cache-control': 'no-store' }

function failure(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE })
}

export async function GET(
  _request: Request,
  context: RouteContext<'/api/gallery/[id]'>,
): Promise<Response> {
  const { id } = await context.params
  try {
    const item = await getGalleryItem(id)
    if (!item) return failure(404, 'No extension with that id.')
    return Response.json(item, { headers: NO_STORE })
  } catch (error) {
    console.error('Gallery read failed', error)
    return failure(502, 'The gallery could not be read. Try again.')
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext<'/api/gallery/[id]'>,
): Promise<Response> {
  if (deleteLimited(clientIp(request.headers))) {
    return failure(429, 'Too many requests. Wait a few minutes and try again.')
  }
  const { id } = await context.params
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return failure(401, 'The edit token is missing.')
  try {
    const item = await getGalleryItem(id)
    const hash = item ? await getEditTokenHash(id) : null
    if (!item || !hash) return failure(404, 'No extension with that id.')
    if (!tokenMatches(token, hash)) return failure(403, 'The edit token does not match.')
    await deleteGalleryItem(id)
    await deleteBlobs(item)
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (error) {
    console.error('Gallery delete failed', error)
    return failure(502, 'The extension could not be deleted. Try again.')
  }
}
