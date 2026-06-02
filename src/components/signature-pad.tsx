import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'

// API exposée au parent pour récupérer/effacer la signature.
export interface SignaturePadHandle {
  toDataURL: () => string
  clear: () => void
  isEmpty: () => boolean
}

// Pad de signature simple (canvas + pointer events), sans dépendance externe.
export const SignaturePad = forwardRef<SignaturePadHandle, { className?: string }>(
  function SignaturePad({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const dessine = useRef(false)
    const vide = useRef(true)

    // Adapte la résolution du canvas à l'écran (netteté) au montage.
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      const ctx = canvas.getContext('2d')!
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#111827'
    }, [])

    function pos(e: React.PointerEvent) {
      const rect = canvasRef.current!.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    function start(e: React.PointerEvent) {
      e.preventDefault()
      dessine.current = true
      const ctx = canvasRef.current!.getContext('2d')!
      const { x, y } = pos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }
    function move(e: React.PointerEvent) {
      if (!dessine.current) return
      e.preventDefault()
      const ctx = canvasRef.current!.getContext('2d')!
      const { x, y } = pos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
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
        vide.current = true
      },
    }))

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{ touchAction: 'none' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
    )
  },
)
