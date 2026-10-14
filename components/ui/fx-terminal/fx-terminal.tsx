'use client'

import '@xterm/xterm/css/xterm.css'

import { LoaderCircleIcon, RotateCwIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import type {
  FxColorScheme,
  FxGatewayRefusal,
  FxSpeed,
  FxTerminalSession,
} from '@/components/ui/fx-terminal/runtime'
import type { FxExecEvent, WorkspaceSeed } from '@/components/ui/fx-terminal/workspace'
import { type StatusTone, statusInkClasses } from '@/components/ui/token-status'
import {
  type AgentNotice,
  type AgentNoticeTone,
  type AgentUnavailableReason,
  describeAgentUnavailableReason,
} from '@/lib/agent-types'
import type { ExtensionRuntime } from '@/lib/extensions/runtime'
import { cn } from '@/lib/utils'
import type { ViewerAgentTools } from '@/lib/viewer-agent-tools'

interface FxTerminalHandle {
  focus(): void
  fit(): void
}

interface FxTerminalProps {
  tools: ViewerAgentTools
  /** Page-side loader behind the workspace `ext` command. */
  extensions?: ExtensionRuntime
  /** Same-origin proxy that holds the AI Gateway key. */
  gatewayBase?: string
  model?: string
  effort?: string
  speed?: FxSpeed
  /** Omit to follow the `.dark` class on the document, live. */
  colorScheme?: FxColorScheme
  onExec?: (event: FxExecEvent) => void
  onReady?: () => void
  /** Each prompt the user submits, slash commands excluded. */
  onPrompt?: (prompt: string) => void
  /** Files written into the workspace before fx starts; read once, at start. */
  seed?: WorkspaceSeed
  className?: string
  ref?: React.Ref<FxTerminalHandle>
}

type FxTerminalStatus =
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'unsupported' }
  | { kind: 'error'; title: string; message: string }

const noticeTone = {
  neutral: 'neutral',
  warning: 'warning',
  danger: 'danger',
} satisfies Record<AgentNoticeTone, StatusTone>

const noticeSurface = {
  neutral: 'bg-status-neutral-surface',
  warning: 'bg-status-warning-surface',
  danger: 'bg-status-danger-surface',
} satisfies Record<AgentNoticeTone, string>

const refusalReasons = new Map<string, AgentUnavailableReason>([
  ['not-configured', 'not-configured'],
  ['rate-limited', 'rate-limited'],
  ['model-not-allowed', 'model-not-allowed'],
])

function describeRefusal(refusal: FxGatewayRefusal): AgentNotice {
  const reason = refusalReasons.get(refusal.type)
  if (reason) return describeAgentUnavailableReason(reason)
  return {
    title: 'The model proxy refused the request',
    description: refusal.message,
    tone: refusal.status === 413 ? 'warning' : 'danger',
  }
}

function subscribeToDocumentScheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

function documentScheme(): FxColorScheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function serverScheme(): FxColorScheme {
  return 'light'
}

function FxTerminal({
  tools,
  extensions,
  gatewayBase = '/api/agent/gateway',
  model = 'anthropic/claude-haiku-5.5',
  effort = 'low',
  speed = 'normal',
  colorScheme,
  onExec,
  onReady,
  onPrompt,
  seed,
  className,
  ref,
}: FxTerminalProps) {
  const followed = React.useSyncExternalStore(
    subscribeToDocumentScheme,
    documentScheme,
    serverScheme,
  )
  const scheme = colorScheme ?? followed
  const initialScheme = React.useEffectEvent(() => scheme)
  const handleExec = React.useEffectEvent((event: FxExecEvent) => onExec?.(event))
  const handleReady = React.useEffectEvent(() => onReady?.())
  const handlePrompt = React.useEffectEvent((prompt: string) => onPrompt?.(prompt))
  const initialSeed = React.useEffectEvent(() => seed)

  const [container, setContainer] = React.useState<HTMLDivElement | null>(null)
  const [session, setSession] = React.useState<FxTerminalSession | null>(null)
  const [status, setStatus] = React.useState<FxTerminalStatus>({ kind: 'starting' })
  const [refusal, setRefusal] = React.useState<FxGatewayRefusal | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  React.useImperativeHandle(
    ref,
    () => ({ focus: () => session?.focus(), fit: () => session?.fit() }),
    [session],
  )

  React.useEffect(() => {
    if (!container) return
    const aborter = new AbortController()
    let current: FxTerminalSession | null = null
    void (async () => {
      try {
        const { supportsJspi } = await import('libfx/browser')
        if (aborter.signal.aborted) return
        if (!supportsJspi()) {
          setStatus({ kind: 'unsupported' })
          return
        }
        const { startFxTerminal } = await import('@/components/ui/fx-terminal/runtime')
        const started = await startFxTerminal(container, {
          tools,
          extensions,
          gatewayBase,
          model,
          effort,
          speed,
          colorScheme: initialScheme(),
          signal: aborter.signal,
          onExec: handleExec,
          onRefusal: setRefusal,
          onPrompt: handlePrompt,
          seed: initialSeed(),
        })
        if (aborter.signal.aborted) {
          started.dispose()
          return
        }
        current = started
        setSession(started)
        setStatus({ kind: 'ready' })
        handleReady()
        void started.exited.then((code) => {
          if (aborter.signal.aborted) return
          setSession(null)
          setStatus({
            kind: 'error',
            title: 'The agent stopped',
            message: `fx exited with code ${code}. Retry starts a new session.`,
          })
        })
      } catch (error) {
        if (aborter.signal.aborted) return
        setStatus({
          kind: 'error',
          title: "The agent couldn't start",
          message:
            error instanceof TypeError
              ? 'The agent runtime could not be downloaded. Check the connection and retry.'
              : error instanceof Error
                ? error.message
                : 'The terminal failed to start.',
        })
      }
    })()
    return () => {
      aborter.abort()
      current?.dispose()
      setSession(null)
    }
  }, [container, tools, extensions, gatewayBase, model, effort, speed])

  const retry = () => {
    setStatus({ kind: 'starting' })
    setRefusal(null)
    setAttempt((count) => count + 1)
  }

  React.useEffect(() => {
    session?.setColorScheme(scheme)
  }, [session, scheme])

  React.useEffect(() => {
    if (!session) return
    const frame = requestAnimationFrame(() => {
      session.fit()
      session.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [session])

  const banner = refusal ? describeRefusal(refusal) : null
  const background = scheme === 'dark' ? '#0a0a0a' : '#fafafa'

  return (
    <section
      data-slot="fx-terminal"
      aria-label="fx terminal"
      className={cn('flex min-h-0 flex-col bg-background text-foreground', className)}
    >
      {banner && (
        <div
          role="alert"
          className={cn(
            'flex shrink-0 items-start gap-3 border-border border-b px-4 py-3',
            noticeSurface[banner.tone],
          )}
        >
          <TriangleAlertIcon
            aria-hidden
            className={cn('mt-0.5 size-4 shrink-0', statusInkClasses[noticeTone[banner.tone]])}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="font-medium text-sm">{banner.title}</p>
            <p className="text-muted-foreground text-xs">{banner.description}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-my-2 size-11"
            aria-label="Dismiss"
            onClick={() => setRefusal(null)}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      )}

      <div className={cn('relative flex min-h-0 flex-1 flex-col', scheme === 'light' && 'p-3')}>
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            scheme === 'light'
              ? 'rounded-lg border border-border py-3 ps-3.5'
              : 'rounded-none py-2 ps-4',
            status.kind !== 'ready' && 'invisible',
          )}
          style={{ background }}
          aria-hidden={status.kind !== 'ready'}
        >
          <div key={attempt} ref={setContainer} className="min-h-0 flex-1" />
        </div>

        {status.kind === 'starting' && (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground text-sm"
          >
            <span className="grid size-4 animate-spin place-items-center">
              <LoaderCircleIcon aria-hidden className="size-4" />
            </span>
            Starting the agent…
          </div>
        )}

        {status.kind === 'unsupported' && (
          <Notice notice={describeAgentUnavailableReason('unsupported-browser')} />
        )}

        {status.kind === 'error' && (
          <Notice
            notice={{
              title: status.title,
              description: status.message,
              tone: 'danger',
            }}
            action={
              <Button variant="outline" className="h-11 px-4" onClick={retry}>
                <RotateCwIcon aria-hidden />
                Retry
              </Button>
            }
          />
        )}
      </div>
    </section>
  )
}

function Notice({ notice, action }: { notice: AgentNotice; action?: React.ReactNode }) {
  return (
    <div
      role={notice.tone === 'danger' ? 'alert' : 'status'}
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <span
        className={cn(
          'grid size-10 place-items-center rounded-full',
          noticeSurface[notice.tone],
          statusInkClasses[noticeTone[notice.tone]],
        )}
      >
        <TriangleAlertIcon aria-hidden className="size-5" />
      </span>
      <div className="flex max-w-xs flex-col gap-1">
        <p className="text-balance font-medium text-sm">{notice.title}</p>
        <p className="text-pretty text-muted-foreground text-sm">{notice.description}</p>
      </div>
      {action}
    </div>
  )
}

export type { FxColorScheme, FxExecEvent, FxGatewayRefusal }
export { FxTerminal, type FxTerminalHandle, type FxTerminalProps }
