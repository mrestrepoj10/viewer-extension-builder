'use client'

import { DownloadIcon, LoaderCircleIcon, PowerOffIcon } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { statusToneClasses } from '@/components/ui/token-status'
import { buildExtensionZip, zipFileName } from '@/lib/extensions/export'
import type { ExtensionRuntime, LoadedExtension } from '@/lib/extensions/runtime'
import { cn } from '@/lib/utils'

function ExtensionChip({ entry, runtime }: { entry: LoadedExtension; runtime: ExtensionRuntime }) {
  const [unloading, setUnloading] = useState(false)
  const unload = async () => {
    if (unloading) return
    setUnloading(true)
    try {
      await runtime.unload(entry.id)
    } finally {
      setUnloading(false)
    }
  }
  const exportZip = () => runtime.download(zipFileName(entry.id), buildExtensionZip(entry.source))
  return (
    <li className="flex items-center gap-1 ps-2.5">
      <span className="min-w-0 flex-1 truncate font-medium" title={entry.source.config.description}>
        {entry.displayname}
      </span>
      {entry.errorCount > 0 && (
        <span
          className={cn(
            'rounded-sm px-1.5 py-0.5 font-mono text-xs tabular-nums',
            statusToneClasses.danger,
          )}
        >
          {entry.errorCount} {entry.errorCount === 1 ? 'error' : 'errors'}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`Unload ${entry.displayname}`}
        title="Unload"
        aria-disabled={unloading || undefined}
        onClick={unload}
      >
        {unloading ? (
          <LoaderCircleIcon aria-hidden className="animate-spin" />
        ) : (
          <PowerOffIcon aria-hidden />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`Export ${entry.displayname} as a zip`}
        title="Export"
        onClick={exportZip}
      >
        <DownloadIcon aria-hidden />
      </Button>
    </li>
  )
}

export function ExtensionsOverlay({
  runtime,
  className,
}: {
  runtime: ExtensionRuntime
  className?: string
}) {
  const loaded = useSyncExternalStore(runtime.subscribe, runtime.loaded, runtime.loaded)
  if (loaded.length === 0) return null
  return (
    <section
      aria-label="Extensions"
      className={cn(
        'grid min-w-56 max-w-72 gap-0.5 rounded-lg border border-border bg-background py-1.5 pe-1 text-foreground text-sm shadow-sm',
        className,
      )}
    >
      <p className="ps-2.5 text-muted-foreground text-xs uppercase tracking-wide">Extensions</p>
      <ul className="grid">
        {loaded.map((entry) => (
          <ExtensionChip key={entry.id} entry={entry} runtime={runtime} />
        ))}
      </ul>
    </section>
  )
}
