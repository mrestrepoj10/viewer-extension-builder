import {
  boxCenter,
  distance,
  documentOf,
  json,
  parseHexColor,
  plural,
  roundNumber,
  roundVec,
  ToolInputError,
  targetProperties,
  type ViewerAgentDocumentNode,
  type ViewerAgentViewer,
  type ViewerToolKit,
  type ViewerToolSpec,
} from '@/lib/viewer-agent-core'
import { boundsOf, type ElementIndex } from '@/lib/viewer-agent-state'

const CAMERA_PRESETS = new Map<string, [number, number, number]>([
  ['top', [0, 0, 1]],
  ['bottom', [0, 0, -1]],
  ['front', [0, -1, 0]],
  ['back', [0, 1, 0]],
  ['left', [-1, 0, 0]],
  ['right', [1, 0, 0]],
  ['iso', [1, -1, 1]],
])

const SECTION_DEFAULT_METERS = 1.2
const VIEW_LOAD_CEILING_MS = 30_000

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function findLevel(index: ElementIndex, wanted: string): ElementIndex['levels'][number] {
  const target = wanted.trim().toLocaleLowerCase()
  const exact = index.levels.find((level) => level.name.toLocaleLowerCase() === target)
  if (exact) return exact
  const partial = index.levels.filter((level) => level.name.toLocaleLowerCase().includes(target))
  if (partial.length === 1) return partial[0]
  const names = index.levels.map((level) => level.name).join(', ')
  throw new ToolInputError(
    partial.length > 1
      ? `"${wanted}" matches several levels (${partial.map((level) => level.name).join(', ')})`
      : `unknown level "${wanted}" (levels: ${names || 'none found'})`,
  )
}

function viewables(viewer: ViewerAgentViewer, kit: ViewerToolKit): ViewerAgentDocumentNode[] {
  const doc = documentOf(kit.requireModel(viewer))
  if (!doc) throw new Error('the loaded model carries no document, so it has no views to list')
  return doc.getRoot().search({ type: 'geometry' })
}

function knownSet(kit: ViewerToolKit, setId: string | undefined): string | undefined {
  return setId && kit.sets.get(setId) ? setId : undefined
}

function currentGuid(viewer: ViewerAgentViewer): string | null {
  try {
    return viewer.model?.getDocumentNode()?.guid() ?? null
  } catch {
    return null
  }
}

export function displayTools(kit: ViewerToolKit): ViewerToolSpec[] {
  return [
    {
      name: 'select_elements',
      description: 'Select elements in the viewer. An empty ids array clears the selection.',
      properties: { ...targetProperties, fit: { type: 'boolean', description: 'Zoom to them.' } },
      mutates: true,
      movesCamera: (args) => args.boolean('fit') === true,
      async run(args, viewer) {
        if (args.numbers('ids')?.length === 0 && !args.string('setId')) {
          viewer.clearSelection()
          return { text: json({ selected: 0 }), label: 'Cleared the selection' }
        }
        const { dbIds, source } = kit.resolveTargets(args, viewer)
        viewer.select(dbIds)
        if (args.boolean('fit')) viewer.fitToView(dbIds)
        return {
          text: json({ selected: dbIds.length }),
          label: `Selected ${plural(dbIds.length, 'element')}`,
          detail: source,
          setId: knownSet(kit, args.string('setId')),
        }
      },
    },
    {
      name: 'isolate_elements',
      description: 'Show only these elements; everything else is ghosted. show_all undoes it.',
      properties: { ...targetProperties, fit: { type: 'boolean', description: 'Zoom to them.' } },
      mutates: true,
      movesCamera: (args) => args.boolean('fit') === true,
      async run(args, viewer) {
        const { dbIds, source } = kit.resolveTargets(args, viewer)
        viewer.isolate(dbIds)
        if (args.boolean('fit')) viewer.fitToView(dbIds)
        return {
          text: json({ isolated: dbIds.length }),
          label: `Isolated ${plural(dbIds.length, 'element')}`,
          detail: source,
          setId: knownSet(kit, args.string('setId')),
        }
      },
    },
    {
      name: 'hide_elements',
      description: 'Hide elements. show_all brings them back.',
      properties: targetProperties,
      mutates: true,
      async run(args, viewer) {
        const { dbIds, source } = kit.resolveTargets(args, viewer)
        viewer.hide(dbIds)
        return {
          text: json({ hidden: dbIds.length }),
          label: `Hid ${plural(dbIds.length, 'element')}`,
          detail: source,
          setId: knownSet(kit, args.string('setId')),
        }
      },
    },
    {
      name: 'show_all',
      description: 'Clear isolation and show every hidden element.',
      mutates: true,
      async run(_args, viewer) {
        viewer.showAll()
        return { text: json({ shown: 'all' }), label: 'Showed every element' }
      },
    },
    {
      name: 'color_elements',
      description:
        'Paint elements with a colour (hex such as #e5484d). The label names the colour in the legend.',
      properties: {
        ...targetProperties,
        hex: { type: 'string', maxLength: 7 },
        label: { type: 'string', maxLength: 80 },
      },
      required: ['hex'],
      mutates: true,
      async run(args, viewer) {
        const model = kit.requireModel(viewer)
        const color = parseHexColor(args.string('hex') ?? '')
        const { dbIds, source } = kit.resolveTargets(args, viewer)
        const label = args.string('label') ?? source
        const vector = kit.math.vector4(color.r, color.g, color.b, 1)
        for (const id of dbIds) viewer.setThemingColor(id, vector, model, true)
        viewer.impl.invalidate(true, true, true)
        kit.colors.apply(dbIds, color.hex, label)
        return {
          text: json({
            colored: dbIds.length,
            hex: color.hex,
            legend: kit.colors.legend().map((entry) => ({ ...entry })),
          }),
          label: `Coloured ${plural(dbIds.length, 'element')}`,
          detail: label,
          color: color.hex,
          setId: knownSet(kit, args.string('setId')),
        }
      },
    },
    {
      name: 'clear_colors',
      description: 'Remove colours the agent applied, from the given elements or from all.',
      properties: targetProperties,
      mutates: true,
      async run(args, viewer) {
        const model = kit.requireModel(viewer)
        const scoped = args.has('ids') || args.has('setId')
        const removed = scoped
          ? kit.colors.remove(kit.resolveTargets(args, viewer).dbIds)
          : kit.colors.remove()
        kit.repaint(viewer, model)
        return {
          text: json({ cleared: removed, remaining: kit.colors.size }),
          label: scoped
            ? `Cleared colours from ${plural(removed, 'element')}`
            : 'Cleared all colours',
        }
      },
    },
    {
      name: 'fit_to_view',
      description: 'Zoom the camera to elements, or to the whole model when none are given.',
      properties: targetProperties,
      mutates: true,
      movesCamera: true,
      async run(args, viewer) {
        const scoped = args.has('ids') || args.has('setId')
        const targets = scoped ? kit.resolveTargets(args, viewer) : null
        viewer.fitToView(targets ? targets.dbIds : null)
        return {
          text: json({ fitted: targets ? targets.dbIds.length : 'model' }),
          label: targets
            ? `Zoomed to ${plural(targets.dbIds.length, 'element')}`
            : 'Zoomed to the model',
          detail: targets?.source,
        }
      },
    },
    {
      name: 'set_section',
      description:
        'One section plane: by level name (cuts offset model units above the level, default about 1.2 m) or by axis and position. Geometry beyond the plane is cut away.',
      properties: {
        level: { type: 'string', maxLength: 200 },
        offset: { type: 'number', description: 'Model units above the level.' },
        axis: { type: 'string', enum: ['x', 'y', 'z'] },
        position: { type: 'number', description: 'Viewer coordinate along the axis.' },
        flip: { type: 'boolean', description: 'Cut away the other side.' },
      },
      mutates: true,
      async run(args, viewer) {
        const model = kit.requireModel(viewer)
        if (model.is2d()) throw new ToolInputError('sections apply to 3D views only')
        const levelName = args.string('level')
        let axis = args.string('axis') ?? 'z'
        let position = args.number('position')
        let basis = 'position'
        if (levelName) {
          const level = findLevel(await kit.getIndex(viewer), levelName)
          const base = level.zMin ?? level.elevation
          if (base === null) throw new Error(`level ${level.name} has no elements to place a cut`)
          const scale = model.getUnitScale()
          const offset =
            args.number('offset') ??
            (scale > 0 ? SECTION_DEFAULT_METERS / scale : SECTION_DEFAULT_METERS)
          axis = 'z'
          position = base + offset
          basis = `${level.name} + ${roundNumber(offset)}`
        }
        if (position === undefined) throw new ToolInputError('give level, or axis and position')
        const sign = args.boolean('flip') ? -1 : 1
        const normal = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis] ?? [0, 0, 1]
        viewer.setCutPlanes([
          kit.math.vector4(normal[0] * sign, normal[1] * sign, normal[2] * sign, -position * sign),
        ])
        return {
          text: json({ axis, position: roundNumber(position), basis, flipped: sign === -1 }),
          label: levelName
            ? `Sectioned at ${basis}`
            : `Sectioned ${axis} at ${roundNumber(position)}`,
        }
      },
    },
    {
      name: 'clear_section',
      description: 'Remove the section plane.',
      mutates: true,
      async run(_args, viewer) {
        viewer.setCutPlanes([])
        return { text: json({ section: null }), label: 'Removed the section' }
      },
    },
    {
      name: 'set_camera',
      description:
        'Orient the camera to a preset view of the model, or look at elements from the current direction. Both together orient, then frame the elements.',
      properties: {
        preset: { type: 'string', enum: [...CAMERA_PRESETS.keys()] },
        ...targetProperties,
      },
      mutates: true,
      movesCamera: true,
      async run(args, viewer) {
        const model = kit.requireModel(viewer)
        const preset = args.string('preset')
        const scoped = args.has('ids') || args.has('setId')
        if (!preset && !scoped) throw new ToolInputError('give preset, or ids or setId to look at')
        const targets = scoped ? kit.resolveTargets(args, viewer) : null
        const nav = viewer.navigation
        if (model.is2d()) {
          if (preset) throw new ToolInputError('camera presets apply to 3D views only')
        } else if (preset) {
          const box = model.getBoundingBox()
          const center = boxCenter(box)
          const [dx, dy, dz] = CAMERA_PRESETS.get(preset) ?? [1, -1, 1]
          const length = Math.hypot(dx, dy, dz)
          const reach = Math.max(distance(box.min, box.max), 1)
          const up = preset === 'top' || preset === 'bottom' ? [0, 1, 0] : [0, 0, 1]
          nav.setView(
            kit.math.vector3(
              center.x + (dx / length) * reach,
              center.y + (dy / length) * reach,
              center.z + (dz / length) * reach,
            ),
            kit.math.vector3(center.x, center.y, center.z),
          )
          nav.setCameraUpVector(kit.math.vector3(up[0], up[1], up[2]))
        } else if (targets) {
          const box = boundsOf(await kit.getIndex(viewer), targets.dbIds, kit.math)
          if (box) {
            const center = boxCenter(box)
            const position = nav.getPosition()
            const target = nav.getTarget()
            nav.setView(
              kit.math.vector3(
                center.x + position.x - target.x,
                center.y + position.y - target.y,
                center.z + position.z - target.z,
              ),
              kit.math.vector3(center.x, center.y, center.z),
            )
            nav.setPivotPoint(kit.math.vector3(center.x, center.y, center.z))
          }
        }
        viewer.fitToView(targets ? targets.dbIds : null, model, true)
        return {
          text: json({
            preset: preset ?? null,
            framed: targets ? targets.dbIds.length : 'model',
            position: roundVec(nav.getPosition()),
            target: roundVec(nav.getTarget()),
          }),
          label: preset
            ? `Camera to ${preset}${targets ? `, framing ${plural(targets.dbIds.length, 'element')}` : ''}`
            : `Looked at ${plural(targets?.dbIds.length ?? 0, 'element')}`,
          detail: targets?.source,
        }
      },
    },
    {
      name: 'list_views',
      description: 'Every 3D view and 2D sheet in the file, with the loaded one marked.',
      mutates: false,
      async run(_args, viewer) {
        const nodes = viewables(viewer, kit)
        const current = currentGuid(viewer)
        return {
          text: json({
            views: nodes.map((node, position) => ({
              index: position + 1,
              name: node.name(),
              kind: node.is2D() ? '2d' : '3d',
              guid: node.guid(),
              loaded: node.guid() === current,
            })),
          }),
          label: `Listed ${plural(nodes.length, 'view')}`,
        }
      },
    },
    {
      name: 'open_view',
      description:
        'Switch to another view or sheet by index, guid, or name from list_views. Waits for it to load; display changes and undo history reset.',
      properties: { view: { type: 'string', maxLength: 200 } },
      required: ['view'],
      mutates: true,
      async run(args, viewer, signal) {
        const wanted = (args.string('view') ?? '').trim()
        const nodes = viewables(viewer, kit)
        const position = Number(wanted)
        const lower = wanted.toLocaleLowerCase()
        let node =
          (Number.isInteger(position) && position >= 1 ? nodes[position - 1] : undefined) ??
          nodes.find((item) => item.guid() === wanted) ??
          nodes.find((item) => item.name().toLocaleLowerCase() === lower)
        if (!node) {
          const partial = nodes.filter((item) => item.name().toLocaleLowerCase().includes(lower))
          if (partial.length > 1) {
            throw new ToolInputError(
              `"${wanted}" matches ${partial.length} views; use the index from list_views`,
            )
          }
          node = partial[0]
        }
        if (!node) throw new ToolInputError(`no view "${wanted}"; run list_views`)
        const label = `${node.is2D() ? 'sheet' : 'view'} “${node.name()}”`
        if (node.guid() === currentGuid(viewer)) {
          return {
            text: json({ loaded: node.name(), changed: false }),
            label: `${label} is already open`,
            skipUndo: true,
          }
        }
        const started = kit.now()
        const model = await viewer.loadDocumentNode(node.getDocument(), node, {
          keepCurrentModels: false,
        })
        while (!(model.isLoadDone() && model.isObjectTreeCreated())) {
          if (kit.now() - started > VIEW_LOAD_CEILING_MS) {
            return {
              text: json({
                loaded: node.name(),
                ready: false,
                note: 'Still loading; try again shortly.',
              }),
              label: `Opening ${label}`,
              partial: true,
              skipUndo: true,
            }
          }
          await wait(100, signal)
        }
        kit.sync(viewer)
        return {
          text: json({ loaded: node.name(), kind: node.is2D() ? '2d' : '3d', changed: true }),
          label: `Opened ${label}`,
          skipUndo: true,
        }
      },
    },
    {
      name: 'save_view_state',
      description: 'Save the camera, visibility, section, selection, and colours under a name.',
      properties: { name: { type: 'string', maxLength: 80 } },
      required: ['name'],
      mutates: false,
      async run(args, viewer) {
        const name = args.string('name') ?? ''
        kit.savedStates.delete(name)
        kit.savedStates.set(name, kit.takeSnapshot(viewer))
        for (const key of [...kit.savedStates.keys()].slice(
          0,
          Math.max(0, kit.savedStates.size - 20),
        )) {
          kit.savedStates.delete(key)
        }
        return { text: json({ saved: name }), label: `Saved the view as “${name}”` }
      },
    },
    {
      name: 'restore_view_state',
      description: 'Return to a view saved with save_view_state.',
      properties: { name: { type: 'string', maxLength: 80 } },
      required: ['name'],
      mutates: true,
      movesCamera: true,
      async run(args, viewer) {
        const name = args.string('name') ?? ''
        const saved = kit.savedStates.get(name)
        if (!saved) {
          const names = [...kit.savedStates.keys()].join(', ')
          throw new ToolInputError(`no saved view "${name}" (saved: ${names || 'none'})`)
        }
        viewer.restoreState(saved.viewerState)
        kit.colors.restore(saved.colors)
        kit.repaint(viewer, kit.requireModel(viewer))
        return { text: json({ restored: name }), label: `Restored the view “${name}”` }
      },
    },
  ]
}
