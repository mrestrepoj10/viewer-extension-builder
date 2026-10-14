import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { del, put } from '@vercel/blob'
import { parse } from 'acorn'
import { strFromU8, unzipSync } from 'fflate'

import { AGENT_MODEL } from '@/lib/agent-model'
import { buildExtensionZip, zipFileName } from '@/lib/extensions/export'
import {
  EXTENSION_ID_PATTERN,
  type ExtensionSource,
  MAIN_CSS,
  MAIN_JS,
  parseExtensionConfig,
} from '@/lib/extensions/format'
import { insertGalleryItem } from '@/lib/gallery/db'
import {
  DEFAULT_AUTHOR,
  type GalleryItem,
  type GallerySource,
  LIMITS,
  type PublishResult,
} from '@/lib/gallery/types'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const encoder = new TextEncoder()

export class PublishError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export function newGalleryId(): string {
  let id = ''
  for (let index = 0; index < 10; index++) id += BASE62[randomInt(BASE62.length)]
  return id
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function field(form: FormData, name: string, max: number, label: string): string {
  const value = form.get(name)
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > max) throw new PublishError(`${label} is longer than ${max} characters`)
  return text
}

function source(form: FormData, name: string): string | null {
  const value = form.get(name)
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw new PublishError(`${name} must be text`)
  if (encoder.encode(value).length > LIMITS.sourceBytes) {
    throw new PublishError(`${name} is over ${Math.round(LIMITS.sourceBytes / 1000)} KB`, 413)
  }
  return value
}

function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  return null
}

function syntaxError(code: string): string | null {
  try {
    parse(code, { ecmaVersion: 'latest', sourceType: 'script' })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'main.js does not parse'
  }
}

export interface PublishInput {
  title: string
  description: string
  author: string
  prompt: string | null
  source: ExtensionSource
  thumbnail: Uint8Array
  thumbnailType: string
}

export async function readPublishForm(form: FormData): Promise<PublishInput> {
  const extensionId = field(form, 'extensionId', 64, 'The extension id')
  if (!EXTENSION_ID_PATTERN.test(extensionId)) throw new PublishError('The extension id is invalid')
  const configText = source(form, 'config')
  const mainJs = source(form, 'mainJs')
  const mainCss = source(form, 'mainCss')
  if (!configText) throw new PublishError('config.json is missing')
  if (!mainJs) throw new PublishError('main.js is missing')
  const parsed = parseExtensionConfig(configText, extensionId)
  if (!parsed.config) {
    const first = parsed.problems[0]
    throw new PublishError(`config.json: ${first?.message ?? 'invalid'}`)
  }
  const problem = syntaxError(mainJs)
  if (problem) throw new PublishError(`main.js: ${problem}`)
  if (!mainJs.includes('registerExtension')) {
    throw new PublishError(`main.js never calls registerExtension('${extensionId}', ...)`)
  }
  const thumbnail = form.get('thumbnail')
  if (!(thumbnail instanceof Blob)) throw new PublishError('The thumbnail is missing')
  if (thumbnail.size > LIMITS.imageBytes) throw new PublishError('The thumbnail is over 1 MB', 413)
  const bytes = new Uint8Array(await thumbnail.arrayBuffer())
  const type = imageType(bytes)
  if (!type) throw new PublishError('The thumbnail must be a JPEG or PNG image')
  const wantsCss = parsed.config.filestoload.cssfiles.includes(MAIN_CSS)
  return {
    title: field(form, 'title', LIMITS.title, 'The title') || parsed.config.displayname,
    description:
      field(form, 'description', LIMITS.description, 'The description') ||
      parsed.config.description,
    author: field(form, 'author', LIMITS.author, 'The author name') || DEFAULT_AUTHOR,
    prompt: field(form, 'prompt', LIMITS.prompt, 'The prompt') || null,
    source: {
      id: extensionId,
      config: parsed.config,
      configText,
      mainJs,
      mainCss: wantsCss ? mainCss : null,
    },
    thumbnail: bytes,
    thumbnailType: type,
  }
}

export async function publishExtension(input: PublishInput): Promise<PublishResult> {
  const { source } = input
  const zip = buildExtensionZip(source)
  if (zip.byteLength > LIMITS.zipBytes) throw new PublishError('The zip is over 2 MB', 413)
  const id = newGalleryId()
  const editToken = randomBytes(24).toString('base64url')
  const base = `gallery/${id}`
  const folder = `${base}/${source.id}/contents`
  const options = { access: 'public', addRandomSuffix: false } as const
  const uploads = await Promise.all([
    put(`${base}/${zipFileName(source.id)}`, Buffer.from(zip), {
      ...options,
      contentType: 'application/zip',
    }),
    put(`${folder}/${MAIN_JS}`, source.mainJs, {
      ...options,
      contentType: 'text/javascript; charset=utf-8',
    }),
    source.mainCss === null
      ? null
      : put(`${folder}/${MAIN_CSS}`, source.mainCss, {
          ...options,
          contentType: 'text/css; charset=utf-8',
        }),
    put(
      `${base}/thumbnail.${input.thumbnailType === 'image/png' ? 'png' : 'jpg'}`,
      Buffer.from(input.thumbnail),
      { ...options, contentType: input.thumbnailType },
    ),
  ])
  const [files, mainJs, mainCss, thumbnail] = uploads
  try {
    await insertGalleryItem({
      id,
      title: input.title,
      description: input.description,
      author: input.author,
      extensionId: source.id,
      prompt: input.prompt,
      model: AGENT_MODEL,
      filesUrl: files.url,
      mainJsUrl: mainJs.url,
      mainCssUrl: mainCss?.url ?? null,
      config: source.config,
      thumbnailUrl: thumbnail.url,
      editTokenHash: hashToken(editToken),
    })
  } catch (error) {
    await del(uploads.filter((upload) => upload !== null).map((upload) => upload.url))
    throw error
  }
  return { id, editToken }
}

export async function deleteBlobs(item: GalleryItem): Promise<void> {
  const urls = [item.filesUrl, item.mainJsUrl, item.mainCssUrl, item.thumbnailUrl]
  await del(urls.filter((url): url is string => Boolean(url)))
}

export async function readGallerySource(item: GalleryItem): Promise<GallerySource> {
  const response = await fetch(item.filesUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error(`the zip is unavailable (${response.status})`)
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
  const read = (name: string) => {
    const bytes = files[`${item.extensionId}/${name}`]
    return bytes ? strFromU8(bytes) : null
  }
  const configText = read('config.json')
  const mainJs = read(`contents/${MAIN_JS}`)
  if (configText === null || mainJs === null) throw new Error('the zip is missing files')
  return {
    extensionId: item.extensionId,
    configText,
    mainJs,
    mainCss: read(`contents/${MAIN_CSS}`),
  }
}
