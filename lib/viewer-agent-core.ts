import type {
  AgentToolResult,
  AgentToolSchema,
  AgentToolSchemaProperty,
  JsonValue,
} from '@/lib/agent-types'
import type { QueryRunResult } from '@/lib/viewer-agent-query'
import type {
  ColorLedger,
  ElementIndex,
  ElementRow,
  ElementSetStore,
  ViewerSnapshot,
} from '@/lib/viewer-agent-state'
import type { Vec3 } from '@/lib/viewer-types'

type PropertyResult = Autodesk.Viewing.PropertyResult

export interface ViewerAgentTree {
  getRootId(): number
  getChildCount(dbId: number): number
  getNodeName(dbId: number): string
  enumNodeChildren(dbId: number, callback: (dbId: number) => void, recursive?: boolean): void
  enumNodeFragments(dbId: number, callback: (fragId: number) => void, recursive?: boolean): void
}

export interface ViewerAgentDocumentNode {
  guid(): string
  name(): string
  is2D(): boolean
  is3D(): boolean
  getDocument(): ViewerAgentDocument
}

export interface ViewerAgentDocument {
  getRoot(): { search(props: { type?: string; role?: string }): ViewerAgentDocumentNode[] }
  downloadAecModelData(): Promise<AecModelData | null>
}

/** The slice of a document's AEC model data the index reads; parsed before use. */
export interface AecModelData {
  levels?: unknown
}

export interface ViewerAgentModel {
  getObjectTree(
    onSuccess: (tree: ViewerAgentTree) => void,
    onError?: (error: unknown) => void,
  ): void
  getBulkProperties2(
    dbIds: number[],
    options: { propFilter?: string[] },
    onSuccess: (results: PropertyResult[]) => void,
    onError: (error: unknown) => void,
  ): void
  getFragmentList(): { getWorldBounds(fragId: number, box: THREE.Box3): void }
  getBoundingBox(): { min: Vec3; max: Vec3 }
  getUnitString(): string
  getUnitScale(): number
  getDocumentNode(): ViewerAgentDocumentNode | null
  getPropertyDb(): {
    executeUserFunction(
      userFunction: (pdb: LmvPropertyDatabase, userData: number) => PropertySnapshotExport,
      userData: number,
    ): Promise<PropertySnapshotExport>
  }
  is2d(): boolean
  isLoadDone(): boolean
  isObjectTreeCreated(): boolean
}

export interface ViewerAgentNavigation {
  getPosition(): Vec3
  getTarget(): Vec3
  getCameraUpVector(): Vec3
  setView(position: THREE.Vector3, target: THREE.Vector3): void
  setCameraUpVector(up: THREE.Vector3): void
  setPivotPoint(pivot: THREE.Vector3): void
}

export interface ViewerAgentState {
  [key: string]: JsonValue
}

/** The members of `APSViewer3D` the tool catalog drives; a real viewer satisfies it. */
export interface ViewerAgentViewer {
  model: ViewerAgentModel | null
  navigation: ViewerAgentNavigation
  container: { clientWidth: number; clientHeight: number }
  impl: { invalidate(needsClear: boolean, needsRender?: boolean, overlayDirty?: boolean): void }
  getSelection(): number[]
  select(dbIds: number[] | number): void
  clearSelection(): void
  isolate(dbIds?: number[] | number): void
  hide(dbIds: number[] | number): void
  showAll(): void
  fitToView(dbIds?: number[] | null, model?: ViewerAgentModel, immediate?: boolean): void
  setThemingColor(
    dbId: number,
    color: THREE.Vector4,
    model?: ViewerAgentModel,
    recursive?: boolean,
  ): void
  clearThemingColors(model: ViewerAgentModel): void
  setCutPlanes(planes: THREE.Vector4[]): void
  getState(): ViewerAgentState
  restoreState(state: ViewerAgentState, filter?: ViewerStateFilter, immediate?: boolean): boolean
  getScreenShot(width: number, height: number, callback: (url: string) => void): void
  search(
    text: string,
    onSuccess: (dbIds: number[]) => void,
    onError: (error: unknown) => void,
    attributeNames?: string[],
  ): void
  loadDocumentNode(
    document: ViewerAgentDocument,
    node: ViewerAgentDocumentNode,
    options?: { keepCurrentModels?: boolean },
  ): Promise<ViewerAgentModel>
}

/** Constructors for the viewer's bundled THREE, injectable so tests run without it. */
export interface ViewerMath {
  vector3(x: number, y: number, z: number): THREE.Vector3
  vector4(x: number, y: number, z: number, w: number): THREE.Vector4
  box3(): THREE.Box3
}

export interface LmvAttributeDefinition {
  name: string
  category: string
  displayName?: string
  flags?: number
}

/** The property database LMV hands `executeUserFunction`, inside its worker. */
export interface LmvPropertyDatabase {
  getObjectCount(): number
  enumAttributes(callback: (attrId: number, definition: LmvAttributeDefinition) => void): void
  enumObjectProperties(dbId: number, callback: (attrId: number, valueId: number) => void): void
  getAttrValue(attrId: number, valueId: number): string | number | boolean | null
}

export type PropertyValue = string | number | boolean | null

export interface PropertySnapshotAttribute {
  name: string
  category: string
  displayName: string
  hidden: boolean
}

/** The whole property database as flat tables: object `id` owns pairs `offsets[id]` up to
 * `offsets[id + 1]`, each pair an attribute index and a value index. */
export interface PropertySnapshot {
  objectCount: number
  attributes: PropertySnapshotAttribute[]
  offsets: Int32Array
  pairs: Int32Array
  values: PropertyValue[]
}

export type PropertySnapshotExport =
  | ({ ok: true } & PropertySnapshot)
  | { ok: false; pairs: number; limit: number }

export const RESULT_TEXT_LIMIT = 60_000

export class ToolInputError extends Error {
  override name = 'ToolInputError'
}

type ToolArgValue = string | number | boolean | string[] | number[]

export class ToolArgs {
  private readonly values: ReadonlyMap<string, ToolArgValue>

  constructor(values: ReadonlyMap<string, ToolArgValue>) {
    this.values = values
  }

  has(name: string): boolean {
    return this.values.has(name)
  }

  string(name: string): string | undefined {
    const value = this.values.get(name)
    return typeof value === 'string' ? value : undefined
  }

  number(name: string): number | undefined {
    const value = this.values.get(name)
    return typeof value === 'number' ? value : undefined
  }

  boolean(name: string): boolean | undefined {
    const value = this.values.get(name)
    return typeof value === 'boolean' ? value : undefined
  }

  numbers(name: string): number[] | undefined {
    const value = this.values.get(name)
    if (!Array.isArray(value)) return undefined
    return value.filter((item): item is number => typeof item === 'number')
  }

  strings(name: string): string[] | undefined {
    const value = this.values.get(name)
    if (!Array.isArray(value)) return undefined
    return value.filter((item): item is string => typeof item === 'string')
  }
}

type ScalarCheck = { ok: true; value: string | number | boolean } | { ok: false; problem: string }

function checkScalar(name: string, value: unknown, property: AgentToolSchemaProperty): ScalarCheck {
  const fail = (problem: string): ScalarCheck => ({ ok: false, problem: `${name} ${problem}` })
  switch (property.type) {
    case 'string':
      if (typeof value !== 'string') return fail('must be a string')
      if (property.maxLength !== undefined && value.length > property.maxLength) {
        return fail(`must be at most ${property.maxLength} characters`)
      }
      if (property.enum && !property.enum.includes(value)) {
        return fail(`must be one of ${property.enum.join(', ')}`)
      }
      return { ok: true, value }
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail('must be a number')
      if (property.type === 'integer' && !Number.isInteger(value)) return fail('must be an integer')
      if (property.minimum !== undefined && value < property.minimum) {
        return fail(`must be at least ${property.minimum}`)
      }
      if (property.maximum !== undefined && value > property.maximum) {
        return fail(`must be at most ${property.maximum}`)
      }
      return { ok: true, value }
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : fail('must be true or false')
    case 'array':
      return fail('must be an array')
  }
}

/** Checks model-written input against a tool's schema; throws one message naming every problem. */
export function validateToolInput(schema: AgentToolSchema, input: unknown): ToolArgs {
  const raw = input === undefined || input === null ? {} : input
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolInputError('arguments must be a JSON object')
  }
  const entries: [string, unknown][] = Object.entries(raw)
  const problems: string[] = []
  const values = new Map<string, ToolArgValue>()
  for (const [name, value] of entries) {
    const property = schema.properties[name]
    if (!property) {
      problems.push(
        `unknown argument ${name} (allowed: ${Object.keys(schema.properties).join(', ') || 'none'})`,
      )
      continue
    }
    if (value === null || value === undefined) continue
    if (property.type === 'array') {
      if (!Array.isArray(value)) {
        problems.push(`${name} must be an array`)
        continue
      }
      const items: unknown[] = value
      if (property.maxItems !== undefined && items.length > property.maxItems) {
        problems.push(`${name} must have at most ${property.maxItems} items`)
        continue
      }
      if (property.items.type === 'string') {
        if (!items.every((item) => typeof item === 'string')) {
          problems.push(`${name} must be an array of strings`)
          continue
        }
        values.set(
          name,
          items.filter((item): item is string => typeof item === 'string'),
        )
      } else {
        const numbers = items.filter(
          (item): item is number => typeof item === 'number' && Number.isFinite(item),
        )
        const integral = property.items.type === 'integer'
        if (numbers.length !== items.length || (integral && !numbers.every(Number.isInteger))) {
          problems.push(`${name} must be an array of ${integral ? 'integers' : 'numbers'}`)
          continue
        }
        values.set(name, numbers)
      }
      continue
    }
    const checked = checkScalar(name, value, property)
    if (checked.ok) values.set(name, checked.value)
    else problems.push(checked.problem)
  }
  for (const name of schema.required ?? []) {
    if (!values.has(name) && !problems.some((problem) => problem.startsWith(`${name} `))) {
      problems.push(`${name} is required`)
    }
  }
  if (problems.length > 0) throw new ToolInputError(problems.join('; '))
  return new ToolArgs(values)
}

export interface HexColor {
  hex: string
  r: number
  g: number
  b: number
}

/** Accepts `#rgb`, `rgb`, `#rrggbb`, or `rrggbb`; channels come back as 0–1 fractions. */
export function parseHexColor(value: string): HexColor {
  let hex = value.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(hex)) {
    hex = hex
      .split('')
      .map((digit) => digit + digit)
      .join('')
  }
  if (!/^[0-9a-f]{6}$/.test(hex)) {
    throw new ToolInputError(`not a colour: ${value} (use a hex value such as #e5484d)`)
  }
  return {
    hex: `#${hex}`,
    r: Number.parseInt(hex.slice(0, 2), 16) / 255,
    g: Number.parseInt(hex.slice(2, 4), 16) / 255,
    b: Number.parseInt(hex.slice(4, 6), 16) / 255,
  }
}

export function truncateResultText(text: string, limit: number = RESULT_TEXT_LIMIT): string {
  if (text.length <= limit) return text
  const note = `\n[truncated: ${text.length} characters, showing ${limit}. Narrow it with limit or filters.]`
  return text.slice(0, Math.max(0, limit - note.length)) + note
}

export function formatSetId(sequence: number): string {
  return `set-${sequence}`
}

export interface Box {
  min: Vec3
  max: Vec3
}

export function isValidBox(box: Box): boolean {
  const { min, max } = box
  return (
    [min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite) &&
    min.x <= max.x &&
    min.y <= max.y &&
    min.z <= max.z
  )
}

export function unionBoxes(boxes: readonly Box[]): Box | null {
  let result: Box | null = null
  for (const box of boxes) {
    if (!isValidBox(box)) continue
    if (!result) {
      result = { min: { ...box.min }, max: { ...box.max } }
      continue
    }
    result = {
      min: {
        x: Math.min(result.min.x, box.min.x),
        y: Math.min(result.min.y, box.min.y),
        z: Math.min(result.min.z, box.min.z),
      },
      max: {
        x: Math.max(result.max.x, box.max.x),
        y: Math.max(result.max.y, box.max.y),
        z: Math.max(result.max.z, box.max.z),
      },
    }
  }
  return result
}

export function boxCenter(box: Box): Vec3 {
  return {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  }
}

export function boxSize(box: Box): Vec3 {
  return { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z }
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
}

/** Shortest distance between two axis-aligned boxes; 0 when they touch or overlap. */
export function boxGap(a: Box, b: Box): number {
  const axis = (aMin: number, aMax: number, bMin: number, bMax: number) =>
    Math.max(0, bMin - aMax, aMin - bMax)
  return Math.hypot(
    axis(a.min.x, a.max.x, b.min.x, b.max.x),
    axis(a.min.y, a.max.y, b.min.y, b.max.y),
    axis(a.min.z, a.max.z, b.min.z, b.max.z),
  )
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

export function roundNumber(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export const SCREENSHOT_MAX_EDGE = 1024

/** LMV files Category under `__category__`; every other `__` category is tree bookkeeping. */
export function isInternalCategory(category: string): boolean {
  return category.startsWith('__') && category !== '__category__'
}

export function documentOf(model: ViewerAgentModel | null): ViewerAgentDocument | null {
  try {
    return model?.getDocumentNode()?.getDocument() ?? null
  } catch {
    return null
  }
}

export function json(value: JsonValue): string {
  return JSON.stringify(value)
}

export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`
}

export function roundVec(vector: Vec3): JsonValue {
  return { x: roundNumber(vector.x), y: roundNumber(vector.y), z: roundNumber(vector.z) }
}

export function roundBox(box: Box): JsonValue {
  return { min: roundVec(box.min), max: roundVec(box.max) }
}

export function elementJson(row: ElementRow): JsonValue {
  return { id: row.dbId, name: row.name, category: row.category, level: row.level }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('cancelled')
}

export const targetProperties = {
  ids: {
    type: 'array',
    items: { type: 'integer' },
    maxItems: 10_000,
    description: 'Element dbIds.',
  },
  setId: {
    type: 'string',
    maxLength: 64,
    description: 'An element set id such as set-2, or "selection" for what the user has selected.',
  },
} satisfies { [name: string]: AgentToolSchemaProperty }

export function limitProperty(fallback: number, maximum: number): AgentToolSchemaProperty {
  return {
    type: 'integer',
    minimum: 1,
    maximum,
    description: `Rows to list (default ${fallback}).`,
  }
}

export interface ToolTargets {
  dbIds: number[]
  source: string
}

export type ViewerToolOutcome = Omit<AgentToolResult, 'undoable' | 'undoId'> & {
  skipUndo?: boolean
}

/** `restoreState` restores only the keys set here, so leaving out `viewport` keeps the camera. */
export interface ViewerStateFilter {
  seedURN?: boolean
  objectSet?: boolean
  viewport?: boolean
  renderOptions?: boolean
  cutplanes?: boolean
}

export interface ViewerToolSpec {
  name: string
  description: string
  properties?: { [name: string]: AgentToolSchemaProperty }
  required?: string[]
  mutates: boolean
  /** Undo restores the camera only for tools that moved it. */
  movesCamera?: boolean | ((args: ToolArgs) => boolean)
  run(args: ToolArgs, viewer: ViewerAgentViewer, signal: AbortSignal): Promise<ViewerToolOutcome>
}

/** What the tool groups share: the catalog's stores and the model-bound caches. */
export interface ViewerToolKit {
  math: ViewerMath
  sets: ElementSetStore
  colors: ColorLedger
  savedStates: Map<string, ViewerSnapshot>
  resultLimit: number
  queryTimeoutMs: number
  now(): number
  sync(viewer: ViewerAgentViewer): void
  requireModel(viewer: ViewerAgentViewer): ViewerAgentModel
  getIndex(viewer: ViewerAgentViewer): Promise<ElementIndex>
  getSnapshot(model: ViewerAgentModel): Promise<PropertySnapshot>
  resolveTargets(
    args: ToolArgs,
    viewer: ViewerAgentViewer,
    idsKey?: string,
    setKey?: string,
  ): ToolTargets
  repaint(viewer: ViewerAgentViewer, model: ViewerAgentModel): void
  takeSnapshot(viewer: ViewerAgentViewer): ViewerSnapshot
  runQuery(request: {
    snapshot: PropertySnapshot
    elements: readonly ElementRow[]
    code: string
    timeoutMs: number
    maxChars: number
    signal: AbortSignal
  }): Promise<QueryRunResult>
}
