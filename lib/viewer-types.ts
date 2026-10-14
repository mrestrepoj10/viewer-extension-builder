export type Vec3 = { x: number; y: number; z: number }

export interface APSCameraState {
  position: Vec3
  target: Vec3
  up: Vec3
  isPerspective: boolean
}

export interface APSProperty {
  displayName: string
  displayValue: string | number | boolean
  displayCategory: string
  units: string | null
  hidden: boolean
  type: number
}

export interface APSPropertyResult {
  dbId: number
  name: string
  externalId: string
  properties: APSProperty[]
}

export interface APSContextMenuItem {
  title: string
  target: (() => void) | APSContextMenuItem[]
  icon?: string
  divider?: boolean
}

export interface APSContextMenuStatus {
  /** dbIds under the cursor when the menu opened (empty over empty space) */
  numSelected: number
  hasSelected: boolean
  canvasX: number
  canvasY: number
  [key: string]: unknown
}

// `Viewer3D` is the base class, so a `GuiViewer3D` is an `APSViewer3D` too.
export type APSViewer3D = Autodesk.Viewing.Viewer3D
export type APSModel = Autodesk.Viewing.Model
export type APSDocument = Autodesk.Viewing.Document
export type APSDocumentNode = Autodesk.Viewing.BubbleNode
export type APSViewerExtension = Autodesk.Viewing.Extension
export type APSViewerExtensionConstructor = new (
  viewer: Autodesk.Viewing.GuiViewer3D,
  options?: Record<string, unknown>,
) => Autodesk.Viewing.Extension
export type APSViewingNamespace = typeof Autodesk.Viewing
export type AutodeskGlobal = typeof Autodesk

/** Fetch the token from YOUR backend — never embed APS credentials in the
 * browser. The runtime re-calls the supplier before expiry. */
export type GetAccessToken = () => Promise<{
  accessToken: string
  /** seconds until expiry */
  expiresInSeconds: number
}>

export type APSViewerStatus = 'idle' | 'loading-runtime' | 'ready' | 'error'

/** Deliberately accepts any string, so consumer-registered extensions need
 * nothing extra; the `viewer-extension-types` item types the public ids. */
export type APSExtensionRequest = string | { id: string; options?: Record<string, unknown> }

export type APSExtensionStatus = 'loading' | 'ready' | 'error'

export type APSViewerProfile = 'aec' | 'default' | 'fluent' | 'navis'

/** `aps-viewer` registers Hide others as a viewer extension under this id, so code that
 * holds only the viewer drives the same mode as the toolbar toggle. */
export const APS_HIDE_OTHERS_EXTENSION_ID = 'Cantera.HideOthers'

/** Dispatched on the viewer with `{ state: APSHideOthersState }` after every change. */
export const APS_HIDE_OTHERS_CHANGED_EVENT = 'cantera.hideOthersChanged'

export interface APSHideOthersState {
  active: boolean
  /** The dbIds left visible. Empty while active means the mode waits for a selection. */
  ids: readonly number[]
}

export interface APSHideOthersController {
  getHideOthersState(): APSHideOthersState
  /** `true` hides everything except `ids`, else the selection, else the current isolation;
   * `false` shows everything and restores ghosting. */
  setHideOthers(active: boolean, ids?: readonly number[]): void
  toggleHideOthers(): void
}

export function isAPSHideOthersController(value: unknown): value is APSHideOthersController {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getHideOthersState' in value &&
    typeof value.getHideOthersState === 'function' &&
    'setHideOthers' in value &&
    typeof value.setHideOthers === 'function' &&
    'toggleHideOthers' in value &&
    typeof value.toggleHideOthers === 'function'
  )
}
