// Architecture screenshots. Two flavours: the bare canvas (usable any time)
// and a composed share card with the scenario, stars, and cost baked in —
// the thing you actually want to drop into Slack after a workshop.
//
// Uses React Flow's documented export approach: rasterise the `.react-flow__viewport`
// element at a transform that frames the whole graph, rather than screenshotting
// the visible pane.

import { getViewportForBounds, type Rect } from '@xyflow/react'

// Loaded on demand. Rasterising a DOM tree is a big library to carry, and it is
// dead weight for everyone who never clicks an export button — which is most
// people, most of the time.
const loadToPng = async () => (await import('html-to-image')).toPng

const BG = '#0f172a'
const PAD = 0.12

const download = (dataUrl: string, filename: string) => {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

/** Never let a stuck rasterisation leave the UI spinning forever. */
async function withTimeout<T>(p: Promise<T>, ms = 15_000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'architecture'

/**
 * Rasterise the current graph to a PNG data URL, framed to fit every node.
 * `bounds` must come from the React Flow instance's own getNodesBounds — the
 * standalone helper does not know each node's measured size, which frames the
 * shot wrong (dead space on one side, clipped nodes on the other).
 */
export async function captureCanvas(bounds: Rect, width = 1280, height = 720): Promise<string | null> {
  const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewportEl || bounds.width === 0 || bounds.height === 0) return null

  const { x, y, zoom } = getViewportForBounds(bounds, width, height, 0.2, 2, PAD)

  const toPng = await loadToPng()

  return withTimeout(
    toPng(viewportEl, {
      backgroundColor: BG,
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      },
      // The app uses system fonts only; letting html-to-image walk and inline
      // every stylesheet is pure cost and can stall the render outright.
      skipFonts: true,
      // The minimap and the on-canvas controls are chrome, not architecture.
      filter: (el) =>
        !(el instanceof HTMLElement) ||
        !(el.classList?.contains('react-flow__minimap') || el.classList?.contains('react-flow__controls')),
    }),
  )
}

export async function exportCanvasPng(bounds: Rect, name: string): Promise<boolean> {
  const dataUrl = await captureCanvas(bounds)
  if (!dataUrl) return false
  download(dataUrl, `cloudopolis-${slug(name)}.png`)
  return true
}

export interface ShareCardInfo {
  emoji: string
  title: string
  track: string
  stars: number
  cost: number
  budget: number
  /** Shown as the footer tag so a screenshot carries its own origin */
  origin: string
}

/**
 * Compose the architecture shot under a header band with the result. Drawn on a
 * plain 2D canvas so there is no second DOM rasterisation to go wrong.
 */
export async function exportShareCard(bounds: Rect, info: ShareCardInfo): Promise<boolean> {
  const shot = await captureCanvas(bounds, 1280, 640)
  if (!shot) return false

  const W = 1280
  const HEADER = 128
  const FOOTER = 44
  const H = HEADER + 640 + FOOTER

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  ctx.fillStyle = '#020617'
  ctx.fillRect(0, 0, W, H)

  const img = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('architecture image failed to load'))
  })
  img.src = shot
  await loaded
  ctx.drawImage(img, 0, HEADER, W, 640)

  // Header band
  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, 0, W, HEADER)
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(0, HEADER - 2, W, 2)

  ctx.textBaseline = 'middle'
  ctx.font = '46px system-ui, -apple-system, "Segoe UI Emoji", sans-serif'
  ctx.fillText(info.emoji, 36, HEADER / 2)

  ctx.fillStyle = '#f1f5f9'
  ctx.font = 'bold 34px system-ui, -apple-system, sans-serif'
  ctx.fillText(info.title, 100, HEADER / 2 - 14)

  ctx.fillStyle = '#94a3b8'
  ctx.font = '18px system-ui, -apple-system, sans-serif'
  ctx.fillText(`${info.track} · $${info.cost}/mo of a $${info.budget} budget`, 100, HEADER / 2 + 22)

  // Stars, right-aligned
  ctx.font = '40px system-ui, -apple-system, "Segoe UI Emoji", sans-serif'
  ctx.textAlign = 'right'
  let x = W - 36
  for (let i = 3; i >= 1; i--) {
    ctx.fillStyle = i <= info.stars ? '#fbbf24' : '#334155'
    ctx.fillText('★', x, HEADER / 2)
    x -= 46
  }

  // Footer tag
  ctx.textAlign = 'left'
  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, H - FOOTER, W, FOOTER)
  ctx.fillStyle = '#64748b'
  ctx.font = '16px system-ui, -apple-system, sans-serif'
  ctx.fillText(`Cloudopolis · ${info.origin}`, 36, H - FOOTER / 2)

  download(canvas.toDataURL('image/png'), `cloudopolis-${slug(info.title)}-${info.stars}star.png`)
  return true
}
