import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'

import { GalleryCard } from '@/components/gallery/gallery-card'
import { GalleryFeed } from '@/components/gallery/gallery-feed'
import { PageFrame, SiteFooter, SiteHeader } from '@/components/gallery/site-chrome'
import { galleryConfigured, listGallery } from '@/lib/gallery/db'

export const metadata: Metadata = {
  title: 'Extension gallery · Viewer Extension Builder',
  description:
    'Autodesk Viewer extensions described in plain words and written by the fx agent. Run one on a sample model, download it, or remix it.',
}

const quietLink =
  'text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground'

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid max-w-xl gap-2 py-16">
      <h2 className="font-medium text-lg">{title}</h2>
      <p className="text-pretty text-muted-foreground">{children}</p>
    </div>
  )
}

async function requestTime(): Promise<number> {
  await connection()
  return Date.now()
}

async function Feed() {
  const now = await requestTime()
  if (!galleryConfigured()) {
    return (
      <Notice title="The gallery has no storage yet">
        Set DATABASE_URL and BLOB_READ_WRITE_TOKEN, run pnpm db:migrate, and reload. The{' '}
        <Link href="/agent" className={quietLink}>
          builder
        </Link>{' '}
        works without them.
      </Notice>
    )
  }
  const page = await listGallery()
  if (page.items.length === 0) {
    return (
      <Notice title="Nothing is published yet">
        Build an extension in the{' '}
        <Link href="/agent" className={quietLink}>
          builder
        </Link>
        , load it, then publish it from the Extensions overlay on the viewer.
      </Notice>
    )
  }
  return (
    <GalleryFeed initialCursor={page.nextCursor}>
      {page.items.map((item, index) => (
        <GalleryCard key={item.id} item={item} now={now} priority={index < 3} />
      ))}
    </GalleryFeed>
  )
}

function FeedSkeleton() {
  return (
    <ul aria-hidden className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {['a', 'b', 'c'].map((key) => (
        <li key={key} className="grid gap-3">
          <div className="aspect-[8/5] rounded-md bg-muted" />
          <div className="h-5 w-2/3 rounded-sm bg-muted" />
        </li>
      ))}
    </ul>
  )
}

export default function GalleryPage() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="pb-8">
        <PageFrame className="grid gap-3 pt-10 pb-12 sm:pt-16 sm:pb-16">
          <h1 className="max-w-3xl text-balance font-semibold text-3xl tracking-tight sm:text-5xl">
            Autodesk Viewer extensions, ready to run and remix
          </h1>
          <p className="max-w-2xl text-pretty text-lg text-muted-foreground">
            Each one was built in the{' '}
            <Link href="/agent" className={quietLink}>
              builder
            </Link>
            , where the fx agent writes, checks, and loads an extension from a description. Open one
            to run it on the sample model, download its folder, or remix it.
          </p>
        </PageFrame>
        <PageFrame>
          <Suspense fallback={<FeedSkeleton />}>
            <Feed />
          </Suspense>
        </PageFrame>
      </main>
      <SiteFooter />
    </div>
  )
}
