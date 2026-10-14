import type { ExtensionConfig } from '@/lib/extensions/format'

export interface GalleryItem {
  id: string
  title: string
  description: string
  author: string
  extensionId: string
  prompt: string | null
  model: string
  filesUrl: string
  mainJsUrl: string
  mainCssUrl: string | null
  config: ExtensionConfig
  thumbnailUrl: string
  createdAt: string
}

export interface GalleryPage {
  items: GalleryItem[]
  nextCursor: string | null
}

export interface GallerySource {
  extensionId: string
  configText: string
  mainJs: string
  mainCss: string | null
}

export interface PublishResult {
  id: string
  editToken: string
}

export const GALLERY_PAGE_SIZE = 12
export const DEFAULT_AUTHOR = 'anonymous'
export const LIMITS = {
  title: 80,
  description: 500,
  author: 40,
  prompt: 4000,
  sourceBytes: 1_500_000,
  zipBytes: 2 * 1024 * 1024,
  imageBytes: 1024 * 1024,
  requestBytes: 4 * 1024 * 1024,
} as const

export function encodeCursor(item: Pick<GalleryItem, 'createdAt' | 'id'>): string {
  return `${item.createdAt}_${item.id}`
}

export function decodeCursor(cursor: string | null | undefined): { at: string; id: string } | null {
  if (!cursor) return null
  const split = cursor.lastIndexOf('_')
  if (split < 0) return null
  const at = cursor.slice(0, split)
  const id = cursor.slice(split + 1)
  if (!/^[0-9A-Za-z]{10}$/.test(id) || Number.isNaN(Date.parse(at))) return null
  return { at, id }
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function relativeTime(iso: string, now: number): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export function loaderSnippet(item: Pick<GalleryItem, 'extensionId' | 'mainJsUrl' | 'mainCssUrl'>) {
  const css = item.mainCssUrl ? `<link rel="stylesheet" href="${item.mainCssUrl}">\n` : ''
  return `${css}<script src="${item.mainJsUrl}"></script>
<script>
  // after the viewer has started
  viewer.loadExtension('${item.extensionId}')
</script>
`
}
