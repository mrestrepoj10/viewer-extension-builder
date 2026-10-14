import {
  type APSViewerToolbarButton,
  createAPSViewerToolbarButton,
  hasAPSViewerToolbarControl,
  mountAPSViewerToolbarControl,
  setAPSViewerToolbarButtonLabel,
  setAPSViewerToolbarButtonPressed,
  unmountAPSViewerToolbarControl,
} from '@/components/ui/aps-viewer/toolbar'
import {
  APS_HIDE_OTHERS_CHANGED_EVENT,
  APS_HIDE_OTHERS_EXTENSION_ID,
  type APSHideOthersController,
  type APSHideOthersState,
  type APSViewerExtension,
  type AutodeskGlobal,
} from '@/lib/viewer-types'

export interface APSViewerHideOthersOptions {
  /** Show the toolbar toggle. The mode itself works without it. */
  button?: boolean
  label?: string
}

export interface APSViewerHideOthersExtension extends APSViewerExtension, APSHideOthersController {
  setOptions(options: APSViewerHideOthersOptions): void
}

export const APS_HIDE_OTHERS_BUTTON_ID = 'aps-viewer-hide-others'
const DEFAULT_LABEL = 'Hide others'
const BUTTON_ORDER = 0
const GHOSTING_PREFERENCE = 'ghosting'

const EYE_OFF_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1em;height:1em;display:block" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`

const EMPTY_IDS: readonly number[] = Object.freeze([])
export const APS_HIDE_OTHERS_INACTIVE: APSHideOthersState = Object.freeze({
  active: false,
  ids: EMPTY_IDS,
})

interface IsolationEvent {
  isolation?: { ids?: number[] }[]
}

interface PreferenceEvent {
  name?: string
  value?: unknown
}

const registeredManagers = new WeakSet<object>()

export function registerAPSViewerHideOthers(autodesk: AutodeskGlobal): void {
  const viewing = autodesk.Viewing
  const manager = viewing.theExtensionManager
  if (registeredManagers.has(manager)) return
  if (manager.getExtensionClass?.(APS_HIDE_OTHERS_EXTENSION_ID)) {
    registeredManagers.add(manager)
    return
  }

  class CanteraAPSViewerHideOthers
    extends viewing.Extension
    implements APSViewerHideOthersExtension
  {
    private state = APS_HIDE_OTHERS_INACTIVE
    private savedGhosting: boolean | null = null
    private applying = false
    private showButton = true
    private label = DEFAULT_LABEL
    private button: APSViewerToolbarButton | null = null
    private readonly listeners: [string, (event: IsolationEvent & PreferenceEvent) => void][] = []

    private readonly onPageHide = () => {
      if (this.state.active) this.writeGhosting(this.savedGhosting)
    }

    private readonly onPageShow = () => {
      if (this.state.active) this.writeGhosting(false)
    }

    constructor(viewer: Autodesk.Viewing.GuiViewer3D, options?: Record<string, unknown>) {
      super(viewer, options)
      this.readOptions(options ?? {})
    }

    load(): boolean {
      this.listen(viewing.SELECTION_CHANGED_EVENT, () => this.onSelection())
      this.listen(viewing.AGGREGATE_ISOLATION_CHANGED_EVENT, (event) => this.onIsolation(event))
      this.listen(viewing.PREF_CHANGED_EVENT, (event) => this.onPreference(event))
      // A viewable switch rebuilds the toolbar's controls without a new toolbar event.
      this.listen(viewing.MODEL_ADDED_EVENT, () => this.mountButton())
      window.addEventListener('pagehide', this.onPageHide)
      window.addEventListener('pageshow', this.onPageShow)
      this.mountButton()
      return true
    }

    onToolbarCreated(): void {
      this.mountButton()
    }

    unload(): boolean {
      for (const [type, handler] of this.listeners) this.viewer.removeEventListener(type, handler)
      this.listeners.length = 0
      window.removeEventListener('pagehide', this.onPageHide)
      window.removeEventListener('pageshow', this.onPageShow)
      this.unmountButton()
      if (this.state.active) this.end()
      return true
    }

    setOptions(options: APSViewerHideOthersOptions): void {
      this.readOptions(options)
      if (!this.showButton) {
        this.unmountButton()
        return
      }
      if (this.button) setAPSViewerToolbarButtonLabel(this.button, this.label)
      this.mountButton()
    }

    getHideOthersState(): APSHideOthersState {
      return this.state
    }

    toggleHideOthers(): void {
      this.setHideOthers(!this.state.active)
    }

    setHideOthers(active: boolean, ids?: readonly number[]): void {
      if (!active) {
        if (!this.state.active) return
        this.applying = true
        try {
          this.viewer.showAll()
        } finally {
          this.applying = false
        }
        this.end()
        return
      }
      const targets =
        ids && ids.length > 0
          ? [...new Set(ids)]
          : this.state.active
            ? [...this.state.ids]
            : this.currentTargets()
      if (!this.state.active) this.savedGhosting = this.readGhosting()
      this.applying = true
      try {
        this.writeGhosting(false)
        if (targets.length > 0) this.viewer.isolate(targets)
      } finally {
        this.applying = false
      }
      this.update({ active: true, ids: Object.freeze(targets) })
    }

    private readOptions(options: APSViewerHideOthersOptions): void {
      if (typeof options.button === 'boolean') this.showButton = options.button
      if (typeof options.label === 'string' && options.label) this.label = options.label
    }

    private listen(type: string, handler: (event: IsolationEvent & PreferenceEvent) => void) {
      this.viewer.addEventListener(type, handler)
      this.listeners.push([type, handler])
    }

    private is3d(): boolean {
      return Boolean(this.viewer.model) && !this.viewer.model.is2d()
    }

    private currentTargets(): number[] {
      const selection = this.viewer.getSelection()
      if (selection.length > 0) return selection
      return this.is3d() ? this.viewer.getIsolatedNodes() : []
    }

    private readGhosting(): boolean {
      return this.viewer.prefs.get(GHOSTING_PREFERENCE) !== false
    }

    private writeGhosting(value: boolean | null): void {
      if (value === null || !this.is3d()) return
      const applying = this.applying
      this.applying = true
      try {
        this.viewer.setGhosting(value)
      } finally {
        this.applying = applying
      }
    }

    private end(): void {
      this.writeGhosting(this.savedGhosting)
      this.savedGhosting = null
      this.update(APS_HIDE_OTHERS_INACTIVE)
    }

    private onSelection(): void {
      if (!this.state.active || this.applying) return
      const selection = this.viewer.getSelection()
      if (selection.length > 0) this.setHideOthers(true, selection)
    }

    // Isolation changed by anything else (the context menu, restoreState, Show all) keeps
    // ghosting off; clearing it ends the mode.
    private onIsolation(event: IsolationEvent): void {
      if (!this.state.active || this.applying) return
      const ids = [...new Set((event.isolation ?? []).flatMap((entry) => entry.ids ?? []))]
      if (ids.length === 0) {
        this.end()
        return
      }
      this.update({ active: true, ids: Object.freeze(ids) })
    }

    // While active the mode owns the ghosting preference: a change from elsewhere becomes the
    // value to restore, and ghosting stays off.
    private onPreference(event: PreferenceEvent): void {
      if (!this.state.active || this.applying || event.name !== GHOSTING_PREFERENCE) return
      this.savedGhosting = event.value === true
      if (event.value === true) this.writeGhosting(false)
    }

    private update(next: APSHideOthersState): void {
      this.state = next
      if (this.button) setAPSViewerToolbarButtonPressed(viewing, this.button, next.active)
      this.viewer.dispatchEvent({ type: APS_HIDE_OTHERS_CHANGED_EVENT, state: next })
    }

    private mountButton(): void {
      if (!this.showButton || !this.viewer.toolbar) return
      if (hasAPSViewerToolbarControl(this.viewer, APS_HIDE_OTHERS_BUTTON_ID)) return
      const button = createAPSViewerToolbarButton(
        viewing,
        APS_HIDE_OTHERS_BUTTON_ID,
        this.label,
        EYE_OFF_ICON_SVG,
        () => this.toggleHideOthers(),
      )
      setAPSViewerToolbarButtonPressed(viewing, button, this.state.active)
      if (mountAPSViewerToolbarControl(viewing, this.viewer, button, BUTTON_ORDER)) {
        this.button = button
      }
    }

    private unmountButton(): void {
      this.button = null
      try {
        unmountAPSViewerToolbarControl(this.viewer, APS_HIDE_OTHERS_BUTTON_ID)
      } catch {
        // the viewer may already be finished
      }
    }
  }

  manager.registerExtension(APS_HIDE_OTHERS_EXTENSION_ID, CanteraAPSViewerHideOthers)
  registeredManagers.add(manager)
}
