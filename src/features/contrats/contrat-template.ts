import type { Artisan } from '@/types/database'
import { TAUX_COMMISSION } from '@/lib/constants'

// ------------------------------------------------------------
//  Modèle par défaut du contrat d'engagement Celexia ↔ artisan.
//  ⚠️ Texte PROVISOIRE à valider/remplacer par les clauses définitives.
//  Le contenu est "figé" (snapshot) au moment de la génération du contrat.
// ------------------------------------------------------------

export function genererContenuContrat(artisan: Artisan): string {
  const pct = Math.round(TAUX_COMMISSION * 100)
  const nomArtisan = [artisan.prenom, artisan.nom].filter(Boolean).join(' ')
  const societe = artisan.societe ? ` (${artisan.societe})` : ''

  return `CONTRAT D'ENGAGEMENT — APPORT D'AFFAIRES

Entre les soussignés :

• CELEXIA, plateforme de mise en relation, ci-après « Celexia » ;
• ${nomArtisan}${societe}, professionnel ci-après « l'Artisan ».

PRÉAMBULE
Celexia met en relation des particuliers ayant un projet de travaux avec des
artisans de confiance. Celexia ne réalise pas les travaux : elle présente le
client à l'Artisan, qui réalise la prestation et facture le client en direct.

ARTICLE 1 — OBJET
Le présent contrat définit les conditions dans lesquelles Celexia transmet à
l'Artisan des demandes de clients (« projets ») et la rémunération due à Celexia.

ARTICLE 2 — COMMISSION
En contrepartie de chaque projet transmis et abouti, l'Artisan s'engage à
reverser à Celexia une commission de ${pct} % (dix pour cent) du montant
hors taxes du devis signé avec le client.

ARTICLE 3 — FAIT GÉNÉRATEUR & PAIEMENT
La commission est due dès la signature du devis entre l'Artisan et le client.
Le paiement intervient selon les modalités convenues entre les parties.

ARTICLE 4 — ENGAGEMENTS DE L'ARTISAN
L'Artisan s'engage à traiter les clients transmis avec sérieux et diligence, à
établir un devis, et à informer Celexia de l'issue de chaque projet (devis
signé ou non).

ARTICLE 5 — DURÉE
Le présent contrat prend effet à sa signature et s'applique à l'ensemble des
projets transmis par Celexia à l'Artisan.

Fait pour servir et valoir ce que de droit.
En signant ci-dessous, l'Artisan reconnaît avoir lu et accepté l'intégralité
des présentes conditions.`
}
