'use client'

import { TriangleAlertIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { APSViewer } from '@/components/ui/aps-viewer/aps-viewer'
import { statusInkClasses } from '@/components/ui/token-status'
import { parseExtensionConfig } from '@/lib/extensions/format'
import { createExtensionRuntime, type ExtensionHostViewer } from '@/lib/extensions/runtime'
import type { GallerySource } from '@/lib/gallery/types'
import { cn } from '@/lib/utils'
import { AEC_STARTER_EXTENSIONS } from '@/lib/viewer-extension-types'
import type { APSModel, APSViewer3D, GetAccessToken } from '@/lib/viewer-types'

const STARTER_EXTENSIONS = AEC_STARTER_EXTENSIONS.map((entry) => entry.id)

const BUILDING_CATEGORIES = ['Revit Walls', 'Revit Floors', 'Revit Roofs']

const READY_CEILING_MS = 120_000

type LoadState = { kind: 'pending' } | { kind: 'failed'; title: string; message: string }

function searchCategory(model: APSModel, category: string): Promise<number[]> {
  return new Promise((resolve) =>
    model.search(category, resolve, () => resolve([]), ['Category'], { searchHidden: true }),
  )
}

async function fitToBuilding(viewer: APSViewer3D, model: APSModel): Promise<void> {
  const found = await Promise.all(BUILDING_CATEGORIES.map((name) => searchCategory(model, name)))
  const dbIds = found.flat()
  if (dbIds.length > 0) viewer.fitToView(dbIds, model, true)
}

// Loads happen where `ext load` runs them in the builder: once the object tree and the toolbar
// exist, so load() can query the model and onToolbarCreated() runs.
function whenReady(viewer: APSViewer3D, model: APSModel, signal: AbortSignal): Promise<void> {
  const viewing = window.Autodesk?.Viewing
  const host: ExtensionHostViewer = viewer
  return new Promise((resolve, reject) => {
    if (!viewing) {
      reject(new Error('the viewer runtime is unavailable'))
      return
    }
    const events = [viewing.OBJECT_TREE_CREATED_EVENT, viewing.TOOLBAR_CREATED_EVENT]
    const stop = () => {
      clearTimeout(timer)
      for (const type of events) viewer.removeEventListener(type, check)
      signal.removeEventListener('abort', stop)
    }
    function check() {
      if (!model.isObjectTreeCreated() || !host.toolbar) return
      stop()
      resolve()
    }
    const timer = setTimeout(() => {
      stop()
      reject(new Error(`the model was not ready after ${READY_CEILING_MS / 1000} s`))
    }, READY_CEILING_MS)
    for (const type of events) viewer.addEventListener(type, check)
    signal.addEventListener('abort', stop)
    check()
  })
}

async function fetchSource(id: string): Promise<GallerySource> {
  const response = await fetch(`/api/gallery/${encodeURIComponent(id)}/source`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`the files could not be fetched (${response.status})`)
  return (await response.json()) as GallerySource
}

export function ItemViewer({
  galleryId,
  extensionId,
  urn,
}: {
  galleryId: string
  extensionId: string
  urn: string
}) {
  const [{ attach, getViewer, runtime }] = useState(() => {
    let viewer: APSViewer3D | null = null
    const getViewer = () => viewer
    return {
      attach: (next: APSViewer3D) => {
        viewer = next
      },
      getViewer,
      runtime: createExtensionRuntime((): ExtensionHostViewer | null => getViewer()),
    }
  })
  const [state, setState] = useState<LoadState>({ kind: 'pending' })
  // cacheComponents keeps this route mounted but hidden after navigating away, and revealing it
  // builds a new viewer, so the extension is loaded once per viewer rather than once per mount.
  const session = useRef<{ viewer: APSViewer3D; controller: AbortController } | null>(null)

  useEffect(
    () => () => {
      session.current?.controller.abort()
      session.current = null
      runtime.dispose()
    },
    [runtime],
  )

  const getAccessToken = useCallback<GetAccessToken>(async () => {
    const response = await fetch('/api/viewer-token', { cache: 'no-store' })
    if (!response.ok) throw new Error('The viewer token is unavailable.')
    return (await response.json()) as Awaited<ReturnType<GetAccessToken>>
  }, [])

  const fail = (title: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    setState((previous) =>
      previous.kind === 'failed' ? previous : { kind: 'failed', title, message },
    )
  }

  const loadInto = async (viewer: APSViewer3D, model: APSModel, signal: AbortSignal) => {
    try {
      const [source] = await Promise.all([fetchSource(galleryId), whenReady(viewer, model, signal)])
      if (signal.aborted) return
      const parsed = parseExtensionConfig(source.configText, source.extensionId)
      if (!parsed.config) throw new Error(parsed.problems[0]?.message ?? 'config.json is invalid')
      const report = await runtime.load({
        id: source.extensionId,
        config: parsed.config,
        configText: source.configText,
        mainJs: source.mainJs,
        mainCss: source.mainCss,
      })
      if (signal.aborted) return
      const first = report.errors[0]
      if (!report.returned || first) {
        const where = first?.line ? ` (main.js:${first.line}:${first.column ?? 1})` : ''
        fail(
          report.returned
            ? `${extensionId} reported an error while loading`
            : `${extensionId} did not load`,
          `${first?.message ?? 'load() returned false'}${where}`,
        )
      }
    } catch (error) {
      if (!signal.aborted) fail(`${extensionId} did not load`, error)
    }
    if (!signal.aborted) await fitToBuilding(viewer, model)
  }

  const onModelLoaded = (model: APSModel) => {
    const viewer = getViewer()
    if (!viewer || session.current?.viewer === viewer) return
    session.current?.controller.abort()
    const controller = new AbortController()
    session.current = { viewer, controller }
    setState({ kind: 'pending' })
    void loadInto(viewer, model, controller.signal)
  }

  return (
    <>
      <APSViewer
        urn={urn}
        getAccessToken={getAccessToken}
        profile="aec"
        extensions={STARTER_EXTENSIONS}
        className="size-full"
        onViewerReady={attach}
        onModelLoaded={onModelLoaded}
        onError={(error) => fail('The model could not load', error)}
      />
      {state.kind === 'failed' && (
        <div
          role="alert"
          className="absolute inset-x-3 top-3 z-20 mx-auto flex max-w-md items-start gap-3 rounded-lg border border-border bg-background p-3 shadow-sm"
        >
          <TriangleAlertIcon
            aria-hidden
            className={cn('mt-0.5 size-4 shrink-0', statusInkClasses.danger)}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-medium text-sm">{state.title}</p>
            <p className="break-words text-muted-foreground text-xs">{state.message}</p>
          </div>
        </div>
      )}
    </>
  )
}
