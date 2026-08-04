import { useState, type DragEvent } from 'react'

// Petit hook de glisser-déposer : renvoie l'état "survol" + les handlers à poser
// sur la zone. Au dépôt, le 1er fichier est transmis à `onFile`.
// Si `onFiles` est fourni, c'est LUI qui reçoit la totalité des fichiers déposés
// (les pièces jointes d'un projet acceptent un dépôt multiple).
export function useDropzone(
  onFile: (file: File) => void,
  onFiles?: (files: File[]) => void,
) {
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
      const files = Array.from(e.dataTransfer.files ?? [])
      if (!files.length) return
      if (onFiles) onFiles(files)
      else onFile(files[0])
    },
  }

  return { dragActive, handlers }
}
