import type {
  AgentSelectionContext,
  AgentTool,
  AgentToolResult,
  AgentToolSchema,
} from '@/lib/agent-types'
import {
  documentOf,
  hideOthersOf,
  type PropertySnapshot,
  parseHexColor,
  plural,
  RESULT_TEXT_LIMIT,
  ToolInputError,
  throwIfAborted,
  truncateResultText,
  type ViewerAgentDocument,
  type ViewerAgentModel,
  type ViewerAgentViewer,
  type ViewerMath,
  type ViewerStateFilter,
  type ViewerToolKit,
  type ViewerToolSpec,
  validateToolInput,
} from '@/lib/viewer-agent-core'
import { displayTools } from '@/lib/viewer-agent-display'
import { inspectionTools } from '@/lib/viewer-agent-inspect'
import {
  loadPropertySnapshot,
  QuerySandbox,
  type QueryWorkerHandle,
} from '@/lib/viewer-agent-query'
import {
  buildElementIndex,
  ColorLedger,
  type ElementIndex,
  ElementSetStore,
  UndoStack,
  type ViewerSnapshot,
} from '@/lib/viewer-agent-state'

export type {
  ViewerAgentModel,
  ViewerAgentViewer,
  ViewerMath,
} from '@/lib/viewer-agent-core'
export type { QueryWorkerHandle } from '@/lib/viewer-agent-query'
export {
  ColorLedger,
  type ColorLegendEntry,
  ElementSetStore,
  type UndoEntry,
  UndoStack,
} from '@/lib/viewer-agent-state'

export type ViewerAgentTool = AgentTool

export interface ViewerAgentToolsOptions {
  /** THREE constructors; defaults to the viewer runtime's global THREE. */
  math?: ViewerMath
  /** Characters of tool output the model reads before the truncation note. */
  resultTextLimit?: number
  queryTimeoutMs?: number
  /** Property pairs above which run_query refuses to copy the database. */
  queryMaxPairs?: number
  createQueryWorker?: () => QueryWorkerHandle
  now?: () => number
}

export interface ViewerAgentTools {
  tools: ViewerAgentTool[]
  sets: ElementSetStore
  undo: UndoStack
  colors: ColorLedger
  instructions: string
  describeSelection(dbIds?: readonly number[]): Promise<AgentSelectionContext>
  dispose(): void
}

const KEEP_CAMERA: ViewerStateFilter = {
  seedURN: true,
  objectSet: true,
  renderOptions: true,
  cutplanes: true,
}

const defaultMath: ViewerMath = {
  vector3: (x, y, z) => new THREE.Vector3(x, y, z),
  vector4: (x, y, z, w) => new THREE.Vector4(x, y, z, w),
  box3: () => new THREE.Box3(),
}

export const VIEWER_AGENT_INSTRUCTIONS = `You work inside an Autodesk Platform Services viewer. A translated building model, often from Revit, is loaded. You inspect and drive the viewer only through your tools; you cannot edit the model.

How to work
- For orientation use get_model_info, list_levels, or list_categories. Never guess level or category names.
- find_elements, search_text, and get_selection save a named element set (set-1, set-2, ...) and return a sample. Pass setId to any tool that takes ids instead of repeating dbIds. setId "selection" means what the user has selected right now. list_sets recalls the sets.
- Display changes stay until changed. The user can undo each one from the interface.
- run_query runs JavaScript over a copy of the property database in a sandbox with no page or network access, for counts, sums, and groupings the other tools cannot express. pdb offers leaves(), elements() ({dbId, name, category, level}), name(id), props(id) (visible properties, type properties merged), prop(id, name), find((id, pdb) => boolean), and attributes(). Return a small JSON value.
- take_screenshot shows you the current view as an image. Use it to check what the user sees.
- After open_view, levels and categories are rebuilt for the new view; set ids stay valid within the same file.

Units
- Positions, section offsets, camera coordinates, and measure_bbox lengths are viewer coordinates in model units (get_model_info names the unit; Revit models are usually feet). measure_bbox also reports metres.
- Property values keep the units they were authored in, which can differ from model units.

Answering
- Keep answers short: lead with the answer, then the counts or names behind it. Refer to set ids instead of listing dbIds.
- Before you hide, isolate, colour, or section a large part of the model, say in one sentence what you are about to change.
- If a tool fails, say what failed. Never invent results.`

export function createViewerAgentTools(
  getViewer: () => ViewerAgentViewer | null,
  options: ViewerAgentToolsOptions = {},
): ViewerAgentTools {
  const math = options.math ?? defaultMath
  const now = options.now ?? Date.now
  const sets = new ElementSetStore(50, now)
  const colors = new ColorLedger()
  const sandbox = new QuerySandbox(options.createQueryWorker)
  const savedStates = new Map<string, ViewerSnapshot>()

  let trackedModel: ViewerAgentModel | null = null
  let trackedDocument: ViewerAgentDocument | null = null
  let modelKey = 0
  let indexPromise: Promise<ElementIndex> | null = null
  let snapshotPromise: Promise<PropertySnapshot> | null = null
  let undoSequence = 0

  const repaint = (viewer: ViewerAgentViewer, model: ViewerAgentModel) => {
    viewer.clearThemingColors(model)
    for (const [id, hex] of colors.entries()) {
      const { r, g, b } = parseHexColor(hex)
      viewer.setThemingColor(id, math.vector4(r, g, b, 1), model, true)
    }
    viewer.impl.invalidate(true, true, true)
  }

  const restoreSnapshot = (
    viewer: ViewerAgentViewer,
    snapshot: ViewerSnapshot,
    filter?: ViewerStateFilter,
  ) => {
    if (!viewer.model) return
    const mode = hideOthersOf(viewer)
    if (mode?.getHideOthersState().active && !snapshot.hideOthers) mode.setHideOthers(false)
    viewer.restoreState(snapshot.viewerState, filter)
    if (mode && snapshot.hideOthers) mode.setHideOthers(true, snapshot.hideOthers)
    colors.restore(snapshot.colors)
    repaint(viewer, viewer.model)
  }

  const undo = new UndoStack((snapshot) => {
    const viewer = getViewer()
    if (viewer) {
      restoreSnapshot(viewer, snapshot, snapshot.restoreCamera ? undefined : KEEP_CAMERA)
    }
  })

  const sync = (viewer: ViewerAgentViewer) => {
    if (viewer.model === trackedModel) return
    const nextDocument = documentOf(viewer.model)
    if (trackedDocument !== null && nextDocument !== trackedDocument) sets.clear()
    trackedModel = viewer.model
    trackedDocument = nextDocument
    modelKey += 1
    indexPromise = null
    snapshotPromise = null
    savedStates.clear()
    colors.remove()
    undo.clear()
  }

  const requireModel = (viewer: ViewerAgentViewer): ViewerAgentModel => {
    if (!viewer.model) throw new Error('no model is loaded in the viewer yet')
    return viewer.model
  }

  const kit: ViewerToolKit = {
    math,
    sets,
    colors,
    savedStates,
    resultLimit: options.resultTextLimit ?? RESULT_TEXT_LIMIT,
    queryTimeoutMs: options.queryTimeoutMs ?? 10_000,
    now,
    sync,
    requireModel,
    getIndex(viewer) {
      const model = requireModel(viewer)
      if (!indexPromise) {
        const pending = buildElementIndex(model, math)
        indexPromise = pending
        pending.catch(() => {
          if (indexPromise === pending) indexPromise = null
        })
      }
      return indexPromise
    },
    getSnapshot(model) {
      if (!snapshotPromise) {
        const pending = loadPropertySnapshot(model, options.queryMaxPairs ?? 6_000_000)
        snapshotPromise = pending
        pending.catch(() => {
          if (snapshotPromise === pending) snapshotPromise = null
        })
      }
      return snapshotPromise
    },
    resolveTargets(args, viewer, idsKey = 'ids', setKey = 'setId') {
      const ids = args.numbers(idsKey) ?? []
      const setId = args.string(setKey)
      const parts: string[] = []
      const dbIds = [...ids]
      if (ids.length > 0) parts.push(plural(ids.length, 'id'))
      if (setId === 'selection') {
        const selection = viewer.getSelection()
        if (selection.length === 0) throw new ToolInputError('nothing is selected in the viewer')
        dbIds.push(...selection)
        parts.push('the selection')
      } else if (setId) {
        const set = sets.get(setId)
        if (!set) {
          const known = sets
            .list()
            .map((item) => item.id)
            .join(', ')
          throw new ToolInputError(`unknown set ${setId} (sets: ${known || 'none yet'})`)
        }
        dbIds.push(...set.dbIds)
        parts.push(`${set.id} (${set.label})`)
      }
      if (dbIds.length === 0) throw new ToolInputError(`give ${idsKey} or ${setKey}`)
      return { dbIds: [...new Set(dbIds)], source: parts.join(' and ') }
    },
    repaint,
    takeSnapshot(viewer) {
      const mode = hideOthersOf(viewer)?.getHideOthersState()
      return {
        viewerState: viewer.getState(),
        colors: colors.snapshot(),
        hideOthers: mode?.active ? [...mode.ids] : null,
      }
    },
    restoreSnapshot,
    runQuery: (request) => sandbox.run({ ...request, key: modelKey }),
  }

  const define = (spec: ViewerToolSpec): ViewerAgentTool => {
    const inputSchema: AgentToolSchema = {
      type: 'object',
      properties: spec.properties ?? {},
      additionalProperties: false,
    }
    if (spec.required) inputSchema.required = spec.required
    return {
      name: spec.name,
      description: spec.description,
      inputSchema,
      mutates: spec.mutates,
      async execute(input, context) {
        const args = validateToolInput(inputSchema, input)
        throwIfAborted(context.signal)
        const viewer = getViewer()
        if (!viewer) throw new Error('the viewer is not ready yet')
        sync(viewer)
        const before = spec.mutates ? kit.takeSnapshot(viewer) : null
        const { skipUndo, ...outcome } = await spec.run(args, viewer, context.signal)
        const result: AgentToolResult = {
          ...outcome,
          text: truncateResultText(outcome.text, kit.resultLimit),
        }
        if (result.text !== outcome.text) result.partial = true
        if (before && !skipUndo) {
          const { movesCamera } = spec
          before.restoreCamera =
            typeof movesCamera === 'function' ? movesCamera(args) : (movesCamera ?? false)
          undoSequence += 1
          const undoId = context.actionId ?? `undo-${undoSequence}`
          undo.push({ id: undoId, label: outcome.label, createdAt: now() }, before)
          result.undoable = true
          result.undoId = undoId
        }
        return result
      },
    }
  }

  const describeSelection = async (dbIds?: readonly number[]): Promise<AgentSelectionContext> => {
    const viewer = getViewer()
    const ids = [...(dbIds ?? viewer?.getSelection() ?? [])]
    if (!viewer || ids.length === 0) return { dbIds: [], summary: 'Nothing selected' }
    sync(viewer)
    const index = await kit.getIndex(viewer).catch(() => null)
    const rows = ids.map((id) => index?.byId.get(id))
    if (ids.length === 1) {
      const row = rows[0]
      if (!row) return { dbIds: ids, summary: `Element ${ids[0]}` }
      return { dbIds: ids, summary: row.category ? `${row.name} · ${row.category}` : row.name }
    }
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row?.category) counts.set(row.category, (counts.get(row.category) ?? 0) + 1)
    }
    const top = [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([category, count]) => `${count} ${category}`)
    return { dbIds: ids, summary: top.join(', ') }
  }

  return {
    tools: [...inspectionTools(kit), ...displayTools(kit)].map(define),
    sets,
    undo,
    colors,
    instructions: VIEWER_AGENT_INSTRUCTIONS,
    describeSelection,
    dispose: () => sandbox.dispose(),
  }
}
