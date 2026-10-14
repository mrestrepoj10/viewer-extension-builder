import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal } from '@xterm/xterm'
import {
  type ConfigStore,
  createFxTerminal,
  type PromptHistoryStore,
  type TerminalRuntime,
  xtermAdapter,
} from 'libfx/browser'
import { createViewerWorkspace, type FxExecEvent } from '@/components/ui/fx-terminal/workspace'
import type { ExtensionRuntime } from '@/lib/extensions/runtime'
import type { ViewerAgentTools } from '@/lib/viewer-agent-tools'

export type FxColorScheme = 'light' | 'dark'

export interface FxGatewayRefusal {
  status: number
  type: string
  message: string
}

export interface FxTerminalSession {
  exited: Promise<number>
  focus(): void
  fit(): void
  setColorScheme(scheme: FxColorScheme): void
  dispose(): void
}

export interface FxTerminalStartOptions {
  tools: ViewerAgentTools
  extensions?: ExtensionRuntime
  gatewayBase: string
  model: string
  effort: string
  speed?: string
  colorScheme: FxColorScheme
  signal: AbortSignal
  onExec?: (event: FxExecEvent) => void
  onRefusal?: (refusal: FxGatewayRefusal) => void
}

const GATEWAY_ORIGIN = 'https://ai-gateway.vercel.sh'
const REFUSAL_STATUSES = new Set([400, 403, 413, 429, 503])
const INTERACTIVE_TIMEOUT_MS = 30_000
const STORAGE_PREFIX = 'cantera.fx.'
const HISTORY_LIMIT = 100

const darkTheme: ITheme = {
  background: '#0a0a0a',
  foreground: '#ededed',
  cursor: '#ededed',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#404040',
  black: '#0a0a0a',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d4d4d4',
  brightBlack: '#737373',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
}

const lightTheme: ITheme = {
  background: '#fafafa',
  foreground: '#0a0a0a',
  cursor: '#0a0a0a',
  cursorAccent: '#fafafa',
  selectionBackground: '#d4d4d4',
  black: '#171717',
  red: '#dc2626',
  green: '#15803d',
  yellow: '#a16207',
  blue: '#1d4ed8',
  magenta: '#9333ea',
  cyan: '#0e7490',
  white: '#737373',
  brightBlack: '#737373',
  brightRed: '#b91c1c',
  brightGreen: '#166534',
  brightYellow: '#854d0e',
  brightBlue: '#1e40af',
  brightMagenta: '#7e22ce',
  brightCyan: '#155e75',
  brightWhite: '#0a0a0a',
}

export function terminalBackground(scheme: FxColorScheme): string {
  return (scheme === 'dark' ? darkTheme : lightTheme).background ?? 'transparent'
}

function mirroredGreyscale(): string[] {
  const levels = [0, 95, 135, 175, 215, 255]
  const hex = (value: number) => value.toString(16).padStart(2, '0')
  const palette: string[] = []
  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) palette.push(`#${hex(r)}${hex(g)}${hex(b)}`)
    }
  }
  for (let step = 0; step < 24; step++) {
    const grey = hex(255 - (8 + 10 * step))
    palette.push(`#${grey}${grey}${grey}`)
  }
  return palette
}

// fx picks its muted greys once, for FX_THEME at start; after a live switch the
// 256-colour grey ramp is mirrored so that text stays readable.
function themeFor(scheme: FxColorScheme, startedAs: FxColorScheme): ITheme {
  const theme = scheme === 'dark' ? darkTheme : lightTheme
  return scheme === startedAs ? theme : { ...theme, extendedAnsi: mirroredGreyscale() }
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(STORAGE_PREFIX + key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) storage()?.removeItem(STORAGE_PREFIX + key)
    else storage()?.setItem(STORAGE_PREFIX + key, value)
  } catch {
    return
  }
}

// A stored model would override FX_MODEL, and the proxy refuses every other model.
function createConfigStore(model: string): ConfigStore {
  return {
    get(id) {
      const value = read(`config.${id}`)
      return id === 'model' && value !== model ? null : value
    },
    set(id, value) {
      write(`config.${id}`, value)
    },
  }
}

function loadHistory(root: string): string[] {
  try {
    const parsed: unknown = JSON.parse(read(`history.${root}`) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function createPromptHistoryStore(): PromptHistoryStore {
  return {
    load: (root, limit) => loadHistory(root).slice(-Math.max(0, limit)),
    append(root, value) {
      const entries = loadHistory(root)
      if (entries.at(-1) === value) return 'duplicate'
      write(`history.${root}`, JSON.stringify([...entries, value].slice(-HISTORY_LIMIT)))
    },
    clear: (root) => write(`history.${root}`, null),
  }
}

function localRefusal(url: string): Response {
  return Response.json(
    { error: { type: 'invalid-request', message: `Requests to ${url} are not allowed here.` } },
    { status: 403 },
  )
}

async function readRefusal(response: Response): Promise<FxGatewayRefusal | null> {
  try {
    const body: unknown = await response.clone().json()
    const error = body && typeof body === 'object' && 'error' in body ? body.error : null
    if (!error || typeof error !== 'object') return null
    const type = 'type' in error ? error.type : undefined
    const message = 'message' in error ? error.message : undefined
    if (typeof type !== 'string' || typeof message !== 'string') return null
    return { status: response.status, type, message }
  } catch {
    return null
  }
}

export function createGatewayFetch(
  gatewayBase: string,
  onRefusal?: (refusal: FxGatewayRefusal) => void,
): typeof fetch {
  const base = new URL(gatewayBase.replace(/\/$/, ''), globalThis.location?.href).href
  return async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return localRefusal(raw)
    }
    if (url.origin !== GATEWAY_ORIGIN) return localRefusal(`${url.origin}${url.pathname}`)
    const target = `${base}${url.pathname}${url.search}`
    const response = await fetch(
      input instanceof Request ? new Request(target, input) : target,
      init,
    )
    if (onRefusal && REFUSAL_STATUSES.has(response.status)) {
      const refusal = await readRefusal(response)
      if (refusal) onRefusal(refusal)
    }
    return response
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The browser terminal reads no effort from env or args, and fx cannot save
// /model to its settings file there (it prints an error), so effort is chosen
// through /model and the screen is reset with /clear before it is shown. fx's
// /clear wipes the scrollback itself; clearing xterm as well races its renderer.
async function applyEffort(
  runtime: TerminalRuntime,
  options: FxTerminalStartOptions,
  saved: Promise<void>,
) {
  const speed = options.speed ? ` ${options.speed}` : ''
  runtime.write(`/model ${options.model} ${options.effort}${speed}`)
  await sleep(150)
  runtime.write('\r')
  await Promise.race([saved, sleep(3000)])
  await sleep(150)
  runtime.write('/clear')
  await sleep(150)
  runtime.write('\r')
  await sleep(250)
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error('The terminal closed while the agent was starting.')
}

export async function startFxTerminal(
  container: HTMLElement,
  options: FxTerminalStartOptions,
): Promise<FxTerminalSession> {
  const terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 1,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    fontWeightBold: 600,
    lineHeight: 1.25,
    scrollback: 5000,
    scrollOnUserInput: true,
    theme: themeFor(options.colorScheme, options.colorScheme),
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  terminal.open(container)
  const safeFit = () => {
    try {
      if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit()
    } catch {
      return
    }
  }
  safeFit()
  let frame: number | null = null
  const resizeObserver = new ResizeObserver(() => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      safeFit()
    })
  })
  resizeObserver.observe(container)

  let runtime: TerminalRuntime | null = null
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (frame !== null) cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    try {
      runtime?.abort()
    } catch {
      return
    } finally {
      terminal.dispose()
    }
  }

  try {
    throwIfAborted(options.signal)
    const workspace = createViewerWorkspace(options.tools, {
      gatewayBase: options.gatewayBase,
      model: options.model,
      onExec: options.onExec,
      extensions: options.extensions,
    })
    let modelSaved = () => {}
    const saved = new Promise<void>((resolve) => {
      modelSaved = resolve
    })
    runtime = await createFxTerminal({
      terminal: xtermAdapter(terminal),
      env: {
        AI_GATEWAY_API_KEY: 'proxy',
        FX_MODEL: options.model,
        FX_THEME: options.colorScheme,
      },
      onEvent: (event) => {
        if (event.type === 'config.changed' && event.configId === 'model') modelSaved()
      },
      fetch: createGatewayFetch(options.gatewayBase, options.onRefusal),
      workspace,
      configStore: createConfigStore(options.model),
      promptHistoryStore: createPromptHistoryStore(),
    })
    throwIfAborted(options.signal)
    await withTimeout(
      runtime.interactive,
      INTERACTIVE_TIMEOUT_MS,
      'The agent did not start in time. Try again.',
    )
    throwIfAborted(options.signal)
    await applyEffort(runtime, options, saved)
    throwIfAborted(options.signal)
  } catch (error) {
    dispose()
    throw error
  }

  const started = runtime
  terminal.focus()
  return {
    exited: started.exited,
    focus: () => {
      if (!disposed) terminal.focus()
    },
    fit: () => {
      if (!disposed) safeFit()
    },
    setColorScheme: (scheme) => {
      if (!disposed) terminal.options.theme = themeFor(scheme, options.colorScheme)
    },
    dispose,
  }
}
