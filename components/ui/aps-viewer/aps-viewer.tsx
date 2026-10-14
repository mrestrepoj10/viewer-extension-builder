'use client'

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { APSViewerContext } from '@/components/ui/aps-viewer/context'
import {
  type APSViewerHideOthersExtension,
  registerAPSViewerHideOthers,
} from '@/components/ui/aps-viewer/hide-others'
import {
  acquireViewerRuntime,
  onViewerTokenError,
  releaseViewerRuntime,
  toDocumentId,
} from '@/components/ui/aps-viewer/loader'
import { ViewerStore } from '@/components/ui/aps-viewer/store'
import {
  APS_VIEWER_TOOLBAR_EXTENSION_ID,
  type APSViewerToolbarExtension,
  type APSViewerToolbarPosition,
  type APSViewerToolbarScale,
  registerAPSViewerToolbar,
} from '@/components/ui/aps-viewer/toolbar'
import {
  APS_HIDE_OTHERS_EXTENSION_ID,
  type APSDocument,
  type APSExtensionRequest,
  type APSModel,
  type APSViewer3D,
  type APSViewerProfile,
  type GetAccessToken,
} from '@/lib/viewer-types'

export type {
  APSViewerToolbarPosition,
  APSViewerToolbarScale,
} from '@/components/ui/aps-viewer/toolbar'

export interface APSViewerProps {
  /** Model Derivative URN (base64), with or without the `urn:` prefix. Omit to
   * mount an empty viewer and load models imperatively. */
  urn?: string
  /** Fetches an OAuth token from your backend. Must be referentially stable
   * or the value at first mount wins (the SDK initializer is global). */
  getAccessToken: GetAccessToken
  version?: string
  env?: string
  api?: string
  /** Extensions to load once the viewer starts. Captured when the viewer
   * mounts; failures report through `onExtensionError`. */
  extensions?: readonly APSExtensionRequest[]
  viewerConfig?: Record<string, unknown>
  profile?: APSViewerProfile
  toolbar?: 'native' | 'none'
  /** Changes apply live, without recreating the viewer. */
  toolbarPosition?: APSViewerToolbarPosition
  /** Changes apply live, without recreating the viewer. */
  toolbarScale?: APSViewerToolbarScale
  viewCube?: boolean
  /** The Hide others toggle in the native toolbar: keeps the selection and fully hides the
   * rest. `useAPSHideOthers` drives the mode with or without the button. Changes apply live. */
  hideOthers?: boolean
  /** Clip the viewer frame to this pixel radius, clamped to 0–32. */
  radius?: number
  /** Force one appearance. Omit to follow the app's light/dark appearance live. */
  theme?: 'light' | 'dark'
  autoResize?: boolean
  /** Default false: keeps the SDK runtime warm across route changes. */
  shutdownOnUnmount?: boolean
  onViewerReady?: (viewer: APSViewer3D) => void
  onModelLoaded?: (model: APSModel, doc: APSDocument) => void
  onError?: (error: Error) => void
  /** Non-fatal: the viewer and the other extensions keep going. */
  onExtensionError?: (id: string, error: Error) => void
  className?: string
  style?: CSSProperties
  /** Overlay UI: absolutely positioned children sit on top of the canvas and
   * can use every hook. */
  children?: ReactNode
}

function toExtensionEntry(request: APSExtensionRequest): {
  id: string
  options?: Record<string, unknown>
} {
  return typeof request === 'string' ? { id: request } : request
}

function unloadModel(viewer: APSViewer3D | null, model: APSModel | null): void {
  if (!viewer || !model) return
  try {
    viewer.unloadModel(model)
  } catch {
    // the viewer is gone; the model went with it
  }
}

/** Disable ViewCube at construction so GuiViewer3D cannot auto-load it after
 * the live visibility effect has already asked it to unload. */
function withInitialViewCube(
  viewerConfig: Record<string, unknown> | undefined,
  viewCube: boolean,
): Record<string, unknown> | undefined {
  if (viewCube) return viewerConfig
  const configured = viewerConfig?.disabledExtensions
  const disabledExtensions =
    configured && typeof configured === 'object' ? configured : ({} as Record<string, unknown>)
  return {
    ...viewerConfig,
    disabledExtensions: { ...disabledExtensions, viewcube: true },
  }
}

// SSR-safe: no window access until effects run. Tears down cleanly under
// React Strict Mode's mount → unmount → remount cycle, which is where naive
// viewer wrappers leak WebGL contexts.
export function APSViewer({
  urn,
  getAccessToken,
  version,
  env,
  api,
  extensions,
  viewerConfig,
  profile,
  toolbar = 'native',
  toolbarPosition = 'bottom',
  toolbarScale = 'md',
  viewCube = true,
  hideOthers = true,
  radius,
  theme,
  autoResize = true,
  shutdownOnUnmount = false,
  onViewerReady,
  onModelLoaded,
  onError,
  onExtensionError,
  className,
  style,
  children,
}: APSViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [store] = useState(() => new ViewerStore())
  // Lifecycle status lives in the store: the viewer is an external imperative
  // resource, so its lifecycle is external state, not component state.
  const status = useSyncExternalStore(store.subscribe, store.getStatus, ViewerStore.getServerStatus)
  const [viewerEpoch, setViewerEpoch] = useState(0)
  const viewerRef = useRef<APSViewer3D | null>(null)
  const viewCubeRef = useRef(viewCube)
  const toolbarOptionsRef = useRef({ position: toolbarPosition, scale: toolbarScale })
  const hideOthersRef = useRef(hideOthers)
  const frameRadius =
    radius === undefined || !Number.isFinite(radius) ? undefined : Math.min(32, Math.max(0, radius))

  // Latest-value refs: listing any of these as an effect dependency would tear
  // down the WebGL context whenever a consumer passes a fresh closure or
  // literal. `viewerConfig` and `extensions` are captured at viewer creation.
  const callbacksRef = useRef({
    getAccessToken,
    onViewerReady,
    onModelLoaded,
    onError,
    onExtensionError,
    shutdownOnUnmount,
    viewerConfig,
    extensions,
  })
  // Synced after commit, not during render: a render React discards (Strict
  // Mode, a concurrent restart) must never leave its callbacks behind.
  useEffect(() => {
    callbacksRef.current = {
      getAccessToken,
      onViewerReady,
      onModelLoaded,
      onError,
      onExtensionError,
      shutdownOnUnmount,
      viewerConfig,
      extensions,
    }
  })

  useEffect(() => {
    viewCubeRef.current = viewCube
  }, [viewCube])

  useEffect(() => {
    toolbarOptionsRef.current = { position: toolbarPosition, scale: toolbarScale }
  }, [toolbarPosition, toolbarScale])

  useEffect(() => {
    hideOthersRef.current = hideOthers
  }, [hideOthers])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let viewer: APSViewer3D | null = null

    store.setStatus('loading-runtime')
    acquireViewerRuntime({
      getAccessToken: () => callbacksRef.current.getAccessToken(),
      version,
      env,
      api,
    })
      .then((autodesk) => {
        // Strict Mode: the first effect's cleanup may already have run.
        if (disposed) return
        const Ctor = toolbar === 'none' ? autodesk.Viewing.Viewer3D : autodesk.Viewing.GuiViewer3D
        viewer = new Ctor(
          container,
          withInitialViewCube(callbacksRef.current.viewerConfig, viewCubeRef.current),
        )
        const startCode = viewer.start()
        if (startCode > 0) {
          throw new Error(`cantera aps-viewer: viewer.start() failed with code ${startCode}`)
        }
        viewerRef.current = viewer
        store.attach(viewer)
        // The runtime can resolve so quickly that `loading-runtime` → `ready`
        // batches into one status value; the epoch restarts model loading.
        setViewerEpoch((previous) => previous + 1)
        if (profile) {
          const settings = {
            aec: autodesk.Viewing.ProfileSettings.AEC,
            default: autodesk.Viewing.ProfileSettings.Default,
            fluent: autodesk.Viewing.ProfileSettings.Fluent,
            navis: autodesk.Viewing.ProfileSettings.Navis,
          }[profile]
          if (settings) viewer.setProfile(new autodesk.Viewing.Profile(settings))
        }
        const boundViewer = viewer
        if (toolbar === 'native') {
          registerAPSViewerToolbar(autodesk)
          boundViewer
            .loadExtension(APS_VIEWER_TOOLBAR_EXTENSION_ID, toolbarOptionsRef.current)
            .then((extension) => {
              if (disposed) {
                boundViewer.unloadExtension(APS_VIEWER_TOOLBAR_EXTENSION_ID)
                return
              }
              const nativeToolbar = extension as APSViewerToolbarExtension
              nativeToolbar.setOptions(toolbarOptionsRef.current)
            })
            .catch((error) => {
              if (disposed) return
              const wrapped =
                error instanceof Error
                  ? error
                  : new Error('cantera aps-viewer: native toolbar configuration failed')
              console.error('cantera aps-viewer: failed to configure the native toolbar', error)
              callbacksRef.current.onExtensionError?.(APS_VIEWER_TOOLBAR_EXTENSION_ID, wrapped)
            })
        }
        registerAPSViewerHideOthers(autodesk)
        boundViewer
          .loadExtension(APS_HIDE_OTHERS_EXTENSION_ID, { button: hideOthersRef.current })
          .then((extension) => {
            if (disposed) {
              boundViewer.unloadExtension(APS_HIDE_OTHERS_EXTENSION_ID)
              return
            }
            const mode = extension as APSViewerHideOthersExtension
            mode.setOptions({ button: hideOthersRef.current })
          })
          .catch((error) => {
            if (disposed) return
            const wrapped =
              error instanceof Error
                ? error
                : new Error('cantera aps-viewer: Hide others failed to load')
            console.error('cantera aps-viewer: failed to load Hide others', error)
            callbacksRef.current.onExtensionError?.(APS_HIDE_OTHERS_EXTENSION_ID, wrapped)
          })
        for (const request of callbacksRef.current.extensions ?? []) {
          const { id, options } = toExtensionEntry(request)
          store.setExtensionStatus(id, 'loading')
          boundViewer
            .loadExtension(id, options)
            .then(() => {
              if (!disposed) store.setExtensionStatus(id, 'ready')
            })
            .catch((error) => {
              if (disposed) return
              store.setExtensionStatus(id, 'error')
              const wrapped =
                error instanceof Error
                  ? error
                  : new Error(`cantera aps-viewer: failed to load extension "${id}"`)
              console.error(`cantera aps-viewer: failed to load extension "${id}"`, error)
              callbacksRef.current.onExtensionError?.(id, wrapped)
            })
        }
        store.setStatus('ready')
        callbacksRef.current.onViewerReady?.(viewer)
      })
      .catch((error: Error) => {
        if (disposed) return
        store.setStatus('error')
        callbacksRef.current.onError?.(error)
      })

    return () => {
      disposed = true
      // detach() also resets the store's status to 'idle'.
      store.detach()
      if (viewer) {
        // Unloaded before finish so an active Hide others hands back the ghosting preference.
        viewer.unloadExtension(APS_HIDE_OTHERS_EXTENSION_ID)
        viewer.unloadExtension(APS_VIEWER_TOOLBAR_EXTENSION_ID)
        viewer.finish()
        viewer = null
        viewerRef.current = null
      }
      releaseViewerRuntime({ shutdown: callbacksRef.current.shutdownOnUnmount })
    }
  }, [version, env, api, toolbar, profile, store])

  // Appearance is deliberately separate from viewer lifetime: a theme switch
  // calls setTheme in place and never burns a second WebGL context.
  useEffect(() => {
    if (status !== 'ready') return
    const viewer = viewerRef.current
    if (!viewer || typeof window === 'undefined') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const root = document.documentElement
      const dark = theme
        ? theme === 'dark'
        : root.classList.contains('dark') || (!root.classList.contains('light') && media.matches)
      viewer.setTheme(dark ? 'dark-theme' : 'light-theme')
    }
    apply()
    if (theme) return

    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    media.addEventListener('change', apply)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', apply)
    }
  }, [status, theme])

  // ViewCube APIs moved into Autodesk.ViewCubeUi in LMV v7. Treat it as live
  // chrome: load/unload the extension without replacing the WebGL viewer.
  useEffect(() => {
    if (viewerEpoch === 0 || status !== 'ready') return
    const viewer = viewerRef.current
    if (!viewer) return
    let cancelled = false
    const id = 'Autodesk.ViewCubeUi'

    if (viewCube) {
      viewer
        .loadExtension(id)
        .then(() => {
          if (cancelled && (!viewCubeRef.current || viewerRef.current !== viewer)) {
            viewer.unloadExtension(id)
          }
        })
        .catch((error) => {
          if (cancelled) return
          const wrapped =
            error instanceof Error
              ? error
              : new Error('cantera aps-viewer: ViewCube failed to load')
          console.error('cantera aps-viewer: failed to load the ViewCube extension', error)
          callbacksRef.current.onExtensionError?.(id, wrapped)
        })
    } else {
      viewer.unloadExtension(id)
    }

    return () => {
      cancelled = true
    }
  }, [status, viewCube, viewerEpoch])

  useEffect(() => {
    if (viewerEpoch === 0 || status !== 'ready' || toolbar !== 'native') return
    const extension = viewerRef.current?.getExtension(APS_VIEWER_TOOLBAR_EXTENSION_ID) as
      | APSViewerToolbarExtension
      | null
      | undefined
    extension?.setOptions({ position: toolbarPosition, scale: toolbarScale })
  }, [status, toolbar, toolbarPosition, toolbarScale, viewerEpoch])

  useEffect(() => {
    if (viewerEpoch === 0 || status !== 'ready') return
    const extension = viewerRef.current?.getExtension(APS_HIDE_OTHERS_EXTENSION_ID) as
      | APSViewerHideOthersExtension
      | null
      | undefined
    extension?.setOptions({ button: hideOthers })
  }, [status, hideOthers, viewerEpoch])

  // Switching viewables (the document browser, a sheet link) tears the viewer
  // down, and LMV unloads every extension it did not load itself. Load ours
  // again once the next model is in; the ones still loading are left alone.
  useEffect(() => {
    if (viewerEpoch === 0 || status !== 'ready') return
    const viewer = viewerRef.current
    const viewing = typeof window === 'undefined' ? undefined : window.Autodesk?.Viewing
    if (!viewer || !viewing) return
    const restoring = new Set<string>()
    const restore = (
      id: string,
      options: Record<string, unknown> | undefined,
      onLoaded?: (extension: unknown) => void,
    ) => {
      if (restoring.has(id) || viewer.getExtension(id)) return
      restoring.add(id)
      viewer
        .loadExtension(id, options)
        .then((extension) => onLoaded?.(extension))
        .catch((error) => {
          const wrapped =
            error instanceof Error
              ? error
              : new Error(`cantera aps-viewer: failed to reload extension "${id}"`)
          console.error(`cantera aps-viewer: failed to reload extension "${id}"`, error)
          callbacksRef.current.onExtensionError?.(id, wrapped)
        })
        .finally(() => restoring.delete(id))
    }
    const onModelAdded = () => {
      if (toolbar === 'native') {
        restore(APS_VIEWER_TOOLBAR_EXTENSION_ID, toolbarOptionsRef.current, (extension) =>
          (extension as APSViewerToolbarExtension | undefined)?.setOptions(
            toolbarOptionsRef.current,
          ),
        )
      }
      restore(APS_HIDE_OTHERS_EXTENSION_ID, { button: hideOthersRef.current }, (extension) =>
        (extension as APSViewerHideOthersExtension | undefined)?.setOptions({
          button: hideOthersRef.current,
        }),
      )
      const statuses = store.getExtensionStatuses()
      for (const request of callbacksRef.current.extensions ?? []) {
        const { id, options } = toExtensionEntry(request)
        if (statuses[id] === 'ready') restore(id, options)
      }
    }
    viewer.addEventListener(viewing.MODEL_ADDED_EVENT, onModelAdded)
    return () => viewer.removeEventListener(viewing.MODEL_ADDED_EVENT, onModelAdded)
  }, [status, toolbar, viewerEpoch, store])

  // The SDK's token callback cannot reject, so the loader broadcasts token
  // failures instead: without this the viewer would sit at "loading" forever
  // with nothing reported to the consumer.
  useEffect(
    () =>
      onViewerTokenError((error) => {
        // A ready viewer keeps rendering with its last good token; anything
        // earlier in the lifecycle cannot finish loading without one.
        if (store.getStatus() !== 'ready') store.setStatus('error')
        callbacksRef.current.onError?.(error)
      }),
    [store],
  )

  useEffect(() => {
    if (!autoResize || status !== 'ready' || typeof ResizeObserver === 'undefined') return
    const viewer = viewerRef.current
    if (!viewer) return
    const observer = new ResizeObserver(() => viewer.resize())
    observer.observe(viewer.container)
    return () => observer.disconnect()
  }, [autoResize, status])

  // Swapping `urn` reuses the live viewer instead of recreating the WebGL context.
  useEffect(() => {
    const viewer = viewerRef.current
    const autodesk = typeof window !== 'undefined' ? window.Autodesk : undefined
    if (viewerEpoch === 0 || status !== 'ready' || !viewer || !autodesk) return
    if (!urn) return

    let cancelled = false
    let loadedModel: APSModel | null = null
    // A URN swap reuses this store, so the previous model's snapshot has to
    // go before the next document starts loading.
    store.resetModel()

    autodesk.Viewing.Document.load(
      toDocumentId(urn),
      (doc) => {
        if (cancelled) return
        const geometry = doc.getRoot().getDefaultGeometry()
        if (!geometry) {
          callbacksRef.current.onError?.(
            new Error('cantera aps-viewer: document has no viewable geometry'),
          )
          return
        }
        viewer
          .loadDocumentNode(doc, geometry)
          .then((model) => {
            // Cancelled while this request was in flight: the cleanup below
            // has already run and never saw this model, so unload it here or
            // it stays in the viewer next to the model that replaced it.
            if (cancelled) {
              unloadModel(viewer, model)
              return
            }
            loadedModel = model
            callbacksRef.current.onModelLoaded?.(model, doc)
          })
          .catch((error: Error) => {
            if (!cancelled) callbacksRef.current.onError?.(error)
          })
      },
      (code, message) => {
        if (cancelled) return
        callbacksRef.current.onError?.(
          new Error(`cantera aps-viewer: Document.load failed (${code}): ${message}`),
        )
      },
    )

    return () => {
      cancelled = true
      unloadModel(viewer, loadedModel)
      store.resetModel()
    }
  }, [status, urn, store, viewerEpoch])

  return (
    <APSViewerContext.Provider value={store}>
      <div
        className={className}
        style={{
          position: 'relative',
          // React drops undefined style values.
          borderRadius: frameRadius,
          overflow: frameRadius === undefined ? undefined : 'hidden',
          ...style,
        }}
        data-aps-viewer=""
        data-aps-viewer-status={status}
        data-aps-viewer-radius={frameRadius}
      >
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {children}
      </div>
    </APSViewerContext.Provider>
  )
}
