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
  APS_HIDE_OTHERS_BUTTON_ID,
  type APSViewerHideOthersExtension,
  type APSViewerHideOthersOptions,
} from '@/components/ui/aps-viewer/hide-others'
export {
  type APSCamera,
  type APSExtensionResult,
  type APSHideOthers,
  type APSPropertiesResult,
  type APSSelection,
  type APSViewerHandle,
  type BuildContextMenu,
  useAPSAutoResize,
  useAPSCamera,
  useAPSContextMenu,
  useAPSExtension,
  useAPSExtensions,
  useAPSHideOthers,
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
export {
  APS_HIDE_OTHERS_CHANGED_EVENT,
  APS_HIDE_OTHERS_EXTENSION_ID,
  type APSCameraState,
  type APSContextMenuItem,
  type APSContextMenuStatus,
  type APSDocument,
  type APSDocumentNode,
  type APSExtensionRequest,
  type APSExtensionStatus,
  type APSHideOthersController,
  type APSHideOthersState,
  type APSModel,
  type APSProperty,
  type APSPropertyResult,
  type APSViewer3D,
  type APSViewerExtension,
  type APSViewerExtensionConstructor,
  type APSViewerProfile,
  type APSViewerStatus,
  type APSViewingNamespace,
  type AutodeskGlobal,
  type GetAccessToken,
  isAPSHideOthersController,
  type Vec3,
} from '@/lib/viewer-types'
