import type { ElementSet } from '@/lib/agent-types'
import {
  type Box,
  describeError,
  formatSetId,
  unionBoxes,
  type ViewerAgentModel,
  type ViewerAgentState,
  type ViewerAgentTree,
  type ViewerMath,
} from '@/lib/viewer-agent-core'

type PropertyResult = Autodesk.Viewing.PropertyResult

type Listener = () => void

class Emitter {
  private listeners = new Set<Listener>()

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  protected emit(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Snapshots are replaced on change, so `useSyncExternalStore(sets.subscribe, sets.list)` is safe. */
export class ElementSetStore extends Emitter {
  private sets: readonly ElementSet[] = Object.freeze([])
  private sequence = 0
  private readonly limit: number
  private readonly now: () => number

  constructor(limit = 50, now: () => number = Date.now) {
    super()
    this.limit = limit
    this.now = now
  }

  list = (): readonly ElementSet[] => this.sets

  get(id: string): ElementSet | undefined {
    return this.sets.find((set) => set.id === id)
  }

  create(label: string, dbIds: readonly number[], origin: string): ElementSet {
    this.sequence += 1
    const set: ElementSet = Object.freeze({
      id: formatSetId(this.sequence),
      label,
      dbIds: Object.freeze([...new Set(dbIds)]),
      createdAt: this.now(),
      origin,
    })
    this.sets = Object.freeze([...this.sets, set].slice(-this.limit))
    this.emit()
    return set
  }

  rename(id: string, label: string): boolean {
    if (!this.get(id)) return false
    this.sets = Object.freeze(
      this.sets.map((set) => (set.id === id ? Object.freeze({ ...set, label }) : set)),
    )
    this.emit()
    return true
  }

  remove(id: string): boolean {
    if (!this.get(id)) return false
    this.sets = Object.freeze(this.sets.filter((set) => set.id !== id))
    this.emit()
    return true
  }

  clear(): void {
    if (this.sets.length === 0) return
    this.sets = Object.freeze([])
    this.emit()
  }

  /** Replaces every set with saved ones, keeping their ids; new sets number on from the highest. */
  restore(saved: readonly ElementSet[]): void {
    const sets = saved
      .slice(-this.limit)
      .map((set) => Object.freeze({ ...set, dbIds: Object.freeze([...new Set(set.dbIds)]) }))
    this.sequence = sets.reduce(
      (highest, set) => Math.max(highest, Number(/^set-(\d+)$/.exec(set.id)?.[1] ?? 0)),
      0,
    )
    this.sets = Object.freeze(sets)
    this.emit()
  }
}

export interface ColorLegendEntry {
  hex: string
  label: string
  count: number
}

export interface ColorLedgerSnapshot {
  colors: ReadonlyMap<number, string>
  labels: ReadonlyMap<string, string>
}

/** The viewer keeps one theming colour per element and cannot list them, so the ledger does. */
export class ColorLedger extends Emitter {
  private colors = new Map<number, string>()
  private labels = new Map<string, string>()
  private legendSnapshot: readonly ColorLegendEntry[] = Object.freeze([])

  get size(): number {
    return this.colors.size
  }

  legend = (): readonly ColorLegendEntry[] => this.legendSnapshot

  colorOf(dbId: number): string | undefined {
    return this.colors.get(dbId)
  }

  entries(): [number, string][] {
    return [...this.colors]
  }

  apply(dbIds: readonly number[], hex: string, label: string): void {
    for (const id of dbIds) this.colors.set(id, hex)
    this.labels.set(hex, label)
    this.changed()
  }

  /** Forgets the given ids, or every id when none are given; returns how many it removed. */
  remove(dbIds?: readonly number[]): number {
    if (!dbIds) {
      const count = this.colors.size
      this.colors.clear()
      this.labels.clear()
      this.changed()
      return count
    }
    let count = 0
    for (const id of dbIds) if (this.colors.delete(id)) count += 1
    this.changed()
    return count
  }

  snapshot(): ColorLedgerSnapshot {
    return { colors: new Map(this.colors), labels: new Map(this.labels) }
  }

  restore(snapshot: ColorLedgerSnapshot): void {
    this.colors = new Map(snapshot.colors)
    this.labels = new Map(snapshot.labels)
    this.changed()
  }

  private changed(): void {
    const counts = new Map<string, number>()
    for (const hex of this.colors.values()) counts.set(hex, (counts.get(hex) ?? 0) + 1)
    for (const hex of [...this.labels.keys()]) if (!counts.has(hex)) this.labels.delete(hex)
    this.legendSnapshot = Object.freeze(
      [...counts].map(([hex, count]) => ({ hex, label: this.labels.get(hex) ?? hex, count })),
    )
    this.emit()
  }
}

export interface UndoEntry {
  id: string
  label: string
  createdAt: number
}

export interface ViewerSnapshot {
  viewerState: ViewerAgentState
  colors: ColorLedgerSnapshot
  restoreCamera?: boolean
}

/** Restoring an entry returns the viewer to how it was before that action and drops it and
 * every later entry, since their snapshots assume it happened. */
export class UndoStack extends Emitter {
  private stack: { entry: UndoEntry; snapshot: ViewerSnapshot }[] = []
  private entriesSnapshot: readonly UndoEntry[] = Object.freeze([])
  private readonly apply: (snapshot: ViewerSnapshot) => void
  private readonly limit: number

  constructor(apply: (snapshot: ViewerSnapshot) => void, limit = 30) {
    super()
    this.apply = apply
    this.limit = limit
  }

  entries = (): readonly UndoEntry[] => this.entriesSnapshot

  has(id: string): boolean {
    return this.stack.some((item) => item.entry.id === id)
  }

  push(entry: UndoEntry, snapshot: ViewerSnapshot): void {
    this.stack = [...this.stack.filter((item) => item.entry.id !== entry.id), { entry, snapshot }]
    this.stack = this.stack.slice(-this.limit)
    this.changed()
  }

  restore(id: string): boolean {
    const index = this.stack.findIndex((item) => item.entry.id === id)
    if (index === -1) return false
    this.apply(this.stack[index].snapshot)
    this.stack = this.stack.slice(0, index)
    this.changed()
    return true
  }

  clear(): void {
    if (this.stack.length === 0) return
    this.stack = []
    this.changed()
  }

  private changed(): void {
    this.entriesSnapshot = Object.freeze(this.stack.map((item) => item.entry))
    this.emit()
  }
}

export interface ElementRow {
  dbId: number
  name: string
  category: string
  level: string
}

export interface LevelRow {
  name: string
  count: number
  /** As authored in the source file, when the model carries AEC level data. */
  elevation: number | null
  /** Viewer-coordinate z range of the level's elements. */
  zMin: number | null
  zMax: number | null
}

export interface CategoryRow {
  name: string
  count: number
}

export interface ElementIndex {
  model: ViewerAgentModel
  tree: ViewerAgentTree
  elements: readonly ElementRow[]
  byId: ReadonlyMap<number, ElementRow>
  levels: readonly LevelRow[]
  categories: readonly CategoryRow[]
}

const LEVEL_PROPERTIES = ['Level', 'Base Constraint', 'Reference Level', 'Schedule Level']

export function bulkProperties(
  model: ViewerAgentModel,
  dbIds: number[],
  propFilter?: string[],
): Promise<PropertyResult[]> {
  if (dbIds.length === 0) return Promise.resolve([])
  return new Promise((resolve, reject) =>
    model.getBulkProperties2(dbIds, propFilter ? { propFilter } : {}, resolve, (error) =>
      reject(new Error(`property query failed: ${describeError(error)}`)),
    ),
  )
}

export function objectTree(model: ViewerAgentModel): Promise<ViewerAgentTree> {
  return new Promise((resolve, reject) =>
    model.getObjectTree(resolve, (error) =>
      reject(new Error(`the model tree is unavailable: ${describeError(error)}`)),
    ),
  )
}

export function normalizeCategory(value: string): string {
  return value.replace(/^Revit\s+/i, '').trim()
}

function visibleValue(result: PropertyResult | undefined, name: string): string {
  const property = result?.properties.find(
    (item) => item.displayName === name && item.displayCategory !== '__internalref__',
  )
  if (!property || property.displayValue === '' || property.displayValue === null) return ''
  return String(property.displayValue)
}

async function aecLevels(model: ViewerAgentModel): Promise<{ name: string; elevation: number }[]> {
  try {
    const data = await model.getDocumentNode()?.getDocument().downloadAecModelData()
    const levels = data?.levels
    if (!Array.isArray(levels)) return []
    const rows: { name: string; elevation: number }[] = []
    const items: unknown[] = levels
    for (const level of items) {
      if (typeof level !== 'object' || level === null) continue
      if (!('name' in level) || !('elevation' in level)) continue
      const { name, elevation } = level
      if (typeof name === 'string' && typeof elevation === 'number') rows.push({ name, elevation })
    }
    return rows
  } catch {
    return []
  }
}

export function boundsOf(
  index: Pick<ElementIndex, 'model' | 'tree'>,
  dbIds: readonly number[],
  math: ViewerMath,
): Box | null {
  const fragments = index.model.getFragmentList()
  const scratch = math.box3()
  const boxes: Box[] = []
  for (const id of dbIds) {
    index.tree.enumNodeFragments(
      id,
      (fragId) => {
        fragments.getWorldBounds(fragId, scratch)
        boxes.push({ min: { ...scratch.min }, max: { ...scratch.max } })
      },
      true,
    )
  }
  return unionBoxes(boxes)
}

export async function buildElementIndex(
  model: ViewerAgentModel,
  math: ViewerMath,
): Promise<ElementIndex> {
  const tree = await objectTree(model)
  const leaves: number[] = []
  tree.enumNodeChildren(
    tree.getRootId(),
    (id) => {
      if (tree.getChildCount(id) === 0) leaves.push(id)
    },
    true,
  )
  const results = await bulkProperties(model, leaves, ['name', 'Category', ...LEVEL_PROPERTIES])
  const byResult = new Map(results.map((result) => [result.dbId, result]))

  const levelRefs = new Set<number>()
  for (const result of results) {
    for (const property of result.properties) {
      if (
        property.displayCategory === '__internalref__' &&
        property.displayName === 'Level' &&
        typeof property.displayValue === 'number'
      ) {
        levelRefs.add(property.displayValue)
      }
    }
  }
  const levelNames = new Map<number, string>()
  for (const result of await bulkProperties(model, [...levelRefs], ['name']).catch(() => [])) {
    if (result.name) levelNames.set(result.dbId, result.name.replace(/\s*\[\d+\]$/, ''))
  }

  const elements: ElementRow[] = leaves.map((dbId) => {
    const result = byResult.get(dbId)
    const ref = result?.properties.find(
      (item) => item.displayCategory === '__internalref__' && item.displayName === 'Level',
    )?.displayValue
    const refName = typeof ref === 'number' ? levelNames.get(ref) : undefined
    return {
      dbId,
      name: result?.name || tree.getNodeName(dbId) || '',
      category: normalizeCategory(visibleValue(result, 'Category')),
      level:
        refName || LEVEL_PROPERTIES.map((name) => visibleValue(result, name)).find(Boolean) || '',
    }
  })

  const categoryCounts = new Map<string, number>()
  const levelMembers = new Map<string, number[]>()
  for (const element of elements) {
    const category = element.category || '(none)'
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
    if (!element.level) continue
    const members = levelMembers.get(element.level)
    if (members) members.push(element.dbId)
    else levelMembers.set(element.level, [element.dbId])
  }

  const authored = await aecLevels(model)
  const elevations = new Map(authored.map((level) => [level.name, level.elevation]))
  const levels: LevelRow[] = []
  for (const name of new Set([...authored.map((level) => level.name), ...levelMembers.keys()])) {
    const members = levelMembers.get(name) ?? []
    const box = members.length > 0 ? boundsOf({ model, tree }, members, math) : null
    levels.push({
      name,
      count: members.length,
      elevation: elevations.get(name) ?? null,
      zMin: box ? box.min.z : null,
      zMax: box ? box.max.z : null,
    })
  }
  levels.sort(
    (a, b) =>
      (a.elevation ?? a.zMin ?? Number.POSITIVE_INFINITY) -
      (b.elevation ?? b.zMin ?? Number.POSITIVE_INFINITY),
  )

  return {
    model,
    tree,
    elements,
    byId: new Map(elements.map((element) => [element.dbId, element])),
    levels,
    categories: [...categoryCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}

export interface ElementFilter {
  category?: string
  level?: string
  name?: string
}

/** Exact (case-insensitive) matches win, so `Level 1` does not also match `Level 10`; when
 * nothing matches exactly the filter falls back to a substring match. */
export function filterElements(
  elements: readonly ElementRow[],
  filter: ElementFilter,
): ElementRow[] {
  const normalize = (value: string) => normalizeCategory(value).toLocaleLowerCase()
  const matcher = (wanted: string | undefined, pick: (row: ElementRow) => string) => {
    if (!wanted) return () => true
    const target = normalize(wanted)
    const exact = elements.some((row) => normalize(pick(row)) === target)
    return exact
      ? (row: ElementRow) => normalize(pick(row)) === target
      : (row: ElementRow) => normalize(pick(row)).includes(target)
  }
  const byCategory = matcher(filter.category, (row) => row.category)
  const byLevel = matcher(filter.level, (row) => row.level)
  const byName = matcher(filter.name, (row) => row.name)
  return elements.filter((row) => byCategory(row) && byLevel(row) && byName(row))
}
