'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { APSViewer } from '@/components/ui/aps-viewer/aps-viewer'
import { statusInkClasses } from '@/components/ui/token-status'
import { parseExtensionConfig } from '@/lib/extensions/format'
import { createExtensionRuntime, type ExtensionHostViewer } from '@/lib/extensions/runtime'
import type { GallerySource } from '@/lib/gallery/types'
import { cn } from '@/lib/utils'
import { AEC_STARTER_EXTENSIONS } from '@/lib/viewer-extension-types'
import type { APSViewer3D, GetAccessToken } from '@/lib/viewer-types'

const STARTER_EXTENSIONS = AEC_STARTER_EXTENSIONS.map((entry) => entry.id)

type LoadState =
  | { kind: 'waiting' }
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'failed'; message: string }

async function fetchSource(id: string): Promise<GallerySource> {
  const response = await fetch(`/api/gallery/${encodeURIComponent(id)}/source`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`the files could not be fetched (${response.status})`)
  return (await response.json()) as GallerySource
}

function describe(state: LoadState, extensionId: string): string {
  switch (state.kind) {
    case 'waiting':
      return 'Loading the model.'
    case 'loading':
      return `Loading ${extensionId}.`
    case 'loaded':
      return `${extensionId} is loaded in the viewer above, as published.`
    case 'failed':
      return `${extensionId} did not load: ${state.message}`
  }
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
  const [{ attach, runtime }] = useState(() => {
    let viewer: ExtensionHostViewer | null = null
    return {
      attach: (next: ExtensionHostViewer) => {
        viewer = next
      },
      runtime: createExtensionRuntime(() => viewer),
    }
  })
  const [state, setState] = useState<LoadState>({ kind: 'waiting' })
  const started = useRef(false)

  useEffect(() => () => runtime.dispose(), [runtime])

  const getAccessToken = useCallback<GetAccessToken>(async () => {
    const response = await fetch('/api/viewer-token', { cache: 'no-store' })
    if (!response.ok) throw new Error('The viewer token is unavailable.')
    return (await response.json()) as Awaited<ReturnType<GetAccessToken>>
  }, [])

  const loadExtension = async () => {
    if (started.current) return
    started.current = true
    setState({ kind: 'loading' })
    try {
      const source = await fetchSource(galleryId)
      const parsed = parseExtensionConfig(source.configText, source.extensionId)
      if (!parsed.config) throw new Error(parsed.problems[0]?.message ?? 'config.json is invalid')
      const report = await runtime.load({
        id: source.extensionId,
        config: parsed.config,
        configText: source.configText,
        mainJs: source.mainJs,
        mainCss: source.mainCss,
      })
      if (!report.returned) {
        const first = report.errors[0]
        const where = first?.line ? ` (main.js:${first.line}:${first.column ?? 1})` : ''
        throw new Error(`${first?.message ?? 'load() returned false'}${where}`)
      }
      setState({ kind: 'loaded' })
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="grid gap-3">
      <div className="h-[min(78svh,52rem)] min-h-[26rem] border-border border-y bg-muted">
        <APSViewer
          urn={urn}
          getAccessToken={getAccessToken}
          profile="aec"
          extensions={STARTER_EXTENSIONS}
          className="size-full"
          onViewerReady={(viewer: APSViewer3D) => attach(viewer)}
          onModelLoaded={() => void loadExtension()}
          onError={(error) => setState({ kind: 'failed', message: error.message })}
        />
      </div>
      <p
        role="status"
        className={cn(
          'mx-auto w-full max-w-6xl px-4 text-muted-foreground text-sm sm:px-6',
          state.kind === 'failed' && statusInkClasses.danger,
        )}
      >
        {describe(state, extensionId)}
      </p>
    </div>
  )
}
