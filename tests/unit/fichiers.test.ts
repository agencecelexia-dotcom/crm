import { describe, expect, it } from 'vitest'

import {
  categorieDe,
  extensionDe,
  formatAutorise,
  formatTaille,
} from '../../src/lib/fichiers'

/** Construit un File minimal — seuls `name` et `type` nous intéressent ici. */
function fichier(nom: string, type = ''): File {
  return new File(['x'], nom, { type })
}

describe('extensionDe', () => {
  it('extrait et normalise en minuscules', () => {
    expect(extensionDe('devis.PDF')).toBe('pdf')
    expect(extensionDe('photo salle de bain.JPEG')).toBe('jpeg')
  })

  it('ne retient que la dernière extension', () => {
    expect(extensionDe('archive.tar.gz')).toBe('gz')
  })

  it('renvoie une chaîne vide sans extension', () => {
    expect(extensionDe('SCAN0001')).toBe('')
  })

  it('ne prend pas un fichier caché pour une extension', () => {
    // '.env' ne doit pas être lu comme « extension env » : sans ce cas, un
    // fichier caché serait catégorisé sur un nom qui n'existe pas.
    expect(extensionDe('.env')).toBe('')
  })
})

describe('formatAutorise', () => {
  it('accepte les formats du métier', () => {
    for (const nom of ['devis.pdf', 'chantier.mp4', 'photo.heic', 'plan.dwg', 'note.docx']) {
      expect(formatAutorise(fichier(nom)), nom).toBe(true)
    }
  })

  it('refuse les exécutables et scripts', () => {
    for (const nom of ['virus.exe', 'script.bat', 'install.msi', 'run.sh', 'payload.js']) {
      expect(formatAutorise(fichier(nom)), nom).toBe(false)
    }
  })

  it('refuse quelle que soit la casse', () => {
    expect(formatAutorise(fichier('VIRUS.EXE'))).toBe(false)
  })

  it('accepte un fichier sans extension', () => {
    // Un scan sans extension est un cas légitime ; le refuser ferait plus de
    // dégâts que le risque qu'il couvre.
    expect(formatAutorise(fichier('SCAN0001'))).toBe(true)
  })
})

describe('categorieDe', () => {
  it('se fie au type MIME quand il est présent', () => {
    expect(categorieDe('x', 'image/jpeg')).toBe('image')
    expect(categorieDe('x', 'video/mp4')).toBe('video')
    expect(categorieDe('x', 'audio/mpeg')).toBe('audio')
    expect(categorieDe('x', 'application/pdf')).toBe('pdf')
  })

  it("retombe sur l'extension quand le MIME manque", () => {
    // Cas réel : les lignes antérieures à 0098 n'ont pas de type_mime, et
    // certains navigateurs mobiles renvoient un type vide pour un .mov.
    expect(categorieDe('chantier.mov', null)).toBe('video')
    expect(categorieDe('photo.heic', '')).toBe('image')
    expect(categorieDe('devis.pdf', undefined)).toBe('pdf')
  })

  it('classe en « autre » ce qui ne se prévisualise pas', () => {
    expect(categorieDe('plan.dwg', null)).toBe('autre')
    expect(categorieDe('SCAN0001', null)).toBe('autre')
  })
})

describe('formatTaille', () => {
  it('choisit une unité lisible', () => {
    expect(formatTaille(512)).toBe('512 o')
    expect(formatTaille(2048)).toBe('2 Ko')
    expect(formatTaille(5 * 1024 * 1024)).toBe('5.0 Mo')
    expect(formatTaille(2 * 1024 * 1024 * 1024)).toBe('2.0 Go')
  })

  it('ne rend rien pour une taille inconnue', () => {
    expect(formatTaille(null)).toBe('')
    expect(formatTaille(undefined)).toBe('')
  })
})
