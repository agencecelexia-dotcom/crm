import type { Artisan } from '@/types/database'
import { formatDate } from '@/lib/format'

// ------------------------------------------------------------
//  Modèle du contrat d'apporteur d'affaires Celexia (texte fourni par le client).
//  Les variables {{...}} sont remplies à la génération (depuis la fiche artisan
//  + valeurs par défaut éditables). {{DATE_SIGNATURE}} reste un jeton, rempli à
//  l'affichage/au PDF avec la vraie date de signature électronique.
// ------------------------------------------------------------

export const CONTRAT_MODELE = `CONTRAT D'APPORTEUR D'AFFAIRES
Mise en relation et apport de clientèle

Entre les soussignés

La société CELEXIA, société par actions simplifiée unipersonnelle (SASU) au capital social de 1 000 euros, immatriculée au Registre du Commerce et des Sociétés de Créteil sous le numéro 939 306 429, identifiée à la TVA sous le numéro FR41939306429, dont le siège social est situé 27 B rue François Rolland, 94130 Nogent-sur-Marne, représentée par M. Thomas Aubigeon, en sa qualité de Président,
Ci-après dénommée « l'Apporteur » ou « CELEXIA »,
D'une part,

Et

La société {{SOCIETE_ARTISAN}}, {{FORME_JURIDIQUE}}, au capital de {{CAPITAL_ARTISAN}} euros, immatriculée au RCS / Répertoire des Métiers de {{VILLE_IMMATRICULATION}} sous le numéro SIREN {{SIREN_ARTISAN}}, dont le siège social est situé {{ADRESSE_ARTISAN}}, représentée par {{REPRESENTANT_ARTISAN}}, en sa qualité de {{QUALITE_REPRESENTANT}}, dûment habilité(e),
Ci-après dénommée « le Partenaire » ou « l'Artisan »,
D'autre part,

Ci-après désignées ensemble « les Parties » et individuellement « une Partie ».

Préambule

CELEXIA exerce une activité d'apport d'affaires et de mise en relation. Elle déploie à ses frais des actions de communication et de publicité destinées à identifier des particuliers ou professionnels (les « Clients ») ayant un projet de travaux, et à les mettre en relation avec des artisans qualifiés susceptibles de réaliser ces travaux.
Le Partenaire est un professionnel du bâtiment disposant des compétences, qualifications, autorisations et assurances requises pour réaliser les prestations relevant de son corps de métier.
CELEXIA n'exécute aucun travaux et n'intervient pas dans la relation contractuelle entre le Partenaire et le Client. Son rôle se limite strictement à la mise en relation. Les Parties sont des professionnels indépendants. C'est dans ce cadre qu'elles sont convenues de ce qui suit.

Article 1 – Objet du contrat
Le présent contrat a pour objet de définir les conditions dans lesquelles CELEXIA transmet au Partenaire des opportunités d'affaires (les « Affaires ») correspondant à son métier et à sa zone d'intervention, et la rémunération due à CELEXIA en contrepartie de cet apport.
Il est conclu pour l'ensemble des Affaires, présentes ET futures : signé une seule fois, il demeure valable pour tous les projets que CELEXIA transmettra ultérieurement au Partenaire, sans qu'une nouvelle signature soit nécessaire.

Article 2 – Définitions
Affaire / Lead : toute demande d'un Client transmise par CELEXIA au Partenaire, comprenant a minima l'identité du Client, ses coordonnées et la nature du projet.
Client : le particulier ou professionnel à l'origine de la demande de travaux, mis en relation avec le Partenaire par CELEXIA.
Devis signé : tout devis, bon de commande ou marché accepté par le Client et émanant du Partenaire (ou de toute entité qui lui est liée), portant sur une Affaire transmise par CELEXIA.
Acompte : toute somme versée par le Client au Partenaire à la signature du devis ou avant le démarrage des travaux.
Montant TTC : le montant toutes taxes comprises (TTC) total du Devis signé, avenants et travaux complémentaires inclus.

Article 3 – Obligations de CELEXIA
Transmettre au Partenaire, avec diligence, les Affaires correspondant à son métier et à sa zone géographique d'intervention.
Communiquer au Partenaire les informations utiles en sa possession sur le projet du Client (nature, localisation, coordonnées).
Agir loyalement et n'effectuer aucune déclaration trompeuse auprès des Clients quant à son rôle de simple intermédiaire.
CELEXIA est tenue d'une obligation de moyens. Elle ne garantit ni un volume d'Affaires, ni la conclusion effective d'un contrat entre le Partenaire et le Client.

Article 4 – Obligations du Partenaire
Contacter le Client dans les meilleurs délais, et en tout état de cause sous 48 heures ouvrées suivant la transmission de l'Affaire.
Établir un devis, réaliser les travaux et facturer le Client en son nom propre, sous sa seule responsabilité.
Informer CELEXIA, sans délai, de la suite donnée à chaque Affaire (sans suite, devis envoyé, devis signé) et transmettre une copie du devis signé ainsi que son montant et le montant de l'acompte encaissé.
Exécuter les travaux dans les règles de l'art, conformément à la réglementation applicable et aux engagements pris envers le Client.
Disposer, pendant toute la durée du contrat, des qualifications, autorisations et assurances nécessaires (cf. Article 10).

Article 5 – Rémunération de l'Apporteur
En contrepartie de l'apport d'Affaires, le Partenaire verse à CELEXIA une commission égale à {{TAUX_COMMISSION}} % du Montant TTC (toutes taxes comprises) de chaque Devis signé issu d'une Affaire transmise par CELEXIA.
La commission est due dès la signature du devis par le Client. En cas d'avenant ou de travaux complémentaires sur la même Affaire, la commission s'applique également au montant additionnel.

Article 6 – Paiement de la commission sur l'acompte
La commission est payable par le Partenaire dès l'encaissement de l'acompte versé par le Client, et au plus tard dans un délai de {{DELAI_PAIEMENT}} jours suivant cet encaissement. Le Partenaire règle ainsi la commission par prélèvement sur l'acompte client, de sorte qu'il n'avance aucune somme sur ses propres fonds.
Si le montant de l'acompte est inférieur au montant de la commission due, le Partenaire en règle le solde dans le même délai. À réception de l'information du devis signé, CELEXIA émet une facture de commission ; le règlement intervient par virement bancaire sur le compte indiqué par CELEXIA.
Tout retard de paiement entraîne de plein droit l'application de pénalités au taux d'intérêt légal majoré, ainsi que l'indemnité forfaitaire pour frais de recouvrement de quarante (40) euros prévue par la loi.

Article 7 – Transparence et suivi des Affaires
Le Partenaire s'engage à déclarer loyalement et exhaustivement les suites données aux Affaires. À la demande de CELEXIA, il justifie de l'état de chaque Affaire transmise (devis, contrat, facture client, acompte). Toute dissimulation d'un Devis signé ou d'un acompte encaissé constitue un manquement grave autorisant la résiliation immédiate du contrat, sans préjudice du paiement des commissions dues et de dommages-intérêts.

Article 8 – Non-contournement
Pendant la durée du contrat et pour une période de {{DUREE_NON_CONTOURNEMENT}} mois suivant la transmission d'une Affaire, le Partenaire s'interdit de traiter, directement ou indirectement (y compris via un tiers, un proche, une autre société ou un sous-traitant), toute Affaire ou tout Client présenté par CELEXIA sans verser la commission prévue à l'Article 5. Tout contournement rend exigible la commission correspondante, majorée d'une indemnité forfaitaire égale à {{PENALITE_CONTOURNEMENT}} % de son montant.

Article 9 – Indépendance des Parties et responsabilité
Les Parties sont des professionnels juridiquement et financièrement indépendants. Le présent contrat ne crée entre elles aucune société, aucun mandat de représentation, aucun lien de subordination ni de franchise.
CELEXIA agit exclusivement en qualité d'intermédiaire. Elle n'est pas partie au contrat de travaux conclu entre le Partenaire et le Client et n'encourt aucune responsabilité au titre de la réalisation, de la qualité, des délais, du prix ou du service après-vente des travaux, qui relèvent de la seule responsabilité du Partenaire.

Article 10 – Qualifications, assurances et garanties
Le Partenaire déclare et garantit être titulaire de l'ensemble des qualifications, agréments et assurances obligatoires pour son activité, notamment, le cas échéant, une assurance de responsabilité civile professionnelle et une assurance de responsabilité décennale en cours de validité. Il s'engage à en justifier à première demande de CELEXIA et à maintenir ces garanties pendant toute la durée du contrat.

Article 11 – Données personnelles (RGPD)
Chaque Partie traite les données personnelles des Clients dans le respect du Règlement (UE) 2016/679 (RGPD) et de la loi « Informatique et Libertés ». Les coordonnées des Clients transmises par CELEXIA ne peuvent être utilisées par le Partenaire qu'aux fins d'exécution de l'Affaire concernée, à l'exclusion de toute prospection non consentie ou de toute cession à un tiers.

Article 12 – Durée, résiliation
Le contrat prend effet à la date de sa signature pour une durée indéterminée. Chaque Partie peut y mettre fin à tout moment, par écrit, moyennant un préavis de {{PREAVIS}} jours.
Les commissions afférentes aux Devis signés avant la fin du contrat, ainsi que les obligations de non-contournement (Article 8) et de paiement, survivent à la résiliation.
En cas de manquement grave (notamment dissimulation d'une Affaire ou d'un acompte, ou contournement), le contrat peut être résilié de plein droit, sans préavis, quinze (15) jours après une mise en demeure restée sans effet.

Article 13 – Confidentialité
Les Parties s'engagent à conserver confidentielles les informations échangées dans le cadre du contrat (Affaires, Clients, conditions commerciales), pendant toute sa durée et deux (2) ans après son terme.

Article 14 – Droit applicable et règlement des litiges
Le présent contrat est régi par le droit français. En cas de différend, les Parties s'efforceront de trouver une solution amiable. À défaut, le litige sera porté devant le Tribunal de commerce de Créteil, dans le ressort du siège social de CELEXIA.

Fait à {{VILLE_SIGNATURE}}, le {{DATE_SIGNATURE}}, en deux exemplaires originaux.

Pour l'Apporteur (CELEXIA)
M. Thomas Aubigeon, Président

Pour le Partenaire ({{SOCIETE_ARTISAN}})
{{REPRESENTANT_ARTISAN}}, {{QUALITE_REPRESENTANT}}
Signature électronique (précédée de la mention « Lu et approuvé ») ci-dessous.`

// Définition des variables éditables (libellé pour le formulaire de génération).
export const VARIABLES_CONTRAT: { cle: string; label: string }[] = [
  { cle: 'SOCIETE_ARTISAN', label: 'Société' },
  { cle: 'FORME_JURIDIQUE', label: 'Forme juridique' },
  { cle: 'CAPITAL_ARTISAN', label: 'Capital (€)' },
  { cle: 'SIREN_ARTISAN', label: 'SIREN' },
  { cle: 'VILLE_IMMATRICULATION', label: "Ville d'immatriculation" },
  { cle: 'ADRESSE_ARTISAN', label: 'Adresse du siège' },
  { cle: 'REPRESENTANT_ARTISAN', label: 'Représentant' },
  { cle: 'QUALITE_REPRESENTANT', label: 'Qualité du représentant' },
  { cle: 'TAUX_COMMISSION', label: 'Taux de commission (%)' },
  { cle: 'DELAI_PAIEMENT', label: 'Délai de paiement (jours)' },
  { cle: 'DUREE_NON_CONTOURNEMENT', label: 'Non-contournement (mois)' },
  { cle: 'PENALITE_CONTOURNEMENT', label: 'Pénalité contournement (%)' },
  { cle: 'PREAVIS', label: 'Préavis de résiliation (jours)' },
  { cle: 'VILLE_SIGNATURE', label: 'Ville de signature' },
]

/** Valeurs par défaut des variables, pré-remplies depuis la fiche artisan. */
export function variablesParDefaut(artisan: Artisan): Record<string, string> {
  const adresse = [artisan.adresse, artisan.code_postal, artisan.ville]
    .filter(Boolean)
    .join(', ')
  return {
    SOCIETE_ARTISAN: artisan.societe ?? '',
    FORME_JURIDIQUE: artisan.forme_juridique ?? '',
    CAPITAL_ARTISAN: artisan.capital_social ?? '',
    SIREN_ARTISAN: artisan.siren ?? '',
    VILLE_IMMATRICULATION: artisan.ville_immatriculation ?? '',
    ADRESSE_ARTISAN: adresse,
    REPRESENTANT_ARTISAN: artisan.representant ?? '',
    QUALITE_REPRESENTANT: artisan.qualite_representant ?? '',
    TAUX_COMMISSION: String(Math.round((artisan.taux_commission ?? 0.1) * 100)),
    DELAI_PAIEMENT: '15',
    DUREE_NON_CONTOURNEMENT: '24',
    PENALITE_CONTOURNEMENT: '30',
    PREAVIS: '30',
    VILLE_SIGNATURE: artisan.ville ?? 'Nogent-sur-Marne',
  }
}

/** Remplace les {{CLE}} présentes dans `vars` ; laisse les autres jetons tels quels. */
export function remplirContrat(modele: string, vars: Record<string, string>): string {
  return modele.replace(/\{\{(\w+)\}\}/g, (m, cle) => (cle in vars ? vars[cle] : m))
}

/** Remplit {{DATE_SIGNATURE}} au moment de l'affichage / du PDF. */
export function finaliserContenu(contenu: string, signedAt: string | null): string {
  return contenu.replace('{{DATE_SIGNATURE}}', signedAt ? formatDate(signedAt) : '____________')
}
