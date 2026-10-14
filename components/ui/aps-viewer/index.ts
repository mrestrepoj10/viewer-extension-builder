'use client'

export { APSViewer, type APSViewerProps } from '@/components/ui/aps-viewer/aps-viewer'
export {
  APSViewerContext,
  useAPSViewerStore,
} from '@/components/ui/aps-viewer/context'
export {
  APSViewerExtensionChip,
  APSViewerExtensionLoader,
  APSViewerExtensionPicker,
  type APSViewerExtensionPickerProps,
  type APSViewerExtensionStatus,
  extensionLabel,
} from '@/components/ui/aps-viewer/extensions'
export {
  type APSCamera,
  type APSExtensionResult,
  type APSPropertiesResult,
  type APSSelection,
  type APSViewerHandle,
  type BuildContextMenu,
  useAPSAutoResize,
  useAPSCamera,
  useAPSContextMenu,
  useAPSExtension,
  useAPSExtensions,
  useAPSModelLoaded,
  useAPSProperties,
  useAPSSelection,
  useAPSViewer,
  useAPSViewerEvent,
} from '@/components/ui/aps-viewer/hooks'
export {
  acquireViewerRuntime,
  loadViewerScript,
  onViewerTokenError,
  releaseViewerRuntime,
  toDocumentId,
  type ViewerRuntimeOptions,
} from '@/components/ui/aps-viewer/loader'
export {
  APSViewerSettings,
  type APSViewerSettingsProps,
  type APSViewerSettingsScale,
  type APSViewerSettingsTheme,
  APSViewerSettingsTrigger,
  type APSViewerSettingsTriggerProps,
  type APSViewerSettingsValue,
  apsViewerPropsFor,
  DEFAULT_APS_VIEWER_SETTINGS,
  parseAPSViewerSettings,
} from '@/components/ui/aps-viewer/settings'
export { ViewerStore } from '@/components/ui/aps-viewer/store'
export type {
  APSViewerToolbarPosition,
  APSViewerToolbarScale,
} from '@/components/ui/aps-viewer/toolbar'
export type {
  APSCameraState,
  APSContextMenuItem,
  APSContextMenuStatus,
  APSDocument,
  APSDocumentNode,
  APSExtensionRequest,
  APSExtensionStatus,
  APSModel,
  APSProperty,
  APSPropertyResult,
  APSViewer3D,
  APSViewerExtension,
  APSViewerExtensionConstructor,
  APSViewerProfile,
  APSViewerStatus,
  APSViewingNamespace,
  AutodeskGlobal,
  GetAccessToken,
  Vec3,
} from '@/lib/viewer-types'
