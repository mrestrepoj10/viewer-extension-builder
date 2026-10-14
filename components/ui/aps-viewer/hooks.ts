'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useAPSViewerStore } from '@/components/ui/aps-viewer/context'
import { ViewerStore } from '@/components/ui/aps-viewer/store'
import type {
  APSCameraState,
  APSExtensionStatus,
  APSPropertyResult,
  APSViewer3D,
  Vec3,
} from '@/lib/viewer-types'

export interface APSViewerHandle {
  viewer: APSViewer3D | null
  isReady: boolean
}

export function useAPSViewer(): APSViewerHandle {
  const store = useAPSViewerStore()
  const viewer = useSyncExternalStore(store.subscribe, store.getViewer, ViewerStore.getServerViewer)
  return { viewer, isReady: viewer !== null }
}

export function useAPSModelLoaded(): boolean {
  const store = useAPSViewerStore()
  return useSyncExternalStore(
    store.subscribe,
    store.isModelLoaded,
    ViewerStore.getServerModelLoaded,
  )
}

export interface APSSelection {
  /** Currently selected dbIds (stable reference between selection events) */
  dbIds: readonly number[]
  select: (dbIds: number[] | number) => void
  clear: () => void
  isolate: (dbIds?: number[] | number) => void
  fitToView: (dbIds?: number[]) => void
}

export function useAPSSelection(): APSSelection {
  const store = useAPSViewerStore()
  const dbIds = useSyncExternalStore(
    store.subscribe,
    store.getSelection,
    ViewerStore.getServerSelection,
  )

  // The verbs memoize on the store alone, never on the selection snapshot, so
  // their identities survive selection events — safe in consumer dep arrays.
  const verbs = useMemo(
    () => ({
      select: (ids: number[] | number) => store.getViewer()?.select(ids),
      clear: () => store.getViewer()?.clearSelection(),
      isolate: (ids?: number[] | number) => store.getViewer()?.isolate(ids),
      fitToView: (ids?: number[]) => store.getViewer()?.fitToView(ids ?? null),
    }),
    [store],
  )

  return useMemo(() => ({ dbIds, ...verbs }), [dbIds, verbs])
}

export interface APSCamera {
  /** rAF-coalesced camera state (null until the first frame after load) */
  camera: APSCameraState | null
  setView: (position: Vec3, target: Vec3, up?: Vec3) => void
  fitToView: () => void
}

export function useAPSCamera(): APSCamera {
  const store = useAPSViewerStore()
  const camera = useSyncExternalStore(store.subscribe, store.getCamera, ViewerStore.getServerCamera)

  // Memoized on the store alone: verbs keyed on the per-frame camera snapshot
  // would re-run any consumer effect that lists them 60 times a second.
  const verbs = useMemo(
    () => ({
      setView: (position: Vec3, target: Vec3, up?: Vec3) => {
        const viewer = store.getViewer()
        if (!viewer) return
        // LMV accepts plain {x, y, z} vectors at runtime; the official typings
        // ask for THREE.Vector3, which is structurally a superset of Vec3.
        viewer.navigation.setView(position as THREE.Vector3, target as THREE.Vector3)
        if (up) viewer.navigation.setCameraUpVector(up as THREE.Vector3)
      },
      fitToView: () => store.getViewer()?.fitToView(null),
    }),
    [store],
  )

  return useMemo(() => ({ camera, ...verbs }), [camera, verbs])
}

/** The handler is kept in a ref, so inline closures are fine. Type the payload
 * through the type parameter: `useAPSViewerEvent<{ dbIdArray: number[] }>(...)`. */
export function useAPSViewerEvent<EventType = unknown>(
  eventType: string,
  handler: (event: EventType) => void,
): void {
  const { viewer } = useAPSViewer()
  const handlerRef = useRef(handler)
  // Synced after commit, not during render: a render React discards (Strict
  // Mode, a concurrent restart) must never leave its handler behind.
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!viewer) return
    const listener = (event: EventType) => handlerRef.current(event)
    viewer.addEventListener(eventType, listener)
    return () => viewer.removeEventListener(eventType, listener)
  }, [viewer, eventType])
}

export interface APSPropertiesResult {
  data: APSPropertyResult[]
  isLoading: boolean
  error: Error | null
}

const EMPTY_PROPERTIES: APSPropertiesResult = Object.freeze({
  data: [],
  isLoading: false,
  error: null,
})

/** `key` is the serialized identity of dbIds, so a freshly-computed array does
 * not refetch; while a fetch is in flight the previous results stay visible
 * with `isLoading: true`. */
export function useAPSProperties(dbIds: readonly number[]): APSPropertiesResult {
  const { viewer } = useAPSViewer()
  const key = dbIds.join(',')
  // Written only from async callbacks; the reset and loading states derive
  // during render by comparing against the last settled request.
  const [settled, setSettled] = useState<{
    viewer: APSViewer3D
    key: string
    data: APSPropertyResult[]
    error: Error | null
  } | null>(null)

  useEffect(() => {
    if (!viewer || key === '') return
    let cancelled = false

    Promise.all(
      key.split(',').map(
        (dbId) =>
          new Promise<APSPropertyResult>((resolve, reject) =>
            viewer.getProperties(
              Number(dbId),
              // The official typings mark name/externalId optional; LMV
              // populates both for every real dbId.
              (result) => resolve(result as APSPropertyResult),
              reject,
            ),
          ),
      ),
    )
      .then((data) => {
        if (!cancelled) setSettled({ viewer, key, data, error: null })
      })
      .catch((error) => {
        if (!cancelled)
          setSettled({
            viewer,
            key,
            data: [],
            error: error instanceof Error ? error : new Error(String(error)),
          })
      })

    return () => {
      cancelled = true
    }
  }, [viewer, key])

  return useMemo(() => {
    if (!viewer || key === '') return EMPTY_PROPERTIES
    if (settled && settled.viewer === viewer && settled.key === key) {
      return { data: settled.data, isLoading: false, error: settled.error }
    }
    // In flight: keep what last settled so lists do not blank out — but only
    // from the same viewer instance, whose model is the same model.
    return {
      data: settled && settled.viewer === viewer ? settled.data : [],
      isLoading: true,
      error: null,
    }
  }, [viewer, key, settled])
}

let contextMenuCallbackId = 0

export type BuildContextMenu = (
  items: import('@/lib/viewer-types').APSContextMenuItem[],
  status: import('@/lib/viewer-types').APSContextMenuStatus,
) => import('@/lib/viewer-types').APSContextMenuItem[]

export function useAPSContextMenu(build: BuildContextMenu): void {
  const { viewer } = useAPSViewer()
  const buildRef = useRef(build)
  // Synced after commit, not during render — see useAPSViewerEvent.
  useEffect(() => {
    buildRef.current = build
  })

  useEffect(() => {
    if (!viewer) return
    const id = `cantera-aps-viewer-menu-${++contextMenuCallbackId}`
    viewer.registerContextMenuCallback(id, (menu, status) => {
      const next = buildRef.current(menu.slice(), status)
      menu.length = 0
      menu.push(...next)
    })
    return () => {
      viewer.unregisterContextMenuCallback(id)
    }
  }, [viewer])
}

/** An `'error'` entry means that feature is unavailable, not that the viewer
 * is broken. */
export function useAPSExtensions(): Readonly<Record<string, APSExtensionStatus>> {
  const store = useAPSViewerStore()
  return useSyncExternalStore(
    store.subscribe,
    store.getExtensionStatuses,
    ViewerStore.getServerExtensionStatuses,
  )
}

export interface APSExtensionResult {
  status: 'idle' | APSExtensionStatus
  /** The loaded extension instance (null until ready). Cast to your extension's type. */
  extension: unknown
  error: Error | null
}

const IDLE_EXTENSION: APSExtensionResult = Object.freeze({
  status: 'idle',
  extension: null,
  error: null,
})

// Options may hold SDK objects, circular structures, or functions — never
// serialize them; compare by key identity.
function sameOptions(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => Object.is(a[key], b[key]))
}

/** Changing `options` after load re-applies them through the extension's own
 * `setOptions` when it exposes one. Keep option values referentially stable —
 * a literal recreated every render re-applies every render. */
export function useAPSExtension(id: string, options?: Record<string, unknown>): APSExtensionResult {
  const { viewer } = useAPSViewer()
  // Written only from async callbacks; `idle` (no viewer) and `loading`
  // derive during render by comparing against the last settled load.
  const [generation, setGeneration] = useState(0)
  const readyRef = useRef(false)
  const [settled, setSettled] = useState<{
    viewer: APSViewer3D
    id: string
    generation: number
    status: 'ready' | 'error'
    extension: unknown
    error: Error | null
  } | null>(null)
  const optionsRef = useRef(options)
  const appliedOptionsRef = useRef(options)
  // Synced after commit, not during render — see useAPSViewerEvent. Declared
  // before the load effect so a same-commit id change reads current options.
  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    if (!viewer) return
    let cancelled = false
    readyRef.current = false
    appliedOptionsRef.current = optionsRef.current
    viewer
      .loadExtension(id, optionsRef.current)
      .then((extension) => {
        if (cancelled) return
        readyRef.current = true
        setSettled({
          viewer,
          id,
          generation,
          status: 'ready',
          extension: extension ?? viewer.getExtension(id),
          error: null,
        })
      })
      .catch((error) => {
        if (cancelled) return
        console.error(`cantera aps-viewer: failed to load extension "${id}"`, error)
        setSettled({
          viewer,
          id,
          generation,
          status: 'error',
          extension: null,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })
    return () => {
      cancelled = true
      try {
        viewer.unloadExtension(id)
      } catch {
        // viewer may already be finished
      }
    }
  }, [viewer, id, generation])

  // Switching viewables tears the viewer down, and LMV unloads every extension
  // it did not load itself; load this one again once the next model is in.
  useEffect(() => {
    const viewing = typeof window === 'undefined' ? undefined : window.Autodesk?.Viewing
    if (!viewer || !viewing) return
    const onModelAdded = () => {
      if (readyRef.current && !viewer.getExtension(id)) setGeneration((current) => current + 1)
    }
    viewer.addEventListener(viewing.MODEL_ADDED_EVENT, onModelAdded)
    return () => viewer.removeEventListener(viewing.MODEL_ADDED_EVENT, onModelAdded)
  }, [viewer, id])

  const result = useMemo<APSExtensionResult>(() => {
    if (!viewer) return IDLE_EXTENSION
    if (
      settled &&
      settled.viewer === viewer &&
      settled.id === id &&
      settled.generation === generation
    ) {
      return { status: settled.status, extension: settled.extension, error: settled.error }
    }
    return { status: 'loading', extension: null, error: null }
  }, [viewer, id, generation, settled])

  const { status, extension } = result
  // Keyed on the fields it reads, not the whole result object, so an
  // unrelated change (a new error) cannot re-run the option pass.
  useEffect(() => {
    if (status !== 'ready' || sameOptions(appliedOptionsRef.current, options)) return
    appliedOptionsRef.current = options
    const loaded = extension as {
      setOptions?: (options: Record<string, unknown>) => unknown
    } | null
    loaded?.setOptions?.(options ?? {})
  }, [status, extension, options])

  return result
}

export function useAPSAutoResize(): void {
  const { viewer } = useAPSViewer()
  useEffect(() => {
    if (!viewer || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => viewer.resize())
    observer.observe(viewer.container)
    return () => observer.disconnect()
  }, [viewer])
}
