export const SHOTS_DIR = '/model/shots'
export const IMAGE_MAX_BYTES = 3.75 * 1024 * 1024
export const DESCRIBE_QUESTION = 'Describe what this image of a building model shows, briefly.'
export const DESCRIBE_MAX_OUTPUT_TOKENS = 1024
export const DESCRIBE_TIMEOUT_MS = 60_000

const EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

const SHOT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SEQUENTIAL = /^shot-(\d+)\.[a-z]+$/

export class ImageError extends Error {}

export function imageExtension(mimeType: string): string | null {
  return EXTENSIONS.get(mimeType) ?? null
}

export function shotFileName(
  existing: readonly string[],
  extension: string,
  name?: string,
): string {
  if (name === undefined) {
    const taken = existing.map((file) => Number(SEQUENTIAL.exec(file)?.[1] ?? 0))
    return `shot-${Math.max(0, ...taken) + 1}.${extension}`
  }
  if (!SHOT_NAME.test(name)) {
    throw new ImageError('--name takes letters, digits, dot, dash, and underscore (up to 64)')
  }
  const suffix = `.${extension}`
  return name.toLowerCase().endsWith(suffix) ? name : `${name}${suffix}`
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

export function sniffImageType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  return null
}

export function checkImage(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new ImageError('the file is empty')
  if (bytes.length > IMAGE_MAX_BYTES) {
    throw new ImageError(
      `the image is ${formatBytes(bytes.length)}; the limit is ${formatBytes(IMAGE_MAX_BYTES)}`,
    )
  }
  const mediaType = sniffImageType(bytes)
  if (!mediaType) throw new ImageError('not a PNG, JPEG, WebP, or GIF image')
  return mediaType
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export interface DescribeRequestInput {
  model: string
  mediaType: string
  base64: string
  question?: string
}

export interface DescribeRequest {
  headers: Record<string, string>
  body: string
}

export function describeRequest(input: DescribeRequestInput): DescribeRequest {
  return {
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer proxy',
      'ai-gateway-protocol-version': '0.0.1',
      'ai-language-model-id': input.model,
      'ai-language-model-specification-version': '4',
      'ai-language-model-streaming': 'false',
    },
    body: JSON.stringify({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              mediaType: input.mediaType,
              data: { type: 'data', data: input.base64 },
            },
            { type: 'text', text: input.question?.trim() || DESCRIBE_QUESTION },
          ],
        },
      ],
      maxOutputTokens: DESCRIBE_MAX_OUTPUT_TOKENS,
    }),
  }
}

function textOf(part: unknown): string {
  if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'text') return ''
  return 'text' in part && typeof part.text === 'string' ? part.text : ''
}

export function describeText(body: unknown): string {
  const content = body && typeof body === 'object' && 'content' in body ? body.content : null
  if (!Array.isArray(content)) throw new ImageError('the model response has no content')
  const text = content.map(textOf).join('').trim()
  if (!text) {
    const reason =
      typeof body === 'object' &&
      body !== null &&
      'finishReason' in body &&
      typeof body.finishReason === 'string'
        ? body.finishReason
        : null
    throw new ImageError(
      reason
        ? `the model returned no text (finish reason: ${reason})`
        : 'the model returned no text',
    )
  }
  return text
}

interface GatewayErrorFields {
  type: string | null
  message: string | null
}

function errorFields(body: unknown): GatewayErrorFields {
  const error = body && typeof body === 'object' && 'error' in body ? body.error : null
  if (!error || typeof error !== 'object') return { type: null, message: null }
  const type = 'type' in error && typeof error.type === 'string' ? error.type : null
  const message = 'message' in error && typeof error.message === 'string' ? error.message : null
  return { type, message }
}

export function describeRefusal(status: number, body: unknown): string {
  const { type, message } = errorFields(body)
  if (type === 'too-large') {
    return 'the request is over the gateway size limit; take a smaller screenshot (--max-edge)'
  }
  if (message) return type ? `${message} (${type})` : message
  return `the gateway answered HTTP ${status}`
}

export interface DescribeImageOptions extends DescribeRequestInput {
  gatewayBase: string
  signal: AbortSignal
  fetch?: typeof fetch
}

export async function describeImage(options: DescribeImageOptions): Promise<string> {
  const request = describeRequest(options)
  const url = `${options.gatewayBase.replace(/\/$/, '')}/v4/ai/language-model`
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(DESCRIBE_TIMEOUT_MS)])
  const response = await (options.fetch ?? fetch)(url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal,
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new ImageError(describeRefusal(response.status, body))
  return describeText(body)
}
