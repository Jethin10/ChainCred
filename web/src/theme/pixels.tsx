import { useEffect, useRef } from 'react'

// The landing page's sky: blocky clouds in two blues, with checkerboard dithering between levels.
const SKY = { deep: '#00a3ff', light: '#7ccfff', paper: '#ffffff' }

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function hash(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const fade = (t: number) => t * t * (3 - 2 * t)
function noise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const plane = (k: number) => lerp(
    lerp(hash(xi, yi, k), hash(xi + 1, yi, k), xf),
    lerp(hash(xi, yi + 1, k), hash(xi + 1, yi + 1, k), xf), yf)
  return lerp(plane(zi), plane(zi + 1), zf)
}

/** Animated dithered sky. Clouds drift, part around the pointer, and leave the centre clear for a title. */
export function PixelSky({ cell = 18, clearCenter = true, seed = 0 }: { cell?: number; clearCenter?: boolean; seed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const anim = { raf: 0 }
    let last = 0, t = seed * 7.3
    const pointer = { x: -1e4, y: -1e4, r: 0 }
    const still = reduced()

    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      ctx.fillStyle = SKY.paper
      ctx.fillRect(0, 0, w, h)
      const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell)
      const half = cell / 2
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cell, y = r * cell
          let v = noise(c / 9 + t * 0.6, r / 6, t * 0.35) * 0.7 + noise(c / 3.5, r / 3 + t, seed) * 0.3
          if (clearCenter) {
            const dx = (x + half - w / 2) / (w * (w < 600 ? 0.5 : 0.4)), dy = (y + half - h * 0.55) / (h * 0.42)
            v *= Math.min(1, Math.max(0, (Math.hypot(dx, dy) - 0.7) / 0.55))
          }
          const px = x + half - pointer.x, py = y + half - pointer.y
          v *= 1 - Math.exp(-(px * px + py * py) / (pointer.r * pointer.r + 1))
          if (v < 0.3) continue
          // five levels: dither on paper, light, dither light/deep, deep
          if (v < 0.38) dither(x, y, SKY.light)
          else if (v < 0.5) { ctx.fillStyle = SKY.light; ctx.fillRect(x, y, cell, cell) }
          else if (v < 0.58) { ctx.fillStyle = SKY.light; ctx.fillRect(x, y, cell, cell); dither(x, y, SKY.deep) }
          else { ctx.fillStyle = SKY.deep; ctx.fillRect(x, y, cell, cell) }
        }
      }
    }
    const dither = (x: number, y: number, color: string) => {
      ctx.fillStyle = color
      for (let dy = 0; dy < cell; dy += 3) for (let dx = (dy / 3) % 2 ? 3 : 0; dx < cell; dx += 6) ctx.fillRect(x + dx, y + dy, 3, 3)
    }
    const loop = (now: number) => {
      anim.raf = requestAnimationFrame(loop)
      if (now - last < 110) return // ~9 fps: stepped, like pixel art
      last = now
      t += 0.012
      pointer.r += ((pointer.x > -1e3 ? 70 : 0) - pointer.r) * 0.25
      draw()
    }
    const move = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect()
      pointer.x = e.clientX - b.left; pointer.y = e.clientY - b.top
      if (pointer.y < -40 || pointer.y > b.height + 40) pointer.x = -1e4
    }
    const leave = () => { pointer.x = -1e4 }
    draw()
    if (!still) {
      anim.raf = requestAnimationFrame(loop)
      window.addEventListener('pointermove', move, { passive: true })
      document.addEventListener('pointerleave', leave)
    }
    const ro = new ResizeObserver(() => draw())
    ro.observe(canvas)
    return () => { cancelAnimationFrame(anim.raf); window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); ro.disconnect() }
  }, [cell, clearCenter, seed])
  return <canvas ref={ref} className="sky" aria-hidden="true" />
}

/** Full-screen pixel dissolve, played whenever `trigger` changes. */
export function PixelWipe({ trigger }: { trigger: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const canvas = ref.current
    if (!canvas || reduced()) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = (canvas.width = window.innerWidth), h = (canvas.height = window.innerHeight)
    const size = 32, cols = Math.ceil(w / size), rows = Math.ceil(h / size)
    const order = Array.from({ length: cols * rows }, (_, i) => ({ i, a: Math.random() * 0.6 + ((i % cols) / cols) * 0.4, b: Math.random() }))
    const start = performance.now(), IN = 170, OUT = 260
    const anim = { raf: 0 }
    const frame = (now: number) => {
      const e = now - start
      ctx.clearRect(0, 0, w, h)
      for (const cell of order) {
        const on = e < IN ? cell.a < e / IN : cell.b > (e - IN) / OUT
        if (!on) continue
        ctx.fillStyle = cell.b > 0.55 ? SKY.deep : cell.b > 0.2 ? SKY.light : SKY.paper
        ctx.fillRect((cell.i % cols) * size, Math.floor(cell.i / cols) * size, size, size)
      }
      if (e < IN + OUT) anim.raf = requestAnimationFrame(frame)
      else ctx.clearRect(0, 0, w, h)
    }
    anim.raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(anim.raf)
  }, [trigger])
  return <canvas ref={ref} className="wipe" aria-hidden="true" />
}

/** The PayKit mark from the landing page, as a pixel-art coin. */
export function Mark() {
  return <svg className="mark" viewBox="0 0 8 8" aria-hidden="true" shapeRendering="crispEdges">
    <path d="M2 0h4v1h1v1h1v4h-1v1h-1v1h-4v-1h-1v-1h-1v-4h1v-1h1z" fill="#0a0a0a" />
    <path d="M3 2h2v1h1v1h-1v1h-1v1h-1z" fill="#7ccfff" />
  </svg>
}
