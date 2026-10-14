/** Per-instance fixed-window limiter, the same shape as the gateway proxy's. */
export function createRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return (key: string): boolean => {
    const now = Date.now()
    if (buckets.size > 10_000) {
      for (const [stale, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(stale)
    }
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return false
    }
    bucket.count += 1
    return bucket.count > limit
  }
}

export function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    'local'
  )
}
