import type { APSViewer3D, APSViewerExtension, AutodeskGlobal } from '@/lib/viewer-types'

export const APS_VIEWER_TOOLBAR_EXTENSION_ID = 'Cantera.APSViewerToolbar'

export type APSViewerToolbarPosition = 'bottom' | 'top' | 'left' | 'right'
export type APSViewerToolbarScale = 'sm' | 'md' | 'lg' | number

export interface APSViewerToolbarOptions {
  position?: APSViewerToolbarPosition
  /** Rendered button box: `md` is 44px, `sm` 36, `lg` 52. A number is an
   * exact pixel box, clamped to 32–64. */
  scale?: APSViewerToolbarScale
}

export interface APSViewerToolbarExtension extends APSViewerExtension {
  setOptions(options: APSViewerToolbarOptions): void
}

const POSITION_CLASSES = [
  'cantera-toolbar--bottom',
  'cantera-toolbar--top',
  'cantera-toolbar--left',
  'cantera-toolbar--right',
] as const
const SCALE_CLASSES = [
  'cantera-toolbar--sm',
  'cantera-toolbar--md',
  'cantera-toolbar--lg',
  'cantera-toolbar--sized',
] as const
const STYLE_ATTRIBUTE = 'data-cantera-aps-viewer-toolbar'
/** Rendered button box per preset. */
const SCALE_PRESET_PX = { sm: 36, md: 44, lg: 52 } as const
const SCALE_SIZE_PROPERTY = '--cantera-toolbar-size'
const SCALE_ICON_PROPERTY = '--cantera-toolbar-icon-size'
const MIN_SCALE_PX = 32
const MAX_SCALE_PX = 64

// Autodesk publishes no stable DOM contract for the native toolbar, so these
// selectors are isolated behind our classes and target the known v7 shapes.
const APS_VIEWER_TOOLBAR_CSS = `
.adsk-toolbar.cantera-toolbar--top,
.adsk-toolbar.cantera-toolbar--bottom,
.adsk-toolbar.cantera-toolbar--left,
.adsk-toolbar.cantera-toolbar--right {
  position: absolute !important;
  z-index: 5;
  overflow: visible;
}

.adsk-toolbar.cantera-toolbar--top,
.adsk-toolbar.cantera-toolbar--bottom,
.adsk-toolbar.cantera-toolbar--left,
.adsk-toolbar.cantera-toolbar--right {
  gap: 0;
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 16%))
    drop-shadow(0 8px 18px rgb(0 0 0 / 14%));
}

.adsk-toolbar.cantera-toolbar--top > .adsk-control-group,
.adsk-toolbar.cantera-toolbar--bottom > .adsk-control-group,
.adsk-toolbar.cantera-toolbar--left > .adsk-control-group,
.adsk-toolbar.cantera-toolbar--right > .adsk-control-group {
  /* Inline-block groups otherwise leave a baseline gap under the toolbar. */
  vertical-align: top;
  margin: 0 !important;
  border-radius: 0;
  box-shadow: none;
}

.adsk-toolbar.cantera-toolbar--top > .adsk-control-group:first-child,
.adsk-toolbar.cantera-toolbar--bottom > .adsk-control-group:first-child {
  border-radius: 10px 0 0 10px;
}

.adsk-toolbar.cantera-toolbar--top > .adsk-control-group:last-child,
.adsk-toolbar.cantera-toolbar--bottom > .adsk-control-group:last-child {
  border-radius: 0 10px 10px 0;
}

.adsk-toolbar.cantera-toolbar--left > .adsk-control-group:first-child,
.adsk-toolbar.cantera-toolbar--right > .adsk-control-group:first-child {
  border-radius: 10px 10px 0 0;
}

.adsk-toolbar.cantera-toolbar--left > .adsk-control-group:last-child,
.adsk-toolbar.cantera-toolbar--right > .adsk-control-group:last-child {
  border-radius: 0 0 10px 10px;
}

.adsk-toolbar.cantera-toolbar--top .adsk-button,
.adsk-toolbar.cantera-toolbar--bottom .adsk-button,
.adsk-toolbar.cantera-toolbar--left .adsk-button,
.adsk-toolbar.cantera-toolbar--right .adsk-button {
  border-radius: 6px;
}

.adsk-toolbar.cantera-toolbar--bottom {
  inset: auto 12px 12px 12px !important;
}

.adsk-toolbar.cantera-toolbar--top {
  inset: 12px 12px auto 12px !important;
}

.adsk-toolbar.cantera-toolbar--left,
.adsk-toolbar.cantera-toolbar--right {
  top: 50% !important;
  bottom: auto !important;
  width: auto !important;
  max-height: calc(100% - 24px);
  transform: translateY(-50%);
  flex-direction: column;
  overflow: visible;
}

.adsk-toolbar.cantera-toolbar--left {
  right: auto !important;
  left: 12px !important;
}

.adsk-toolbar.cantera-toolbar--right {
  right: 12px !important;
  left: auto !important;
}

/* :not(.adsk-hidden): forcing display on every group would also un-hide
 * LMV's dormant sub-toolbars (measure's Done/delete group), overflowing the
 * vertical layout with phantom buttons. */
.adsk-toolbar.cantera-toolbar--left .adsk-control-group:not(.adsk-hidden),
.adsk-toolbar.cantera-toolbar--right .adsk-control-group:not(.adsk-hidden) {
  display: flex;
  flex-direction: column;
  width: auto;
  height: auto;
  overflow: visible;
}

.adsk-toolbar.cantera-toolbar--sized .adsk-button {
  width: calc(var(--cantera-toolbar-size, 42px) - 14px);
  height: calc(var(--cantera-toolbar-size, 42px) - 14px);
}

/* LMV stretches the icon box to the whole button and sets its glyph at the
 * top, and the document browser draws a background at 80% of that box: both
 * drift as the button grows. Center one icon-sized mark instead. */
.adsk-toolbar.cantera-toolbar--sized .adsk-button .adsk-button-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  line-height: 1;
  font-size: var(--cantera-toolbar-icon-size, 20px);
  /* LMV marks some icon backgrounds !important (document browser: 80% auto). */
  background-position: center !important;
  background-size: var(--cantera-toolbar-icon-size, 20px) auto !important;
}

.adsk-toolbar.cantera-toolbar--sized .adsk-button-arrow > .adsk-button-icon {
  font-size: max(14px, calc(var(--cantera-toolbar-icon-size, 20px) - 6px));
}

.adsk-toolbar.cantera-toolbar--sized .adsk-control-group {
  min-height: calc(var(--cantera-toolbar-size, 42px) + 8px);
}

.adsk-toolbar.cantera-toolbar--left .adsk-control-tooltip,
.adsk-toolbar.cantera-toolbar--left .toolbar-vertical-group,
.adsk-toolbar.cantera-toolbar--left .toolbar-settings-sub-menu,
.adsk-toolbar.cantera-toolbar--left .toolbar-submenu,
.adsk-toolbar.cantera-toolbar--left .explode-submenu {
  top: 50% !important;
  right: auto !important;
  bottom: auto !important;
  left: calc(100% + 10px) !important;
  transform: translateY(-50%) !important;
}

.adsk-toolbar.cantera-toolbar--right .adsk-control-tooltip,
.adsk-toolbar.cantera-toolbar--right .toolbar-vertical-group,
.adsk-toolbar.cantera-toolbar--right .toolbar-settings-sub-menu,
.adsk-toolbar.cantera-toolbar--right .toolbar-submenu,
.adsk-toolbar.cantera-toolbar--right .explode-submenu {
  top: 50% !important;
  right: calc(100% + 10px) !important;
  bottom: auto !important;
  left: auto !important;
  transform: translateY(-50%) !important;
}
`

let stylesheetConsumers = 0
const registeredManagers = new WeakSet<object>()

function retainStylesheet(): void {
  stylesheetConsumers += 1
  if (document.head.querySelector(`style[${STYLE_ATTRIBUTE}]`)) return
  const style = document.createElement('style')
  style.setAttribute(STYLE_ATTRIBUTE, '')
  style.textContent = APS_VIEWER_TOOLBAR_CSS
  document.head.appendChild(style)
}

function releaseStylesheet(): void {
  stylesheetConsumers = Math.max(0, stylesheetConsumers - 1)
  if (stylesheetConsumers === 0) {
    document.head.querySelector(`style[${STYLE_ATTRIBUTE}]`)?.remove()
  }
}

// Clamped, never rounded: CSS renders fractional pixels.
function normalizeScale(scale: APSViewerToolbarScale | undefined): APSViewerToolbarScale {
  if (typeof scale !== 'number') return scale ?? 'md'
  if (!Number.isFinite(scale)) return 'md'
  return Math.min(MAX_SCALE_PX, Math.max(MIN_SCALE_PX, scale))
}

function normalizeOptions(
  options: APSViewerToolbarOptions = {},
): Required<APSViewerToolbarOptions> {
  return {
    position: options.position ?? 'bottom',
    scale: normalizeScale(options.scale),
  }
}

function removeToolbarClasses(viewer: APSViewer3D): void {
  const toolbar = viewer.toolbar?.container
  if (!toolbar) return
  toolbar.classList.remove(...POSITION_CLASSES, ...SCALE_CLASSES)
  toolbar.style.removeProperty(SCALE_SIZE_PROPERTY)
  toolbar.style.removeProperty(SCALE_ICON_PROPERTY)
}

export function registerAPSViewerToolbar(autodesk: AutodeskGlobal): void {
  const viewing = autodesk.Viewing
  const manager = viewing.theExtensionManager
  if (registeredManagers.has(manager)) return
  if (manager.getExtensionClass?.(APS_VIEWER_TOOLBAR_EXTENSION_ID)) {
    registeredManagers.add(manager)
    return
  }

  class CanteraAPSViewerToolbar extends viewing.Extension implements APSViewerToolbarExtension {
    private current = normalizeOptions()
    private hasStylesheet = false

    constructor(viewer: Autodesk.Viewing.GuiViewer3D, options?: Record<string, unknown>) {
      super(viewer, options)
      this.current = normalizeOptions(options as APSViewerToolbarOptions | undefined)
    }

    load(): boolean {
      retainStylesheet()
      this.hasStylesheet = true
      if (this.viewer.toolbar) this.onToolbarCreated()
      return true
    }

    onToolbarCreated(): void {
      this.apply()
    }

    setOptions(options: APSViewerToolbarOptions): void {
      this.current = normalizeOptions(options)
      this.apply()
    }

    unload(): boolean {
      removeToolbarClasses(this.viewer)
      if (this.hasStylesheet) {
        releaseStylesheet()
        this.hasStylesheet = false
      }
      return true
    }

    private apply(): void {
      const toolbar = this.viewer.toolbar?.container
      if (!toolbar) return
      toolbar.classList.remove(...POSITION_CLASSES, ...SCALE_CLASSES)
      toolbar.style.removeProperty(SCALE_SIZE_PROPERTY)
      toolbar.style.removeProperty(SCALE_ICON_PROPERTY)
      toolbar.classList.add(`cantera-toolbar--${this.current.position}`)
      const scale = this.current.scale
      if (typeof scale !== 'number') toolbar.classList.add(`cantera-toolbar--${scale}`)
      toolbar.classList.add('cantera-toolbar--sized')
      const px = typeof scale === 'number' ? scale : SCALE_PRESET_PX[scale]
      toolbar.style.setProperty(SCALE_SIZE_PROPERTY, `${px}px`)
      toolbar.style.setProperty(SCALE_ICON_PROPERTY, `${Math.min(24, Math.max(18, px - 24))}px`)
    }
  }

  manager.registerExtension(APS_VIEWER_TOOLBAR_EXTENSION_ID, CanteraAPSViewerToolbar)
  registeredManagers.add(manager)
}
