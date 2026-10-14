import type { AutodeskGlobal, GetAccessToken } from '@/lib/viewer-types'

const VIEWER_HOST = 'https://developer.api.autodesk.com/modelderivative/v2/viewers'

export interface ViewerRuntimeOptions {
  getAccessToken: GetAccessToken
  /** SDK version, e.g. '7.*' (default) pins to latest v7 */
  version?: string
  /** Initializer environment (default 'AutodeskProduction2' — SVF2) */
  env?: string
  /** Initializer API (default 'streamingV2' — SVF2) */
  api?: string
  language?: string
}

let scriptPromise: Promise<AutodeskGlobal> | null = null
let runtimePromise: Promise<AutodeskGlobal> | null = null
let activeConsumers = 0
const tokenErrorListeners = new Set<(error: Error) => void>()

/**
 * Subscribes to token-supplier failures. The SDK's `getAccessToken` callback
 * has no rejection path, so failures are broadcast here instead of leaving
 * the SDK waiting forever. Returns an unsubscribe function.
 */
export function onViewerTokenError(listener: (error: Error) => void): () => void {
  tokenErrorListeners.add(listener)
  return () => {
    tokenErrorListeners.delete(listener)
  }
}

function reportTokenError(cause: unknown): void {
  const error = new Error('cantera aps-viewer: getAccessToken failed', { cause })
  if (tokenErrorListeners.size === 0) {
    console.error(error, cause)
    return
  }
  for (const listener of tokenErrorListeners) listener(error)
}

function assertBrowser(): void {
  if (typeof window === 'undefined') {
    throw new Error(
      'cantera aps-viewer: the APS Viewer runtime can only load in the browser. ' +
        'Render <APSViewer> inside a client component; it is SSR-safe as long as ' +
        'you do not call loader functions during server rendering.',
    )
  }
}

/**
 * Injects the viewer script and stylesheet exactly once; concurrent callers
 * share one promise. Resolves when `window.Autodesk.Viewing` exists.
 */
export function loadViewerScript(version = '7.*'): Promise<AutodeskGlobal> {
  assertBrowser()
  if (window.Autodesk?.Viewing) return Promise.resolve(window.Autodesk)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<AutodeskGlobal>((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${VIEWER_HOST}/${version}/style.min.css`
    css.setAttribute('data-aps-viewer', 'style')
    document.head.appendChild(css)

    const script = document.createElement('script')
    script.src = `${VIEWER_HOST}/${version}/viewer3D.min.js`
    script.async = true
    script.setAttribute('data-aps-viewer', 'script')
    script.onload = () => {
      if (window.Autodesk?.Viewing) {
        resolve(window.Autodesk)
      } else {
        scriptPromise = null
        script.remove()
        css.remove()
        reject(
          new Error('cantera aps-viewer: viewer3D.min.js loaded but window.Autodesk is missing'),
        )
      }
    }
    script.onerror = () => {
      scriptPromise = null
      script.remove()
      css.remove()
      reject(
        new Error('cantera aps-viewer: failed to load the APS Viewer script from the Autodesk CDN'),
      )
    }
    document.head.appendChild(script)
  })

  return scriptPromise
}

/**
 * Loads the script (if needed) and runs the SDK's global Initializer exactly
 * once — the first caller's options win. Pair with `releaseViewerRuntime()`
 * on unmount; the runtime stays warm unless released with `shutdown: true`.
 */
export function acquireViewerRuntime(options: ViewerRuntimeOptions): Promise<AutodeskGlobal> {
  assertBrowser()
  activeConsumers += 1
  if (runtimePromise) return runtimePromise

  const {
    getAccessToken,
    version = '7.*',
    env = 'AutodeskProduction2',
    api = 'streamingV2',
    language,
  } = options

  runtimePromise = loadViewerScript(version).then(
    (autodesk) =>
      new Promise<AutodeskGlobal>((resolve) => {
        autodesk.Viewing.Initializer(
          {
            env,
            api,
            language,
            getAccessToken: (onTokenReady?: (token: string, expiresInSeconds: number) => void) => {
              getAccessToken()
                .then(({ accessToken, expiresInSeconds }) =>
                  onTokenReady?.(accessToken, expiresInSeconds),
                )
                .catch(reportTokenError)
            },
          },
          () => resolve(autodesk),
        )
      }),
  )
  runtimePromise.catch(() => {
    runtimePromise = null
  })
  return runtimePromise
}

export function releaseViewerRuntime({ shutdown = false }: { shutdown?: boolean } = {}): void {
  activeConsumers = Math.max(0, activeConsumers - 1)
  if (
    shutdown &&
    activeConsumers === 0 &&
    typeof window !== 'undefined' &&
    window.Autodesk?.Viewing
  ) {
    window.Autodesk.Viewing.shutdown()
    runtimePromise = null
  }
}

/** Normalizes a Model Derivative URN into the `urn:` documentId form. */
export function toDocumentId(urn: string): string {
  const trimmed = urn.trim()
  return trimmed.startsWith('urn:') ? trimmed : `urn:${trimmed}`
}
