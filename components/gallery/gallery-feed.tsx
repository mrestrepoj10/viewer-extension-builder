'use client'

import { LoaderCircleIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { GalleryCard } from '@/components/gallery/gallery-card'
import { Button } from '@/components/ui/button'
import { statusInkClasses } from '@/components/ui/token-status'
import type { GalleryItem, GalleryPage } from '@/lib/gallery/types'
import { cn } from '@/lib/utils'

export function GalleryFeed({
  initialCursor,
  children,
}: {
  initialCursor: string | null
  children: ReactNode
}) {
  const [more, setMore] = useState<Array<{ item: GalleryItem; now: number }>>([])
  const [cursor, setCursor] = useState(initialCursor)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMore = async () => {
    if (!cursor || pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/gallery?cursor=${encodeURIComponent(cursor)}`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`The gallery answered ${response.status}.`)
      const page = (await response.json()) as GalleryPage
      const now = Date.now()
      setMore((current) => [...current, ...page.items.map((item) => ({ item, now }))])
      setCursor(page.nextCursor)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The gallery could not be read.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-12">
      <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {children}
        {more.map(({ item, now }) => (
          <GalleryCard key={item.id} item={item} now={now} />
        ))}
      </ul>
      {(cursor || error) && (
        <div className="flex flex-wrap items-center gap-4">
          {cursor && (
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 px-4"
              aria-disabled={pending || undefined}
              onClick={loadMore}
            >
              {pending && <LoaderCircleIcon aria-hidden className="animate-spin" />}
              Load more
            </Button>
          )}
          {error && (
            <p role="alert" className={cn('text-sm', statusInkClasses.danger)}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
