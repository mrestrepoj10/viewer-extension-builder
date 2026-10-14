import { Bash, type CommandContext, defineCommand } from 'just-bash/browser'
import type { WorkspaceAdapter, WorkspaceExecResult } from 'libfx/browser'

import {
  checkImage,
  describeImage,
  formatBytes,
  fromBase64,
  ImageError,
  imageExtension,
  SHOTS_DIR,
  shotFileName,
  toBase64,
} from '@/components/ui/fx-terminal/images'
import type { AgentTool, AgentToolResult, AgentToolSchemaProperty } from '@/lib/agent-types'
import type { ViewerAgentTools } from '@/lib/viewer-agent-tools'

export interface FxExecEvent {
  command: string
  exitCode: number
  ms: number
}

export interface ViewerWorkspaceOptions {
  gatewayBase: string
  model: string
  onExec?: (event: FxExecEvent) => void
  fetch?: typeof fetch
}

type WorkspaceFs = CommandContext['fs']

const ROOT = '/model'
const HOME = '/home/agent'
const OUTPUT_LIMIT_BYTES = 60 * 1024
const TOOL_BUDGET_MS = 25_000
const EXIT_STILL_RUNNING = 75
const EXIT_INTERRUPTED = 130

type ToolValue = string | number | boolean | string[] | number[]

class UsageError extends Error {}

interface Job {
  id: number
  tool: string
  controller: AbortController
  result: Promise<AgentToolResult>
  render: (result: AgentToolResult, fs: WorkspaceFs) => Promise<string>
}

const SCREENSHOT_TOOL = 'take_screenshot'
const SCREENSHOT_HELP = `Save an image of the current view under ${SHOTS_DIR}/ (shot-1.jpg, shot-2.jpg, ...). You do not see the pixels; viewer describe_image <path> returns a text description.`
const NAME_FLAG = '--name <string>'
const NAME_HELP = `File name under ${SHOTS_DIR} (default shot-N; the extension is added).`
const EXPERIMENTAL =
  'experimental: the model gets a text description, not the pixels, and each call costs one extra model request'

const encoder = new TextEncoder()

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function camel(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function flagLabel(name: string): string {
  return `--${kebab(name).replace(/(^|-)set-id$/, '$1set')}`
}

function firstSentence(text: string): string {
  const match = /^.*?[.!?](\s|$)/.exec(text)
  return (match ? match[0] : text).trim()
}

function valueHint(property: AgentToolSchemaProperty): string {
  if (property.type === 'array') return `<${property.items.type},...>`
  if (property.type === 'string' && property.enum) return `<${property.enum.join('|')}>`
  return property.type === 'boolean' ? '' : `<${property.type}>`
}

function resolveFlag(tool: AgentTool, flag: string): string | undefined {
  const properties = tool.inputSchema.properties
  const name = camel(flag)
  for (const candidate of [flag, name, `${name}Id`]) {
    if (Object.hasOwn(properties, candidate)) return candidate
  }
  return undefined
}

function coerce(
  name: string,
  property: AgentToolSchemaProperty,
  raw: string,
  lastSetId: () => string,
): ToolValue {
  const label = flagLabel(name)
  const number = (text: string) => {
    const value = Number(text)
    if (text.trim() === '' || !Number.isFinite(value)) {
      throw new UsageError(`${label} needs a number (got "${text}")`)
    }
    return value
  }
  switch (property.type) {
    case 'string':
      return raw === '@last' && /(^s|S)etId$/.test(name) ? lastSetId() : raw
    case 'number':
    case 'integer':
      return number(raw)
    case 'boolean':
      if (/^(true|1|yes)$/i.test(raw)) return true
      if (/^(false|0|no)$/i.test(raw)) return false
      throw new UsageError(`${label} is true or false (got "${raw}")`)
    case 'array': {
      const items = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      return property.items.type === 'string' ? items : items.map(number)
    }
  }
}

export function parseToolArgs(
  tool: AgentTool,
  args: readonly string[],
  lastSetId: () => string,
): Map<string, ToolValue> {
  const properties = tool.inputSchema.properties
  const raw = new Map<string, string[]>()
  const switches = new Map<string, boolean>()
  const positional: string[] = []
  const add = (name: string, value: string) => raw.set(name, [...(raw.get(name) ?? []), value])
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--') {
      positional.push(...args.slice(index + 1))
      break
    }
    if (!arg.startsWith('--') || arg.length === 2) {
      positional.push(arg)
      continue
    }
    const equals = arg.indexOf('=')
    const flag = equals > 2 ? arg.slice(2, equals) : arg.slice(2)
    const negated = flag.startsWith('no-') ? resolveFlag(tool, flag.slice(3)) : undefined
    if (negated && properties[negated]?.type === 'boolean' && equals < 0) {
      switches.set(negated, false)
      continue
    }
    const name = resolveFlag(tool, flag)
    if (!name) {
      const allowed = Object.keys(properties).map(flagLabel).join(' ')
      throw new UsageError(`unknown flag --${flag} (flags: ${allowed || 'none'})`)
    }
    const boolean = properties[name]?.type === 'boolean'
    const next = args[index + 1]
    if (equals > 2) {
      add(name, arg.slice(equals + 1))
    } else if (boolean ? next !== undefined && /^(true|false)$/i.test(next) : next !== undefined) {
      add(name, next)
      index += 1
    } else if (boolean) {
      switches.set(name, true)
    } else {
      throw new UsageError(`${flagLabel(name)} needs a value`)
    }
  }
  placePositionals(tool, positional, add)
  const input = new Map<string, ToolValue>(switches)
  for (const [name, values] of raw) {
    const property = properties[name]
    const value = property.type === 'array' ? values.join(',') : (values.at(-1) ?? '')
    input.set(name, coerce(name, property, value, lastSetId))
  }
  return input
}

function placePositionals(
  tool: AgentTool,
  positional: readonly string[],
  add: (name: string, value: string) => void,
) {
  const properties = tool.inputSchema.properties
  const rest: string[] = []
  for (const token of positional) {
    if (token === '@last' && properties.setId) add('setId', token)
    else if (/^\d+(,\d*)*$/.test(token) && properties.ids) add('ids', token)
    else rest.push(token)
  }
  if (rest.length === 0) return
  const strings = (tool.inputSchema.required ?? []).filter(
    (name) => properties[name]?.type === 'string',
  )
  if (strings.length !== 1) {
    throw new UsageError(`unexpected argument "${rest[0]}" (see viewer ${tool.name} --help)`)
  }
  add(strings[0], rest.join(' '))
}

function toolDescription(tool: AgentTool): string {
  return tool.name === SCREENSHOT_TOOL ? SCREENSHOT_HELP : tool.description
}

function toolHelp(tool: AgentTool): string {
  const required = new Set(tool.inputSchema.required ?? [])
  const flags = Object.entries(tool.inputSchema.properties).map(([name, property]) => [
    `${flagLabel(name)} ${valueHint(property)}`,
    [property.description, required.has(name) ? 'required' : ''].filter(Boolean).join(' '),
  ])
  if (tool.name === SCREENSHOT_TOOL) flags.push([NAME_FLAG, NAME_HELP])
  const lines = [`viewer ${tool.name}${tool.mutates ? '  (changes the view; undoable)' : ''}`]
  lines.push('', toolDescription(tool), '')
  if (flags.length === 0) {
    lines.push('No flags.')
  } else {
    lines.push('Flags')
    const width = Math.max(...flags.map(([usage]) => usage.length))
    for (const [usage, notes] of flags) lines.push(`  ${usage.padEnd(width)}  ${notes}`.trimEnd())
  }
  return `${lines.join('\n')}\n`
}

const SHOTS_HELP = `viewer shots

List the screenshots saved under ${SHOTS_DIR}, newest last, with their sizes.

No flags.
`

const DESCRIBE_HELP = `viewer describe_image <path>  (${EXPERIMENTAL})

Send one PNG, JPEG, WebP, or GIF file from this workspace (up to 3.75 MB) to the model in a
separate request and print its text description. Use it on a viewer take_screenshot file.

Flags
  --question <string>  What to ask about the image (default: describe what it shows, briefly).
`

const USAGE = `Usage
  viewer <tool> [--flag value]...   run one tool; its flags are the tool's inputs
  viewer <tool> --help              that tool's flags
  viewer help                       this list
  viewer wait [job]                 collect a tool that outlived the 25 s command budget

Arrays take comma lists (--ids 1,2,3). Booleans are bare (--fit) or negated (--no-fit).
--set set-1 passes a saved element set; @last is the newest set (viewer isolate_elements @last).
Bare integers are dbIds (viewer select_elements 12 34).`

function catalogHelp(tools: readonly AgentTool[]): string {
  const entries = [
    ...tools.map((tool) => [tool.name, firstSentence(toolDescription(tool))]),
    ['shots', `List the screenshots saved under ${SHOTS_DIR}.`],
    ['describe_image', `Describe an image file in text (${EXPERIMENTAL}).`],
  ]
  const width = Math.max(...entries.map(([name]) => name.length))
  const rows = entries.map(([name, summary]) => `  ${name.padEnd(width)}  ${summary}`)
  return `viewer drives the model viewer next to this terminal. Each subcommand is one tool.\n\n${USAGE}\n\nTools\n${rows.join('\n')}\n`
}

const TERMINAL_NOTES = `In this terminal, take_screenshot cannot show you the image: it saves the file under ${SHOTS_DIR}/ and prints its path. To learn what a screenshot shows, run \`viewer describe_image <path>\` (${EXPERIMENTAL}).`

function readme(catalog: ViewerAgentTools): string {
  const sections = [
    ...catalog.tools.map((tool) => `## ${tool.name}\n\n\`\`\`\n${toolHelp(tool)}\`\`\``),
    `## shots\n\n\`\`\`\n${SHOTS_HELP}\`\`\``,
    `## describe_image\n\n\`\`\`\n${DESCRIBE_HELP}\`\`\``,
  ]
  return `# viewer\n\n${catalogHelp(catalog.tools)}\n# How to work\n\n${catalog.instructions}\n\nEvery tool named above is a viewer subcommand: get_model_info is \`viewer get_model_info\`.\n\n${TERMINAL_NOTES}\n\n# Tools\n\n${sections.join('\n\n')}\n`
}

const MOTD =
  '[workspace] This is a sandboxed bash (pipes, grep, jq, sort, redirects) over an in-memory ' +
  'filesystem at /model, with no network. The `viewer` command drives the model viewer next to ' +
  'this terminal: each subcommand is one tool. Start with `viewer help` or `cat README.md`.\n\n'

function utf8Head(text: string, bytes: number): string {
  if (encoder.encode(text).length <= bytes) return text
  let low = 0
  let high = Math.min(text.length, bytes)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (encoder.encode(text.slice(0, middle)).length <= bytes) low = middle
    else high = middle - 1
  }
  return text.slice(0, low).replace(/[\uD800-\uDBFF]$/, '')
}

function fitOutput(result: WorkspaceExecResult): WorkspaceExecResult {
  const total = encoder.encode(result.stdout).length + encoder.encode(result.stderr).length
  if (total <= OUTPUT_LIMIT_BYTES) return result
  const stderr = utf8Head(result.stderr, 4096)
  const stdout = utf8Head(result.stdout, OUTPUT_LIMIT_BYTES - encoder.encode(stderr).length - 512)
  const note = `[workspace] output cut at ${Math.round(OUTPUT_LIMIT_BYTES / 1024)} KB of ${Math.round(total / 1024)} KB; narrow it with --limit, head or grep, or redirect it to a file.\n`
  return {
    stdout: stdout.endsWith('\n') ? stdout : `${stdout}\n`,
    stderr: stderr + note,
    exitCode: result.exitCode,
  }
}

function errorLine(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface TakenFlag {
  value: string | undefined
  rest: string[]
}

export function takeFlag(args: readonly string[], flag: string): TakenFlag {
  const rest: string[] = []
  let value: string | undefined
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === flag) {
      value = args[index + 1]
      if (value === undefined) throw new UsageError(`${flag} needs a value`)
      index += 1
    } else if (arg.startsWith(`${flag}=`)) {
      value = arg.slice(flag.length + 1)
    } else {
      rest.push(arg)
    }
  }
  return { value, rest }
}

async function listShots(fs: WorkspaceFs): Promise<string[]> {
  if (!(await fs.exists(SHOTS_DIR))) return []
  return fs.readdir(SHOTS_DIR)
}

async function saveScreenshot(
  result: AgentToolResult,
  fs: WorkspaceFs,
  name: string | undefined,
): Promise<string> {
  const image = result.image
  if (!image) return result.text
  const extension = imageExtension(image.mimeType) ?? 'png'
  const bytes = fromBase64(image.base64)
  await fs.mkdir(SHOTS_DIR, { recursive: true })
  const path = `${SHOTS_DIR}/${shotFileName(await listShots(fs), extension, name)}`
  await fs.writeFile(path, bytes)
  const size = image.width && image.height ? `${image.width}x${image.height} ` : ''
  return `saved ${path} (${size}${extension}, ${formatBytes(bytes.length)})`
}

async function renderShots(fs: WorkspaceFs): Promise<string> {
  const files = await listShots(fs)
  if (files.length === 0)
    return `no screenshots yet; viewer take_screenshot saves one to ${SHOTS_DIR}`
  const rows = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(`${SHOTS_DIR}/${file}`)
      return { file, size: stat.size, mtime: stat.mtime.getTime() }
    }),
  )
  rows.sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file, 'en', { numeric: true }))
  return rows.map((row) => `${SHOTS_DIR}/${row.file}  ${formatBytes(row.size)}`).join('\n')
}

const plainText = async (result: AgentToolResult) => result.text

export function createViewerWorkspace(
  catalog: ViewerAgentTools,
  options: ViewerWorkspaceOptions,
): WorkspaceAdapter {
  const { gatewayBase, model, onExec } = options
  const tools = new Map(catalog.tools.map((tool) => [tool.name, tool]))
  const jobs = new Map<number, Job>()
  let nextJob = 1

  const lastSetId = () => {
    const latest = catalog.sets.list().at(-1)
    if (!latest) throw new UsageError('@last needs a saved set; none yet (find_elements makes one)')
    return latest.id
  }

  const ok = (stdout: string): WorkspaceExecResult => ({
    stdout: stdout.endsWith('\n') ? stdout : `${stdout}\n`,
    stderr: '',
    exitCode: 0,
  })
  const fail = (message: string): WorkspaceExecResult => ({
    stdout: '',
    stderr: `viewer: ${message}\n`,
    exitCode: 1,
  })

  const settle = async (
    job: Job,
    signal: AbortSignal,
    fs: WorkspaceFs,
  ): Promise<WorkspaceExecResult> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort = () => {}
    const budget = new Promise<'pending' | 'interrupted'>((resolve) => {
      timer = setTimeout(() => resolve('pending'), TOOL_BUDGET_MS)
      onAbort = () => resolve('interrupted')
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const outcome = await Promise.race([job.result, budget])
      if (outcome === 'pending') {
        jobs.set(job.id, job)
        return {
          stdout: `${job.tool} is still running as job ${job.id}; run \`viewer wait ${job.id}\` to collect it.\n`,
          stderr: '',
          exitCode: EXIT_STILL_RUNNING,
        }
      }
      jobs.delete(job.id)
      if (outcome === 'interrupted') {
        job.controller.abort()
        return {
          stdout: '',
          stderr: `viewer: ${job.tool} interrupted\n`,
          exitCode: EXIT_INTERRUPTED,
        }
      }
      return ok(await job.render(outcome, fs))
    } catch (error) {
      jobs.delete(job.id)
      return fail(`${job.tool}: ${errorLine(error)}`)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }

  const describe = async (
    args: readonly string[],
    signal: AbortSignal,
    context: CommandContext,
  ): Promise<WorkspaceExecResult> => {
    let path: string
    let question: string | undefined
    try {
      const parsed = takeFlag(args, '--question')
      question = parsed.value
      if (parsed.rest.length !== 1 || parsed.rest[0].startsWith('--')) {
        throw new UsageError('usage: viewer describe_image <path> [--question "..."]')
      }
      path = context.fs.resolvePath(context.cwd, parsed.rest[0])
    } catch (error) {
      return fail(`describe_image: ${errorLine(error)}`)
    }
    try {
      if (!(await context.fs.exists(path))) throw new ImageError(`no such file ${path}`)
      const bytes = await context.fs.readFileBuffer(path)
      const mediaType = checkImage(bytes)
      const text = await describeImage({
        gatewayBase,
        model,
        mediaType,
        base64: toBase64(bytes),
        question,
        signal,
        fetch: options.fetch,
      })
      return ok(text)
    } catch (error) {
      if (signal.aborted) {
        return {
          stdout: '',
          stderr: 'viewer: describe_image interrupted\n',
          exitCode: EXIT_INTERRUPTED,
        }
      }
      return fail(`describe_image: ${errorLine(error)}`)
    }
  }

  const run = async (
    args: readonly string[],
    signal: AbortSignal,
    context: CommandContext,
  ): Promise<WorkspaceExecResult> => {
    const [first = 'help', ...rest] = args
    const help = rest.includes('--help') || rest.includes('-h')
    if (first === 'help' || first === '--help' || first === '-h') {
      const name = rest[0]?.replace(/-/g, '_')
      if (name === 'shots') return ok(SHOTS_HELP)
      if (name === 'describe_image') return ok(DESCRIBE_HELP)
      const topic = name ? tools.get(name) : undefined
      return ok(topic ? toolHelp(topic) : catalogHelp(catalog.tools))
    }
    if (first === 'wait') {
      const job = rest[0] ? jobs.get(Number(rest[0])) : [...jobs.values()].at(-1)
      if (!job) return fail(rest[0] ? `no job ${rest[0]}` : 'no job is running')
      return settle(job, signal, context.fs)
    }
    const command = first.replace(/-/g, '_')
    if (command === 'shots') return ok(help ? SHOTS_HELP : await renderShots(context.fs))
    if (command === 'describe_image')
      return help ? ok(DESCRIBE_HELP) : describe(rest, signal, context)
    const tool = tools.get(command)
    if (!tool) return fail(`unknown tool "${first}"; run viewer help for the list`)
    if (help) return ok(toolHelp(tool))
    let input: Map<string, ToolValue>
    let render: Job['render'] = plainText
    try {
      let flags = rest
      if (tool.name === SCREENSHOT_TOOL) {
        const parsed = takeFlag(rest, '--name')
        flags = parsed.rest
        const name = parsed.value
        if (name !== undefined) shotFileName([], 'png', name)
        render = (result, fs) => saveScreenshot(result, fs, name)
      }
      input = parseToolArgs(tool, flags, lastSetId)
    } catch (error) {
      return fail(`${tool.name}: ${errorLine(error)}`)
    }
    const controller = new AbortController()
    const result = tool.execute(Object.fromEntries(input), { signal: controller.signal })
    result.catch(() => {})
    return settle(
      { id: nextJob++, tool: tool.name, controller, result, render },
      signal,
      context.fs,
    )
  }

  const viewer = defineCommand('viewer', async (args, context) =>
    run(args, context.signal ?? new AbortController().signal, context),
  )
  const bash = new Bash({
    files: { [`${ROOT}/README.md`]: readme(catalog), [`${HOME}/.keep`]: '' },
    cwd: ROOT,
    env: { HOME, USER: 'agent', TERM: 'xterm-256color' },
    customCommands: [viewer],
  })

  let first = true
  const workspace: WorkspaceAdapter = {
    info: { version: 1, root: ROOT, cwd: ROOT, home: HOME, gitAvailable: false, ephemeral: true },
    permission: 'allow-sandboxed',
    async exec({ command, cwd, signal }) {
      const started = performance.now()
      let result: WorkspaceExecResult
      try {
        const outcome = await bash.exec(command, { cwd, signal })
        result = { stdout: outcome.stdout, stderr: outcome.stderr, exitCode: outcome.exitCode }
      } catch (error) {
        result = { stdout: '', stderr: `${errorLine(error)}\n`, exitCode: 1 }
      }
      result = fitOutput(result)
      if (first) {
        first = false
        result.stdout = MOTD + result.stdout
      }
      onExec?.({ command, exitCode: result.exitCode, ms: Math.round(performance.now() - started) })
      return result
    },
  }
  return workspace
}
