import { domToCanvas } from 'modern-screenshot'

export const THUMBNAIL_WIDTH = 1200
export const THUMBNAIL_HEIGHT = 750
const QUALITY = 0.85
const SCREENSHOT_TIMEOUT_MS = 20_000

export interface ThumbnailViewer {
  container: HTMLElement
  getScreenShot(width: number, height: number, callback: (url: string) => void): void
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function viewerImage(viewer: ThumbnailViewer, width: number, height: number) {
  return new Promise<ImageBitmap>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the viewer screenshot timed out')),
      SCREENSHOT_TIMEOUT_MS,
    )
    viewer.getScreenShot(width, height, (url) => {
      clearTimeout(timer)
      fetch(url)
        .then((response) => response.blob())
        .then((blob) => createImageBitmap(blob))
        .then(resolve, reject)
        .finally(() => {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
        })
    })
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Keeps the extension's panels in frame when the crop cannot show the whole viewer. */
function cropOrigin(size: number, span: number, low: number | null, high: number | null) {
  let origin = (size - span) / 2
  if (low !== null && high !== null) origin = clamp(origin, high - span, low)
  return clamp(origin, 0, size - span)
}

async function elementCanvas(
  element: Element,
  box: Box,
  scale: number,
): Promise<HTMLCanvasElement | null> {
  // The clone is drawn at the box the element occupies, so its own offsets must not move it again.
  const options = {
    scale,
    width: box.right - box.left,
    height: box.bottom - box.top,
    style: { transform: 'none', translate: 'none', margin: '0' },
    timeout: SCREENSHOT_TIMEOUT_MS / 4,
  }
  try {
    return await domToCanvas(element, options)
  } catch {
    try {
      return await domToCanvas(element, { ...options, font: false })
    } catch {
      return null
    }
  }
}

/** The viewer canvas at 1200×750 with the extension's visible panels drawn where they sit. */
export async function captureThumbnail(
  viewer: ThumbnailViewer,
  elements: readonly Element[],
): Promise<Blob> {
  const frame = viewer.container.getBoundingClientRect()
  const width = Math.max(1, frame.width)
  const height = Math.max(1, frame.height)
  const aspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT
  const cropWidth = width / height > aspect ? height * aspect : width
  const cropHeight = cropWidth / aspect

  const placed = elements
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const box: Box = {
        left: rect.left - frame.left,
        top: rect.top - frame.top,
        right: rect.right - frame.left,
        bottom: rect.bottom - frame.top,
      }
      return { element, box }
    })
    .filter(({ box }) => box.right > 0 && box.bottom > 0 && box.left < width && box.top < height)
  const union = placed.reduce<Box | null>(
    (all, { box }) =>
      all
        ? {
            left: Math.min(all.left, box.left),
            top: Math.min(all.top, box.top),
            right: Math.max(all.right, box.right),
            bottom: Math.max(all.bottom, box.bottom),
          }
        : box,
    null,
  )
  const cropX = cropOrigin(width, cropWidth, union?.left ?? null, union?.right ?? null)
  const cropY = cropOrigin(height, cropHeight, union?.top ?? null, union?.bottom ?? null)
  const scale = THUMBNAIL_WIDTH / cropWidth

  const canvas = document.createElement('canvas')
  canvas.width = THUMBNAIL_WIDTH
  canvas.height = THUMBNAIL_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('this browser cannot draw the thumbnail')
  context.fillStyle = getComputedStyle(viewer.container).backgroundColor || '#ffffff'
  context.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)

  const shot = await viewerImage(viewer, Math.round(width * scale), Math.round(height * scale))
  context.drawImage(shot, -cropX * scale, -cropY * scale, width * scale, height * scale)
  shot.close()

  for (const { element, box } of placed) {
    const drawn = await elementCanvas(element, box, scale)
    if (!drawn) continue
    context.drawImage(
      drawn,
      (box.left - cropX) * scale,
      (box.top - cropY) * scale,
      (box.right - box.left) * scale,
      (box.bottom - box.top) * scale,
    )
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the thumbnail could not be encoded'))),
      'image/jpeg',
      QUALITY,
    )
  })
}
