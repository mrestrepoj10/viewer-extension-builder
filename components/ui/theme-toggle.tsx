'use client'

import { MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ThemeToggleProps = Omit<React.ComponentProps<typeof Button>, 'children' | 'onClick'>

// Icon and accessible name follow the `.dark` class in CSS, not React state, so
// server and client markup match and the button is right on the first paint.
function ThemeToggle({ className, variant = 'ghost', ...props }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      type="button"
      variant={variant}
      size="icon"
      data-slot="theme-toggle"
      className={cn('size-10 text-muted-foreground hover:text-foreground', className)}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      {...props}
    >
      <span aria-hidden className="grid size-4 place-items-center">
        <MoonIcon className="col-start-1 row-start-1 size-4 dark:hidden" />
        <SunIcon className="col-start-1 row-start-1 hidden size-4 dark:block" />
      </span>
      <span className="sr-only dark:hidden">Switch to dark theme</span>
      <span className="sr-only hidden dark:inline">Switch to light theme</span>
    </Button>
  )
}

export { ThemeToggle, type ThemeToggleProps }
