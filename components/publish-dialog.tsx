'use client'

import { LoaderCircleIcon } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { type FormEvent, useEffect, useId, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { statusInkClasses } from '@/components/ui/token-status'
import type { ExtensionRuntime, LoadedExtension } from '@/lib/extensions/runtime'
import { rememberAuthor, rememberEditToken, savedAuthor } from '@/lib/gallery/local'
import { captureThumbnail } from '@/lib/gallery/thumbnail'
import { DEFAULT_AUTHOR, LIMITS, type PublishResult } from '@/lib/gallery/types'
import { cn } from '@/lib/utils'

type Shot =
  | { kind: 'pending' }
  | { kind: 'ready'; blob: Blob; url: string }
  | { kind: 'failed'; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch {
    // fall through to the status line
  }
  return `The gallery answered ${response.status}.`
}

function useThumbnail(entry: LoadedExtension, runtime: ExtensionRuntime): Shot {
  const [shot, setShot] = useState<Shot>({ kind: 'pending' })
  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    const viewer = runtime.viewer()
    const capture = viewer
      ? captureThumbnail(viewer, runtime.visibleElements(entry.id))
      : Promise.reject(new Error('the viewer is not ready'))
    capture.then(
      (blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setShot({ kind: 'ready', blob, url })
      },
      (error: unknown) => {
        if (!cancelled) setShot({ kind: 'failed', message: errorMessage(error) })
      },
    )
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [entry.id, runtime])
  return shot
}

function PublishForm({
  entry,
  runtime,
  firstPrompt,
  onDone,
  onCancel,
}: {
  entry: LoadedExtension
  runtime: ExtensionRuntime
  firstPrompt: string | null
  onDone: (result: PublishResult) => void
  onCancel: () => void
}) {
  const { config } = entry.source
  const shot = useThumbnail(entry, runtime)
  const [title, setTitle] = useState(config.displayname)
  const [description, setDescription] = useState(config.description)
  const [author, setAuthor] = useState(savedAuthor)
  const [prompt, setPrompt] = useState(firstPrompt ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = useId()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending || shot.kind !== 'ready') return
    setPending(true)
    setError(null)
    const form = new FormData()
    form.set('extensionId', entry.id)
    form.set('title', title)
    form.set('description', description)
    form.set('author', author)
    form.set('prompt', prompt)
    form.set('config', entry.source.configText)
    form.set('mainJs', entry.source.mainJs)
    if (entry.source.mainCss !== null) form.set('mainCss', entry.source.mainCss)
    form.set('thumbnail', shot.blob, 'thumbnail.jpg')
    try {
      const response = await fetch('/api/gallery', { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readError(response))
      const result = (await response.json()) as PublishResult
      rememberEditToken(result.id, result.editToken)
      rememberAuthor(author.trim())
      onDone(result)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Publish {entry.displayname}</DialogTitle>
        <DialogDescription>
          Anyone with the link can run it, download it, and remix it. This browser keeps the key
          that deletes it.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
        <figure className="grid gap-1.5">
          <div className="relative aspect-[8/5] overflow-hidden rounded-md bg-muted outline outline-1 outline-foreground/10 -outline-offset-1">
            {shot.kind === 'ready' && (
              <Image src={shot.url} alt="" fill unoptimized className="object-cover" />
            )}
            {shot.kind === 'pending' && (
              <output className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
                Capturing the view
              </output>
            )}
            {shot.kind === 'failed' && (
              <p
                role="alert"
                className={cn(
                  'absolute inset-0 flex items-center justify-center p-4 text-center text-sm',
                  statusInkClasses.danger,
                )}
              >
                The thumbnail failed: {shot.message}
              </p>
            )}
          </div>
          <figcaption className="text-muted-foreground text-xs">
            The current view with the extension&apos;s open panels. Close this to rearrange it.
          </figcaption>
        </figure>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-title`}>Title</Label>
            <Input
              id={`${ids}-title`}
              value={title}
              maxLength={LIMITS.title}
              required
              onChange={(event) => setTitle(event.target.value)}
              className="h-11"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-author`}>Your name</Label>
            <Input
              id={`${ids}-author`}
              value={author}
              maxLength={LIMITS.author}
              placeholder={DEFAULT_AUTHOR}
              autoComplete="nickname"
              onChange={(event) => setAuthor(event.target.value)}
              className="h-11"
            />
          </div>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-description`}>Description</Label>
        <Textarea
          id={`${ids}-description`}
          value={description}
          maxLength={LIMITS.description}
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-prompt`}>Prompt</Label>
        <Textarea
          id={`${ids}-prompt`}
          value={prompt}
          maxLength={LIMITS.prompt}
          rows={3}
          placeholder="Optional: what you asked the agent for"
          aria-describedby={firstPrompt ? `${ids}-prompt-help` : undefined}
          onChange={(event) => setPrompt(event.target.value)}
        />
        {firstPrompt && (
          <p id={`${ids}-prompt-help`} className="text-muted-foreground text-xs">
            The first prompt of this session. Edit or clear it.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className={cn('text-sm', statusInkClasses.danger)}>
          {error}
        </p>
      )}

      <DialogFooter className="-mx-4 -mb-4">
        <Button type="button" variant="outline" className="h-11 px-4" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-11 gap-2 px-4"
          aria-disabled={pending || shot.kind !== 'ready' || undefined}
        >
          {pending && <LoaderCircleIcon aria-hidden className="animate-spin" />}
          Publish
        </Button>
      </DialogFooter>
    </form>
  )
}

function Published({ result, onClose }: { result: PublishResult; onClose: () => void }) {
  const path = `/e/${result.id}`
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Published</DialogTitle>
        <DialogDescription>
          It is in the gallery at <span className="font-mono text-foreground">{path}</span>. The
          delete key stays in this browser only.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="-mx-4 -mb-4">
        <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>
          Close
        </Button>
        <Link
          href={path}
          target="_blank"
          rel="noopener"
          className={cn(buttonVariants(), 'h-11 px-4')}
        >
          Open
        </Link>
      </DialogFooter>
    </div>
  )
}

export function PublishDialog({
  entry,
  runtime,
  firstPrompt,
  open,
  onOpenChange,
}: {
  entry: LoadedExtension
  runtime: ExtensionRuntime
  firstPrompt: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [result, setResult] = useState<PublishResult | null>(null)
  const close = () => onOpenChange(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setResult(null)
        onOpenChange(next)
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        {result ? (
          <Published result={result} onClose={close} />
        ) : (
          open && (
            <PublishForm
              entry={entry}
              runtime={runtime}
              firstPrompt={firstPrompt}
              onDone={setResult}
              onCancel={close}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
