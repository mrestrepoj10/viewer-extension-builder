import { downloadBytes } from '@/lib/extensions/export'
import { type ExtensionSource, MAIN_CSS, MAIN_JS, sourceUrlFor } from '@/lib/extensions/format'

export type ErrorPhase = 'script' | 'load' | 'runtime' | 'unload'

export interface CapturedError {
  id: string
  phase: ErrorPhase
  kind: 'error' | 'rejection' | 'console'
  message: string
  line?: number
  column?: number
  at: number
}

export interface ToolbarControl {
  path: string
  tooltip?: string
}

export interface LoadedExtension {
  id: string
  displayname: string
  loadedAt: number
  controls: ToolbarControl[]
  errorCount: number
  source: ExtensionSource
}

export interface LoadReport {
  id: string
  replaced: boolean
  registered: boolean
  /** null when load() never ran (the script failed or did not register). */
  returned: boolean | null
  errors: CapturedError[]
  warnings: string[]
  controls: ToolbarControl[]
  elements: string[]
  ms: number
}

export interface UnloadReport {
  id: string
  wasLoaded: boolean
  returned: boolean | null
  errors: CapturedError[]
  leftovers: { controls: string[]; elements: string[]; listeners: string[] }
}

export interface ClickReport {
  id: string
  control: ToolbarControl
  state: 'active' | 'inactive' | 'disabled' | null
  shown: string[]
  hidden: string[]
  errors: CapturedError[]
}

export interface ExtensionRuntime {
  load(source: ExtensionSource): Promise<LoadReport>
  unload(id: string): Promise<UnloadReport>
  click(id: string, controlId: string): Promise<ClickReport>
  errors(id?: string): CapturedError[]
  loaded(): readonly LoadedExtension[]
  isLoaded(id: string): boolean
  subscribe(listener: () => void): () => void
  download(fileName: string, bytes: Uint8Array): void
  dispose(): void
}

interface ToolbarNode {
  getId(): string
  getNumberOfControls?: () => number
  getControlId?: (index: number) => string
  getControl?: (id: string) => unknown
  removeControl?: (control: unknown) => unknown
  getToolTip?: () => string
}

export interface ExtensionHostViewer {
  container: HTMLElement
  toolbar?: unknown
  loadExtension(id: string, options?: object): Promise<unknown>
  unloadExtension(id: string): boolean
  addEventListener(type: string, listener: (event: unknown) => void): unknown
  removeEventListener(type: string, listener: (event: unknown) => void): unknown
}

const SCRIPT_TIMEOUT_MS = 5_000
const CLICK_SETTLE_MS = 5_000
const LOAD_TIMEOUT_MS = 10_000
const ERROR_LIMIT = 50
// Top-level const and class in a classic script land in the page's global lexical scope, so a
// second load would throw "already declared". The wrapper opens on line 1 to keep line numbers.
const WRAP_OPEN = '(() => {'
const WRAP_CLOSE = '\n})()\n'
const OWNER_PATTERN = /ext\/([A-Za-z_$][\w$]*)\/main\.(?:js|css):(\d+):(\d+)/

function unwrapped(line: number, column: number) {
  return { line, column: line === 1 ? Math.max(1, column - WRAP_OPEN.length) : column }
}

function isToolbarNode(value: unknown): value is ToolbarNode {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'getId') === 'function'
  )
}

function walkToolbar(node: unknown, prefix: string, visit: (entry: ToolbarEntry) => void) {
  if (!isToolbarNode(node) || !node.getNumberOfControls || !node.getControlId || !node.getControl)
    return
  const count = node.getNumberOfControls()
  for (let index = 0; index < count; index++) {
    const childId = node.getControlId(index)
    const child = node.getControl(childId)
    const path = prefix ? `${prefix}/${childId}` : childId
    visit({ path, parent: node, control: child })
    walkToolbar(child, path, visit)
  }
}

interface ToolbarEntry {
  path: string
  parent: ToolbarNode
  control: unknown
}

function toolbarEntries(viewer: ExtensionHostViewer): Map<string, ToolbarEntry> {
  const entries = new Map<string, ToolbarEntry>()
  walkToolbar(viewer.toolbar, '', (entry) => entries.set(entry.path, entry))
  return entries
}

function describeControl(entry: ToolbarEntry): ToolbarControl {
  const tooltip = isToolbarNode(entry.control) ? entry.control.getToolTip?.() : undefined
  return tooltip ? { path: entry.path, tooltip } : { path: entry.path }
}

function describeElement(element: Element): string {
  const id = element.id ? `#${element.id}` : ''
  const classes = [...element.classList]
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join('')
  const title = element.querySelector('.docking-panel-title')?.textContent?.trim()
  return `${element.tagName.toLowerCase()}${id}${classes}${title ? ` "${title}"` : ''}`
}

const BUTTON_STATES = ['active', 'inactive', 'disabled'] as const

function buttonState(control: unknown): ClickReport['state'] {
  if (!isToolbarNode(control)) return null
  const getState: unknown = Reflect.get(control, 'getState')
  if (typeof getState !== 'function') return null
  const state: unknown = Reflect.apply(getState, control, [])
  return typeof state === 'number' ? (BUTTON_STATES[state] ?? null) : null
}

const TEXT_EXCERPT = 240

function describeWithText(element: Element): string {
  const visibleText = (node: Element | null) =>
    node instanceof HTMLElement ? node.innerText : (node?.textContent ?? '')
  const title = visibleText(element.querySelector('.docking-panel-title'))
  const raw = visibleText(element)
  const text = raw
    .replace(title, '')
    .split(/\s*\n\s*/)
    .filter(Boolean)
    .join(' | ')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
  if (!text) return describeElement(element)
  const excerpt = text.length > TEXT_EXCERPT ? `${text.slice(0, TEXT_EXCERPT)}…` : text
  return `${describeElement(element)}: ${excerpt}`
}

function isShown(element: Element): boolean {
  return element.isConnected && element.checkVisibility()
}

function errorText(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function stackOf(value: unknown): string {
  return value instanceof Error && typeof value.stack === 'string' ? value.stack : ''
}

function currentStack(): string {
  return new Error().stack ?? ''
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 30))
  })
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

interface ExtensionManagerLike {
  unregisterExtension(id: string): boolean
  getExtensionClass?: (id: string) => unknown
}

function extensionManager(): ExtensionManagerLike | null {
  return window.Autodesk?.Viewing?.theExtensionManager ?? null
}

interface LoadedRecord {
  id: string
  source: ExtensionSource
  loadedAt: number
  controls: ToolbarControl[]
  script: HTMLScriptElement | null
  style: HTMLStyleElement | null
  blobUrl: string
}

interface Attributed {
  listeners: Map<string, Array<{ type: string; listener: unknown }>>
  controls: Map<string, Array<{ group: ToolbarNode; control: unknown }>>
  elements: Map<string, Set<Element>>
}

type Restore = () => void

export function createExtensionRuntime(
  getViewer: () => ExtensionHostViewer | null,
): ExtensionRuntime {
  const records = new Map<string, LoadedRecord>()
  const history = new Map<string, CapturedError[]>()
  const listeners = new Set<() => void>()
  const attributed: Attributed = { listeners: new Map(), controls: new Map(), elements: new Map() }
  const restores: Restore[] = []
  const patchedViewers = new WeakSet<object>()
  let snapshot: readonly LoadedExtension[] = Object.freeze([])
  let loading: {
    id: string
    phase: ErrorPhase
    errors: CapturedError[]
    warnings: string[]
  } | null = null
  let installed = false
  let loadingBlob = ''
  let groupsPatched = false

  const emit = () => {
    snapshot = Object.freeze(
      [...records.values()].map((record) => ({
        id: record.id,
        displayname: record.source.config.displayname,
        loadedAt: record.loadedAt,
        controls: record.controls,
        errorCount: history.get(record.id)?.length ?? 0,
        source: record.source,
      })),
    )
    for (const listener of listeners) listener()
  }

  const tracking = () => loading !== null || records.size > 0

  const ownerFromStack = (stack: string): string | null => {
    if (!stack) return null
    const pattern = new RegExp(OWNER_PATTERN.source, 'g')
    for (const match of stack.matchAll(pattern)) {
      const id = match[1]
      if (records.has(id) || loading?.id === id) return id
    }
    return null
  }

  const locate = (id: string, stack: string, filename?: string, line?: number, column?: number) => {
    const record = records.get(id)
    const ours =
      filename === record?.blobUrl ||
      (filename !== undefined && filename === loadingBlob) ||
      filename?.endsWith(sourceUrlFor(id))
    if (filename && line && ours) return unwrapped(line, column ?? 1)
    const pattern = new RegExp(`ext/${id.replace(/\$/g, '\\$')}/main\\.js:(\\d+):(\\d+)`)
    const match = pattern.exec(stack)
    return match ? unwrapped(Number(match[1]), Number(match[2])) : {}
  }

  const record = (id: string, entry: Omit<CapturedError, 'id' | 'at' | 'phase'>) => {
    const phase: ErrorPhase = loading?.id === id ? loading.phase : 'runtime'
    const captured: CapturedError = { id, phase, at: Date.now(), ...entry }
    if (loading?.id === id) loading.errors.push(captured)
    const list = history.get(id) ?? []
    list.push(captured)
    if (list.length > ERROR_LIMIT) list.splice(0, list.length - ERROR_LIMIT)
    history.set(id, list)
    if (!loading && records.has(id)) emit()
  }

  const ownerOfBlob = (filename: string): string | null => {
    for (const entry of records.values()) if (entry.blobUrl === filename) return entry.id
    return null
  }

  const onError = (event: ErrorEvent) => {
    const stack = stackOf(event.error)
    const owner =
      ownerOfBlob(event.filename) ??
      (event.filename?.includes('/main.js') ? ownerFromStack(`${event.filename}:0:0`) : null) ??
      ownerFromStack(stack) ??
      (loading && event.filename === loadingBlob ? loading.id : null)
    if (!owner) return
    record(owner, {
      kind: 'error',
      message: event.error ? errorText(event.error) : event.message,
      ...locate(owner, stack, event.filename, event.lineno, event.colno),
    })
  }

  const onRejection = (event: PromiseRejectionEvent) => {
    const stack = stackOf(event.reason)
    const owner = ownerFromStack(stack)
    if (!owner) return
    record(owner, { kind: 'rejection', message: errorText(event.reason), ...locate(owner, stack) })
  }

  const patchMethod = (
    target: object,
    name: string,
    wrap: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
  ) => {
    const original: unknown = Reflect.get(target, name)
    if (typeof original !== 'function') return
    const own = Object.hasOwn(target, name)
    const bound = (...args: unknown[]) => Reflect.apply(original, target, args)
    const replacement = wrap(bound)
    Reflect.set(target, name, replacement)
    restores.push(() => {
      if (Reflect.get(target, name) !== replacement) return
      if (own) Reflect.set(target, name, original)
      else Reflect.deleteProperty(target, name)
    })
  }

  const patchConsole = (level: 'error' | 'warn') => {
    patchMethod(console, level, (original) => (...args: unknown[]) => {
      if (tracking()) {
        const errorArg = args.find((arg) => arg instanceof Error)
        const stack = stackOf(errorArg)
        const owner = ownerFromStack(stack) ?? ownerFromStack(currentStack()) ?? loading?.id ?? null
        if (owner) {
          const message = args.map(errorText).join(' ')
          if (level === 'warn' && loading?.id === owner) loading.warnings.push(message)
          else if (level === 'error') {
            record(owner, { kind: 'console', message, ...locate(owner, stack || currentStack()) })
          }
        }
      }
      return original(...args)
    })
  }

  const patchAppend = (element: HTMLElement) => {
    for (const name of ['appendChild', 'append', 'insertBefore'] as const) {
      patchMethod(element, name, (original) => (...args: unknown[]) => {
        const result = original(...args)
        if (tracking()) {
          const owner = ownerFromStack(currentStack())
          const node = args[0]
          if (owner && node instanceof Element) {
            const set = attributed.elements.get(owner) ?? new Set<Element>()
            set.add(node)
            attributed.elements.set(owner, set)
          }
        }
        return result
      })
    }
  }

  const patchViewer = (viewer: ExtensionHostViewer) => {
    if (patchedViewers.has(viewer)) return
    patchedViewers.add(viewer)
    patchMethod(viewer, 'addEventListener', (original) => (...args: unknown[]) => {
      if (tracking()) {
        const owner = ownerFromStack(currentStack())
        if (owner && typeof args[0] === 'string') {
          const list = attributed.listeners.get(owner) ?? []
          list.push({ type: args[0], listener: args[1] })
          attributed.listeners.set(owner, list)
        }
      }
      return original(...args)
    })
    patchMethod(viewer, 'removeEventListener', (original) => (...args: unknown[]) => {
      for (const list of attributed.listeners.values()) {
        const index = list.findIndex(
          (entry) => entry.type === args[0] && entry.listener === args[1],
        )
        if (index >= 0) list.splice(index, 1)
      }
      return original(...args)
    })
    patchAppend(viewer.container)
  }

  const patchGroups = () => {
    if (groupsPatched) return
    const ui = window.Autodesk?.Viewing?.UI
    if (!ui) return
    groupsPatched = true
    for (const klass of [ui.ControlGroup, ui.ToolBar]) {
      const proto: unknown = klass?.prototype
      if (typeof proto !== 'object' || proto === null || !Object.hasOwn(proto, 'addControl')) {
        continue
      }
      const original: unknown = Reflect.get(proto, 'addControl')
      if (typeof original !== 'function') continue
      const replacement = function (this: unknown, ...args: unknown[]) {
        const result: unknown = Reflect.apply(original, this, args)
        if (tracking() && isToolbarNode(this)) {
          const owner = ownerFromStack(currentStack())
          if (owner) {
            const list = attributed.controls.get(owner) ?? []
            list.push({ group: this, control: args[0] })
            attributed.controls.set(owner, list)
          }
        }
        return result
      }
      Reflect.set(proto, 'addControl', replacement)
      restores.push(() => {
        if (Reflect.get(proto, 'addControl') === replacement)
          Reflect.set(proto, 'addControl', original)
      })
    }
  }

  const install = () => {
    if (installed) return
    installed = true
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    restores.push(() => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    })
    patchConsole('error')
    patchConsole('warn')
    patchAppend(document.body)
  }

  const requireViewer = (): ExtensionHostViewer => {
    const viewer = getViewer()
    if (!viewer) throw new Error('the viewer is not ready yet; wait for the model to load')
    install()
    patchViewer(viewer)
    patchGroups()
    return viewer
  }

  const injectScript = (
    id: string,
    code: string,
  ): Promise<{ blobUrl: string; script: HTMLScriptElement }> => {
    const blob = new Blob(
      [`${WRAP_OPEN}${code}${WRAP_CLOSE}//# sourceURL=${sourceUrlFor(id, MAIN_JS)}\n`],
      {
        type: 'text/javascript',
      },
    )
    const blobUrl = URL.createObjectURL(blob)
    loadingBlob = blobUrl
    const script = document.createElement('script')
    script.src = blobUrl
    script.dataset.extension = id
    const done = new Promise<{ blobUrl: string; script: HTMLScriptElement }>((resolve, reject) => {
      script.onload = () => resolve({ blobUrl, script })
      script.onerror = () => reject(new Error(`the browser refused to run ${sourceUrlFor(id)}`))
    })
    document.head.append(script)
    return withTimeout(done, SCRIPT_TIMEOUT_MS, `${sourceUrlFor(id)} did not finish loading`)
  }

  const injectStyle = (id: string, css: string): HTMLStyleElement => {
    const style = document.createElement('style')
    style.dataset.extension = id
    style.textContent = `${css}\n/*# sourceURL=${sourceUrlFor(id, MAIN_CSS)} */\n`
    document.head.append(style)
    return style
  }

  const cleanupLeftovers = (id: string, viewer: ExtensionHostViewer) => {
    const leftovers = {
      controls: [] as string[],
      elements: [] as string[],
      listeners: [] as string[],
    }
    for (const { type, listener } of [...(attributed.listeners.get(id) ?? [])]) {
      leftovers.listeners.push(type)
      Reflect.apply(viewer.removeEventListener, viewer, [type, listener])
    }
    for (const { group, control } of [...(attributed.controls.get(id) ?? [])].reverse()) {
      if (!isToolbarNode(control)) continue
      const controlId = control.getId()
      if (group.getControl?.(controlId) !== control) continue
      // A shared group (aps-extensions-toolbar) that still holds other extensions' buttons stays.
      if ((control.getNumberOfControls?.() ?? 0) > 0) continue
      leftovers.controls.push(`${group.getId()}/${controlId}`)
      group.removeControl?.(control)
    }
    for (const element of attributed.elements.get(id) ?? []) {
      if (!element.isConnected) continue
      leftovers.elements.push(describeElement(element))
      element.remove()
    }
    attributed.listeners.delete(id)
    attributed.controls.delete(id)
    attributed.elements.delete(id)
    return leftovers
  }

  const unload = async (id: string): Promise<UnloadReport> => {
    const viewer = requireViewer()
    const target = records.get(id)
    const report: UnloadReport = {
      id,
      wasLoaded: Boolean(target),
      returned: null,
      errors: [],
      leftovers: { controls: [], elements: [], listeners: [] },
    }
    loading = { id, phase: 'unload', errors: [], warnings: [] }
    try {
      try {
        report.returned = viewer.unloadExtension(id)
      } catch (error) {
        record(id, { kind: 'error', message: errorText(error), ...locate(id, stackOf(error)) })
        report.returned = false
      }
      extensionManager()?.unregisterExtension(id)
      await nextFrame()
      report.leftovers = cleanupLeftovers(id, viewer)
      report.errors = loading.errors
    } finally {
      loading = null
      if (target) {
        target.script?.remove()
        target.style?.remove()
        URL.revokeObjectURL(target.blobUrl)
        records.delete(id)
      }
      emit()
    }
    return report
  }

  const load = async (source: ExtensionSource): Promise<LoadReport> => {
    const viewer = requireViewer()
    const started = performance.now()
    const { id } = source
    const replaced = records.has(id)
    if (replaced) await unload(id)
    else extensionManager()?.unregisterExtension(id)

    const before = toolbarEntries(viewer)
    const report: LoadReport = {
      id,
      replaced,
      registered: false,
      returned: null,
      errors: [],
      warnings: [],
      controls: [],
      elements: [],
      ms: 0,
    }
    history.set(id, [])
    const state = {
      id,
      phase: 'script' as ErrorPhase,
      errors: [] as CapturedError[],
      warnings: [] as string[],
    }
    loading = state
    let style: HTMLStyleElement | null = null
    let script: HTMLScriptElement | null = null
    let blobUrl = ''
    try {
      if (source.mainCss !== null) style = injectStyle(id, source.mainCss)
      try {
        const injected = await injectScript(id, source.mainJs)
        script = injected.script
        blobUrl = injected.blobUrl
      } catch (error) {
        record(id, { kind: 'error', message: errorText(error) })
      }
      const manager = extensionManager()
      report.registered = Boolean(manager?.getExtensionClass?.(id))
      if (state.errors.length === 0 && !report.registered) {
        state.errors.push({
          id,
          phase: 'script',
          kind: 'error',
          message: `main.js ran but did not register '${id}'; call Autodesk.Viewing.theExtensionManager.registerExtension('${id}', ${id})`,
          at: Date.now(),
        })
      }
      if (report.registered && state.errors.length === 0) {
        const entry: LoadedRecord = {
          id,
          source,
          loadedAt: Date.now(),
          controls: [],
          script,
          style,
          blobUrl,
        }
        records.set(id, entry)
        state.phase = 'load'
        try {
          await withTimeout(
            viewer.loadExtension(id, source.config.options),
            LOAD_TIMEOUT_MS,
            `viewer.loadExtension('${id}') did not settle within ${LOAD_TIMEOUT_MS / 1000} s`,
          )
          report.returned = true
        } catch (error) {
          report.returned = false
          const stack = stackOf(error)
          const duplicate = state.errors.some((item) => item.message === errorText(error))
          if (!duplicate)
            record(id, { kind: 'error', message: errorText(error), ...locate(id, stack) })
        }
        await nextFrame()
      }
      const after = toolbarEntries(viewer)
      report.controls = [...after.values()]
        .filter((entry) => !before.has(entry.path))
        .map(describeControl)
      report.elements = [...(attributed.elements.get(id) ?? [])]
        .filter((element) => element.isConnected)
        .map(describeElement)
      report.errors = [...state.errors]
      report.warnings = [...state.warnings]
    } finally {
      loading = null
    }
    const entry = records.get(id)
    if (report.returned) {
      if (entry) entry.controls = report.controls
    } else {
      if (entry) {
        try {
          viewer.unloadExtension(id)
        } catch {
          // A half-loaded extension can throw from unload(); the load errors already explain it.
        }
        records.delete(id)
      }
      cleanupLeftovers(id, viewer)
      extensionManager()?.unregisterExtension(id)
      script?.remove()
      style?.remove()
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
    report.ms = Math.round(performance.now() - started)
    emit()
    return report
  }

  const click = async (id: string, controlId: string): Promise<ClickReport> => {
    const viewer = requireViewer()
    const target = records.get(id)
    if (!target) throw new Error(`${id} is not loaded; run ext load ${id} first`)
    const owned = target.controls.map((control) => control.path)
    const matches = [...toolbarEntries(viewer).values()].filter(
      (entry) => entry.path === controlId || entry.path.endsWith(`/${controlId}`),
    )
    const entry = matches.find((match) => owned.includes(match.path)) ?? matches[0]
    if (!entry) {
      throw new Error(
        `no toolbar control "${controlId}"; ${id} added: ${owned.join(', ') || 'none'}`,
      )
    }
    const container: unknown = isToolbarNode(entry.control)
      ? Reflect.get(entry.control, 'container')
      : null
    if (!(container instanceof HTMLElement)) {
      throw new Error(`${entry.path} has no element to click`)
    }
    const elements = () => [...(attributed.elements.get(id) ?? [])]
    const before = new Set(elements().filter(isShown))
    const started = Date.now()
    container.click()
    await nextFrame()
    await nextFrame()
    // Panels often fill in after an async property query; wait for their text to settle and
    // for loading placeholders ("Counting doors…") to go away.
    const textOf = () =>
      elements()
        .map((element) => element.textContent ?? '')
        .join('\n')
    const deadline = performance.now() + CLICK_SETTLE_MS
    let previous = textOf()
    let stable = 0
    const pending = (text: string) => /…|\.\.\./.test(text)
    while ((stable < 2 || pending(previous)) && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const current = textOf()
      stable = current === previous ? stable + 1 : 0
      previous = current
    }
    const after = elements()
    return {
      id,
      control: describeControl(entry),
      state: buttonState(entry.control),
      shown: after
        .filter((element) => isShown(element) && !before.has(element))
        .map(describeWithText),
      hidden: [...before].filter((element) => !isShown(element)).map(describeElement),
      errors: (history.get(id) ?? []).filter((error) => error.at >= started),
    }
  }

  return {
    load,
    unload,
    click,
    errors(id) {
      const all = id ? (history.get(id) ?? []) : [...history.values()].flat()
      return [...all].sort((a, b) => a.at - b.at)
    },
    loaded: () => snapshot,
    isLoaded: (id) => records.has(id),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    download(fileName, bytes) {
      downloadBytes(fileName, bytes)
    },
    dispose() {
      for (const restore of restores.splice(0).reverse()) restore()
      installed = false
      groupsPatched = false
    },
  }
}
