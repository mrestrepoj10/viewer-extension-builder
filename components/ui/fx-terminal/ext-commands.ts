import { type CommandContext, defineCommand } from 'just-bash/browser'
import type { WorkspaceExecResult } from 'libfx/browser'

import {
  type CheckResult,
  checkExtensionFolder,
  codeFrame,
  formatDiagnostics,
  UNLOAD_CLEANUP_LIMITS,
} from '@/lib/extensions/check'
import { buildExtensionZip, zipFileName } from '@/lib/extensions/export'
import {
  assertExtensionId,
  displayNameFor,
  EXPORTS_DIR,
  EXTENSIONS_DIR,
  type ExtensionFolder,
  ExtensionFormatError,
  type ExtensionSource,
  extensionPaths,
  kebabNameFor,
  listExtensionIds,
  parseExtensionConfig,
  readExtensionFolder,
  sourceUrlFor,
  stringifyConfig,
  toExtensionSource,
} from '@/lib/extensions/format'
import type {
  CapturedError,
  ClickReport,
  ExtensionRuntime,
  LoadReport,
} from '@/lib/extensions/runtime'

type WorkspaceFs = CommandContext['fs']

export interface ExtCommandOptions {
  /** The page-side runtime that injects scripts into the live viewer. */
  runtime?: ExtensionRuntime
  /** Folder ids seeded as read-only references (BasicSkeleton and the worked examples). */
  references: ReadonlySet<string>
  defaultTemplate: string
}

interface Subcommand {
  usage: string
  summary: string
  details: string
}

const EXIT_INTERRUPTED = 130

const SUBCOMMANDS: Record<string, Subcommand> = {
  list: {
    usage: 'ext list',
    summary: 'List the extension folders, which are references, and which are loaded.',
    details: `Lists every folder under ${EXTENSIONS_DIR} that has a config.json.
Status: reference (read-only example to copy from), loaded (live in the viewer), draft.`,
  },
  new: {
    usage: 'ext new <Id> [--from <Template>] [--description "..."] [--force]',
    summary: 'Copy a template folder to a new extension.',
    details: `Copies ${EXTENSIONS_DIR}/<Template> (default BasicSkeleton) to ${EXTENSIONS_DIR}/<Id>,
renaming every occurrence of the template id (class name, registerExtension id, CSS
classes, control ids) to <Id> and rewriting config.json name, displayname, description.
<Id> is a JavaScript identifier: it is the class name and the registered id.
--force replaces an existing draft folder; references are never overwritten.`,
  },
  check: {
    usage: 'ext check <Id> [--no-lint]',
    summary: 'Validate config.json, parse main.js, and lint it with ESLint plus viewer rules.',
    details: `Stages, in order; the first failing stage stops the rest:
  config   config.json against the aps-extensions contract ("name" = folder, one main.js)
  syntax   acorn, ES latest, plain script (no import/export, no top-level await)
  lint     ESLint core rules (no-undef with browser globals + Autodesk + THREE, ...) and:
           viewer/extension-class    one class extends Autodesk.Viewing.Extension with
                                     load() and unload() that return true
           viewer/register-extension one top-level registerExtension('<Id>', <Class>)
           viewer/plain-script       no require(), import(), eval, document.write
           viewer/unload-cleanup     listeners, controls, tools, panels, intervals that
                                     load-time code adds are removed in unload() (warning)
Output: file:line:col severity rule message, a fix line, and the source line with a caret.
Exit 1 when there is an error; warnings alone exit 0.
${UNLOAD_CLEANUP_LIMITS}
The ESLint bundle (about 350 KB) loads on the first lint; --no-lint stops after syntax.`,
  },
  load: {
    usage: 'ext load <Id> [--skip-check]',
    summary: 'Check, then load the extension into the live viewer and report what happened.',
    details: `Runs ext check first and refuses to load on errors (--skip-check bypasses it).
Then: unloads and unregisters the previous version, injects contents/main.css as a
<style> and contents/main.js as a <script> (sourceURL ${sourceUrlFor('<Id>')}), and calls
viewer.loadExtension('<Id>', config.options). Prints load() → true|false, errors thrown
or logged with console.error during the script and load(), with line:col and the source
line, the toolbar controls that appeared, and the DOM nodes the extension appended.
Errors that happen later (a button click, an event handler) are collected for ext errors.
The script runs inside (() => { ... })() so a reload can declare the same classes again.
Exit 1 when load() did not return true or any error was captured.`,
  },
  click: {
    usage: 'ext click <Id> <control-id>',
    summary: 'Click a toolbar control the extension added and report what happened.',
    details: `Clicks the toolbar control whose id (or group/id path, as ext load lists it) is
<control-id>, the way a user would, then prints the button state, the panels and DOM nodes
of the extension that became visible (with the start of their text, so check it says what
you expect) or hidden, and the errors its handlers threw.
Exit 1 when an error was captured.`,
  },
  unload: {
    usage: 'ext unload <Id>',
    summary: 'Unload and unregister the extension; report anything unload() left behind.',
    details: `Calls viewer.unloadExtension('<Id>'), unregisters the class, and removes its <script>
and <style>. Toolbar controls, viewer event listeners, and DOM nodes that the extension's
code created and unload() did not remove are listed, then removed by the runtime so the
viewer stays clean; fix unload() so the list is empty. Exit 1 when anything was left.`,
  },
  errors: {
    usage: 'ext errors [<Id>]',
    summary: 'Show the runtime errors captured since the last ext load.',
    details: `Lists errors thrown, rejected, or logged with console.error by the extension's code
since its last ext load: uncaught errors in handlers, failed promises, console.error calls.
Each has its phase (script, load, runtime, unload), line:col, and the source line.`,
  },
  export: {
    usage: 'ext export <Id> [--force]',
    summary: 'Zip the folder with a LOAD.md, save it under /model/exports, and download it.',
    details: `Runs ext check, then writes ${EXPORTS_DIR}/<Id>.zip containing <Id>/config.json,
<Id>/contents/main.js, <Id>/contents/main.css (when listed), and <Id>/LOAD.md (how to load
it in any Viewer v7 page and how to drop it into aps-extensions), and asks the browser to
download it. Refuses when ext check finds errors unless --force.`,
  },
}

export function extHelp(): string {
  const rows = Object.values(SUBCOMMANDS).map((entry) => `  ${entry.usage}\n      ${entry.summary}`)
  return `ext builds Autodesk Viewer v7 extensions in ${EXTENSIONS_DIR}/<Id>/ and runs them in the viewer.

Folder (aps-extensions format)
  config.json         {"name": "<Id>", "displayname", "description", "options": {},
                       "loadonstartup": "false", "filestoload": {"cssfiles": ["main.css"],
                       "jsfiles": ["main.js"]}}
  contents/main.js    plain script: one class extends Autodesk.Viewing.Extension, load() and
                      unload() return true, then
                      Autodesk.Viewing.theExtensionManager.registerExtension('<Id>', <Class>)
  contents/main.css   optional styles

Usage
${rows.join('\n')}
  ext <command> --help
      Details for one command.

Loop: ext new <Id> → edit contents/main.js → ext check <Id> → ext load <Id> → ext click
<Id> <control-id> → viewer take_screenshot → ext errors <Id> → ext unload <Id> → ext export <Id>.
`
}

function subcommandHelp(name: string): string {
  const entry = SUBCOMMANDS[name]
  return `${entry.usage}\n\n${entry.summary}\n\n${entry.details}\n`
}

class UsageError extends Error {}

interface ParsedArgs {
  positional: string[]
  flags: Map<string, string | true>
}

function parseArgs(args: readonly string[], valued: readonly string[]): ParsedArgs {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const equals = arg.indexOf('=')
    const name = equals > 0 ? arg.slice(2, equals) : arg.slice(2)
    if (valued.includes(name)) {
      const value = equals > 0 ? arg.slice(equals + 1) : args[index + 1]
      if (value === undefined) throw new UsageError(`--${name} needs a value`)
      if (equals < 0) index += 1
      flags.set(name, value)
    } else {
      flags.set(name, true)
    }
  }
  return { positional, flags }
}

function requireFlags(parsed: ParsedArgs, allowed: readonly string[], usage: string) {
  for (const name of parsed.flags.keys()) {
    if (!allowed.includes(name)) throw new UsageError(`unknown flag --${name} (usage: ${usage})`)
  }
}

function ok(stdout: string, exitCode = 0): WorkspaceExecResult {
  return { stdout: stdout.endsWith('\n') ? stdout : `${stdout}\n`, stderr: '', exitCode }
}

function fail(message: string, stdout = ''): WorkspaceExecResult {
  return {
    stdout: stdout && !stdout.endsWith('\n') ? `${stdout}\n` : stdout,
    stderr: `ext: ${message}\n`,
    exitCode: 1,
  }
}

function errorLine(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function checkSummary(id: string, result: CheckResult): string {
  const stages = result.linted ? 'config, syntax, ESLint + viewer rules' : 'config, syntax'
  if (result.diagnostics.length === 0) return `ext check ${id}: ok (${stages})`
  return `ext check ${id}: ${plural(result.errors, 'error')}, ${plural(result.warnings, 'warning')} (${stages})`
}

function sourcesOf(folder: ExtensionFolder) {
  return { 'config.json': folder.configText, 'main.js': folder.mainJs, 'main.css': folder.mainCss }
}

function renderCheck(folder: ExtensionFolder, result: CheckResult): string {
  const body = formatDiagnostics(result.diagnostics, sourcesOf(folder))
  return body ? `${checkSummary(folder.id, result)}\n${body}` : checkSummary(folder.id, result)
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour12: false })
}

function renderError(error: CapturedError, mainJs: string | null, withClock = false): string {
  const where =
    error.line !== undefined
      ? `${sourceUrlFor(error.id)}:${error.line}:${error.column ?? 1}`
      : sourceUrlFor(error.id)
  const head = `${withClock ? `${clock(error.at)} ` : ''}${where} ${error.phase}${error.kind === 'console' ? ' console.error' : ''} ${error.message}`
  const frame =
    mainJs && error.line !== undefined ? codeFrame(mainJs, error.line, error.column ?? 1) : ''
  return frame ? `${head}\n${frame}` : head
}

async function copyTree(fs: WorkspaceFs, from: string, to: string, rename: (text: string) => string) {
  const written: string[] = []
  const visit = async (source: string, target: string) => {
    const stat = await fs.stat(source)
    if (stat.isDirectory) {
      await fs.mkdir(target, { recursive: true })
      for (const entry of (await fs.readdir(source)).sort()) {
        await visit(`${source}/${entry}`, `${target}/${entry}`)
      }
      return
    }
    await fs.writeFile(target, rename(await fs.readFile(source)))
    written.push(target)
  }
  await visit(from, to)
  return written
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createExtCommand(options: ExtCommandOptions) {
  const { runtime, references } = options

  const requireRuntime = (): ExtensionRuntime => {
    if (!runtime) throw new Error('no viewer is attached to this terminal, so nothing can load')
    return runtime
  }

  const list = async (fs: WorkspaceFs) => {
    const ids = await listExtensionIds(fs)
    if (ids.length === 0) return ok(`no extensions under ${EXTENSIONS_DIR}; ext new <Id> creates one`)
    const rows = await Promise.all(
      ids.map(async (id) => {
        const text = await fs.readFile(extensionPaths(id).config)
        const parsed = parseExtensionConfig(text, id)
        const status = runtime?.isLoaded(id) ? 'loaded' : references.has(id) ? 'reference' : 'draft'
        const description = parsed.config?.description ?? 'config.json is invalid (ext check)'
        return [id, status, description] as const
      }),
    )
    const width = Math.max(2, ...rows.map(([id]) => id.length))
    const lines = rows.map(
      ([id, status, description]) => `${id.padEnd(width)}  ${status.padEnd(9)}  ${description}`,
    )
    return ok([`${'Id'.padEnd(width)}  ${'status'.padEnd(9)}  description`, ...lines].join('\n'))
  }

  const create = async (args: readonly string[], fs: WorkspaceFs) => {
    const parsed = parseArgs(args, ['from', 'description'])
    requireFlags(parsed, ['from', 'description', 'force'], SUBCOMMANDS.new.usage)
    if (parsed.positional.length !== 1) throw new UsageError(`usage: ${SUBCOMMANDS.new.usage}`)
    const id = assertExtensionId(parsed.positional[0])
    const fromFlag = parsed.flags.get('from')
    const template = typeof fromFlag === 'string' ? fromFlag : options.defaultTemplate
    const from = extensionPaths(template)
    const to = extensionPaths(id)
    if (!(await fs.exists(from.config))) {
      const known = await listExtensionIds(fs)
      throw new ExtensionFormatError(
        `no template ${template} under ${EXTENSIONS_DIR} (have: ${known.join(', ') || 'none'})`,
      )
    }
    if (id === template) throw new UsageError('the new id must differ from the template')
    if (await fs.exists(to.dir)) {
      if (references.has(id)) throw new UsageError(`${id} is a reference folder; pick another id`)
      if (parsed.flags.get('force') !== true) {
        throw new UsageError(`${to.dir} exists; pass --force to replace it`)
      }
      await fs.rm(to.dir, { recursive: true, force: true })
    }
    const renames: Array<[RegExp, string]> = [
      [displayNameFor(template), displayNameFor(id)],
      [kebabNameFor(template), kebabNameFor(id)],
      [template, id],
    ].map(([from, to]) => [new RegExp(escapeRegExp(from), 'g'), to])
    const rename = (text: string) =>
      renames.reduce((current, [pattern, to]) => current.replace(pattern, to), text)
    const written = await copyTree(fs, from.dir, to.dir, rename)
    const configResult = parseExtensionConfig(await fs.readFile(to.config), id)
    if (configResult.config) {
      const description = parsed.flags.get('description')
      const config = {
        ...configResult.config,
        displayname: displayNameFor(id),
        description:
          typeof description === 'string' && description.trim()
            ? description.trim()
            : `${displayNameFor(id)} extension.`,
      }
      await fs.writeFile(to.config, stringifyConfig(config))
    }
    return ok(
      [
        `created ${to.dir} from ${template}`,
        ...written.map((path) => `  ${path}`),
        `next: edit ${to.main}, then ext check ${id} and ext load ${id}`,
      ].join('\n'),
    )
  }

  const runCheck = async (folder: ExtensionFolder, lint: boolean, signal: AbortSignal) => {
    const pending = checkExtensionFolder(folder, { lint })
    const aborted = new Promise<null>((resolve) => {
      if (signal.aborted) resolve(null)
      signal.addEventListener('abort', () => resolve(null), { once: true })
    })
    return Promise.race([pending, aborted])
  }

  const interrupted = (): WorkspaceExecResult => ({
    stdout: '',
    stderr: 'ext: interrupted\n',
    exitCode: EXIT_INTERRUPTED,
  })

  const check = async (args: readonly string[], fs: WorkspaceFs, signal: AbortSignal) => {
    const parsed = parseArgs(args, [])
    requireFlags(parsed, ['no-lint'], SUBCOMMANDS.check.usage)
    if (parsed.positional.length !== 1) throw new UsageError(`usage: ${SUBCOMMANDS.check.usage}`)
    const folder = await readExtensionFolder(fs, assertExtensionId(parsed.positional[0]))
    const result = await runCheck(folder, parsed.flags.get('no-lint') !== true, signal)
    if (!result) return interrupted()
    return ok(renderCheck(folder, result), result.errors > 0 ? 1 : 0)
  }

  const renderLoad = (report: LoadReport, source: ExtensionSource, checked: CheckResult | null) => {
    const lines: string[] = []
    const returned =
      report.returned === null ? 'not called' : report.returned ? 'true' : 'false'
    lines.push(
      `ext load ${report.id}${report.replaced ? ' (replaced the loaded version)' : ''}: load() → ${returned}  ${report.ms} ms`,
    )
    if (!report.registered && report.errors.length === 0) {
      lines.push(`main.js did not register '${report.id}'`)
    }
    if (report.controls.length > 0) {
      lines.push('toolbar controls added:')
      for (const control of report.controls) {
        lines.push(`  + ${control.path}${control.tooltip ? ` "${control.tooltip}"` : ''}`)
      }
    } else if (report.returned) {
      lines.push('toolbar controls added: none')
    }
    if (report.elements.length > 0) {
      lines.push('DOM nodes appended by the extension:')
      for (const element of report.elements) lines.push(`  + ${element}`)
    }
    if (report.errors.length > 0) {
      lines.push(`errors (${report.errors.length}):`)
      for (const error of report.errors) {
        lines.push(
          renderError(error, source.mainJs)
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n'),
        )
      }
    } else {
      lines.push('errors: none')
    }
    for (const warning of report.warnings.slice(0, 5)) lines.push(`console.warn: ${warning}`)
    if (checked && checked.warnings > 0) {
      lines.push(`check: ${plural(checked.warnings, 'warning')} (ext check ${report.id} lists them)`)
    }
    if (report.returned !== true) {
      lines.push(`not loaded: fix ${extensionPaths(report.id).main} and run ext load ${report.id} again`)
    } else if (report.errors.length > 0) {
      lines.push(`loaded, but errors were captured: fix them and run ext load ${report.id} again`)
    } else if (report.controls.length > 0 || report.elements.length > 0) {
      lines.push(
        'UI was added. viewer take_screenshot captures the 3D canvas only, not toolbar buttons or panels: trust the lists above for those. ext errors collects errors from later clicks.',
      )
    }
    const button = report.returned ? report.controls.at(-1) : undefined
    if (button) {
      lines.push(
        `next: ext click ${report.id} ${button.path.split('/').at(-1)} presses it and reports what it did`,
      )
    }
    return lines.join('\n')
  }

  const load = async (args: readonly string[], fs: WorkspaceFs, signal: AbortSignal) => {
    const parsed = parseArgs(args, [])
    requireFlags(parsed, ['skip-check'], SUBCOMMANDS.load.usage)
    if (parsed.positional.length !== 1) throw new UsageError(`usage: ${SUBCOMMANDS.load.usage}`)
    const id = assertExtensionId(parsed.positional[0])
    const live = requireRuntime()
    const folder = await readExtensionFolder(fs, id)
    let checked: CheckResult | null = null
    if (parsed.flags.get('skip-check') !== true) {
      checked = await runCheck(folder, true, signal)
      if (!checked) return interrupted()
      if (checked.errors > 0) {
        return fail(
          `not loaded: ext check found ${plural(checked.errors, 'error')} (fix them, or pass --skip-check)`,
          renderCheck(folder, checked),
        )
      }
    }
    const source = toExtensionSource(folder)
    const report = await live.load(source)
    const failed = report.returned !== true || report.errors.length > 0
    return ok(renderLoad(report, source, checked), failed ? 1 : 0)
  }

  const unload = async (args: readonly string[]) => {
    const parsed = parseArgs(args, [])
    requireFlags(parsed, [], SUBCOMMANDS.unload.usage)
    if (parsed.positional.length !== 1) throw new UsageError(`usage: ${SUBCOMMANDS.unload.usage}`)
    const id = assertExtensionId(parsed.positional[0])
    const live = requireRuntime()
    const source = live.loaded().find((entry) => entry.id === id)?.source
    const report = await live.unload(id)
    const lines = [
      `ext unload ${id}: unload() → ${report.returned === null ? 'not called' : String(report.returned)}${report.wasLoaded ? '' : ' (it was not loaded by ext load)'}`,
    ]
    const { controls, elements, listeners } = report.leftovers
    const leftovers = [
      ...controls.map((control) => `toolbar control ${control}`),
      ...listeners.map((type) => `viewer listener "${type}"`),
      ...elements.map((element) => `DOM node ${element}`),
    ]
    if (leftovers.length > 0) {
      lines.push('unload() left these behind (the runtime removed them; fix unload()):')
      lines.push(...leftovers.map((item) => `  - ${item}`))
    } else if (report.wasLoaded) {
      lines.push('clean: no toolbar controls, viewer listeners, or DOM nodes left behind')
    }
    for (const error of report.errors) lines.push(renderError(error, source?.mainJs ?? null))
    const failed = report.returned === false || leftovers.length > 0 || report.errors.length > 0
    return ok(lines.join('\n'), failed ? 1 : 0)
  }

  const renderClick = (report: ClickReport, mainJs: string | null) => {
    const { control } = report
    const lines = [
      `ext click ${report.id} ${control.path}${control.tooltip ? ` "${control.tooltip}"` : ''}${report.state ? `: ${report.state}` : ''}`,
    ]
    for (const element of report.shown) lines.push(`  shown  ${element}`)
    for (const element of report.hidden) lines.push(`  hidden ${element}`)
    if (report.shown.length === 0 && report.hidden.length === 0) {
      lines.push('no panel or DOM node of the extension changed visibility')
    }
    if (report.errors.length > 0) {
      lines.push(`errors (${report.errors.length}):`)
      for (const error of report.errors) {
        lines.push(
          renderError(error, mainJs)
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n'),
        )
      }
    } else {
      lines.push('errors: none')
    }
    return lines.join('\n')
  }

  const click = async (args: readonly string[]) => {
    const parsed = parseArgs(args, [])
    requireFlags(parsed, [], SUBCOMMANDS.click.usage)
    if (parsed.positional.length !== 2) throw new UsageError(`usage: ${SUBCOMMANDS.click.usage}`)
    const id = assertExtensionId(parsed.positional[0])
    const live = requireRuntime()
    const report = await live.click(id, parsed.positional[1])
    const mainJs = live.loaded().find((entry) => entry.id === id)?.source.mainJs ?? null
    return ok(renderClick(report, mainJs), report.errors.length > 0 ? 1 : 0)
  }

  const errors = async (args: readonly string[], fs: WorkspaceFs) => {
    const parsed = parseArgs(args, [])
    requireFlags(parsed, [], SUBCOMMANDS.errors.usage)
    if (parsed.positional.length > 1) throw new UsageError(`usage: ${SUBCOMMANDS.errors.usage}`)
    const id = parsed.positional[0] ? assertExtensionId(parsed.positional[0]) : undefined
    const live = requireRuntime()
    const captured = live.errors(id)
    const loadedIds = live.loaded().map((entry) => entry.id)
    if (captured.length === 0) {
      const scope = id ?? (loadedIds.length > 0 ? loadedIds.join(', ') : 'any extension')
      return ok(`no errors captured for ${scope} since its last ext load`)
    }
    const sources = new Map<string, string | null>()
    for (const error of captured) {
      if (sources.has(error.id)) continue
      const loaded = live.loaded().find((entry) => entry.id === error.id)
      const path = extensionPaths(error.id).main
      sources.set(
        error.id,
        loaded?.source.mainJs ?? ((await fs.exists(path)) ? await fs.readFile(path) : null),
      )
    }
    const lines = [`${plural(captured.length, 'error')} since the last ext load:`]
    for (const error of captured) {
      lines.push(renderError(error, sources.get(error.id) ?? null, true))
    }
    return ok(lines.join('\n'))
  }

  const exportZip = async (args: readonly string[], fs: WorkspaceFs, signal: AbortSignal) => {
    const parsed = parseArgs(args, [])
    requireFlags(parsed, ['force'], SUBCOMMANDS.export.usage)
    if (parsed.positional.length !== 1) throw new UsageError(`usage: ${SUBCOMMANDS.export.usage}`)
    const id = assertExtensionId(parsed.positional[0])
    const folder = await readExtensionFolder(fs, id)
    const checked = await runCheck(folder, true, signal)
    if (!checked) return interrupted()
    if (checked.errors > 0 && parsed.flags.get('force') !== true) {
      return fail(
        `not exported: ext check found ${plural(checked.errors, 'error')} (fix them, or pass --force)`,
        renderCheck(folder, checked),
      )
    }
    const source = toExtensionSource(folder)
    const bytes = buildExtensionZip(source)
    const fileName = zipFileName(id)
    const path = `${EXPORTS_DIR}/${fileName}`
    await fs.mkdir(EXPORTS_DIR, { recursive: true })
    await fs.writeFile(path, bytes)
    const entries = [`${id}/LOAD.md`, `${id}/config.json`, `${id}/contents/main.js`]
    if (source.mainCss !== null) entries.push(`${id}/contents/main.css`)
    const lines = [
      `wrote ${path} (${(bytes.length / 1024).toFixed(1)} KB)`,
      ...entries.map((entry) => `  ${entry}`),
    ]
    if (runtime) {
      runtime.download(fileName, bytes)
      lines.push(`the browser is downloading ${fileName}`)
    } else {
      lines.push('no page is attached, so nothing was downloaded')
    }
    if (checked.errors > 0) lines.push(`exported with ${plural(checked.errors, 'check error')}`)
    lines.push(`LOAD.md: include contents/main.js after viewer3D.js, then viewer.loadExtension('${id}')`)
    return ok(lines.join('\n'))
  }

  const run = async (
    args: readonly string[],
    context: CommandContext,
  ): Promise<WorkspaceExecResult> => {
    const [first = 'help', ...rest] = args
    const signal = context.signal ?? new AbortController().signal
    if (first === 'help' || first === '--help' || first === '-h') {
      const topic = rest[0]
      return ok(topic && SUBCOMMANDS[topic] ? subcommandHelp(topic) : extHelp())
    }
    if (!Object.hasOwn(SUBCOMMANDS, first)) {
      return fail(`unknown command "${first}"; run ext --help`)
    }
    if (rest.includes('--help') || rest.includes('-h')) return ok(subcommandHelp(first))
    try {
      switch (first) {
        case 'list':
          return await list(context.fs)
        case 'new':
          return await create(rest, context.fs)
        case 'check':
          return await check(rest, context.fs, signal)
        case 'load':
          return await load(rest, context.fs, signal)
        case 'click':
          return await click(rest)
        case 'unload':
          return await unload(rest)
        case 'errors':
          return await errors(rest, context.fs)
        case 'export':
          return await exportZip(rest, context.fs, signal)
        default:
          return fail(`unknown command "${first}"; run ext --help`)
      }
    } catch (error) {
      return fail(`${first}: ${errorLine(error)}`)
    }
  }

  return defineCommand('ext', (args, context) => run(args, context))
}

export function extReadme(): string {
  const sections = Object.entries(SUBCOMMANDS).map(
    ([name]) => `## ext ${name}\n\n\`\`\`\n${subcommandHelp(name)}\`\`\``,
  )
  return `# ext\n\n\`\`\`\n${extHelp()}\`\`\`\n\n${sections.join('\n\n')}\n`
}
