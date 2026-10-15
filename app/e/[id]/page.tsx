import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { cache, Suspense } from 'react'

import { ItemActions } from '@/components/gallery/item-actions'
import { ItemViewer } from '@/components/gallery/item-viewer'
import { galleryConfigured, getGalleryItem } from '@/lib/gallery/db'
import { relativeTime } from '@/lib/gallery/types'

const loadItem = cache(async (id: string) => {
  await connection()
  const item = galleryConfigured() ? await getGalleryItem(id) : null
  return item ? { item, now: Date.now() } : null
})

export async function generateMetadata({ params }: PageProps<'/e/[id]'>): Promise<Metadata> {
  const item = (await loadItem((await params).id))?.item
  if (!item) return { title: 'Not found · Viewer Extension Builder' }
  return {
    title: `${item.title} · Viewer Extension Builder`,
    description: item.description,
    openGraph: { images: [{ url: item.thumbnailUrl, width: 1200, height: 750 }] },
  }
}

const headerClass =
  'grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-border border-b px-4 pt-1 pb-2 sm:flex sm:h-14 sm:py-0 sm:pe-2'

function Wordmark() {
  return (
    <Link
      href="/"
      className="-ms-1 inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-md px-1 font-medium font-mono text-sm lowercase focus-visible:outline-2 focus-visible:outline-ring"
    >
      extension builder
    </Link>
  )
}

async function Item({ params }: { params: PageProps<'/e/[id]'>['params'] }) {
  const loaded = await loadItem((await params).id)
  if (!loaded) notFound()
  const { item, now } = loaded
  const urn = process.env.APS_MODEL_URN
  return (
    <>
      <header className={headerClass}>
        <div className="col-span-2 flex min-w-0 items-center gap-3">
          <Wordmark />
          <h1 className="min-w-0 truncate font-medium text-sm">{item.title}</h1>
        </div>
        <p className="flex min-w-0 items-baseline gap-x-2 text-muted-foreground text-sm sm:flex-1">
          <span className="shrink-0 font-mono text-[0.8125rem] text-foreground/80">
            {item.extensionId}
          </span>
          <span className="truncate max-sm:hidden">
            by {item.author} ·{' '}
            <time dateTime={item.createdAt} className="tabular-nums">
              {relativeTime(item.createdAt, now)}
            </time>
          </span>
        </p>
        <ItemActions item={item} />
      </header>
      <main className="relative min-h-0 flex-1 bg-muted">
        {urn ? (
          <ItemViewer galleryId={item.id} extensionId={item.extensionId} urn={urn} />
        ) : (
          <p className="grid size-full place-items-center p-4 text-center text-muted-foreground text-sm">
            Set APS_MODEL_URN, APS_CLIENT_ID, and APS_CLIENT_SECRET to run it here.
          </p>
        )}
      </main>
    </>
  )
}

function ItemSkeleton() {
  return (
    <>
      <header className={headerClass}>
        <div className="col-span-2 flex min-w-0 items-center gap-3">
          <Wordmark />
          <div aria-hidden className="h-4 w-40 rounded-sm bg-muted" />
        </div>
      </header>
      <div aria-hidden className="min-h-0 flex-1 bg-muted" />
    </>
  )
}

export default function ItemPage({ params }: PageProps<'/e/[id]'>) {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      <Suspense fallback={<ItemSkeleton />}>
        <Item params={params} />
      </Suspense>
    </div>
  )
}
