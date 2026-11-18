import { Composition } from 'remotion'
import { Formation } from './Formation'
import { totalImages } from './temps'
import { FPS, HAUTEUR, LARGEUR } from './theme'

export function Racine() {
  return <Composition id="Formation" component={Formation} durationInFrames={totalImages()} fps={FPS} width={LARGEUR} height={HAUTEUR} />
}
