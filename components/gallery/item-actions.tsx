'use client'

import { LoaderCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { statusInkClasses } from '@/components/ui/token-status'
import { editTokenFor, forgetEditToken } from '@/lib/gallery/local'
import { type GalleryItem, loaderSnippet } from '@/lib/gallery/types'
import { cn } from '@/lib/utils'

type ActionItem = Pick<
  GalleryItem,
  'id' | 'title' | 'extensionId' | 'filesUrl' | 'mainJsUrl' | 'mainCssUrl'
>

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

function DeleteAction({ item, token }: { item: ActionItem; token: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/gallery/${item.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      if (!response.ok && response.status !== 404) {
        const body: unknown = await response.json().catch(() => null)
        const message =
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : `The gallery answered ${response.status}.`
        throw new Error(message)
      }
      forgetEditToken(item.id)
      router.replace('/')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setPending(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={cn('h-11 px-4', statusInkClasses.danger)}
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {item.title}?</DialogTitle>
            <DialogDescription>
              This removes the page, its files, and its thumbnail from the gallery. It cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className={cn('text-sm', statusInkClasses.danger)}>
              {error}
            </p>
          )}
          <DialogFooter className="-mx-4 -mb-4">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-11 gap-2 bg-status-danger px-4 text-status-danger-foreground hover:bg-status-danger/90"
              aria-disabled={pending || undefined}
              onClick={remove}
            >
              {pending && <LoaderCircleIcon aria-hidden className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ItemActions({ item }: { item: ActionItem }) {
  const token = useSyncExternalStore(
    subscribeStorage,
    () => editTokenFor(item.id),
    () => null,
  )
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (copied === 'idle') return
    const timer = setTimeout(() => setCopied('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(loaderSnippet(item))
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/agent?remix=${item.id}`} className={cn(buttonVariants(), 'h-11 px-4')}>
        Remix in builder
      </Link>
      <a
        href={`${item.filesUrl}?download=1`}
        download={`${item.extensionId}.zip`}
        className={cn(buttonVariants({ variant: 'outline' }), 'h-11 px-4')}
      >
        Download .zip
      </a>
      <Button type="button" variant="outline" className="h-11 min-w-48 px-4" onClick={copy}>
        <span aria-live="polite">
          {copied === 'copied'
            ? 'Copied the snippet'
            : copied === 'failed'
              ? 'Copy failed'
              : 'Copy loader snippet'}
        </span>
      </Button>
      {token && <DeleteAction item={item} token={token} />}
    </div>
  )
}
