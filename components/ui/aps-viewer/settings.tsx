'use client'

import { SlidersHorizontalIcon, XIcon } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import type { APSViewerProps } from '@/components/ui/aps-viewer/aps-viewer'
import {
  APSViewerExtensionChip,
  APSViewerExtensionLoader,
  APSViewerExtensionPicker,
  type APSViewerExtensionStatus,
  extensionLabel,
} from '@/components/ui/aps-viewer/extensions'
import { useAPSViewer } from '@/components/ui/aps-viewer/hooks'
import {
  type APSViewerToolbarButton,
  type APSViewerToolbarPosition,
  type APSViewerToolbarScale,
  createAPSViewerToolbarButton,
  hasAPSViewerToolbarControl,
  mountAPSViewerToolbarControl,
  setAPSViewerToolbarButtonLabel,
  setAPSViewerToolbarButtonPressed,
  unmountAPSViewerToolbarControl,
} from '@/components/ui/aps-viewer/toolbar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { VIEWER_EXTENSIONS } from '@/lib/viewer-extension-types'

export type APSViewerSettingsTheme = 'system' | 'light' | 'dark'
export type APSViewerSettingsScale = APSViewerToolbarScale

export interface APSViewerSettingsValue {
  toolbar: boolean
  toolbarPosition: APSViewerToolbarPosition
  toolbarScale: APSViewerSettingsScale
  viewCube: boolean
  /** The Hide others toggle in the native toolbar. */
  hideOthers: boolean
  theme: APSViewerSettingsTheme
  /** Frame radius in pixels, 0–32. */
  radius: number
  /** Extension ids the panel loads into the viewer, in load order. */
  extensions: string[]
}

export const DEFAULT_APS_VIEWER_SETTINGS: APSViewerSettingsValue = {
  toolbar: true,
  toolbarPosition: 'bottom',
  toolbarScale: 'md',
  viewCube: true,
  hideOthers: true,
  theme: 'system',
  radius: 0,
  extensions: [],
}

/** Spread onto APSViewer: `<APSViewer {...apsViewerPropsFor(value)} />`. */
export function apsViewerPropsFor(
  value: APSViewerSettingsValue,
): Pick<
  APSViewerProps,
  'toolbar' | 'toolbarPosition' | 'toolbarScale' | 'viewCube' | 'hideOthers' | 'theme' | 'radius'
> {
  return {
    toolbar: value.toolbar ? 'native' : 'none',
    toolbarPosition: value.toolbarPosition,
    toolbarScale: value.toolbarScale,
    viewCube: value.viewCube,
    hideOthers: value.hideOthers,
    theme: value.theme === 'system' ? undefined : value.theme,
    radius: value.radius,
  }
}

const POSITIONS: readonly APSViewerToolbarPosition[] = ['bottom', 'top', 'left', 'right']
const SCALE_PRESETS: readonly APSViewerSettingsScale[] = ['sm', 'md', 'lg']
const THEMES: readonly APSViewerSettingsTheme[] = ['system', 'light', 'dark']

/** Settings as they arrive from outside: every field still unchecked. */
interface UncheckedViewerSettings {
  toolbar?: unknown
  toolbarPosition?: unknown
  toolbarScale?: unknown
  viewCube?: unknown
  hideOthers?: unknown
  theme?: unknown
  radius?: unknown
  extensions?: unknown
}

function isUncheckedSettings(input: unknown): input is UncheckedViewerSettings {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function oneOf<T>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

/** Reads settings that came from outside the app (storage, a URL, an API):
 * each invalid or missing field takes `fallback`'s value, and extension ids
 * outside the catalog are dropped, so an old or edited copy never breaks the
 * viewer. */
export function parseAPSViewerSettings(
  input: unknown,
  fallback: APSViewerSettingsValue = DEFAULT_APS_VIEWER_SETTINGS,
): APSViewerSettingsValue {
  if (!isUncheckedSettings(input)) return fallback
  const { toolbar, viewCube, hideOthers, toolbarScale: scale, radius, extensions } = input
  return {
    toolbar: typeof toolbar === 'boolean' ? toolbar : fallback.toolbar,
    toolbarPosition: oneOf(POSITIONS, input.toolbarPosition, fallback.toolbarPosition),
    toolbarScale:
      typeof scale === 'number' && Number.isFinite(scale)
        ? Math.min(64, Math.max(32, scale))
        : oneOf(SCALE_PRESETS, scale, fallback.toolbarScale),
    viewCube: typeof viewCube === 'boolean' ? viewCube : fallback.viewCube,
    hideOthers: typeof hideOthers === 'boolean' ? hideOthers : fallback.hideOthers,
    theme: oneOf(THEMES, input.theme, fallback.theme),
    radius:
      typeof radius === 'number' && Number.isFinite(radius)
        ? Math.min(32, Math.max(0, Math.round(radius)))
        : fallback.radius,
    extensions: Array.isArray(extensions)
      ? [
          ...new Set(
            extensions.filter(
              (id): id is string => typeof id === 'string' && Object.hasOwn(VIEWER_EXTENSIONS, id),
            ),
          ),
        ]
      : fallback.extensions,
  }
}

const BUTTON_ID = 'cantera-viewer-settings-button'
const BUTTON_ORDER = 1

const SETTINGS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1em;height:1em;display:block" aria-hidden="true"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>`

export interface APSViewerSettingsTriggerProps {
  open: boolean
  onToggle: () => void
  label?: string
}

/** Appends a settings button to the SDK's own toolbar, the way an APS
 * extension would: our control group after a divider, inheriting the
 * toolbar's position and scale. Renders nothing itself. */
export function APSViewerSettingsTrigger({
  open,
  onToggle,
  label = 'Viewer settings',
}: APSViewerSettingsTriggerProps) {
  const { viewer } = useAPSViewer()
  const buttonRef = useRef<APSViewerToolbarButton | null>(null)
  const openRef = useRef(open)
  const toggleRef = useRef(onToggle)
  const labelRef = useRef(label)
  // Synced after commit, not during render: a render React discards must
  // never leave its callbacks behind.
  useEffect(() => {
    openRef.current = open
    toggleRef.current = onToggle
    labelRef.current = label
  })

  useEffect(() => {
    if (!viewer) return
    const viewing = window.Autodesk?.Viewing
    if (!viewing) return

    const mount = () => {
      if (!viewer.toolbar || hasAPSViewerToolbarControl(viewer, BUTTON_ID)) return
      const button = createAPSViewerToolbarButton(
        viewing,
        BUTTON_ID,
        labelRef.current,
        SETTINGS_ICON_SVG,
        () => toggleRef.current(),
      )
      setAPSViewerToolbarButtonPressed(viewing, button, openRef.current)
      if (mountAPSViewerToolbarControl(viewing, viewer, button, BUTTON_ORDER)) {
        buttonRef.current = button
      }
    }

    mount()
    // A viewable switch rebuilds the toolbar's controls without a new
    // TOOLBAR_CREATED_EVENT, so check again when the next model arrives.
    viewer.addEventListener(viewing.TOOLBAR_CREATED_EVENT, mount)
    viewer.addEventListener(viewing.MODEL_ADDED_EVENT, mount)
    return () => {
      viewer.removeEventListener(viewing.TOOLBAR_CREATED_EVENT, mount)
      viewer.removeEventListener(viewing.MODEL_ADDED_EVENT, mount)
      buttonRef.current = null
      try {
        unmountAPSViewerToolbarControl(viewer, BUTTON_ID)
      } catch {
        // the viewer may already be finished
      }
    }
  }, [viewer])

  useEffect(() => {
    const viewing = window.Autodesk?.Viewing
    const button = buttonRef.current
    if (!viewing || !button) return
    setAPSViewerToolbarButtonPressed(viewing, button, open)
  }, [open])

  useEffect(() => {
    const button = buttonRef.current
    if (button) setAPSViewerToolbarButtonLabel(button, label)
  }, [label])

  return null
}

const POSITION_OPTIONS: { value: APSViewerToolbarPosition; label: string }[] = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'top', label: 'Top' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

const SCALE_PRESET_PX = { sm: 36, md: 44, lg: 52 } as const
const MIN_SCALE_PX = 32
const MAX_SCALE_PX = 64

function scaleToPx(scale: APSViewerSettingsScale): number {
  if (typeof scale === 'number') {
    if (!Number.isFinite(scale)) return SCALE_PRESET_PX.md
    return Math.min(MAX_SCALE_PX, Math.max(MIN_SCALE_PX, scale))
  }
  return SCALE_PRESET_PX[scale]
}

const THEME_OPTIONS: { value: APSViewerSettingsTheme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  columns,
  disabled = false,
  describedBy,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  columns: 3 | 4
  disabled?: boolean
  describedBy?: string
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="min-w-0" aria-describedby={disabled ? describedBy : undefined}>
      <legend className="mb-1.5 font-medium text-[13px] text-foreground">{label}</legend>
      <div
        className={cn('grid rounded-lg bg-muted/60', columns === 3 ? 'grid-cols-3' : 'grid-cols-4')}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              className={cn(
                'relative isolate h-11 justify-center rounded-lg bg-transparent px-1 text-[13px] text-muted-foreground transition-colors duration-150 before:absolute before:inset-1 before:-z-10 before:rounded-md before:transition-[background-color,box-shadow] before:duration-150 hover:bg-transparent hover:text-foreground hover:before:bg-background/60 focus-visible:border-ring aria-disabled:opacity-50',
                selected &&
                  'text-foreground before:bg-background before:shadow-xs hover:before:bg-background dark:before:bg-input/70',
              )}
              aria-pressed={selected}
              disabled={disabled}
              focusableWhenDisabled
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          )
        })}
      </div>
    </fieldset>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const fieldId = useId()
  const labelId = `${fieldId}-label`
  return (
    <label
      className="group/field-label flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md px-1 text-sm"
      htmlFor={fieldId}
    >
      <span id={labelId}>{label}</span>
      <Checkbox
        id={fieldId}
        // The primitive renders a button, so the wrapping label alone does
        // not name it — point at the text explicitly.
        aria-labelledby={labelId}
        checked={checked}
        onCheckedChange={onChange}
      />
    </label>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  disabled = false,
  describedBy,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  describedBy?: string
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-medium text-[13px] text-foreground">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-muted-foreground text-xs tabular-nums">
          {value}px
        </output>
      </div>
      <div className="min-w-0 px-1">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step="1"
          value={value}
          aria-disabled={disabled}
          aria-describedby={disabled ? describedBy : undefined}
          onChange={(event) => {
            if (!disabled) onChange(Number(event.currentTarget.value))
          }}
          onKeyDown={(event) => {
            if (disabled) event.preventDefault()
          }}
          onPointerDown={(event) => {
            if (disabled) event.preventDefault()
          }}
          className="h-11 w-full min-w-0 max-w-full cursor-pointer accent-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        />
      </div>
    </div>
  )
}

const TABS = [
  { id: 'setup', label: 'Setup' },
  { id: 'extensions', label: 'Extensions' },
] as const

type TabId = (typeof TABS)[number]['id']

function sameSettings(a: APSViewerSettingsValue, b: APSViewerSettingsValue): boolean {
  return (
    a.toolbar === b.toolbar &&
    a.toolbarPosition === b.toolbarPosition &&
    a.toolbarScale === b.toolbarScale &&
    a.viewCube === b.viewCube &&
    a.hideOthers === b.hideOthers &&
    a.theme === b.theme &&
    a.radius === b.radius &&
    a.extensions.length === b.extensions.length &&
    a.extensions.every((id, index) => id === b.extensions[index])
  )
}

export interface APSViewerSettingsProps {
  value: APSViewerSettingsValue
  onValueChange: (value: APSViewerSettingsValue) => void
  /** What Reset restores. */
  resetValue?: APSViewerSettingsValue
  /** Omit for uncontrolled open state (collapsed by default). */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  label?: string
  className?: string
  /** Extra controls appended to the Setup tab. */
  children?: ReactNode
}

/** Render inside APSViewer. The trigger lives in the SDK toolbar (a corner
 * button stands in when the native toolbar is off); the panel floats over
 * the canvas and starts collapsed. It also loads `value.extensions`, so keep
 * it mounted even when the panel is closed. */
export function APSViewerSettings({
  value,
  onValueChange,
  resetValue = DEFAULT_APS_VIEWER_SETTINGS,
  open,
  defaultOpen = false,
  onOpenChange,
  label = 'Viewer settings',
  className,
  children,
}: APSViewerSettingsProps) {
  const headingId = useId()
  const tabsId = useId()
  const toolbarOffId = useId()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const [tab, setTab] = useState<TabId>('setup')
  const [status, setStatus] = useState<Partial<Record<string, APSViewerExtensionStatus>>>({})
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})
  const isOpen = open ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const handleStatus = useCallback((id: string, next: APSViewerExtensionStatus) => {
    setStatus((previous) => (previous[id] === next ? previous : { ...previous, [id]: next }))
  }, [])

  const toggleExtension = (id: string, next: boolean) => {
    const extensions = next
      ? value.extensions.includes(id)
        ? value.extensions
        : [...value.extensions, id]
      : value.extensions.filter((loaded) => loaded !== id)
    onValueChange({ ...value, extensions })
  }

  const retryExtension = (id: string) => {
    onValueChange({ ...value, extensions: value.extensions.filter((loaded) => loaded !== id) })
    window.requestAnimationFrame(() => onValueChange({ ...value }))
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1
    let next = index
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else return
    event.preventDefault()
    const nextTab = TABS[next]
    setTab(nextTab.id)
    tabRefs.current[nextTab.id]?.focus()
  }

  const loadedCount = value.extensions.length
  const failedId = value.extensions.find((id) => status[id] === 'error')

  return (
    <>
      {value.extensions.map((id) => (
        <APSViewerExtensionLoader key={id} id={id} onStatus={handleStatus} />
      ))}
      {value.toolbar && (
        <APSViewerSettingsTrigger open={isOpen} onToggle={() => setOpen(!isOpen)} label={label} />
      )}
      {!isOpen && !value.toolbar && (
        <Button
          aria-label={label}
          variant="ghost"
          onClick={() => setOpen(true)}
          className="absolute top-4 left-4 z-10 size-11 rounded-xl bg-popover/90 shadow-md ring-1 ring-foreground/10 backdrop-blur"
        >
          <SlidersHorizontalIcon className="size-5" />
        </Button>
      )}
      {isOpen && (
        <section
          aria-labelledby={headingId}
          className={cn(
            'absolute top-4 left-4 z-10 flex max-h-[calc(100%-2rem)] w-80 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-lg bg-popover/95 text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur',
            // A forced appearance re-scopes the palette, so the panel matches the canvas.
            value.theme !== 'system' && value.theme,
            className,
          )}
        >
          <div className="flex items-center gap-1.5 border-border/60 border-b px-2.5 py-1.5">
            <h3
              id={headingId}
              className="font-medium font-mono text-[11px] uppercase tracking-[0.12em]"
            >
              {label}
            </h3>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Collapse ${label.toLowerCase()}`}
              className="relative ml-auto after:absolute after:-inset-2.5"
              onClick={() => setOpen(false)}
            >
              <XIcon />
            </Button>
          </div>
          <div
            role="tablist"
            aria-labelledby={headingId}
            className="grid grid-cols-2 border-border border-b px-2 pt-2"
          >
            {TABS.map((entry, index) => {
              const selected = entry.id === tab
              return (
                <button
                  key={entry.id}
                  ref={(node) => {
                    tabRefs.current[entry.id] = node
                  }}
                  type="button"
                  role="tab"
                  id={`${tabsId}-${entry.id}-tab`}
                  aria-selected={selected}
                  aria-controls={`${tabsId}-${entry.id}-panel`}
                  tabIndex={selected ? 0 : -1}
                  className={cn(
                    'min-h-11 rounded-t-md px-2 pb-1 font-medium text-[13px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1',
                    selected
                      ? 'bg-background text-foreground shadow-[inset_0_-2px_0_0_var(--color-foreground)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setTab(entry.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  {entry.label}{' '}
                  {entry.id === 'extensions' && loadedCount > 0 && (
                    <span className="ms-1 text-muted-foreground tabular-nums">{loadedCount}</span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-3">
            {tab === 'setup' ? (
              <div
                role="tabpanel"
                id={`${tabsId}-setup-panel`}
                aria-labelledby={`${tabsId}-setup-tab`}
                className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden"
              >
                <fieldset className="min-w-0">
                  <legend className="mb-1.5 font-medium text-[13px] text-foreground">Chrome</legend>
                  <ToggleRow
                    label="Native toolbar"
                    checked={value.toolbar}
                    onChange={(toolbar) => onValueChange({ ...value, toolbar })}
                  />
                  <ToggleRow
                    label="View cube"
                    checked={value.viewCube}
                    onChange={(viewCube) => onValueChange({ ...value, viewCube })}
                  />
                  <ToggleRow
                    label="Hide others button"
                    checked={value.hideOthers}
                    onChange={(hideOthers) => onValueChange({ ...value, hideOthers })}
                  />
                  {!value.toolbar && (
                    <p id={toolbarOffId} className="text-muted-foreground text-xs leading-snug">
                      Position, density, and the Hide others button apply to the native toolbar.
                    </p>
                  )}
                </fieldset>
                <SegmentedControl
                  label="Position"
                  value={value.toolbarPosition}
                  options={POSITION_OPTIONS}
                  columns={4}
                  disabled={!value.toolbar}
                  describedBy={toolbarOffId}
                  onChange={(toolbarPosition) => onValueChange({ ...value, toolbarPosition })}
                />
                <SliderRow
                  label="Toolbar density"
                  value={scaleToPx(value.toolbarScale)}
                  min={MIN_SCALE_PX}
                  max={MAX_SCALE_PX}
                  disabled={!value.toolbar}
                  describedBy={toolbarOffId}
                  onChange={(toolbarScale) => onValueChange({ ...value, toolbarScale })}
                />
                <SliderRow
                  label="Viewer radius"
                  value={value.radius}
                  min={0}
                  max={32}
                  onChange={(radius) => onValueChange({ ...value, radius })}
                />
                <SegmentedControl
                  label="Appearance"
                  value={value.theme}
                  options={THEME_OPTIONS}
                  columns={3}
                  onChange={(theme) => onValueChange({ ...value, theme })}
                />
                {children}
              </div>
            ) : (
              <div
                role="tabpanel"
                id={`${tabsId}-extensions-panel`}
                aria-labelledby={`${tabsId}-extensions-tab`}
                className="flex min-h-0 flex-1 flex-col gap-3"
              >
                {loadedCount > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {value.extensions.map((id) => (
                      <APSViewerExtensionChip
                        key={id}
                        id={id}
                        status={status[id] ?? 'idle'}
                        onRemove={(removed) => toggleExtension(removed, false)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-pretty text-[13px] text-muted-foreground leading-relaxed">
                    Add extensions live, with no viewer restart.
                  </p>
                )}
                <APSViewerExtensionPicker
                  loaded={value.extensions}
                  status={status}
                  onToggle={toggleExtension}
                />
              </div>
            )}
          </div>
          <div className="flex min-h-11 items-center justify-between gap-2 border-border border-t px-3 py-2">
            <output
              className={cn(
                'min-w-0 text-xs tabular-nums',
                failedId ? 'text-status-warning' : 'text-muted-foreground',
              )}
            >
              {failedId
                ? `${extensionLabel(failedId)} failed to load`
                : loadedCount === 0
                  ? 'No extensions loaded'
                  : `${loadedCount} extension${loadedCount === 1 ? '' : 's'} loaded`}
            </output>
            <div className="flex shrink-0 items-center gap-1">
              {failedId && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => retryExtension(failedId)}
                >
                  Retry
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={sameSettings(value, resetValue)}
                onClick={() => onValueChange(resetValue)}
              >
                Reset
              </Button>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
