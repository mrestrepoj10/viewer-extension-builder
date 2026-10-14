import type { WorkspaceSeed } from '@/components/ui/fx-terminal/workspace'
import { extensionPaths } from '@/lib/extensions/format'
import type { GalleryItem, GallerySource } from '@/lib/gallery/types'

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return (await response.json()) as T
}

/** Fetches a published extension and lays it out as workspace files under /model/extensions. */
export async function loadRemixSeed(id: string): Promise<WorkspaceSeed> {
  try {
    const [item, source] = await Promise.all([
      json<GalleryItem>(`/api/gallery/${encodeURIComponent(id)}`),
      json<GallerySource>(`/api/gallery/${encodeURIComponent(id)}/source`),
    ])
    const paths = extensionPaths(source.extensionId)
    const files: Record<string, string> = {
      [paths.config]: source.configText,
      [paths.main]: source.mainJs,
    }
    if (source.mainCss !== null) files[paths.css] = source.mainCss
    return {
      files,
      extensionIds: [source.extensionId],
      notice: `Remix of "${item.title}" by ${item.author} from the gallery: its folder is ${paths.dir}/. ext load ${source.extensionId} runs it as published; edit it from there.`,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      files: {},
      extensionIds: [],
      notice: `The gallery remix ${id} could not be fetched (${reason}); the workspace starts without it.`,
    }
  }
}
