'use client'

import { SparklesIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { APSViewer } from '@/components/ui/aps-viewer/aps-viewer'
import { useAPSViewerStore } from '@/components/ui/aps-viewer/context'
import {
  APSViewerSettings,
  type APSViewerSettingsValue,
  apsViewerPropsFor,
  DEFAULT_APS_VIEWER_SETTINGS,
  parseAPSViewerSettings,
} from '@/components/ui/aps-viewer/settings'
import type { ViewerStore } from '@/components/ui/aps-viewer/store'
import { Button } from '@/components/ui/button'
import { FxTerminal, type FxTerminalHandle } from '@/components/ui/fx-terminal/fx-terminal'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { statusInkClasses, statusToneClasses } from '@/components/ui/token-status'
import type { AgentRuntimeStatus } from '@/lib/agent-types'
import { cn } from '@/lib/utils'
import { type ColorLedger, createViewerAgentTools } from '@/lib/viewer-agent-tools'
import { AEC_STARTER_EXTENSIONS } from '@/lib/viewer-extension-types'
import type { GetAccessToken } from '@/lib/viewer-types'

export interface ViewerAgentProps {
  /** Model Derivative URN (base64) of a translated model, with or without the `urn:` prefix. */
  urn: string
  viewerTokenEndpoint?: string
  gatewayBase?: string
  model?: string
  effort?: string
  speed?: string
  embedded?: boolean
  className?: string
}

const STARTER_VIEWER_SETTINGS: APSViewerSettingsValue = {
  ...DEFAULT_APS_VIEWER_SETTINGS,
  extensions: AEC_STARTER_EXTENSIONS.map((entry) => entry.id),
}
const VIEWER_SETTINGS_KEY = 'cantera:viewer-agent:viewer-settings'
const PANEL_WIDTH_KEY = 'cantera:viewer-agent:panel-width'
const COMPACT_QUERY = '(max-width: 767px)'
const DEFAULT_PANEL_WIDTH = 400
const MIN_PANEL_WIDTH = 360
const MAX_PANEL_RATIO = 0.6

// Each stored value falls back to an in-memory copy when the browser refuses
// storage (private windows, blocked site data), so choices last the visit.
function createStoredValue(key: string) {
  const listeners = new Set<() => void>()
  let unsaved: string | null = null
  return {
    read(): string | null {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return unsaved
      }
    },
    write(raw: string | null): void {
      try {
        if (raw === null) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, raw)
      } catch {
        unsaved = raw
      }
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void): () => void {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) listener()
      }
      listeners.add(listener)
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        window.removeEventListener('storage', onStorage)
      }
    },
  }
}

const storedViewerSettings = createStoredValue(VIEWER_SETTINGS_KEY)
const storedPanelWidth = createStoredValue(PANEL_WIDTH_KEY)

function usePersistedViewerSettings(): [
  APSViewerSettingsValue,
  (value: APSViewerSettingsValue) => void,
] {
  const raw = useSyncExternalStore(
    storedViewerSettings.subscribe,
    storedViewerSettings.read,
    () => null,
  )
  const settings = useMemo(() => {
    if (!raw) return STARTER_VIEWER_SETTINGS
    try {
      return parseAPSViewerSettings(JSON.parse(raw), STARTER_VIEWER_SETTINGS)
    } catch {
      return STARTER_VIEWER_SETTINGS
    }
  }, [raw])
  const write = useCallback((value: APSViewerSettingsValue) => {
    const next = JSON.stringify(value)
    storedViewerSettings.write(next === JSON.stringify(STARTER_VIEWER_SETTINGS) ? null : next)
  }, [])
  return [settings, write]
}

function usePersistedPanelWidth(): [number, (width: number) => void] {
  const raw = useSyncExternalStore(storedPanelWidth.subscribe, storedPanelWidth.read, () => null)
  const parsed = Number(raw)
  const width = raw && Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PANEL_WIDTH
  const write = useCallback((next: number) => storedPanelWidth.write(String(Math.round(next))), [])
  return [width, write]
}

function subscribeCompact(onChange: () => void): () => void {
  const list = window.matchMedia(COMPACT_QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function subscribeNothing(): () => void {
  return () => {}
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  )
}

function useCompactLayout(): boolean {
  return useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  )
}

/** Hands the viewer store, which lives inside APSViewer, to the tool catalog outside it. */
function createViewerSource() {
  let store: ViewerStore | null = null
  return {
    getViewer: () => store?.getViewer() ?? null,
    attach(next: ViewerStore): () => void {
      store = next
      return () => {
        if (store === next) store = null
      }
    },
  }
}

type ViewerSource = ReturnType<typeof createViewerSource>

function ViewerStoreBridge({ source }: { source: ViewerSource }) {
  const store = useAPSViewerStore()
  useEffect(() => source.attach(store), [source, store])
  return null
}

function ColorLegend({ colors, className }: { colors: ColorLedger; className?: string }) {
  const legend = useSyncExternalStore(colors.subscribe, colors.legend, colors.legend)
  if (legend.length === 0) return null
  return (
    <section
      aria-label="Agent colours"
      className={cn(
        'absolute z-10 grid min-w-48 max-w-64 gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 text-foreground text-xs shadow-sm',
        className,
      )}
    >
      <p className="text-muted-foreground uppercase tracking-wide">Agent colours</p>
      <ul className="grid gap-1.5">
        {legend.map((entry) => (
          <li
            key={`${entry.hex}-${entry.label}`}
            className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-2"
          >
            <span
              aria-hidden
              className="size-3 rounded-xs border border-border"
              style={{ background: entry.hex }}
            />
            <span className="truncate">{entry.label}</span>
            <span className="font-mono text-muted-foreground tabular-nums">{entry.count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function DockResizeHandle({
  label,
  width,
  onWidthChange,
  target,
}: {
  label: string
  width: number
  onWidthChange: (width: number) => void
  target: RefObject<HTMLElement | null>
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const clamp = (next: number) => {
    const container = target.current?.parentElement?.clientWidth ?? 0
    const max = container > 0 ? container * MAX_PANEL_RATIO : Number.POSITIVE_INFINITY
    onWidthChange(Math.max(MIN_PANEL_WIDTH, Math.min(next, max)))
  }
  const rendered = () => target.current?.getBoundingClientRect().width ?? width
  return (
    <button
      type="button"
      aria-label={label}
      className="group/resize absolute inset-y-0 -start-1.5 z-10 flex w-3 cursor-col-resize touch-none justify-center outline-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { startX: event.clientX, startWidth: rendered() }
      }}
      onPointerMove={(event) => {
        if (drag.current) clamp(drag.current.startWidth + drag.current.startX - event.clientX)
      }}
      onPointerUp={(event) => {
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 16
        if (event.key === 'ArrowLeft') clamp(rendered() + step)
        else if (event.key === 'ArrowRight') clamp(rendered() - step)
        else return
        event.preventDefault()
      }}
    >
      <span
        aria-hidden
        className="h-full w-0.5 bg-transparent group-hover/resize:bg-border group-focus-visible/resize:w-1 group-focus-visible/resize:bg-ring"
      />
    </button>
  )
}

function createTerminalHost(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null
  const host = document.createElement('div')
  host.className = 'flex min-h-0 flex-1 flex-col'
  return host
}

function ViewerAgentSetupNotice({ className }: { className?: string }) {
  return (
    <div
      role="status"
      data-slot="viewer-agent-setup"
      className={cn('flex max-w-md flex-col items-center gap-3 text-center', className)}
    >
      <span
        className={cn('grid size-10 place-items-center rounded-full', statusToneClasses.warning)}
      >
        <TriangleAlertIcon aria-hidden className="size-5" />
      </span>
      <h2 className="font-heading font-medium text-xl">Choose a model for the agent</h2>
      <p className="text-pretty text-muted-foreground text-sm">
        Set APS_MODEL_URN to the base64 URN of a model Autodesk has already translated, along with
        APS_CLIENT_ID, APS_CLIENT_SECRET, and AI_GATEWAY_API_KEY, then reload.
      </p>
    </div>
  )
}

function ViewerAgent({
  urn,
  viewerTokenEndpoint = '/api/viewer-token',
  gatewayBase = '/api/agent/gateway',
  model,
  effort,
  speed,
  embedded = false,
  className,
}: ViewerAgentProps) {
  const compact = useCompactLayout()
  const hydrated = useHydrated()
  const [dockOpen, setDockOpen] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [terminalReady, setTerminalReady] = useState(false)
  const [viewerSettings, setViewerSettings] = usePersistedViewerSettings()
  const [panelWidth, setPanelWidth] = usePersistedPanelWidth()
  const [viewerSource] = useState(createViewerSource)
  const [tools] = useState(() => createViewerAgentTools(viewerSource.getViewer))
  const [terminalHost] = useState(createTerminalHost)
  const [parkingSlot, setParkingSlot] = useState<HTMLDivElement | null>(null)
  const [dockSlot, setDockSlot] = useState<HTMLElement | null>(null)
  const [sheetSlot, setSheetSlot] = useState<HTMLDivElement | null>(null)
  const dockRef = useRef<HTMLElement>(null)
  const terminalRef = useRef<FxTerminalHandle>(null)
  const dockId = useId()
  const attachDock = useCallback((node: HTMLElement | null) => {
    dockRef.current = node
    setDockSlot(node)
  }, [])

  useEffect(() => () => tools.dispose(), [tools])

  const getAccessToken = useCallback<GetAccessToken>(async () => {
    const response = await fetch(viewerTokenEndpoint, { cache: 'no-store' })
    if (!response.ok) throw new Error('The viewer token is unavailable.')
    return (await response.json()) as Awaited<ReturnType<GetAccessToken>>
  }, [viewerTokenEndpoint])

  const open = compact ? sheetOpen : dockOpen
  const setOpen = (next: boolean) => {
    if (compact) setSheetOpen(next)
    else setDockOpen(next)
  }

  const [terminalWanted, setTerminalWanted] = useState(false)
  if (hydrated && open && !terminalWanted) setTerminalWanted(true)

  const slot = (compact ? sheetSlot : dockSlot) ?? parkingSlot

  // The fx session lives in one detached host node that moves between the dock, the sheet, and a
  // hidden parking slot; moving a portal's container instead would remount fx and end the session.
  useLayoutEffect(() => {
    if (!terminalHost || !slot || terminalHost.parentElement === slot) return
    slot.append(terminalHost)
    const frame = requestAnimationFrame(() => terminalRef.current?.fit())
    return () => cancelAnimationFrame(frame)
  }, [terminalHost, slot])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      terminalRef.current?.fit()
      terminalRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  const runtimeStatus: AgentRuntimeStatus = terminalReady ? 'ready' : 'starting'

  const Root = embedded ? 'div' : 'main'

  return (
    <Root
      data-slot="viewer-agent"
      className={cn(
        'flex h-svh min-h-[32rem] w-full min-w-0 flex-col overflow-hidden bg-background text-foreground',
        embedded && 'relative',
        className,
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-border border-b ps-4 pe-2 sm:gap-3">
        <h1 className="min-w-0 flex-1 truncate font-medium font-mono text-sm lowercase">
          canterafx
        </h1>
        <ThemeToggle />
        <Button
          type="button"
          variant={open ? 'default' : 'outline'}
          aria-expanded={open}
          aria-controls={compact ? undefined : dockId}
          className="h-11 min-w-11 gap-2 px-3 max-sm:px-0"
          onClick={() => setOpen(!open)}
        >
          <SparklesIcon aria-hidden />
          <span className="max-sm:sr-only">Agent</span>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section aria-label="Model viewer" className="relative min-h-0 min-w-0 flex-1 bg-muted">
          <APSViewer
            urn={urn}
            getAccessToken={getAccessToken}
            profile="aec"
            {...apsViewerPropsFor(viewerSettings)}
            className="size-full"
            onModelLoaded={() => setViewerError(null)}
            onError={(error) => setViewerError(error.message)}
          >
            <ViewerStoreBridge source={viewerSource} />
            <APSViewerSettings
              value={viewerSettings}
              onValueChange={setViewerSettings}
              resetValue={STARTER_VIEWER_SETTINGS}
            />
            <ColorLegend colors={tools.colors} className="top-3 left-3" />
          </APSViewer>
          {viewerError && (
            <div
              role="alert"
              className="absolute inset-x-3 top-3 z-20 mx-auto flex max-w-md items-start gap-3 rounded-lg border border-border bg-background p-3 shadow-sm"
            >
              <TriangleAlertIcon
                aria-hidden
                className={cn('mt-0.5 size-4 shrink-0', statusInkClasses.danger)}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="font-medium text-sm">The model could not load</p>
                <p className="break-words text-muted-foreground text-xs">{viewerError}</p>
              </div>
            </div>
          )}
        </section>

        <div className="contents" data-agent-runtime-status={runtimeStatus}>
          {!compact && (
            <aside
              ref={attachDock}
              id={dockId}
              aria-label="Agent"
              hidden={!open}
              inert={!open}
              style={{
                width: panelWidth,
                minWidth: MIN_PANEL_WIDTH,
                maxWidth: `${MAX_PANEL_RATIO * 100}%`,
              }}
              className={cn(
                'relative h-full shrink-0 flex-col border-border border-s bg-background',
                open ? 'flex' : 'hidden',
              )}
            >
              <DockResizeHandle
                label="Resize agent panel"
                width={panelWidth}
                onWidthChange={setPanelWidth}
                target={dockRef}
              />
            </aside>
          )}
          {compact && (
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetContent
                side="bottom"
                showCloseButton={false}
                className="gap-0 rounded-t-2xl bg-background p-0 data-[side=bottom]:h-[min(85dvh,44rem)]"
              >
                <div className="flex h-12 shrink-0 items-center justify-between ps-4 pe-1">
                  <SheetTitle className="text-sm">Agent</SheetTitle>
                  <SheetClose
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label="Close agent"
                      />
                    }
                  >
                    <XIcon aria-hidden />
                  </SheetClose>
                </div>
                <div ref={setSheetSlot} className="flex min-h-0 flex-1 flex-col" />
              </SheetContent>
            </Sheet>
          )}
          <div ref={setParkingSlot} hidden inert />
        </div>
        {terminalHost &&
          terminalWanted &&
          createPortal(
            <FxTerminal
              ref={terminalRef}
              tools={tools}
              gatewayBase={gatewayBase}
              model={model}
              effort={effort}
              speed={speed}
              onReady={() => setTerminalReady(true)}
              className="min-h-0 flex-1"
            />,
            terminalHost,
          )}
      </div>
    </Root>
  )
}

export { ViewerAgent, ViewerAgentSetupNotice }
