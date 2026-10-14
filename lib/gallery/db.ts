import { neon } from '@neondatabase/serverless'

import type { ExtensionConfig } from '@/lib/extensions/format'
import {
  decodeCursor,
  encodeCursor,
  GALLERY_PAGE_SIZE,
  type GalleryItem,
  type GalleryPage,
} from '@/lib/gallery/types'

export class GalleryUnavailableError extends Error {}

type Sql = ReturnType<typeof neon>

let client: Sql | null = null

function sql(): Sql {
  if (client) return client
  const url = process.env.DATABASE_URL
  if (!url) throw new GalleryUnavailableError('DATABASE_URL is not set')
  client = neon(url, { fetchOptions: { cache: 'no-store' } })
  return client
}

export function galleryConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.BLOB_READ_WRITE_TOKEN)
}

const COLUMNS = `id, title, description, author, extension_id, prompt, model, files_url, main_js_url,
  main_css_url, config_json, thumbnail_url, created_at`

type Row = Record<string, unknown>

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(text(value))
  return date.toISOString()
}

function toItem(row: Row): GalleryItem {
  return {
    id: text(row.id),
    title: text(row.title),
    description: text(row.description),
    author: text(row.author),
    extensionId: text(row.extension_id),
    prompt: typeof row.prompt === 'string' && row.prompt ? row.prompt : null,
    model: text(row.model),
    filesUrl: text(row.files_url),
    mainJsUrl: text(row.main_js_url),
    mainCssUrl: typeof row.main_css_url === 'string' ? row.main_css_url : null,
    config: row.config_json as ExtensionConfig,
    thumbnailUrl: text(row.thumbnail_url),
    createdAt: iso(row.created_at),
  }
}

async function rows(query: string, params: unknown[]): Promise<Row[]> {
  const result: unknown = await sql().query(query, params)
  return Array.isArray(result) ? (result as Row[]) : []
}

export async function listGallery(
  cursor?: string | null,
  limit = GALLERY_PAGE_SIZE,
): Promise<GalleryPage> {
  const after = decodeCursor(cursor)
  const found = after
    ? await rows(
        `select ${COLUMNS} from extensions where (created_at, id) < ($1::timestamptz, $2)
         order by created_at desc, id desc limit $3`,
        [after.at, after.id, limit + 1],
      )
    : await rows(`select ${COLUMNS} from extensions order by created_at desc, id desc limit $1`, [
        limit + 1,
      ])
  const items = found.slice(0, limit).map(toItem)
  const last = items.at(-1)
  return { items, nextCursor: found.length > limit && last ? encodeCursor(last) : null }
}

export async function getGalleryItem(id: string): Promise<GalleryItem | null> {
  if (!/^[0-9A-Za-z]{10}$/.test(id)) return null
  const [row] = await rows(`select ${COLUMNS} from extensions where id = $1`, [id])
  return row ? toItem(row) : null
}

export async function getEditTokenHash(id: string): Promise<string | null> {
  const [row] = await rows('select edit_token_hash from extensions where id = $1', [id])
  return row ? text(row.edit_token_hash) : null
}

export interface NewGalleryRow {
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
  editTokenHash: string
}

export async function insertGalleryItem(row: NewGalleryRow): Promise<void> {
  await sql().query(
    `insert into extensions (id, title, description, author, extension_id, prompt, model, files_url,
       main_js_url, main_css_url, config_json, thumbnail_url, edit_token_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
    [
      row.id,
      row.title,
      row.description,
      row.author,
      row.extensionId,
      row.prompt,
      row.model,
      row.filesUrl,
      row.mainJsUrl,
      row.mainCssUrl,
      JSON.stringify(row.config),
      row.thumbnailUrl,
      row.editTokenHash,
    ],
  )
}

export async function deleteGalleryItem(id: string): Promise<void> {
  await sql().query('delete from extensions where id = $1', [id])
}
