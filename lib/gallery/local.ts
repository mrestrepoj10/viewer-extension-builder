const TOKENS_KEY = 'veb:gallery:edit-tokens'
const AUTHOR_KEY = 'veb:gallery:author'

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readTokens(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(TOKENS_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => {
        return typeof entry[1] === 'string'
      }),
    )
  } catch {
    return {}
  }
}

function writeTokens(tokens: Record<string, string>) {
  try {
    storage()?.setItem(TOKENS_KEY, JSON.stringify(tokens))
  } catch {
    return
  }
}

export function editTokenFor(id: string): string | null {
  return readTokens()[id] ?? null
}

export function rememberEditToken(id: string, token: string) {
  writeTokens({ ...readTokens(), [id]: token })
}

export function forgetEditToken(id: string) {
  const tokens = readTokens()
  delete tokens[id]
  writeTokens(tokens)
}

export function savedAuthor(): string {
  try {
    return storage()?.getItem(AUTHOR_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberAuthor(name: string) {
  try {
    if (name) storage()?.setItem(AUTHOR_KEY, name)
    else storage()?.removeItem(AUTHOR_KEY)
  } catch {
    return
  }
}
