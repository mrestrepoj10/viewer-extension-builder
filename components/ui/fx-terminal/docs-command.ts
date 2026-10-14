import { type CommandContext, defineCommand } from 'just-bash/browser'
import type { WorkspaceExecResult } from 'libfx/browser'

type WorkspaceFs = CommandContext['fs']

export interface DocsCommandOptions {
  root: string
  indexPath: string
}

const MATCH_LIMIT = 80
const LINE_WIDTH = 200

function docsHelp(root: string, indexPath: string): string {
  return `docs searches the offline Autodesk Viewer v7 and Data Visualization docs under ${root}.

Usage
  docs grep <pattern> [--limit <n>]
      Case-insensitive regular expression over every page: matching page titles first,
      then path:line: text (default limit ${MATCH_LIMIT} lines). Exit 1 when nothing matches.
  docs show <path>
      Print one page. <path> is as listed in ${indexPath}, with or without ${root}/ and .txt.
      Line 1 of a page is its aps.autodesk.com portal URL; cite it.

${indexPath} lists every page as path, title, portal URL (tab separated).
`
}

function ok(stdout: string, exitCode = 0): WorkspaceExecResult {
  return { stdout: stdout.endsWith('\n') ? stdout : `${stdout}\n`, stderr: '', exitCode }
}

function fail(message: string): WorkspaceExecResult {
  return { stdout: '', stderr: `docs: ${message}\n`, exitCode: 1 }
}

function clip(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > LINE_WIDTH ? `${trimmed.slice(0, LINE_WIDTH - 3)}...` : trimmed
}

interface IndexEntry {
  path: string
  title: string
}

async function readIndex(fs: WorkspaceFs, indexPath: string): Promise<IndexEntry[]> {
  if (!(await fs.exists(indexPath))) return []
  return (await fs.readFile(indexPath))
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [path = '', title = ''] = line.split('\t')
      return { path, title }
    })
}

function patternFor(raw: string): RegExp {
  try {
    return new RegExp(raw, 'i')
  } catch {
    return new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
}

export function createDocsCommand({ root, indexPath }: DocsCommandOptions) {
  const grep = async (args: readonly string[], fs: WorkspaceFs) => {
    let limit = MATCH_LIMIT
    const terms: string[] = []
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]
      if (arg === '--limit' || arg.startsWith('--limit=')) {
        const value = arg.includes('=') ? arg.slice(8) : args[++index]
        limit = Number(value)
        if (!Number.isInteger(limit) || limit < 1) return fail('--limit needs a positive integer')
      } else {
        terms.push(arg)
      }
    }
    if (terms.length === 0) return fail('usage: docs grep <pattern> [--limit <n>]')
    const pattern = patternFor(terms.join(' '))
    const entries = await readIndex(fs, indexPath)
    if (entries.length === 0) return fail(`no docs index at ${indexPath}`)
    const titles = entries.filter((entry) => pattern.test(entry.title))
    const lines: string[] = []
    let total = 0
    for (const entry of entries) {
      if (!(await fs.exists(entry.path))) continue
      const text = await fs.readFile(entry.path)
      const rows = text.split('\n')
      for (let index = 1; index < rows.length; index++) {
        if (!pattern.test(rows[index])) continue
        total += 1
        if (lines.length < limit) lines.push(`${entry.path}:${index + 1}: ${clip(rows[index])}`)
      }
    }
    if (titles.length === 0 && total === 0) {
      return { stdout: '', stderr: `docs: no match for /${pattern.source}/i\n`, exitCode: 1 }
    }
    const out: string[] = []
    if (titles.length > 0) {
      out.push(`pages titled /${pattern.source}/i (${titles.length}):`)
      out.push(...titles.slice(0, 20).map((entry) => `  ${entry.path}  ${entry.title}`))
      if (titles.length > 20) out.push(`  ... ${titles.length - 20} more`)
    }
    if (total > 0) {
      out.push(`lines (${Math.min(total, limit)} of ${total}):`)
      out.push(...lines)
      if (total > limit) out.push(`... ${total - limit} more; narrow the pattern or raise --limit`)
    }
    return ok(out.join('\n'))
  }

  const show = async (args: readonly string[], fs: WorkspaceFs) => {
    if (args.length !== 1) return fail('usage: docs show <path>')
    const raw = args[0].replace(/^\/+/, '')
    const rootName = `${root.replace(/^\/+/, '')}/`
    const relative = raw.startsWith(rootName) ? raw.slice(rootName.length) : raw
    const base = `${root}/${relative}`.replace(/\/+/g, '/')
    for (const candidate of [base, `${base}.txt`, base.replace(/\/$/, '.txt')]) {
      if ((await fs.exists(candidate)) && !(await fs.stat(candidate)).isDirectory) {
        return ok(await fs.readFile(candidate))
      }
    }
    const name = relative.replace(/\.txt$/, '').split('/').at(-1) ?? relative
    const close = (await readIndex(fs, indexPath))
      .filter((entry) => entry.path.includes(name))
      .slice(0, 5)
      .map((entry) => entry.path)
    return fail(
      `no page ${base}${close.length > 0 ? `; did you mean: ${close.join(', ')}` : `; see ${indexPath}`}`,
    )
  }

  return defineCommand('docs', async (args, context) => {
    const [first = 'help', ...rest] = args
    try {
      if (first === 'grep') return await grep(rest, context.fs)
      if (first === 'show') return await show(rest, context.fs)
      if (first === 'help' || first === '--help' || first === '-h') {
        return ok(docsHelp(root, indexPath))
      }
      return fail(`unknown command "${first}"; run docs --help`)
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  })
}
