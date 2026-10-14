import Image from 'next/image'
import Link from 'next/link'

import { type GalleryItem, relativeTime } from '@/lib/gallery/types'

export const THUMBNAIL_SIZES =
  '(min-width: 1152px) 368px, (min-width: 1024px) 31vw, (min-width: 640px) 48vw, 100vw'

export function GalleryCard({
  item,
  now,
  priority = false,
}: {
  item: GalleryItem
  now: number
  priority?: boolean
}) {
  return (
    <li className="min-w-0">
      <Link
        href={`/e/${item.id}`}
        className="group grid gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
      >
        <div className="relative aspect-[8/5] overflow-hidden rounded-md bg-muted outline outline-1 outline-foreground/10 -outline-offset-1">
          <Image
            src={item.thumbnailUrl}
            alt=""
            fill
            sizes={THUMBNAIL_SIZES}
            priority={priority}
            className="object-cover"
          />
        </div>
        <div className="grid min-w-0 gap-1">
          <h2 className="truncate font-medium text-base group-hover:underline group-hover:decoration-foreground/30 group-hover:underline-offset-4">
            {item.title}
          </h2>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-muted-foreground text-sm">
            <span className="truncate font-mono text-[0.8125rem] text-foreground/80">
              {item.extensionId}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">{item.author}</span>
            <span aria-hidden>·</span>
            <time dateTime={item.createdAt} className="tabular-nums">
              {relativeTime(item.createdAt, now)}
            </time>
          </p>
        </div>
      </Link>
    </li>
  )
}
