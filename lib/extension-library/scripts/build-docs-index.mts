// Offline index of the Viewer v7 and Data Visualization docs, built with the
// APS docs-portal method: TOC JSON from developer.doc.config.autodesk.com,
// page HTML from developer.doc.autodesk.com, never aps.autodesk.com.
//
//   node lib/extension-library/scripts/build-docs-index.mts
//
// DOCS_CACHE_DIR=<dir> keeps the raw HTML between runs. Output is sorted and
// free of timestamps, so a re-run against unchanged docs is byte-identical.
// It finishes by regenerating the workspace modules (build-workspace-files.mts).

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const VOID = new Set(['br', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr', 'col'])
const DROP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'button'])
const DROP_CLASSES = [
  'clipboard-container',
  'headerlink',
  'snippet-toggle',
  'table-collapser-toggle',
  'text-required',
]
const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'section',
  'table',
  'tbody',
  'thead',
  'ul',
])

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  times: '\u00d7',
  larr: '\u2190',
  rarr: '\u2192',
  laquo: '\u00ab',
  raquo: '\u00bb',
  bull: '\u2022',
  middot: '\u00b7',
  deg: '\u00b0',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const hex = name[1] === 'x' || name[1] === 'X'
        const code = hex ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
    .replace(/\u00a0/g, ' ')
}

interface Frame {
  tag: string
  drop: boolean
  typeMark?: number
  ordered?: boolean
  index?: number
}

function classes(attrs: string): string[] {
  const match = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs)
  return (match ? (match[2] ?? match[3] ?? '') : '').split(/\s+/).filter(Boolean)
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const isHeading = (tag: string) => /^h[1-6]$/.test(tag)
const isList = (tag: string) => tag === 'ul' || tag === 'ol'

/**
 * A small, dependency-free HTML-to-text pass tuned for the APS docs pages:
 * headings become `#` lines, lists `-`/`1.` items, `<pre>` fenced blocks and
 * each table row one `a | b | c` line (nested parameter rows are indented).
 */
function htmlToText(html: string): string {
  const lines: string[] = []
  const stack: Frame[] = []
  let inline = ''
  let prefix = ''
  let pre: string | null = null
  let cell: string | null = null
  let row: string[] | null = null
  let rowIndent = ''
  let dropDepth = 0

  const blank = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
  }
  const flush = () => {
    const text = collapse(inline)
    if (text) lines.push(prefix + text)
    inline = ''
    prefix = ''
  }
  const listDepth = () => stack.filter((frame) => isList(frame.tag)).length
  const closeCell = () => {
    if (cell === null || row === null) return
    row.push(collapse(cell))
    cell = null
  }
  const closeRow = () => {
    closeCell()
    if (row === null) return
    const cells = row.filter((value) => value !== '')
    if (cells.length > 0) lines.push(rowIndent + cells.join(' | '))
    row = null
  }
  const append = (text: string) => {
    if (pre !== null) pre += text
    else if (cell !== null) cell += text
    else inline += text
  }

  const openFrame = (frame: Frame, names: readonly string[]) => {
    const { tag } = frame
    if (tag === 'pre') {
      if (cell === null) flush()
      pre = ''
      return
    }
    if (tag === 'tr') {
      if (cell === null) flush()
      closeRow()
      const level = /level--(\d+)/.exec(names.join(' '))
      rowIndent = level ? '  '.repeat(Math.max(0, Number(level[1]) - 1)) : ''
      row = []
      return
    }
    if (tag === 'td' || tag === 'th') {
      if (row === null) {
        flush()
        row = []
        rowIndent = ''
      }
      closeCell()
      cell = ''
      return
    }
    if (tag === 'code') {
      append('`')
      return
    }
    if (cell !== null) {
      if (names.includes('type')) {
        frame.typeMark = cell.length
        append(' ')
      } else if (BLOCK.has(tag) || isHeading(tag)) {
        append(' ')
      }
      return
    }
    if (isHeading(tag)) {
      flush()
      blank()
      prefix = `${'#'.repeat(Number(tag[1]))} `
      return
    }
    if (isList(tag)) {
      flush()
      frame.ordered = tag === 'ol'
      frame.index = 0
      return
    }
    if (tag === 'li') {
      flush()
      const list = [...stack].reverse().find((item) => isList(item.tag))
      const indent = '  '.repeat(Math.max(0, listDepth() - 1))
      if (list?.ordered) {
        list.index = (list.index ?? 0) + 1
        prefix = `${indent}${list.index}. `
      } else {
        prefix = `${indent}- `
      }
      return
    }
    if (tag === 'p' || tag === 'table' || tag === 'dl') {
      flush()
      if (tag !== 'p' || listDepth() === 0) blank()
      return
    }
    if (BLOCK.has(tag)) flush()
  }

  const closeFrame = (frame: Frame) => {
    const { tag } = frame
    if (tag === 'pre') {
      const body = (pre ?? '').replace(/^\n+|\s+$/g, '')
      pre = null
      if (cell !== null) {
        cell += ` ${collapse(body)} `
        return
      }
      if (body) {
        blank()
        lines.push('```', ...body.split('\n').map((line) => line.replace(/\s+$/, '')), '```', '')
      }
      return
    }
    if (pre !== null) return
    if (tag === 'code') {
      append('`')
      return
    }
    if (tag === 'td' || tag === 'th') {
      closeCell()
      return
    }
    if (tag === 'tr') {
      closeRow()
      return
    }
    if (cell !== null) {
      if (frame.typeMark !== undefined) {
        const head = cell.slice(0, frame.typeMark)
        const type = collapse(cell.slice(frame.typeMark))
        cell = type ? `${head} (${type}) ` : head
      } else if (BLOCK.has(tag) || isHeading(tag)) {
        append(' ')
      }
      return
    }
    if (tag === 'table') {
      closeRow()
      blank()
      return
    }
    if (isHeading(tag)) {
      flush()
      lines.push('')
      return
    }
    if (tag === 'p') {
      flush()
      if (listDepth() === 0) lines.push('')
      return
    }
    if (isList(tag)) {
      flush()
      if (listDepth() === 0) blank()
      return
    }
    if (BLOCK.has(tag)) flush()
  }

  const onOpen = (tag: string, attrs: string, selfClosing: boolean) => {
    const names = classes(attrs)
    const drop = DROP_TAGS.has(tag) || names.some((name) => DROP_CLASSES.includes(name))
    if (dropDepth > 0 || drop) {
      if (!VOID.has(tag) && !selfClosing) {
        stack.push({ tag, drop: true })
        dropDepth += 1
      }
      return
    }
    if (tag === 'br') {
      append(pre !== null ? '\n' : ' ')
      return
    }
    if (VOID.has(tag) || selfClosing) return
    const frame: Frame = { tag, drop: false }
    stack.push(frame)
    if (pre === null) openFrame(frame, names)
  }

  const onClose = (tag: string) => {
    const at = stack.findLastIndex((frame) => frame.tag === tag)
    if (at < 0) return
    while (stack.length > at) {
      const frame = stack.pop() as Frame
      if (frame.drop) {
        dropDepth -= 1
        continue
      }
      if (dropDepth === 0) closeFrame(frame)
    }
  }

  const token =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+|<)/gi
  for (const match of html.matchAll(token)) {
    const [, closing, rawTag, attrs = '', text] = match
    if (text !== undefined) {
      if (dropDepth === 0) append(decodeEntities(text))
      continue
    }
    if (!rawTag) continue
    const tag = rawTag.toLowerCase()
    if (closing) onClose(tag)
    else onOpen(tag, attrs, /\/\s*$/.test(attrs))
  }
  closeRow()
  flush()
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

const SLUG = 'bPlouYTd'
const TOC_BASE = `https://developer.doc.config.autodesk.com/${SLUG}`
const PAGE_BASE = `https://developer.doc.autodesk.com/${SLUG}`
const OUT_DIR = join(import.meta.dirname, '..', 'docs')
const MAX_BYTES = 4_000_000
const CONCURRENCY = 6

interface Source {
  id: string
  dir: string
  include: RegExp
}

const SOURCES: readonly Source[] = [
  { id: 'viewer_v7', dir: 'viewer', include: /^(developers_guide|reference)\// },
  { id: 'dataviz_v1', dir: 'dataviz', include: /^(developers_guide|reference)\// },
]

interface TocNode {
  url_path?: string
  display_name?: string
  source?: string
  children?: TocNode[]
}

interface TocRoot extends TocNode {
  doc_version: string
}

interface Page {
  path: string
  title: string
  url: string
  source: string
}

function flatten(source: Source, root: TocRoot): Page[] {
  const api = root.url_path ?? ''
  const pages: Page[] = []
  const walk = (node: TocNode, segments: string[], titles: string[]) => {
    const here = node.url_path ? [...segments, node.url_path] : segments
    const names = node.display_name ? [...titles, node.display_name] : titles
    const rel = here.join('/')
    if (node.source && source.include.test(`${rel}/`)) {
      const safe = here.map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, '_'))
      pages.push({
        path: `${source.dir}/${safe.join('/')}.txt`,
        title: names.join(' > '),
        url: `https://aps.autodesk.com/en/docs/${api}/${root.doc_version}/${rel}/`,
        source: node.source,
      })
    }
    for (const child of node.children ?? []) walk(child, here, names)
  }
  for (const child of root.children ?? []) walk(child, [], [])
  return pages
}

async function fetchText(url: string): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const body = await response.text()
      if (body.startsWith('<?xml') && body.includes('<Error>'))
        throw new Error('CDN error document')
      return body
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw new Error(`${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function pageHtml(source: string): Promise<string> {
  const cacheDir = process.env.DOCS_CACHE_DIR
  const cached = cacheDir ? join(cacheDir, source) : undefined
  if (cached) {
    try {
      return await readFile(cached, 'utf8')
    } catch {}
  }
  const html = await fetchText(`${PAGE_BASE}/${source}`)
  if (cached) {
    await mkdir(dirname(cached), { recursive: true })
    await writeFile(cached, html)
  }
  return html
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Keeps each member's heading, first paragraph and signature rows. */
function trimReference(body: string): string {
  const out: string[] = []
  let paragraphs = 0
  for (const block of body.split(/\n{2,}/)) {
    if (/^#{1,6} /.test(block)) {
      paragraphs = 0
      out.push(block)
    } else if (block.startsWith('```') || /^\S+\*? \(.*\) \|/m.test(block)) {
      out.push(block)
    } else if (paragraphs++ === 0) {
      out.push(block)
    }
  }
  return `${out.join('\n\n')}\n`
}

function render(page: Page, body: string): string {
  return `${page.url}\n${page.title}\n\n${body}`
}

async function main() {
  const pages: Page[] = []
  for (const source of SOURCES) {
    const toc = JSON.parse(await fetchText(`${TOC_BASE}/${source.id}.json`)) as TocRoot
    pages.push(...flatten(source, toc))
  }
  pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const seen = new Set<string>()
  for (const page of pages) {
    if (seen.has(page.path)) throw new Error(`duplicate docs path ${page.path}`)
    seen.add(page.path)
  }

  const bodies = await mapLimit(pages, CONCURRENCY, async (page) =>
    htmlToText(await pageHtml(page.source)),
  )
  let files = pages.map((page, index) => render(page, bodies[index]))
  const total = () => files.reduce((sum, text) => sum + Buffer.byteLength(text), 0)
  let trimmed = false
  if (total() > MAX_BYTES) {
    trimmed = true
    files = pages.map((page, index) =>
      page.path.includes('/reference/') ? render(page, trimReference(bodies[index])) : files[index],
    )
  }

  await rm(OUT_DIR, { recursive: true, force: true })
  for (const [index, page] of pages.entries()) {
    const file = join(OUT_DIR, page.path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, files[index])
  }
  const index = pages.map((page) => `/docs/${page.path}\t${page.title}\t${page.url}`).join('\n')
  await writeFile(join(OUT_DIR, 'INDEX.txt'), `${index}\n`)

  const sections = new Map<string, { count: number; bytes: number }>()
  for (const [i, page] of pages.entries()) {
    const key = page.path.split('/').slice(0, 2).join('/')
    const entry = sections.get(key) ?? { count: 0, bytes: 0 }
    entry.count += 1
    entry.bytes += Buffer.byteLength(files[i])
    sections.set(key, entry)
  }
  for (const [key, { count, bytes }] of [...sections].sort()) {
    console.log(`${key}\t${count} pages\t${(bytes / 1024).toFixed(0)} KB`)
  }
  console.log(
    `total\t${pages.length} pages\t${(total() / 1024).toFixed(0)} KB${trimmed ? ' (reference pages trimmed)' : ''}`,
  )
  execFileSync(process.execPath, [join(import.meta.dirname, 'build-workspace-files.mts')], {
    stdio: 'inherit',
  })
}

await main()
