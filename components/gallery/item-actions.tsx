'use client'

import { EllipsisIcon, InfoIcon, LoaderCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { PUBLISHED_CODE_NOTE } from '@/components/gallery/site-chrome'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { statusInkClasses } from '@/components/ui/token-status'
import { editTokenFor, forgetEditToken } from '@/lib/gallery/local'
import { type GalleryItem, loaderSnippet } from '@/lib/gallery/types'
import { cn } from '@/lib/utils'

type ActionItem = Pick<
  GalleryItem,
  | 'id'
  | 'title'
  | 'description'
  | 'prompt'
  | 'model'
  | 'extensionId'
  | 'filesUrl'
  | 'mainJsUrl'
  | 'mainCssUrl'
>

const headerButton = 'h-9 px-3 max-sm:h-11'

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

function DeleteDialog({
  item,
  token,
  open,
  onOpenChange,
}: {
  item: ActionItem
  token: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={() => onOpenChange(false)}
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
  )
}

function ItemDetails({ item }: { item: ActionItem }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Details"
            className="size-9 text-muted-foreground hover:text-foreground max-sm:size-11"
          />
        }
      >
        <InfoIcon aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-(--available-height) w-[min(24rem,calc(100vw-2rem))] gap-4 overflow-y-auto p-4"
      >
        {item.description && <p className="text-pretty leading-relaxed">{item.description}</p>}
        {item.prompt && (
          <figure className="grid gap-1.5 border-border border-s ps-3">
            <figcaption className="text-muted-foreground text-xs">
              The prompt, to {item.model}
            </figcaption>
            <blockquote className="whitespace-pre-line text-pretty text-muted-foreground">
              {item.prompt}
            </blockquote>
          </figure>
        )}
        <p className="text-pretty border-border border-t pt-3 text-muted-foreground text-xs">
          {PUBLISHED_CODE_NOTE}
        </p>
      </PopoverContent>
    </Popover>
  )
}

export function ItemActions({ item }: { item: ActionItem }) {
  const token = useSyncExternalStore(
    subscribeStorage,
    () => editTokenFor(item.id),
    () => null,
  )
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [deleteOpen, setDeleteOpen] = useState(false)

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

  const copyLabel =
    copied === 'copied' ? 'Copied the snippet' : copied === 'failed' ? 'Copy failed' : null
  const downloadHref = `${item.filesUrl}?download=1`
  const downloadName = `${item.extensionId}.zip`

  return (
    <div className="flex shrink-0 items-center justify-end gap-1.5">
      <ItemDetails item={item} />
      <Link href={`/agent?remix=${item.id}`} className={cn(buttonVariants(), headerButton)}>
        Remix in builder
      </Link>
      <div className="flex items-center gap-1.5 max-lg:hidden">
        <a
          href={downloadHref}
          download={downloadName}
          className={cn(buttonVariants({ variant: 'outline' }), headerButton)}
        >
          Download .zip
        </a>
        <Button
          type="button"
          variant="outline"
          className={cn(headerButton, 'min-w-40')}
          onClick={copy}
        >
          {copyLabel ?? 'Copy loader snippet'}
        </Button>
        {token && (
          <Button
            type="button"
            variant="outline"
            className={cn(headerButton, statusInkClasses.danger)}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        )}
        <Link
          href="/agent"
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            headerButton,
            'text-muted-foreground',
          )}
        >
          Builder
        </Link>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Actions"
              className="size-9 lg:hidden max-sm:size-11"
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            className="h-10"
            render={(props) => <a {...props} href={downloadHref} download={downloadName} />}
          >
            Download .zip
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10" onClick={copy}>
            Copy loader snippet
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10" render={(props) => <Link {...props} href="/agent" />}>
            Builder
          </DropdownMenuItem>
          {token && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={cn('h-10', statusInkClasses.danger)}
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-live="polite" className="sr-only">
        {copyLabel ?? ''}
      </span>
      {token && (
        <DeleteDialog item={item} token={token} open={deleteOpen} onOpenChange={setDeleteOpen} />
      )}
    </div>
  )
}
