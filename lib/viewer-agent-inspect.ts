import type { AgentImage, JsonValue } from '@/lib/agent-types'
import {
  boxCenter,
  boxGap,
  boxSize,
  describeError,
  distance,
  elementJson,
  isInternalCategory,
  json,
  limitProperty,
  plural,
  roundBox,
  roundNumber,
  roundVec,
  SCREENSHOT_MAX_EDGE,
  ToolInputError,
  targetProperties,
  throwIfAborted,
  type ViewerAgentDocumentNode,
  type ViewerAgentViewer,
  type ViewerToolKit,
  type ViewerToolSpec,
} from '@/lib/viewer-agent-core'
import { boundsOf, bulkProperties, filterElements } from '@/lib/viewer-agent-state'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

/** The translated source file, e.g. `Tower.rvt`: the manifest's first viewable folder. */
export function sourceFileName(node: ViewerAgentDocumentNode | null): string | null {
  try {
    const viewable = node?.getDocument().getRoot().search({ type: 'folder', role: 'viewable' })[0]
    return viewable?.name() || null
  } catch {
    return null
  }
}

function formatValue(property: Autodesk.Viewing.Property): string {
  const unit = property.units
    ? ` ${property.units.replace(/^autodesk\.unit\.unit:/, '').replace(/-[\d.]+$/, '')}`
    : ''
  const value =
    typeof property.displayValue === 'number'
      ? String(roundNumber(property.displayValue, 4))
      : String(property.displayValue)
  return `${value}${unit}`
}

function screenshotBlob(viewer: ViewerAgentViewer, width: number, height: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the screenshot timed out')), 20_000)
    viewer.getScreenShot(width, height, (url) => {
      clearTimeout(timer)
      fetch(url)
        .then((response) => response.blob())
        .then(resolve, reject)
        .finally(() => {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
        })
    })
  })
}

/** PNG screenshots run to hundreds of kilobytes and every image stays in the conversation
 * checkpoint, which libfx caps at 4 MiB; JPEG keeps a view legible at a fraction of that. */
async function compressScreenshot(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return blob
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) return blob
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, bitmap.width, bitmap.height)
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
    return jpeg.size < blob.size ? jpeg : blob
  } catch {
    return blob
  }
}

export function inspectionTools(kit: ViewerToolKit): ViewerToolSpec[] {
  return [
    {
      name: 'get_model_info',
      description:
        'Source file name, loaded view, units, element count, level and category counts, bounding box, and the current selection size.',
      mutates: false,
      async run(_args, viewer) {
        const model = kit.requireModel(viewer)
        const index = await kit.getIndex(viewer)
        const node = model.getDocumentNode()
        const box = model.getBoundingBox()
        const units = model.getUnitString() || 'unknown'
        return {
          text: json({
            file: sourceFileName(node),
            view: node?.name() ?? null,
            is2d: model.is2d(),
            units,
            metresPerUnit: roundNumber(model.getUnitScale(), 6),
            elements: index.elements.length,
            levels: index.levels.length,
            categories: index.categories.length,
            boundingBox: roundBox(box),
            selected: viewer.getSelection().length,
            sets: kit.sets.list().length,
          }),
          label: 'Read the model summary',
          detail: `${plural(index.elements.length, 'element')} · ${units}`,
        }
      },
    },
    {
      name: 'list_levels',
      description:
        'Every level with its element count, authored elevation when known, and the viewer z range of its elements.',
      mutates: false,
      async run(_args, viewer) {
        const index = await kit.getIndex(viewer)
        return {
          text: json({
            levels: index.levels.map((level) => ({
              name: level.name,
              elements: level.count,
              elevation: level.elevation === null ? null : roundNumber(level.elevation),
              zMin: level.zMin === null ? null : roundNumber(level.zMin),
              zMax: level.zMax === null ? null : roundNumber(level.zMax),
            })),
          }),
          label: `Listed ${plural(index.levels.length, 'level')}`,
        }
      },
    },
    {
      name: 'list_categories',
      description: 'Element categories (Walls, Doors, ...) with counts, largest first.',
      properties: { limit: limitProperty(100, 500) },
      mutates: false,
      async run(args, viewer) {
        const index = await kit.getIndex(viewer)
        const limit = args.number('limit') ?? 100
        return {
          text: json({
            total: index.categories.length,
            categories: index.categories
              .slice(0, limit)
              .map((row) => ({ name: row.name, elements: row.count })),
          }),
          label: `Listed ${plural(Math.min(limit, index.categories.length), 'category', 'categories')}`,
        }
      },
    },
    {
      name: 'find_elements',
      description:
        'Find leaf elements matching every given filter (category, level, name, a property value). Exact names win over substrings. Saves all matches as a set and lists a sample.',
      properties: {
        category: { type: 'string', maxLength: 200 },
        level: { type: 'string', maxLength: 200 },
        name: { type: 'string', maxLength: 200, description: 'Substring of the element name.' },
        propertyName: { type: 'string', maxLength: 200 },
        propertyValue: {
          type: 'string',
          maxLength: 500,
          description: 'Requires propertyName; omit it to match any non-empty value.',
        },
        label: { type: 'string', maxLength: 80, description: 'A name for the saved set.' },
        limit: limitProperty(20, 500),
      },
      mutates: false,
      async run(args, viewer) {
        const category = args.string('category')
        const level = args.string('level')
        const name = args.string('name')
        const propertyName = args.string('propertyName')
        const propertyValue = args.string('propertyValue')
        if (!category && !level && !name && !propertyName) {
          throw new ToolInputError('give at least one of category, level, name, propertyName')
        }
        if (propertyValue !== undefined && !propertyName) {
          throw new ToolInputError('propertyValue needs propertyName')
        }
        const index = await kit.getIndex(viewer)
        let hits = filterElements(index.elements, { category, level, name })
        if (propertyName && hits.length > 0) {
          const wantedName = propertyName.toLocaleLowerCase()
          const wantedValue = propertyValue?.toLocaleLowerCase()
          const results = await bulkProperties(
            index.model,
            hits.map((row) => row.dbId),
            [propertyName],
          )
          const matched = new Set<number>()
          for (const result of results) {
            for (const property of result.properties) {
              if (property.displayName.toLocaleLowerCase() !== wantedName) continue
              const value = String(property.displayValue ?? '').toLocaleLowerCase()
              if (wantedValue === undefined ? value !== '' : value.includes(wantedValue)) {
                matched.add(result.dbId)
              }
            }
          }
          hits = hits.filter((row) => matched.has(row.dbId))
        }
        const description = [
          category ?? 'Elements',
          level ? `on ${level}` : '',
          name ? `named “${name}”` : '',
          propertyName ? `with ${propertyName}${propertyValue ? ` = ${propertyValue}` : ''}` : '',
        ]
          .filter(Boolean)
          .join(' ')
        if (hits.length === 0) {
          return {
            text: json({
              count: 0,
              hint: 'No matches. Check names with list_levels or list_categories.',
            }),
            label: `No ${description.toLocaleLowerCase()}`,
          }
        }
        const set = kit.sets.create(
          args.string('label') ?? description,
          hits.map((row) => row.dbId),
          'find_elements',
        )
        const limit = args.number('limit') ?? 20
        return {
          text: json({
            set: set.id,
            count: hits.length,
            shown: Math.min(limit, hits.length),
            elements: hits.slice(0, limit).map(elementJson),
          }),
          label: `Found ${plural(hits.length, 'element')}: ${description}`,
          detail: set.id,
          setId: set.id,
        }
      },
    },
    {
      name: 'search_text',
      description:
        'Full-text search across property values (optionally only in the named properties). Saves the matching leaf elements as a set.',
      properties: {
        text: { type: 'string', maxLength: 200 },
        propertyNames: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        limit: limitProperty(20, 500),
      },
      required: ['text'],
      mutates: false,
      async run(args, viewer) {
        const text = args.string('text') ?? ''
        const index = await kit.getIndex(viewer)
        const names = args.strings('propertyNames')
        const raw = await new Promise<number[]>((resolve, reject) =>
          viewer.search(
            text,
            resolve,
            (error) => reject(new Error(`search failed: ${describeError(error)}`)),
            names,
          ),
        )
        const hits = [...new Set(raw)].filter((id) => index.byId.has(id))
        if (hits.length === 0) {
          return { text: json({ count: 0 }), label: `No matches for “${text}”` }
        }
        const set = kit.sets.create(`“${text}”`, hits, 'search_text')
        const limit = args.number('limit') ?? 20
        return {
          text: json({
            set: set.id,
            count: hits.length,
            shown: Math.min(limit, hits.length),
            elements: hits.slice(0, limit).flatMap((id) => {
              const row = index.byId.get(id)
              return row ? [elementJson(row)] : []
            }),
          }),
          label: `Found ${plural(hits.length, 'match', 'matches')} for “${text}”`,
          detail: set.id,
          setId: set.id,
        }
      },
    },
    {
      name: 'get_properties',
      description:
        'Properties of elements, optionally only the named ones. Lists the first `limit` elements.',
      properties: {
        ...targetProperties,
        names: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        limit: limitProperty(10, 100),
      },
      mutates: false,
      async run(args, viewer) {
        const model = kit.requireModel(viewer)
        const { dbIds, source } = kit.resolveTargets(args, viewer)
        const names = args.strings('names')
        const limit = args.number('limit') ?? 10
        const wanted = names ? new Set(names.map((name) => name.toLocaleLowerCase())) : null
        const results = await bulkProperties(
          model,
          dbIds.slice(0, limit),
          names ? ['name', ...names] : undefined,
        )
        const elements = results.map((result) => {
          const properties: { [name: string]: JsonValue } = {}
          for (const property of result.properties) {
            const requested = wanted?.has(property.displayName.toLocaleLowerCase()) ?? false
            if (wanted && !requested) continue
            if (!wanted && (property.hidden || isInternalCategory(property.displayCategory))) {
              continue
            }
            if (property.displayValue === '' || property.displayValue === null) continue
            const key =
              property.displayName in properties
                ? `${property.displayName} (${property.displayCategory})`
                : property.displayName
            properties[key] = formatValue(property)
          }
          return { id: result.dbId, name: result.name ?? '', properties }
        })
        return {
          text: json({ count: dbIds.length, shown: elements.length, elements }),
          label: `Read properties of ${plural(elements.length, 'element')}`,
          detail: source,
        }
      },
    },
    {
      name: 'get_selection',
      description: 'What the user has selected in the viewer right now; saves it as a set.',
      mutates: false,
      async run(_args, viewer) {
        const selection = viewer.getSelection()
        if (selection.length === 0) {
          return {
            text: json({ count: 0, note: 'Nothing is selected.' }),
            label: 'Nothing selected',
          }
        }
        const index = await kit.getIndex(viewer)
        const set = kit.sets.create('Selection', selection, 'get_selection')
        return {
          text: json({
            set: set.id,
            count: selection.length,
            elements: selection.slice(0, 20).map((id) => {
              const row = index.byId.get(id)
              return row ? elementJson(row) : { id }
            }),
          }),
          label: `Read the selection (${plural(selection.length, 'element')})`,
          detail: set.id,
          setId: set.id,
        }
      },
    },
    {
      name: 'list_sets',
      description: 'The element sets saved so far, newest last.',
      mutates: false,
      async run() {
        const list = kit.sets.list()
        return {
          text: json({
            sets: list.map((set) => ({
              id: set.id,
              label: set.label,
              elements: set.dbIds.length,
              origin: set.origin,
            })),
          }),
          label: `Listed ${plural(list.length, 'set')}`,
        }
      },
    },
    {
      name: 'measure_bbox',
      description:
        'Combined bounding box of elements (size and centre). With toIds or toSetId, also the centre-to-centre distance and the box-to-box gap between the two groups.',
      properties: {
        ...targetProperties,
        toIds: { type: 'array', items: { type: 'integer' }, maxItems: 10_000 },
        toSetId: { type: 'string', maxLength: 64 },
      },
      mutates: false,
      async run(args, viewer) {
        const model = kit.requireModel(viewer)
        const index = await kit.getIndex(viewer)
        const unit = model.getUnitString() || 'model units'
        const scale = model.getUnitScale()
        const metres = (value: number) => (scale > 0 ? roundNumber(value * scale) : null)
        const first = kit.resolveTargets(args, viewer)
        const boxA = boundsOf(index, first.dbIds, kit.math)
        if (!boxA) throw new Error('those elements have no geometry to measure')
        const size = boxSize(boxA)
        const measured = {
          unit,
          size: roundVec(size),
          sizeMetres: { x: metres(size.x), y: metres(size.y), z: metres(size.z) },
          center: roundVec(boxCenter(boxA)),
          boundingBox: roundBox(boxA),
        }
        if (!args.has('toIds') && !args.has('toSetId')) {
          return {
            text: json(measured),
            label: `Measured ${plural(first.dbIds.length, 'element')}`,
            detail: first.source,
          }
        }
        const second = kit.resolveTargets(args, viewer, 'toIds', 'toSetId')
        const boxB = boundsOf(index, second.dbIds, kit.math)
        if (!boxB) throw new Error('the second group has no geometry to measure')
        const a = boxCenter(boxA)
        const b = boxCenter(boxB)
        const centres = distance(a, b)
        const gap = boxGap(boxA, boxB)
        return {
          text: json({
            ...measured,
            distance: roundNumber(centres),
            distanceMetres: metres(centres),
            delta: roundVec({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }),
            gap: roundNumber(gap),
            gapMetres: metres(gap),
          }),
          label: `Measured ${roundNumber(centres, 2)} ${unit} between two groups`,
          detail: `${first.source} to ${second.source}`,
        }
      },
    },
    {
      name: 'take_screenshot',
      description: 'An image of the current view, attached so you can see it.',
      properties: {
        maxEdge: {
          type: 'integer',
          minimum: 256,
          maximum: SCREENSHOT_MAX_EDGE,
          description: `Longest side in pixels (default ${SCREENSHOT_MAX_EDGE}).`,
        },
      },
      mutates: false,
      async run(args, viewer) {
        const maxEdge = args.number('maxEdge') ?? SCREENSHOT_MAX_EDGE
        const { clientWidth, clientHeight } = viewer.container
        const longest = Math.max(clientWidth, clientHeight, 1)
        const scale = Math.min(1, maxEdge / longest)
        const width = Math.max(1, Math.round(clientWidth * scale))
        const height = Math.max(1, Math.round(clientHeight * scale))
        const blob = await compressScreenshot(await screenshotBlob(viewer, width, height))
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const image: AgentImage = {
          mimeType: blob.type || 'image/png',
          base64: toBase64(bytes),
          width,
          height,
        }
        return {
          text: json({ width, height, bytes: bytes.length, note: 'The screenshot is attached.' }),
          label: 'Took a screenshot',
          detail: `${width} × ${height}`,
          image,
        }
      },
    },
    {
      name: 'run_query',
      description:
        'Evaluate JavaScript over a copy of the property database in a sandboxed worker (no page, no network), time-boxed. code is an expression, a function (pdb) => value, or a function body that returns. pdb: leaves(), elements(), name(id), props(id), prop(id, name), find((id, pdb) => boolean), attributes(). console.log output is returned too.',
      properties: {
        code: { type: 'string', maxLength: 20_000 },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 30_000 },
      },
      required: ['code'],
      mutates: false,
      async run(args, viewer, signal) {
        const model = kit.requireModel(viewer)
        const index = await kit.getIndex(viewer)
        const snapshot = await kit.getSnapshot(model)
        throwIfAborted(signal)
        const result = await kit.runQuery({
          snapshot,
          elements: index.elements,
          code: args.string('code') ?? '',
          timeoutMs: args.number('timeoutMs') ?? kit.queryTimeoutMs,
          maxChars: kit.resultLimit,
          signal,
        })
        const logs = result.logs.length > 0 ? `\nconsole:\n${result.logs.join('\n')}` : ''
        if (!result.ok) throw new Error(`${result.error}${logs}`)
        return {
          text: `${result.text}${logs}`,
          label: 'Ran a property query',
          detail: result.count === null ? undefined : plural(result.count, 'result'),
          partial: result.truncated,
        }
      },
    },
  ]
}
