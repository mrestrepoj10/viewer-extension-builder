import type * as React from 'react'

import { Badge } from '@/components/ui/badge'
import {
  connectionExpiry,
  isExpiringSoon,
  type OAuthConnection,
  type OAuthConnectionStatus,
} from '@/lib/oauth-types'
import { cn } from '@/lib/utils'

/** One color, one meaning — never a generic badge variant. Requires the
 * `@cantera/status-tokens` CSS variables. */
type StatusTone = 'success' | 'warning' | 'danger' | 'neutral'

const statusToneClasses = {
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  danger: 'bg-status-danger text-status-danger-foreground',
  neutral: 'bg-status-neutral text-status-neutral-foreground',
} satisfies Record<StatusTone, string>

/** The same tones as ink, for text sitting on the page or on a `-surface`. */
const statusInkClasses = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
  neutral: 'text-status-neutral',
} satisfies Record<StatusTone, string>

const statusTone = {
  connected: 'success',
  expired: 'warning',
  error: 'danger',
  disconnected: 'neutral',
} satisfies Record<OAuthConnectionStatus, StatusTone>

const statusLabel = {
  connected: 'Connected',
  expired: 'Expired',
  error: 'Error',
  disconnected: 'Not connected',
} satisfies Record<OAuthConnectionStatus, string>

// One formatter per locale, not per render: construction is the expensive part of Intl.
const expiryFormatters = new Map<string, Intl.RelativeTimeFormat>()

function expiryFormatter(locale?: string | string[]): Intl.RelativeTimeFormat {
  const key = Array.isArray(locale) ? locale.join(',') : (locale ?? '')
  let formatter = expiryFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' })
    expiryFormatters.set(key, formatter)
  }
  return formatter
}

// Clamped at zero: an expired token reads "expired", never "expires 5 min. ago".
function formatExpiry(expiry: Date, locale?: string | string[]): string {
  const deltaMs = expiry.getTime() - Date.now()
  if (deltaMs <= 0) return 'expired'
  const rtf = expiryFormatter(locale)
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 1) return 'expires now'
  if (minutes < 60) return `expires ${rtf.format(minutes, 'minute')}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `expires ${rtf.format(hours, 'hour')}`
  return `expires ${rtf.format(Math.round(hours / 24), 'day')}`
}

interface TokenStatusProps extends React.ComponentProps<'div'> {
  connection: OAuthConnection
  showExpiry?: boolean
  showScopes?: boolean
  locale?: string | string[]
  /** How far ahead counts as "expiring soon". Default five minutes. */
  expiringSoonMs?: number
}

function TokenStatus({
  connection,
  showExpiry = true,
  showScopes = false,
  locale,
  expiringSoonMs,
  className,
  ...props
}: TokenStatusProps) {
  const expiry = connectionExpiry(connection)
  const expiringSoon =
    connection.status === 'connected' && isExpiringSoon(connection, expiringSoonMs)
  const tone = expiringSoon ? 'warning' : statusTone[connection.status]
  const label = expiringSoon ? 'Expiring soon' : statusLabel[connection.status]

  return (
    <div
      data-slot="token-status"
      data-status={connection.status}
      data-tone={tone}
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1.5', className)}
      {...props}
    >
      <Badge className={cn('h-6 px-2.5 transition-colors', statusToneClasses[tone])}>{label}</Badge>
      {showExpiry && expiry && connection.status === 'connected' && (
        <time
          dateTime={expiry.toISOString()}
          suppressHydrationWarning
          className={cn(
            'text-xs tabular-nums transition-colors',
            expiringSoon ? statusInkClasses.warning : 'text-muted-foreground',
          )}
        >
          {formatExpiry(expiry, locale)}
        </time>
      )}
      {connection.status === 'error' && connection.error && (
        <span className={cn('text-xs', statusInkClasses.danger)}>{connection.error}</span>
      )}
      {showScopes &&
        connection.scopes?.map((scope) => (
          <Badge key={scope} variant="outline" className="font-mono text-xs">
            {scope}
          </Badge>
        ))}
    </div>
  )
}

export { type StatusTone, statusInkClasses, statusToneClasses, TokenStatus, type TokenStatusProps }
