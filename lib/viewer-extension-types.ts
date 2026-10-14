export interface ViewerExtensionInfo {
  /** One line on what loading it adds. */
  description: string
  /** GuiViewer3D loads it automatically for these model kinds. */
  autoLoaded?: '2d' | '3d' | 'both'
  /** Adds its own button or group to the native toolbar. */
  addsToolbarButton?: boolean
  /** Only functions against this model kind. */
  only?: '2d' | '3d'
  /** Needs AEC model data (Revit-derived metadata) to do anything. */
  requiresAecModelData?: boolean
  /** Still ships but warns; do not use in new code. */
  deprecated?: boolean
  /** Gone from the CDN bundle since this viewer version. */
  removedIn?: string
  /** First viewer version that ships it. */
  minViewerVersion?: string
}

export interface ViewerSnapperOptions {
  forceSnapEdges?: boolean
  forceSnapVertices?: boolean
  markupMode?: boolean
  renderSnappedGeometry?: boolean
  renderSnappedTopology?: boolean
  toolName?: string
  [key: string]: unknown
}

export interface MeasureExtensionOptions {
  calibrationUnits?: string
  calibrationFactor?: number
  calibrateWithPage?: boolean
  forceCalibrate?: boolean
  /** Forwarded to the snapper the measure tools share. */
  snapperOptions?: ViewerSnapperOptions
  modelId?: number
  [key: string]: unknown
}

export interface BimWalkExtensionOptions {
  disableBimWalkFlyTo?: boolean
  disableBimWalkInfoIcon?: boolean
  joystickOptions?: Record<string, unknown>
  [key: string]: unknown
}

export interface ViewCubeUiExtensionOptions {
  showTriad?: boolean
  verticalOffset?: number
  fontSizeRatio?: number
  paddingRatio?: number
  resolution?: number
  condensedScale?: number
  [key: string]: unknown
}

export interface BoxSelectionExtensionOptions {
  selectionType?: string
  /** Intersection strategy of the drag tool. */
  type?: 'idbuffer' | 'geometric'
  immediate?: boolean
  [key: string]: unknown
}

export interface DocumentBrowserExtensionOptions {
  openDocumentBrowserOnLoad?: boolean
  showDocumentBrowserNavToolbar?: boolean
  showThumbnails?: boolean
  [key: string]: unknown
}

export interface LevelsExtensionOptions {
  /** Default true. */
  autoDetectAecModelData?: boolean
  /** Default false — turn on for IFC-derived levels. */
  ifcLevelsEnabled?: boolean
  ignoreModelsWithoutLevels?: boolean
  aecModelData?: unknown
  [key: string]: unknown
}

export interface Minimap3DExtensionOptions {
  /** Keep the minimap pinned open instead of toolbar-toggled. */
  enableAlwaysOn?: boolean
  toolbarGroup?: string
  toolbarHeight?: number
  [key: string]: unknown
}

export interface MarkupsCoreExtensionOptions {
  markupDisableHotkeys?: boolean
  markupToolClass?: unknown
  [key: string]: unknown
}

export interface Edit2DExtensionOptions {
  /** Default true; propagates to the registered default tools. */
  enableArcs?: boolean
  enableEllipseArcs?: boolean
  [key: string]: unknown
}

export interface VisualClustersExtensionOptions {
  attribName?: string
  clusterSpacing?: number
  spacing?: number
  stackClusters?: boolean
  searchAncestors?: boolean
  skipDefaultButton?: boolean
  [key: string]: unknown
}

export interface ModelSheetTransitionExtensionOptions {
  hideModel?: boolean
  showModel?: boolean
  loadModel?: boolean
  loadDocument?: boolean
  ui?: boolean
  useOnlyAecModelDataViewports?: boolean
  [key: string]: unknown
}

export interface PixelCompareExtensionOptions {
  diffMode?: string
  mainModelDiffColor?: unknown
  secondaryModelDiffColor?: unknown
  defaultComparePanelVisibility?: boolean
  restoreModelVisibilityOnExit?: boolean
  [key: string]: unknown
}

export interface SplitScreenExtensionOptions {
  modelFilterLeft?: unknown
  modelFilterRight?: unknown
  viewports?: unknown
  [key: string]: unknown
}

export interface CropExtensionOptions {
  createButton?: boolean
  cropStyle?: string
  disableMoveTool?: boolean
  [key: string]: unknown
}

export interface GridsExtensionOptions {
  snapToGrid?: boolean
  visible?: boolean
  [key: string]: unknown
}

export interface FilterExtensionOptions {
  query?: unknown
  ids?: number[]
  elementsProperties?: unknown
  valuesProperties?: unknown
  groupedProperty?: string
  strict?: boolean
  useFilterTable?: boolean
  [key: string]: unknown
}

export interface ModelsPanelExtensionOptions {
  enableCheckmark?: boolean
  enableVisibilityToggle?: boolean
  enableWarningSymbol?: boolean
  [key: string]: unknown
}

export interface Bim360MinimapExtensionOptions {
  initialSize?: number
  [key: string]: unknown
}

export interface MultipageExtensionOptions {
  hideModel?: boolean
  placementTransform?: unknown
  loadDocumentNode?: boolean
  [key: string]: unknown
}

/** Ids absent here take a plain record: they read no options at load time, or
 * they are consumer-registered. */
export interface ViewerExtensionOptionsMap {
  'Autodesk.Measure': MeasureExtensionOptions
  'Autodesk.BimWalk': BimWalkExtensionOptions
  'Autodesk.ViewCubeUi': ViewCubeUiExtensionOptions
  'Autodesk.BoxSelection': BoxSelectionExtensionOptions
  'Autodesk.DocumentBrowser': DocumentBrowserExtensionOptions
  'Autodesk.AEC.LevelsExtension': LevelsExtensionOptions
  'Autodesk.AEC.Minimap3DExtension': Minimap3DExtensionOptions
  'Autodesk.Viewing.MarkupsCore': MarkupsCoreExtensionOptions
  'Autodesk.Edit2D': Edit2DExtensionOptions
  'Autodesk.Snapping': ViewerSnapperOptions
  'Autodesk.VisualClusters': VisualClustersExtensionOptions
  'Autodesk.ModelSheetTransition': ModelSheetTransitionExtensionOptions
  'Autodesk.Viewing.PixelCompare': PixelCompareExtensionOptions
  'Autodesk.SplitScreen': SplitScreenExtensionOptions
  'Autodesk.Crop': CropExtensionOptions
  'Autodesk.Grids': GridsExtensionOptions
  'Autodesk.Filter': FilterExtensionOptions
  'Autodesk.ModelsPanel': ModelsPanelExtensionOptions
  'Autodesk.BIM360.Minimap': Bim360MinimapExtensionOptions
  'Autodesk.Multipage': MultipageExtensionOptions
}

export const VIEWER_EXTENSIONS = {
  // Navigation and orientation
  'Autodesk.ViewCubeUi': {
    description: 'ViewCube and home control in its own corner canvas.',
    autoLoaded: 'both',
  },
  'Autodesk.BimWalk': {
    description: 'First-person walkthrough at eye height.',
    autoLoaded: '3d',
    addsToolbarButton: true,
    only: '3d',
  },
  'Autodesk.Beeline': {
    description: 'Click a destination and walk straight to it.',
    addsToolbarButton: true,
    only: '3d',
  },
  'Autodesk.Viewing.ZoomWindow': {
    description: 'Zoom to a dragged rectangle.',
    addsToolbarButton: true,
  },
  'Autodesk.Viewing.FusionOrbit': {
    description: 'Mechanical-CAD orbit tool. Consider disabling for buildings.',
    autoLoaded: '3d',
    addsToolbarButton: true,
    only: '3d',
  },

  // Model understanding
  'Autodesk.Measure': {
    description: 'Distance, angle, area, arc, and calibration measurement.',
    autoLoaded: 'both',
    addsToolbarButton: true,
  },
  'Autodesk.Section': {
    description: 'Section planes and section box. No reachable load options.',
    autoLoaded: '3d',
    addsToolbarButton: true,
    only: '3d',
  },
  'Autodesk.Explode': {
    description: 'Explode slider. Rarely meaningful for buildings.',
    autoLoaded: '3d',
    addsToolbarButton: true,
    only: '3d',
  },
  'Autodesk.ModelStructure': {
    description: 'Model browser panel (the object tree).',
    autoLoaded: '3d',
    addsToolbarButton: true,
  },
  'Autodesk.PropertiesManager': {
    description: 'Properties panel for the current selection.',
    autoLoaded: 'both',
    addsToolbarButton: true,
  },
  'Autodesk.PropertySearch': {
    description: 'Search elements by property value.',
    addsToolbarButton: true,
  },
  'Autodesk.LayerManager': {
    description: 'Layers panel.',
    autoLoaded: 'both',
    addsToolbarButton: true,
  },
  'Autodesk.BoxSelection': {
    description:
      'Rubber-band multi-select (hold CTRL). Creates its button but does not add it — call addToolbarButton(true) on the instance.',
    autoLoaded: 'both',
  },
  'Autodesk.VisualClusters': {
    description: 'Spatially cluster elements by a property value. Needs a loaded property DB.',
    addsToolbarButton: true,
    only: '3d',
  },
  'Autodesk.Filter': {
    description: 'Property-based element filtering.',
  },

  // Sheets and documents
  'Autodesk.DocumentBrowser': {
    description: 'Browse and switch between the viewables and sheets of the loaded document.',
    addsToolbarButton: true,
  },
  'Autodesk.ModelSheetTransition': {
    description: 'Animated transition between a 3D view and a sheet, preserving orientation.',
    addsToolbarButton: true,
  },
  'Autodesk.Hyperlink': {
    description: 'Links between sheets.',
    autoLoaded: '2d',
    only: '2d',
  },
  'Autodesk.Multipage': {
    description: 'Multi-page PDF and DWF navigation.',
    only: '2d',
  },
  'Autodesk.StringExtractor': {
    description: 'Extract text strings from sheets.',
    only: '2d',
  },
  'Autodesk.Crop': {
    description: 'Crop region on sheets.',
    addsToolbarButton: true,
    only: '2d',
  },

  // AEC
  'Autodesk.AEC.LevelsExtension': {
    description: 'Floor and level selector.',
    addsToolbarButton: true,
    requiresAecModelData: true,
  },
  'Autodesk.AEC.Minimap3DExtension': {
    description:
      'Floor-plan minimap tracking the 3D camera. Auto-loads LevelsExtension with default options — load Levels first, explicitly, to pass it options.',
    addsToolbarButton: true,
    requiresAecModelData: true,
    only: '3d',
  },
  'Autodesk.AEC.Hypermodeling': {
    description: 'Sheets placed in 3D space.',
    addsToolbarButton: true,
    requiresAecModelData: true,
    only: '3d',
  },
  'Autodesk.Grids': {
    description: 'Structural grid lines. Load Autodesk.GridsUI for the toolbar control.',
    requiresAecModelData: true,
  },
  'Autodesk.GridsUI': {
    description: 'Toolbar UI for Autodesk.Grids (auto-loads it).',
    addsToolbarButton: true,
    requiresAecModelData: true,
  },

  // Markup and authoring
  'Autodesk.Viewing.MarkupsCore': {
    description:
      'SVG redline layer with no UI of its own — enterEditMode / generateData. Load MarkupsGui for the toolbar.',
  },
  'Autodesk.Viewing.MarkupsGui': {
    description: 'Markup toolbar UI. Auto-loads MarkupsCore.',
    addsToolbarButton: true,
  },
  'Autodesk.Edit2D': {
    description: '2D vector authoring (polygons, polylines, measured takeoff) with an undo stack.',
    only: '2d',
  },
  'Autodesk.Snapping': {
    description: 'Snap-to-geometry library. Self-loaded by Measure, markups, and Edit2D.',
  },

  // Data and comparison
  'Autodesk.DataVisualization': {
    description:
      'Sprites, heatmaps, and stream lines. Reads no load options — configuration is per method call.',
    minViewerVersion: '7.42',
  },
  'Autodesk.Viewing.PixelCompare': {
    description: 'Pixel and model diff between two versions.',
  },
  'Autodesk.SplitScreen': {
    description: 'Side-by-side viewports.',
    only: '3d',
  },
  'Autodesk.ModelsPanel': {
    description: 'Panel listing loaded models in aggregated scenes.',
  },
  'Autodesk.BIM360.Minimap': {
    description: '2D sheet minimap panel.',
    only: '2d',
  },
  'Autodesk.BIM360.Extension.PushPin': {
    description: 'Issue and RFI pins in 2D and 3D. Sparsely documented — verify against your data.',
  },
  'Autodesk.Geolocation': {
    description: 'Convert between geographic and model coordinates.',
  },
  'Autodesk.NPR': {
    description: 'Non-photorealistic render styles (sketch, cartoon).',
    addsToolbarButton: true,
    only: '3d',
  },
  'Autodesk.Viewing.SceneBuilder': {
    description: 'Author custom geometry into the scene at runtime.',
    only: '3d',
  },

  // Do not use in new code
  'Autodesk.MemoryLimited': {
    description: 'Deprecated memory-limited loading mode.',
    deprecated: true,
  },
  'Autodesk.Viewing.Collaboration': {
    description: 'Live review. Removed from the CDN bundle.',
    removedIn: '7.89',
  },
  'Autodesk.Viewing.WebVR': {
    description: 'WebVR mode. Removed from the CDN bundle.',
    removedIn: '7.115',
  },
} as const satisfies Record<string, ViewerExtensionInfo>

/** Every id in the catalog. Any other string is a consumer-registered extension. */
export type KnownViewerExtensionId = keyof typeof VIEWER_EXTENSIONS

/** The options `loadExtension` reads for this id (a plain record when untyped). */
export type ViewerExtensionOptionsFor<Id extends string> =
  Id extends keyof ViewerExtensionOptionsMap
    ? ViewerExtensionOptionsMap[Id]
    : Record<string, unknown>

export interface ViewerExtensionEntry<Id extends string = string> {
  id: Id
  options?: ViewerExtensionOptionsFor<Id>
}

/** Typed entry for `<APSViewer extensions={[...]}>` — the id is checked
 * against the catalog and the options against that extension's interface. */
export function viewerExtension<Id extends KnownViewerExtensionId>(
  id: Id,
  options?: ViewerExtensionOptionsFor<Id>,
): ViewerExtensionEntry<Id> {
  return options === undefined ? { id } : { id, options }
}

/** Order matters only where options must reach an auto-loaded dependency —
 * which is why Levels precedes anything that would auto-load it. */
export const AEC_STARTER_EXTENSIONS: readonly ViewerExtensionEntry[] = [
  { id: 'Autodesk.AEC.LevelsExtension' },
  { id: 'Autodesk.Measure' },
  { id: 'Autodesk.Viewing.MarkupsGui' },
  { id: 'Autodesk.DocumentBrowser' },
]
