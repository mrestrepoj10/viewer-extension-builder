import { getGalleryItem } from '@/lib/gallery/db'
import { readGallerySource } from '@/lib/gallery/server'

const NO_STORE = { 'cache-control': 'no-store' }

export async function GET(
  _request: Request,
  context: RouteContext<'/api/gallery/[id]/source'>,
): Promise<Response> {
  const { id } = await context.params
  try {
    const item = await getGalleryItem(id)
    if (!item) return Response.json({ error: 'No extension with that id.' }, { status: 404 })
    return Response.json(await readGallerySource(item), { headers: NO_STORE })
  } catch (error) {
    console.error('Gallery source read failed', error)
    return Response.json(
      { error: 'The extension files could not be read. Try again.' },
      { status: 502, headers: NO_STORE },
    )
  }
}
