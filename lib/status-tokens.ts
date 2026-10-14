export const statusCssVars = {
  success: 'var(--status-success, var(--foreground))',
  successForeground: 'var(--status-success-foreground, var(--background))',
  successSurface: 'var(--status-success-surface, var(--muted))',
  warning: 'var(--status-warning, var(--foreground))',
  warningForeground: 'var(--status-warning-foreground, var(--background))',
  warningSurface: 'var(--status-warning-surface, var(--muted))',
  danger: 'var(--status-danger, var(--destructive))',
  dangerForeground: 'var(--status-danger-foreground, var(--background))',
  dangerSurface: 'var(--status-danger-surface, var(--muted))',
  neutral: 'var(--status-neutral, var(--muted-foreground))',
  neutralForeground: 'var(--status-neutral-foreground, var(--background))',
  neutralSurface: 'var(--status-neutral-surface, var(--muted))',
} as const

export type StatusCssVar = keyof typeof statusCssVars
