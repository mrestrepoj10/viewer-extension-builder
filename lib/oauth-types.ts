import type { ReactNode } from 'react'

export interface OAuthProvider {
  id: string
  name: string
  /** A mark carries its own default size (the presets ship `className="size-4"`);
   * a surface wanting another size wraps it in `[&_svg]:size-*`, which wins. */
  icon?: ReactNode
  docsUrl?: string
}

export interface OAuthScope {
  /** The literal scope string sent to the provider, e.g. "data:read". */
  id: string
  label: string
  description?: string
  /** Required scopes are always selected and cannot be deselected. */
  required?: boolean
}

export interface OAuthScopePreset {
  id: string
  label: string
  description?: string
  scopes: string[]
}

export type OAuthConnectionStatus = 'connected' | 'expired' | 'error' | 'disconnected'

export interface OAuthAccount {
  name?: string
  email?: string
  avatarUrl?: string
}

export interface OAuthConnection {
  provider: OAuthProvider
  status: OAuthConnectionStatus
  account?: OAuthAccount
  scopes?: string[]
  expiresAt?: Date | string | number
  error?: string
}

export function connectionExpiry(connection: OAuthConnection): Date | null {
  if (connection.expiresAt == null) return null
  const date = new Date(connection.expiresAt)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isExpiringSoon(connection: OAuthConnection, withinMs = 5 * 60_000): boolean {
  const expiry = connectionExpiry(connection)
  if (!expiry) return false
  return expiry.getTime() - Date.now() <= withinMs
}

const EMAIL_DOMAIN = /@.*$/
const NAME_SEPARATORS = /[\s._-]+/

export function accountInitials(account: OAuthAccount | undefined): string {
  const source = account?.name ?? account?.email ?? ''
  const parts = source.replace(EMAIL_DOMAIN, '').split(NAME_SEPARATORS).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return `${first}${last}`.toUpperCase() || '?'
}
