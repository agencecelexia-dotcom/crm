import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'

// API exposée au parent pour récupérer/effacer la signature.
export interface SignaturePadHandle {
  toDataURL: () => string
  clear: () => void
  isEmpty: () => boolean
}
type Point = { x: number; y: number }
function tracer(canvas: HTMLCanvasElement, traits: Point[][]) {
  const ctx = canvas.getContext('2d')!
  const rect = canvas.getBoundingClientRect()
  ctx.setTransform(canvas.width / rect.width, 0, 0, canvas.height / rect.height, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#111827'
  for (const trait of traits) {
    ctx.beginPath()
    trait.forEach((point, i) => { if (i === 0) ctx.moveTo(point.x * rect.width, point.y * rect.height); else ctx.lineTo(point.x * rect.width, point.y * rect.height) })
    ctx.stroke()
  }
}

// Pad de signature simple (canvas + pointer events), sans dépendance externe.
export const SignaturePad = forwardRef<SignaturePadHandle, { className?: string }>(
  function SignaturePad({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const dessine = useRef(false)
    const vide = useRef(true)
    const traits = useRef<Point[][]>([])

    // Les traits sont conservés si le téléphone pivote ou si le cadre change de taille.
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      function redimensionner() {
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const ratio = Math.max(window.devicePixelRatio || 1, 1)
        const largeur = Math.round(rect.width * ratio), hauteur = Math.round(rect.height * ratio)
        if (canvas.width !== largeur || canvas.height !== hauteur) {
          canvas.width = largeur
          canvas.height = hauteur
          tracer(canvas, traits.current)
        }
      }
      redimensionner()
      const observer = new ResizeObserver(redimensionner)
      observer.observe(canvas)
      return () => observer.disconnect()
    }, [])

    function pos(e: React.PointerEvent) {
      const rect = canvasRef.current!.getBoundingClientRect()
      return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
    }

    function start(e: React.PointerEvent) {
      e.preventDefault()
      dessine.current = true
      canvasRef.current!.setPointerCapture(e.pointerId)
      traits.current.push([pos(e)])
    }
    function move(e: React.PointerEvent) {
      if (!dessine.current) return
      e.preventDefault()
      traits.current[traits.current.length - 1].push(pos(e))
      tracer(canvasRef.current!, traits.current)
      vide.current = false
    }
    function end() {
      dessine.current = false
    }

    useImperativeHandle(ref, () => ({
      toDataURL: () => canvasRef.current!.toDataURL('image/png'),
      isEmpty: () => vide.current,
      clear: () => {
        const canvas = canvasRef.current!
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        traits.current = []
        vide.current = true
      },
    }))

    return (
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Cadre de signature manuscrite : dessinez avec votre doigt ou votre souris"
        className={className}
        style={{ touchAction: 'none' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      />
    )
  },
)
