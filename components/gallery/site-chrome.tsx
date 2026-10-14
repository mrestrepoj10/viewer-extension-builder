import Link from 'next/link'

import { cn } from '@/lib/utils'

export const REPOSITORY_URL = 'https://github.com/mrestrepoj10/viewer-extension-builder'

const navLink =
  'inline-flex h-11 items-center rounded-md px-3 text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'

export function PageFrame({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>
}

export function SiteHeader() {
  return (
    <header>
      <PageFrame className="flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="-ms-1 rounded-md px-1 py-2 font-medium font-mono text-sm lowercase focus-visible:outline-2 focus-visible:outline-ring"
        >
          extension builder
        </Link>
        <nav aria-label="Site" className="-me-3 flex items-center">
          <Link href="/agent" className={navLink}>
            Builder
          </Link>
          <a href={REPOSITORY_URL} className={navLink}>
            GitHub
          </a>
        </nav>
      </PageFrame>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="mt-auto">
      <PageFrame className="flex flex-col gap-1 py-10 text-muted-foreground text-sm sm:flex-row sm:justify-between sm:gap-6">
        <p className="max-w-xl text-pretty">
          Published extensions run in the page with full access to it. Read the code before you ship
          one.
        </p>
        <p>
          Built on{' '}
          <a
            href="https://canteraui.vercel.app"
            className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
          >
            cantera
          </a>
        </p>
      </PageFrame>
    </footer>
  )
}
