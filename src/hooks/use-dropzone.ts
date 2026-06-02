import { useState, type DragEvent } from 'react'

// Petit hook de glisser-déposer : renvoie l'état "survol" + les handlers à poser
// sur la zone. Au dépôt, le 1er fichier est transmis à `onFile`.
export function useDropzone(onFile: (file: File) => void) {
  const [dragActive, setDragActive] = useState(false)

  const handlers = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault()
      setDragActive(true)
    },
    onDragLeave: (e: DragEvent) => {
      e.preventDefault()
      setDragActive(false)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const file = e.dataTransfer.files?.[0]
      if (file) onFile(file)
    },
  }

  return { dragActive, handlers }
}
