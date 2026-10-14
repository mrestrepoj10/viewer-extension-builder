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
