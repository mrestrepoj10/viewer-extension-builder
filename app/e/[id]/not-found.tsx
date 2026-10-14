import Link from 'next/link'

import { PageFrame } from '@/components/gallery/site-chrome'

export default function ItemNotFound() {
  return (
    <PageFrame className="grid max-w-6xl gap-2 py-16">
      <h1 className="font-semibold text-2xl tracking-tight">No extension at this address</h1>
      <p className="text-muted-foreground">
        It may have been deleted by the person who published it.{' '}
        <Link
          href="/"
          className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
        >
          Back to the gallery
        </Link>
      </p>
    </PageFrame>
  )
}
