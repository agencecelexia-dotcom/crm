import { z } from 'zod'
import type { ArtisanInput, ZoneCouverte } from '@/types/database'
import { DEPARTEMENTS, SOUS_METIERS } from '@/lib/constants'
import { normaliserSiteWeb } from '@/lib/site-web'

const texte = z.string().default('')
export const schemaBrouillonInscription = z.object({
  nom: texte, prenom: texte, telephone: texte, email: texte, societe: texte,
  siren: texte, adresse: texte, code_postal: texte, ville: texte,
  forme_juridique: texte, capital_social: texte, ville_immatriculation: texte,
  representant: texte, qualite_representant: texte,
  nb_salaries: texte, annees_experience: texte, assurance_rc_pro: texte, assurance_decennale: texte,
  specificites: texte, autre_metier: texte,
  a_site_web: z.enum(['', 'oui', 'non']).catch(''), site_web: texte,
  metiers: z.array(z.string()).default([]), sous_metiers: z.array(z.string()).default([]),
  mode: z.enum(['rayon', 'departements']).default('rayon'),
  departements: z.array(z.string()).default([]),
  zones: z.array(z.object({ ville: z.string(), cp: z.string(), rayon: z.number().int().min(1).max(300) })).default([]),
})
export type DonneesInscription = z.infer<typeof schemaBrouillonInscription>
export type ErreursInscription = Record<string, string>
const requis = (message: string) => z.string().trim().min(1, message)
const nombreFacultatif = z.string().refine((v) => !v || /^\d{1,3}$/.test(v), 'Indiquez un nombre entier entre 0 et 999.')

export function metiersInscription(d: DonneesInscription) {
  const autres = d.autre_metier.split(',').map((m) => m.trim()).filter(Boolean)
  return [...d.metiers, ...autres].filter((m, i, tous) => tous.findIndex((n) => n.toLowerCase() === m.toLowerCase()) === i)
}

export function validerInscription(d: DonneesInscription, etape: number): ErreursInscription {
  const erreurs: ErreursInscription = {}
  const schemas = [
    z.object({ nom: requis('Indiquez votre nom.'), telephone: z.string().refine((v) => {
      const chiffres = v.replace(/\D/g, '')
      return /^[+\d\s().-]+$/.test(v) && ( /^0[1-9]\d{8}$/.test(chiffres) || /^(?:0033|33)[1-9]\d{8}$/.test(chiffres) || /^\+\d{8,15}$/.test(v.replace(/[\s().-]/g, '')) )
    }, 'Indiquez un numéro complet, par exemple 06 12 34 56 78.'), email: z.string().trim().email('Indiquez une adresse email valide.') }),
    z.object({ societe: requis('Indiquez le nom de votre entreprise.'), siren: z.string().refine((v) => /^\d{9}(?:\d{5})?$/.test(v.replace(/\s/g, '')), 'Le SIREN contient 9 chiffres ; le SIRET, 14 chiffres.'), adresse: requis('Indiquez l’adresse de votre entreprise.'), code_postal: z.string().regex(/^\d{5}$/, 'Le code postal doit contenir 5 chiffres.'), ville: requis('Indiquez la ville de votre entreprise.') }),
    z.object({ nb_salaries: nombreFacultatif, annees_experience: nombreFacultatif }),
  ]
  const resultat = schemas[etape]?.safeParse(d)
  if (resultat && !resultat.success) for (const erreur of resultat.error.issues) erreurs[String(erreur.path[0])] ??= erreur.message
  if (etape === 1) {
    if (!d.a_site_web) erreurs.a_site_web = 'Indiquez si votre entreprise a un site web.'
    else if (d.a_site_web === 'oui' && !d.site_web.trim()) erreurs.site_web = 'Indiquez l’adresse de votre site web.'
    else if (d.a_site_web === 'oui' && !normaliserSiteWeb(d.site_web)) erreurs.site_web = 'Adresse non reconnue. Exemple : www.votre-entreprise.fr'
  }
  if (etape === 2) {
    if (!metiersInscription(d).length) erreurs.metiers = 'Sélectionnez au moins un métier, ou indiquez le vôtre.'
    if (d.mode === 'departements') {
      if (!d.departements.length) erreurs.departements = 'Sélectionnez au moins un département.'
      if (d.departements.some((c) => !DEPARTEMENTS.some((dept) => dept.code === c))) erreurs.departements = 'Sélectionnez un département de la liste.'
    } else {
      if (!d.zones.length) erreurs.zones = 'Indiquez au moins une ville d’intervention.'
      d.zones.forEach((zone, i) => {
        if (!zone.ville.trim()) erreurs[`zone-ville-${i}`] = 'Indiquez la ville de ce secteur.'
        if (!/^\d{5}$/.test(zone.cp)) erreurs[`zone-cp-${i}`] = 'Indiquez son code postal à 5 chiffres.'
      })
    }
  }
  return erreurs
}

export function preparerInscription(d: DonneesInscription, zones: ZoneCouverte[]): ArtisanInput {
  const clean = (v: string) => v.trim() || null
  const metiers = metiersInscription(d)
  return {
    nom: d.nom.trim(), prenom: clean(d.prenom), telephone: clean(d.telephone), email: d.email.trim().toLowerCase(),
    societe: d.societe.trim(), siren: d.siren.replace(/\s/g, '').slice(0, 9), adresse: clean(d.adresse), code_postal: clean(d.code_postal), ville: clean(d.ville),
    forme_juridique: clean(d.forme_juridique), capital_social: clean(d.capital_social), ville_immatriculation: clean(d.ville_immatriculation),
    representant: clean(d.representant) ?? [d.prenom, d.nom].filter(Boolean).join(' ').trim(), qualite_representant: clean(d.qualite_representant),
    nb_salaries: d.nb_salaries ? Number(d.nb_salaries) : null, annees_experience: d.annees_experience ? Number(d.annees_experience) : null,
    assurance_rc_pro: d.assurance_rc_pro ? d.assurance_rc_pro === 'oui' : null, assurance_decennale: d.assurance_decennale ? d.assurance_decennale === 'oui' : null,
    specificites: clean(d.specificites), metiers,
    site_web: d.a_site_web === 'oui' ? normaliserSiteWeb(d.site_web) : null,
    sous_metiers: d.sous_metiers.filter((s) => metiers.some((m) => SOUS_METIERS[m]?.includes(s))),
    departements_couverts: d.mode === 'departements' ? d.departements : [], zones_couvertes: d.mode === 'rayon' ? zones : [],
    zone_intervention: null, rayon_km: null, latitude: null, longitude: null,
    taux_commission: 0, // Retiré du payload public : seul le lien fixe le taux côté serveur.
  }
}
