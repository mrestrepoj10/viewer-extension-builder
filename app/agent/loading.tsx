import { LoaderCircleIcon } from 'lucide-react'

export default function ViewerAgentLoading() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background p-6">
      <output className="flex items-center gap-2 text-muted-foreground text-sm">
        <span aria-hidden className="grid size-4 animate-spin place-items-center">
          <LoaderCircleIcon className="size-4" />
        </span>
        Loading canterafx
      </output>
    </main>
  )
}
