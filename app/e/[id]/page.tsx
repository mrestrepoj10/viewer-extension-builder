import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { cache, Suspense } from 'react'

import { ItemActions } from '@/components/gallery/item-actions'
import { ItemViewer } from '@/components/gallery/item-viewer'
import { PageFrame, SiteFooter, SiteHeader } from '@/components/gallery/site-chrome'
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

async function Item({ params }: { params: PageProps<'/e/[id]'>['params'] }) {
  const loaded = await loadItem((await params).id)
  if (!loaded) notFound()
  const { item, now } = loaded
  const urn = process.env.APS_MODEL_URN
  return (
    <>
      <PageFrame className="grid gap-6 pt-8 pb-10 sm:pt-12">
        <div className="grid gap-3">
          <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
            {item.title}
          </h1>
          <p className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground text-sm">
            <span className="font-mono text-[0.8125rem] text-foreground/80">
              {item.extensionId}
            </span>
            <span aria-hidden>·</span>
            <span>by {item.author}</span>
            <span aria-hidden>·</span>
            <time dateTime={item.createdAt} className="tabular-nums">
              {relativeTime(item.createdAt, now)}
            </time>
          </p>
        </div>
        {item.description && (
          <p className="max-w-2xl text-pretty text-lg leading-relaxed">{item.description}</p>
        )}
        {item.prompt && (
          <figure className="grid max-w-2xl gap-2 border-border border-s ps-4">
            <figcaption className="text-muted-foreground text-sm">
              The prompt, to {item.model}
            </figcaption>
            <blockquote className="whitespace-pre-line text-pretty text-muted-foreground">
              {item.prompt}
            </blockquote>
          </figure>
        )}
        <ItemActions item={item} />
      </PageFrame>
      {urn ? (
        <ItemViewer galleryId={item.id} extensionId={item.extensionId} urn={urn} />
      ) : (
        <PageFrame>
          <p className="text-muted-foreground">
            Set APS_MODEL_URN, APS_CLIENT_ID, and APS_CLIENT_SECRET to run it here.
          </p>
        </PageFrame>
      )}
    </>
  )
}

function ItemSkeleton() {
  return (
    <div aria-hidden className="grid gap-6">
      <PageFrame className="grid gap-3 pt-8 pb-10 sm:pt-12">
        <div className="h-10 w-2/3 max-w-md rounded-sm bg-muted" />
        <div className="h-5 w-1/2 max-w-xs rounded-sm bg-muted" />
      </PageFrame>
      <div className="h-[min(78svh,52rem)] min-h-[26rem] bg-muted" />
    </div>
  )
}

export default function ItemPage({ params }: PageProps<'/e/[id]'>) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <SiteHeader />
      <main>
        <Suspense fallback={<ItemSkeleton />}>
          <Item params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  )
}
