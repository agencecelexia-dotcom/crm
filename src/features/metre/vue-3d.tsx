import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

import { couleurPan } from './affichage-releve'
import type { Face3D, Modele3D, Vec3 } from './modele3d'

/** Ce que la vue offre au reste de l'écran : une image (pour le rapport) et le fichier 3D. */
export interface OutilsVue3D {
  image: () => string | null
  glb: () => Promise<Blob>
}

const COULEURS = {
  mur: '#E8E1D5',
  retrait: '#DCCDB4',
  mitoyen: '#C4C4C4',
  ouverture: '#3B82F6',
  marche: '#A8A29E',
  ecartee: '#94A3B8',
  terrasse: '#B8BCC4',
  aretes: '#334155',
  sol: '#DDE4DA',
  ciel: '#EEF2F6',
}

/** Le navigateur sait-il dessiner en 3D ? */
function webglDisponible(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

/** Du repère du relevé (z vers le haut) à celui de Three.js (y vers le haut). */
const vers3 = ([x, y, z]: Vec3) => new THREE.Vector3(x, z, -y)

function couleurDe(f: Face3D): string {
  if (f.type === 'ouverture') return f.ecartee ? COULEURS.ecartee : COULEURS.ouverture
  if (f.type === 'marche') return COULEURS.marche
  if (f.type === 'mur') return f.mitoyen ? COULEURS.mitoyen : f.retrait ? COULEURS.retrait : COULEURS.mur
  return f.terrasse ? COULEURS.terrasse : couleurPan(Number(f.ref))
}

const virgule = (n: number, d = 1) => n.toFixed(d).replace('.', ',')

/** Une étiquette de cote : un texte sur fond clair, toujours face à la caméra. */
function etiquette(texte: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 320
  c.height = 80
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.strokeStyle = '#334155'
  g.lineWidth = 3
  g.beginPath()
  g.roundRect(4, 4, 312, 72, 16)
  g.fill()
  g.stroke()
  g.fillStyle = '#0f172a'
  g.font = '600 34px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(texte, 160, 42)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }))
  s.renderOrder = 10
  return s
}

/** La longueur et la hauteur d'un mur dessiné : de quoi coter la façade sur la 3D. */
function coteDuMur(f: Face3D): { texte: string; milieu: Vec3 } | null {
  const n = f.sommets.length / 2
  if (f.type !== 'mur' || n < 2 || f.complement || f.mitoyen) return null
  const bas = f.sommets.slice(0, n), haut = f.sommets.slice(n).reverse()
  const L = f.plan2d[n - 1][0] - f.plan2d[0][0]
  if (L < 1.5) return null
  const h = f.hauteur ? (f.hauteur[0] + f.hauteur[1]) / 2 : Math.max(...haut.map((p, i) => p[2] - bas[i][2]))
  const m = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  return { texte: `${virgule(L)} m × ${virgule(h)} m`, milieu: m(m(bas[0], bas[n - 1]), m(haut[0], haut[n - 1])) }
}

/** Une face en triangles : découpée dans son propre plan, puis remise en 3D. */
function geometrieDe(f: Face3D): THREE.BufferGeometry | null {
  const contour = f.plan2d.map(([u, v]) => new THREE.Vector2(u, v))
  if (contour.length < 3) return null
  const triangles = THREE.ShapeUtils.triangulateShape(contour, [])
  if (!triangles.length) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(f.sommets.flatMap((p) => vers3(p).toArray()), 3))
  g.setIndex(triangles.flat())
  g.computeVertexNormals()
  return g
}

/**
 * La maison en 3D : chaque pan dans sa couleur (celle de la carte et de la
 * liste), les murs, les ouvertures lues sur les photos. Un doigt tourne, deux
 * doigts zooment ; toucher une face la choisit.
 */
export default function Vue3D({
  modele,
  pansEcartes,
  choisie,
  onChoisir,
  onPret,
  cotes = true,
}: {
  modele: Modele3D
  /** Les longueurs et hauteurs des façades, écrites sur la 3D. */
  cotes?: boolean
  pansEcartes?: Set<number>
  choisie?: Face3D | null
  onChoisir: (f: Face3D | null) => void
  /** Les outils de la vue, dès qu'elle est prête ; null quand elle disparaît. */
  onPret?: (outils: OutilsVue3D | null) => void
}) {
  const hote = useRef<HTMLDivElement>(null)
  const [indisponible] = useState(() => !webglDisponible())
  // Appliquer l'apparence (pans écartés, face choisie) : posé par la scène.
  const appliquer = useRef<(ecartes: Set<number> | undefined, choisie: Face3D | null | undefined) => void>(() => {})
  const choix = useRef(onChoisir)
  useEffect(() => {
    choix.current = onChoisir
  })

  useEffect(() => {
    const el = hote.current
    if (!el || indisponible) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    } catch {
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(COULEURS.ciel)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f86, 1.6))
    const soleil = new THREE.DirectionalLight(0xffffff, 1.4)
    soleil.position.set(-30, 50, 20)
    scene.add(soleil)

    // La maison, dans un groupe à part : c'est lui qu'on exporte.
    const maison = new THREE.Group()
    maison.name = 'maison'
    const liste: THREE.Mesh[] = []
    for (const f of modele.faces) {
      const g = geometrieDe(f)
      if (!g) continue
      const m = new THREE.Mesh(
        g,
        new THREE.MeshLambertMaterial({
          color: couleurDe(f),
          side: THREE.DoubleSide,
          polygonOffset: f.type === 'ouverture',
          polygonOffsetFactor: -2,
          transparent: true,
        }),
      )
      m.name = `${f.type}-${f.ref}`
      m.userData.face = f
      maison.add(m)
      liste.push(m)
      const aretes = new THREE.LineSegments(
        new THREE.EdgesGeometry(g, 25),
        new THREE.LineBasicMaterial({ color: COULEURS.aretes, transparent: true, opacity: 0.55 }),
      )
      maison.add(aretes)
    }
    scene.add(maison)

    // Les cotes des façades : à part de la maison, pour ne pas partir dans le .glb.
    const etiquettes = new THREE.Group()
    if (cotes) {
      const [ax, ay, az] = modele.min, [bx, by, bz] = modele.max
      const centreMaison = vers3([(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2])
      const taille0 = Math.max(bx - ax, by - ay, bz - az, 6)
      for (const f of modele.faces) {
        const cote = coteDuMur(f)
        if (!cote) continue
        const p = vers3(cote.milieu)
        // Un mètre en avant du mur, du côté opposé au centre de la maison.
        const dir = new THREE.Vector3(p.x - centreMaison.x, 0, p.z - centreMaison.z).normalize()
        const s = etiquette(cote.texte)
        s.position.set(p.x + dir.x * 1, p.y, p.z + dir.z * 1)
        s.scale.set(taille0 * 0.2, taille0 * 0.05, 1)
        etiquettes.add(s)
      }
    }
    scene.add(etiquettes)

    // Le sol, sous la maison.
    const [x0, y0, z0] = modele.min
    const [x1, y1, z1] = modele.max
    const centre = vers3([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
    const taille = Math.max(x1 - x0, y1 - y0, z1 - z0, 6)
    const sol = new THREE.Mesh(
      new THREE.CircleGeometry(taille * 2.2, 48),
      new THREE.MeshLambertMaterial({ color: COULEURS.sol }),
    )
    sol.rotation.x = -Math.PI / 2
    sol.position.set(centre.x, z0 - 0.02, centre.z)
    scene.add(sol)

    // Vue de départ : du sud-est, en hauteur.
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, taille * 40)
    camera.position.set(centre.x + taille * 1.2, centre.y + taille * 1.1, centre.z + taille * 1.6)
    const controles = new OrbitControls(camera, renderer.domElement)
    controles.target.copy(centre)
    controles.maxPolarAngle = Math.PI * 0.48
    controles.minDistance = taille * 0.5
    controles.maxDistance = taille * 6
    controles.update()

    const dessiner = () => renderer.render(scene, camera)
    controles.addEventListener('change', dessiner)
    appliquer.current = (ecartes, vise) => {
      for (const m of liste) {
        const f = m.userData.face as Face3D
        const mat = m.material as THREE.MeshLambertMaterial
        mat.opacity = (f.type === 'pan' && (ecartes?.has(Number(f.ref)) ?? false)) || f.ecartee ? 0.35 : 1
        mat.emissive.set(vise && vise.type === f.type && vise.ref === f.ref ? 0x4a4a4a : 0x000000)
      }
      dessiner()
    }

    const ajuster = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      dessiner()
    }
    const obs = new ResizeObserver(ajuster)
    obs.observe(el)
    ajuster()

    // Toucher une face : un appui bref, sans glisser.
    const rayon = new THREE.Raycaster()
    let depart: [number, number] | null = null
    const bas = (e: PointerEvent) => (depart = [e.clientX, e.clientY])
    const haut = (e: PointerEvent) => {
      if (!depart || Math.hypot(e.clientX - depart[0], e.clientY - depart[1]) > 6) return
      const r = renderer.domElement.getBoundingClientRect()
      rayon.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      const touche = rayon.intersectObjects(liste, false)[0]
      choix.current((touche?.object.userData.face as Face3D | undefined) ?? null)
    }
    renderer.domElement.addEventListener('pointerdown', bas)
    renderer.domElement.addEventListener('pointerup', haut)

    onPret?.({
      image: () => {
        dessiner()
        return renderer.domElement.toDataURL('image/png')
      },
      glb: () =>
        new Promise<Blob>((ok, ko) =>
          new GLTFExporter().parse(
            maison,
            (r) => ok(new Blob([r as ArrayBuffer], { type: 'model/gltf-binary' })),
            (e) => ko(e),
            { binary: true },
          ),
        ),
    })

    return () => {
      obs.disconnect()
      controles.dispose()
      renderer.domElement.removeEventListener('pointerdown', bas)
      renderer.domElement.removeEventListener('pointerup', haut)
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose()
          ;(o.material as THREE.Material).dispose()
        }
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose()
          o.material.dispose()
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
      appliquer.current = () => {}
      onPret?.(null)
    }
    // La scène se reconstruit quand le modèle change ; le reste se règle sans la refaire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modele, indisponible, cotes])

  // Les pans écartés s'effacent, la face choisie s'éclaire — sans refaire la scène.
  useEffect(() => {
    appliquer.current(pansEcartes, choisie)
  }, [pansEcartes, choisie, modele])

  if (indisponible) {
    return (
      <div className="grid size-full place-items-center p-6 text-center text-sm text-muted-foreground">
        Ce téléphone n’affiche pas la 3D. La carte et les métrés restent disponibles.
      </div>
    )
  }
  return <div ref={hote} className="size-full" aria-label="Maison en 3D" role="img" />
}
