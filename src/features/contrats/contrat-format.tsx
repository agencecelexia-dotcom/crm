import { formatDate } from '@/lib/format'
import { parseContrat } from './contrat-modele'

// Rendu mis en forme d'un contrat (titre, sous-titres, articles en gras,
// paragraphes justifiés, définitions, bloc signatures 2 colonnes).
// Utilisé sur les pages publiques /mission et /signer.
export function ContratFormate({
  contenu,
  signedAt,
  apporteurSignature,
  signatureArtisan,
}: {
  contenu: string
  signedAt?: string | null
  apporteurSignature?: string | null
  signatureArtisan?: string | null
}) {
  const blocs = parseContrat(contenu)
  const dateLabel = signedAt ? `Le ${formatDate(signedAt)}` : null

  return (
    <div className="rounded-lg border border-border bg-white px-5 py-6 text-[13px] leading-relaxed text-foreground">
      {blocs.map((b, i) => {
        switch (b.type) {
          case 'titre':
            return (
              <h2 key={i} className="text-center text-lg font-bold tracking-tight">
                {b.texte}
              </h2>
            )
          case 'soustitre':
            return (
              <p key={i} className="text-center text-xs italic text-muted-foreground">
                {b.texte}
              </p>
            )
          case 'section':
            return (
              <h3 key={i} className="mt-5 mb-1 font-semibold text-foreground">
                {b.texte}
              </h3>
            )
          case 'definition':
            return (
              <p key={i} className="mb-1.5 text-justify">
                <span className="font-semibold">{b.terme}</span> : {b.texte}
              </p>
            )
          case 'paragraphe':
            return (
              <p key={i} className="mb-2 text-justify">
                {b.texte}
              </p>
            )
          case 'signature':
            return (
              <div key={i} className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-4">
                <SignatureCol
                  lignes={b.gauche}
                  image={apporteurSignature}
                  dateLabel={dateLabel}
                />
                <SignatureCol
                  lignes={b.droite}
                  image={signatureArtisan}
                  dateLabel={signatureArtisan ? dateLabel : null}
                  placeholder="À signer ci-dessous"
                />
              </div>
            )
        }
      })}
    </div>
  )
}

function SignatureCol({
  lignes,
  image,
  dateLabel,
  placeholder,
}: {
  lignes: string[]
  image?: string | null
  dateLabel?: string | null
  placeholder?: string
}) {
  return (
    <div className="text-xs">
      {lignes.map((l, i) => (
        <p key={i} className={i === 0 ? 'font-semibold' : 'text-muted-foreground'}>
          {l}
        </p>
      ))}
      {image ? (
        <img src={image} alt="Signature" className="mt-1 h-14 w-auto" />
      ) : placeholder ? (
        <p className="mt-2 italic text-muted-foreground">{placeholder}</p>
      ) : null}
      {dateLabel && <p className="mt-1 text-muted-foreground">{dateLabel}</p>}
    </div>
  )
}
