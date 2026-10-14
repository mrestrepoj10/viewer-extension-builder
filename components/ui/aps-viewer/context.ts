'use client'

import { createContext, useContext } from 'react'
import type { ViewerStore } from '@/components/ui/aps-viewer/store'

export const APSViewerContext = createContext<ViewerStore | null>(null)

export function useAPSViewerStore(): ViewerStore {
  const store = useContext(APSViewerContext)
  if (!store) {
    throw new Error(
      'cantera aps-viewer: hooks must be used inside <APSViewer> (as children) ' +
        'or under an <APSViewerContext.Provider>.',
    )
  }
  return store
}
