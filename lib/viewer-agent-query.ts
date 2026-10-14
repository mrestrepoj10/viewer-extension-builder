import type {
  LmvPropertyDatabase,
  PropertySnapshot,
  PropertySnapshotAttribute,
  PropertySnapshotExport,
  PropertyValue,
  ViewerAgentModel,
} from '@/lib/viewer-agent-core'
import type { ElementRow } from '@/lib/viewer-agent-state'

// Runs inside LMV's property worker, which receives it as source text: it must stay
// self-contained, with no imports and no references outside its own body.
export const exportPropertySnapshot = (
  pdb: LmvPropertyDatabase,
  maxPairs: number,
): PropertySnapshotExport => {
  const objectCount = pdb.getObjectCount()
  const offsets = new Int32Array(objectCount + 1)
  const pairList: number[] = []
  const values: PropertyValue[] = []
  const valueIndex = new Map<number, number>()
  let tooLarge = false
  for (let id = 1; id < objectCount; id++) {
    offsets[id] = pairList.length / 2
    if (tooLarge) continue
    pdb.enumObjectProperties(id, (attrId, valueId) => {
      if (pairList.length / 2 >= maxPairs) {
        tooLarge = true
        return
      }
      let index = valueIndex.get(valueId)
      if (index === undefined) {
        index = values.length
        values.push(pdb.getAttrValue(attrId, valueId))
        valueIndex.set(valueId, index)
      }
      pairList.push(attrId, index)
    })
  }
  offsets[objectCount] = pairList.length / 2
  if (tooLarge) return { ok: false, pairs: pairList.length / 2, limit: maxPairs }
  const attributes: PropertySnapshotAttribute[] = []
  pdb.enumAttributes((attrId, definition) => {
    attributes[attrId] = {
      name: String(definition.name || ''),
      category: String(definition.category || ''),
      displayName: String(definition.displayName || definition.name || ''),
      hidden: ((definition.flags || 0) & 1) === 1,
    }
  })
  for (let index = 0; index < attributes.length; index++) {
    if (!attributes[index]) {
      attributes[index] = { name: '', category: '', displayName: '', hidden: true }
    }
  }
  return {
    ok: true,
    objectCount,
    attributes,
    offsets,
    pairs: new Int32Array(pairList),
    values,
  }
}

function isSnapshotExport(value: unknown): value is PropertySnapshotExport {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  if (value.ok === false) return 'pairs' in value && typeof value.pairs === 'number'
  return (
    'offsets' in value &&
    value.offsets instanceof Int32Array &&
    'pairs' in value &&
    value.pairs instanceof Int32Array &&
    'attributes' in value &&
    Array.isArray(value.attributes) &&
    'values' in value &&
    Array.isArray(value.values)
  )
}

export async function loadPropertySnapshot(
  model: ViewerAgentModel,
  maxPairs: number,
): Promise<PropertySnapshot> {
  const result: unknown = await model
    .getPropertyDb()
    .executeUserFunction(exportPropertySnapshot, maxPairs)
  if (!isSnapshotExport(result)) throw new Error('the property database export was unreadable')
  if (!result.ok) {
    throw new Error(
      `this model's property database is too large for run_query (more than ${result.limit} properties); use find_elements and get_properties instead`,
    )
  }
  return result
}

export type QueryWorkerRequest =
  | { kind: 'load'; snapshot: PropertySnapshot; elements: readonly ElementRow[] }
  | { kind: 'run'; id: number; code: string; maxChars: number }

export type QueryRunResult =
  | { ok: true; text: string; count: number | null; truncated: boolean; logs: string[] }
  | { ok: false; error: string; logs: string[] }

export type QueryWorkerResponse =
  | { kind: 'loaded' }
  | { kind: 'result'; id: number; result: QueryRunResult }

export interface QueryWorkerScope {
  onmessage: ((event: { data: QueryWorkerRequest }) => void) | null
  postMessage(message: QueryWorkerResponse): void
}

type QueryConsole = {
  [method in 'log' | 'info' | 'warn' | 'error' | 'debug']: (...args: unknown[]) => void
}

// The sandbox worker's entry point, serialized with Function.prototype.toString: it must stay
// self-contained. It strips the network and storage globals before evaluating any query.
export const runQueryWorker = (scope: QueryWorkerScope): void => {
  const post = scope.postMessage.bind(scope)
  const blocked = [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'WebTransport',
    'EventSource',
    'importScripts',
    'indexedDB',
    'caches',
    'BroadcastChannel',
    'Worker',
    'SharedWorker',
    'postMessage',
  ]
  for (const name of blocked) {
    let target: object | null = scope
    while (target) {
      if (Object.hasOwn(target, name)) Reflect.deleteProperty(target, name)
      target = Object.getPrototypeOf(target)
    }
  }

  let snapshot: PropertySnapshot | null = null
  let elements: readonly ElementRow[] = []
  let instanceOf = -1
  const internal = (category: string) => category.startsWith('__') && category !== '__category__'
  const AsyncFunction: FunctionConstructor = new Function(
    'return (async function () {}).constructor',
  )()

  const collect = (id: number, into: Map<string, PropertyValue>, depth: number): void => {
    if (!snapshot || id < 1 || id >= snapshot.objectCount) return
    const start = snapshot.offsets[id]
    const end = snapshot.offsets[id + 1]
    if (depth < 2 && instanceOf >= 0) {
      for (let pair = start; pair < end; pair++) {
        if (snapshot.pairs[pair * 2] !== instanceOf) continue
        const parent = snapshot.values[snapshot.pairs[pair * 2 + 1]]
        if (typeof parent === 'number') collect(parent, into, depth + 1)
      }
    }
    for (let pair = start; pair < end; pair++) {
      const attribute = snapshot.attributes[snapshot.pairs[pair * 2]]
      if (!attribute || attribute.hidden || internal(attribute.category)) continue
      into.set(attribute.displayName, snapshot.values[snapshot.pairs[pair * 2 + 1]])
    }
  }

  const pdb = {
    get objectCount(): number {
      return snapshot ? snapshot.objectCount : 0
    },
    elements: () => elements.map((row) => ({ ...row })),
    leaves: () => elements.map((row) => row.dbId),
    name: (id: number) => elements.find((row) => row.dbId === id)?.name ?? '',
    props: (id: number) => {
      const map = new Map<string, PropertyValue>()
      collect(id, map, 0)
      return Object.fromEntries(map)
    },
    prop: (id: number, name: string) => {
      const map = new Map<string, PropertyValue>()
      collect(id, map, 0)
      return map.get(name)
    },
    find: (predicate: (id: number, db: unknown) => boolean): number[] =>
      elements.filter((row) => predicate(row.dbId, pdb)).map((row) => row.dbId),
    attributes: () => {
      const names = new Set<string>()
      for (const attribute of snapshot?.attributes ?? []) {
        if (!attribute.hidden && !internal(attribute.category)) {
          names.add(attribute.displayName)
        }
      }
      return [...names].sort()
    },
    getObjectCount: () => (snapshot ? snapshot.objectCount : 0),
    enumObjectProperties: (id: number, callback: (attrId: number, valueId: number) => void) => {
      if (!snapshot || id < 1 || id >= snapshot.objectCount) return
      for (let pair = snapshot.offsets[id]; pair < snapshot.offsets[id + 1]; pair++) {
        callback(snapshot.pairs[pair * 2], snapshot.pairs[pair * 2 + 1])
      }
    },
    getAttributeDef: (attrId: number) => snapshot?.attributes[attrId],
    getAttrValue: (_attrId: number, valueId: number) => snapshot?.values[valueId],
  }

  const describe = (value: unknown): string => {
    if (typeof value === 'string') return value
    try {
      return String(JSON.stringify(value))
    } catch {
      return String(value)
    }
  }

  const replacer = (_key: string, value: unknown) => {
    if (value instanceof Map) return Object.fromEntries(value)
    if (value instanceof Set) return [...value]
    if (value instanceof Int32Array || value instanceof Float64Array) return [...value]
    if (typeof value === 'bigint') return value.toString()
    return value
  }

  const compile = (code: string) => {
    const trimmed = code.trim().replace(/;+\s*$/, '')
    try {
      const expression = new Function('pdb', 'console', `"use strict";\nreturn (\n${trimmed}\n);`)
      return (log: QueryConsole) => {
        const value = expression(pdb, log)
        return typeof value === 'function' ? value(pdb, log) : value
      }
    } catch {
      const body = new AsyncFunction('pdb', 'console', `"use strict";\n${code}`)
      return (log: QueryConsole) => body(pdb, log)
    }
  }

  scope.onmessage = (event) => {
    const message = event.data
    if (message.kind === 'load') {
      snapshot = message.snapshot
      elements = message.elements
      instanceOf = snapshot.attributes.findIndex((item) => item.category === '__instanceof__')
      post({ kind: 'loaded' })
      return
    }
    const { id, maxChars } = message
    const logs: string[] = []
    const capture = (...args: unknown[]) => {
      if (logs.length < 50) logs.push(args.map(describe).join(' ').slice(0, 500))
    }
    const log: QueryConsole = {
      log: capture,
      info: capture,
      warn: capture,
      error: capture,
      debug: capture,
    }
    Promise.resolve()
      .then(() => {
        if (!snapshot) throw new Error('no property database is loaded')
        return compile(message.code)(log)
      })
      .then((value) => {
        const text =
          value === undefined
            ? 'undefined'
            : typeof value === 'string'
              ? value
              : String(JSON.stringify(value, replacer))
        post({
          kind: 'result',
          id,
          result: {
            ok: true,
            text: text.slice(0, maxChars),
            count: Array.isArray(value) ? value.length : null,
            truncated: text.length > maxChars,
            logs,
          },
        })
      })
      .catch((error: unknown) => {
        post({
          kind: 'result',
          id,
          result: {
            ok: false,
            error: error instanceof Error ? `${error.name}: ${error.message}` : describe(error),
            logs,
          },
        })
      })
  }
}

export interface QueryWorkerHandle {
  post(message: QueryWorkerRequest): void
  listen(
    onMessage: (message: QueryWorkerResponse) => void,
    onError: (message: string) => void,
  ): void
  terminate(): void
}

export function queryWorkerSource(): string {
  return `"use strict";\n(${String(runQueryWorker)})(self);\n`
}

export function createBrowserQueryWorker(): QueryWorkerHandle {
  const url = URL.createObjectURL(new Blob([queryWorkerSource()], { type: 'text/javascript' }))
  const worker = new Worker(url)
  return {
    post: (message) => worker.postMessage(message),
    listen: (onMessage, onError) => {
      worker.onmessage = (event: MessageEvent<QueryWorkerResponse>) => onMessage(event.data)
      worker.onerror = (event) => {
        event.preventDefault()
        onError(event.message || 'the query worker failed')
      }
    },
    terminate: () => {
      worker.terminate()
      URL.revokeObjectURL(url)
    },
  }
}

export interface QueryRunRequest {
  key: number
  snapshot: PropertySnapshot
  elements: readonly ElementRow[]
  code: string
  timeoutMs: number
  maxChars: number
  signal: AbortSignal
}

/** One worker per sandbox, holding the latest model's snapshot. A query that overruns its
 * time box, or is cancelled, terminates the worker; the next query starts a fresh one. */
export class QuerySandbox {
  private worker: QueryWorkerHandle | null = null
  private loadedKey: number | null = null
  private sequence = 0
  private pending = new Map<number, (result: QueryRunResult) => void>()
  private readonly createWorker: () => QueryWorkerHandle

  constructor(createWorker: () => QueryWorkerHandle = createBrowserQueryWorker) {
    this.createWorker = createWorker
  }

  run(request: QueryRunRequest): Promise<QueryRunResult> {
    if (request.signal.aborted) return Promise.resolve({ ok: false, error: 'cancelled', logs: [] })
    const worker = this.ensureWorker()
    if (this.loadedKey !== request.key) {
      worker.post({ kind: 'load', snapshot: request.snapshot, elements: request.elements })
      this.loadedKey = request.key
    }
    this.sequence += 1
    const id = this.sequence
    return new Promise((resolve) => {
      const finish = (result: QueryRunResult) => {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', onAbort)
        this.pending.delete(id)
        resolve(result)
      }
      const stop = (error: string) => {
        this.reset()
        finish({ ok: false, error, logs: [] })
      }
      const onAbort = () => stop('cancelled')
      const timer = setTimeout(
        () => stop(`timed out after ${request.timeoutMs} ms; the query was stopped`),
        request.timeoutMs,
      )
      request.signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, finish)
      worker.post({ kind: 'run', id, code: request.code, maxChars: request.maxChars })
    })
  }

  dispose(): void {
    this.reset()
  }

  private ensureWorker(): QueryWorkerHandle {
    if (this.worker) return this.worker
    const worker = this.createWorker()
    worker.listen(
      (message) => {
        if (message.kind === 'result') this.pending.get(message.id)?.(message.result)
      },
      (error) => {
        const waiting = [...this.pending.values()]
        this.reset()
        for (const finish of waiting) finish({ ok: false, error, logs: [] })
      },
    )
    this.worker = worker
    return worker
  }

  private reset(): void {
    this.worker?.terminate()
    this.worker = null
    this.loadedKey = null
  }
}
