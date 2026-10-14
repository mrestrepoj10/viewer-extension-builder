'use client'

import { CheckIcon, LoaderCircleIcon, PlusIcon, XIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { type APSExtensionResult, useAPSExtension } from '@/components/ui/aps-viewer/hooks'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { VIEWER_EXTENSIONS, type ViewerExtensionInfo } from '@/lib/viewer-extension-types'

export type APSViewerExtensionStatus = APSExtensionResult['status']

type CatalogEntry = [string, ViewerExtensionInfo]

const catalogEntries = Object.entries(VIEWER_EXTENSIONS) as CatalogEntry[]
const loadableEntries = catalogEntries.filter(
  ([id, info]) =>
    !info.deprecated &&
    !info.removedIn &&
    info.only !== '2d' &&
    !info.autoLoaded &&
    id !== 'Autodesk.ViewCubeUi',
)

const EXTENSION_SECTIONS = [
  {
    title: 'Navigation and orientation',
    ids: [
      'Autodesk.BimWalk',
      'Autodesk.Beeline',
      'Autodesk.Viewing.ZoomWindow',
      'Autodesk.Viewing.FusionOrbit',
    ],
  },
  {
    title: 'Model understanding',
    ids: [
      'Autodesk.Measure',
      'Autodesk.Section',
      'Autodesk.Explode',
      'Autodesk.ModelStructure',
      'Autodesk.PropertiesManager',
      'Autodesk.PropertySearch',
      'Autodesk.LayerManager',
      'Autodesk.BoxSelection',
      'Autodesk.VisualClusters',
      'Autodesk.Filter',
    ],
  },
  {
    title: 'Sheets and documents',
    ids: [
      'Autodesk.DocumentBrowser',
      'Autodesk.ModelSheetTransition',
      'Autodesk.Hyperlink',
      'Autodesk.Multipage',
      'Autodesk.StringExtractor',
      'Autodesk.Crop',
    ],
  },
  {
    title: 'AEC',
    ids: [
      'Autodesk.AEC.LevelsExtension',
      'Autodesk.AEC.Minimap3DExtension',
      'Autodesk.AEC.Hypermodeling',
      'Autodesk.Grids',
      'Autodesk.GridsUI',
    ],
  },
  {
    title: 'Markup and authoring',
    ids: [
      'Autodesk.Viewing.MarkupsCore',
      'Autodesk.Viewing.MarkupsGui',
      'Autodesk.Edit2D',
      'Autodesk.Snapping',
    ],
  },
  {
    title: 'Data and comparison',
    ids: [
      'Autodesk.DataVisualization',
      'Autodesk.Viewing.PixelCompare',
      'Autodesk.SplitScreen',
      'Autodesk.ModelsPanel',
      'Autodesk.BIM360.Minimap',
      'Autodesk.BIM360.Extension.PushPin',
      'Autodesk.Geolocation',
      'Autodesk.NPR',
      'Autodesk.Viewing.SceneBuilder',
    ],
  },
] as const

interface ExtensionLabelById {
  [extensionId: string]: string
}

const EXTENSION_LABELS: ExtensionLabelById = {
  'Autodesk.Viewing.MarkupsGui': 'Markups toolbar',
  'Autodesk.Viewing.MarkupsCore': 'Markups core',
  'Autodesk.BimWalk': 'BIM walk',
  'Autodesk.NPR': 'Sketch styles',
  'Autodesk.ViewCubeUi': 'ViewCube',
  'Autodesk.AEC.LevelsExtension': 'Levels',
  'Autodesk.AEC.Minimap3DExtension': 'Minimap',
  'Autodesk.AEC.Hypermodeling': 'Hypermodeling',
  'Autodesk.Viewing.FusionOrbit': 'Fusion orbit',
  'Autodesk.Viewing.ZoomWindow': 'Zoom window',
  'Autodesk.Viewing.PixelCompare': 'Pixel compare',
  'Autodesk.Viewing.SceneBuilder': 'Scene builder',
  'Autodesk.BIM360.Extension.PushPin': 'Push pins',
  'Autodesk.GridsUI': 'Grids UI',
  'Autodesk.DataVisualization': 'Data visualization',
}

export function extensionLabel(id: string): string {
  const override = EXTENSION_LABELS[id]
  if (override) return override
  const segment = id.split('.').pop() ?? id
  return segment.replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
}

function groupEntries(entries: CatalogEntry[]) {
  const byId = new Map(entries)
  const grouped = EXTENSION_SECTIONS.map((section) => ({
    title: section.title,
    entries: section.ids.flatMap((id): CatalogEntry[] => {
      const info = byId.get(id)
      return info ? [[id, info]] : []
    }),
  })).filter((section) => section.entries.length > 0)
  const placed = new Set(grouped.flatMap((section) => section.entries.map(([id]) => id)))
  const rest = entries.filter(([id]) => !placed.has(id))
  return rest.length > 0 ? [...grouped, { title: 'Other', entries: rest }] : grouped
}

const loadableSections = groupEntries(loadableEntries)

function extensionBadges(info: ViewerExtensionInfo): string[] {
  const badges: string[] = []
  if (info.addsToolbarButton) badges.push('toolbar button')
  if (info.requiresAecModelData) badges.push('needs AEC data')
  if (info.minViewerVersion) badges.push(`viewer ${info.minViewerVersion}+`)
  return badges
}

function Spinner({ className }: { className?: string }) {
  return <LoaderCircleIcon aria-hidden="true" className={cn('animate-spin', className)} />
}

/** Loads one extension for as long as it is mounted inside APSViewer. */
export function APSViewerExtensionLoader({
  id,
  onStatus,
}: {
  id: string
  onStatus: (id: string, status: APSViewerExtensionStatus) => void
}) {
  const { status } = useAPSExtension(id)
  useEffect(() => {
    onStatus(id, status)
    return () => onStatus(id, 'idle')
  }, [id, status, onStatus])
  return null
}

export function APSViewerExtensionChip({
  id,
  status,
  onRemove,
}: {
  id: string
  status: APSViewerExtensionStatus
  onRemove: (id: string) => void
}) {
  const label = extensionLabel(id)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2 text-xs',
        status === 'error'
          ? 'border-status-warning/40 bg-status-warning-surface text-status-warning'
          : 'border-border bg-muted/60 text-foreground',
      )}
    >
      {status === 'loading' && <Spinner className="size-3" />}
      {label}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="rounded-full"
        aria-label={`Unload ${label}`}
        onClick={() => onRemove(id)}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </span>
  )
}

export interface APSViewerExtensionPickerProps {
  loaded: readonly string[]
  status: Partial<Record<string, APSViewerExtensionStatus>>
  onToggle: (id: string, next: boolean) => void
}

/** Searchable catalog of the extensions that can load on demand, grouped by job. */
export function APSViewerExtensionPicker({
  loaded,
  status,
  onToggle,
}: APSViewerExtensionPickerProps) {
  const [query, setQuery] = useState('')
  const fieldId = useId()
  const needle = query.trim().toLowerCase()

  const sections = useMemo(
    () =>
      loadableSections
        .map((section) => ({
          title: section.title,
          entries: section.entries.filter(
            ([id, info]) =>
              needle.length === 0 ||
              id.toLowerCase().includes(needle) ||
              extensionLabel(id).toLowerCase().includes(needle) ||
              info.description.toLowerCase().includes(needle),
          ),
        }))
        .filter((section) => section.entries.length > 0),
    [needle],
  )

  const matchCount = sections.reduce((total, section) => total + section.entries.length, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label className="font-medium text-[13px] text-foreground" htmlFor={fieldId}>
            Find an extension
          </label>
          <span className="text-muted-foreground text-xs tabular-nums">
            {matchCount} {matchCount === 1 ? 'result' : 'results'}
          </span>
        </div>
        <input
          id={fieldId}
          type="search"
          value={query}
          placeholder="measure, markup, Autodesk.NPR"
          className="h-11 w-full rounded-md border border-border bg-background px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {matchCount === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-xs">
            No extension matches “{query.trim()}”.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {sections.map((section) => (
              <section key={section.title} className="flex flex-col gap-1.5">
                <h4 className="font-semibold text-foreground text-sm">{section.title}</h4>
                <div className="flex flex-col gap-1">
                  {section.entries.map(([id, info]) => {
                    const isLoaded = loaded.includes(id)
                    const pending = isLoaded && status[id] === 'loading'
                    const badges = extensionBadges(info)
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={isLoaded}
                        aria-disabled={pending || undefined}
                        className={cn(
                          'group flex min-h-11 items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-start text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1',
                          isLoaded && 'bg-muted/70',
                          pending && 'opacity-60',
                        )}
                        onClick={() => {
                          if (pending) return
                          onToggle(id, !isLoaded)
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block font-medium text-sm leading-snug">
                            {extensionLabel(id)}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-pretty text-[13px] text-muted-foreground leading-relaxed">
                            {info.description}
                          </span>
                          {badges.length > 0 && (
                            <span aria-hidden="true" className="mt-1.5 flex flex-wrap gap-1">
                              {badges.map((badge) => (
                                <span
                                  key={badge}
                                  className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs"
                                >
                                  {badge}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground group-hover:text-foreground">
                          {pending ? (
                            <Spinner className="size-3.5" />
                          ) : isLoaded ? (
                            <CheckIcon aria-hidden="true" className="size-3.5" />
                          ) : (
                            <PlusIcon aria-hidden="true" className="size-3.5" />
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
