import { ArrowUpRight, Mail, Phone } from 'lucide-react'

import { TEL_APPORTEUR } from '@/lib/constants'
import { formatTel } from '@/lib/format'

/** Les contacts restent directement accessibles, sans ouvrir un formulaire. */
export function PiedDePageArtisan() {
  return (
    <footer className="space-y-6" aria-label="Aide et contacts Celexia">
      <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border p-5"><h2 className="text-base font-medium">Joindre Celexia</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Une question sur un chantier, un document ou votre commission ? Contactez l’agence.</p></div>
          <a href={`tel:${TEL_APPORTEUR}`} className="flex min-h-16 items-center gap-3 border-b border-border px-5 py-4 text-[13px] transition-colors hover:bg-muted/50"><Phone className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden /><span className="flex-1 tabular-nums">{formatTel(TEL_APPORTEUR)}</span><ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden /></a>
          <a href="mailto:agence.celexia@gmail.com" className="flex min-h-16 items-center gap-3 px-5 py-4 text-[13px] transition-colors hover:bg-muted/50"><Mail className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden /><span className="min-w-0 flex-1 break-words">agence.celexia@gmail.com</span><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /></a>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="text-base font-medium">Comment fonctionne votre espace</h2>
          <ol className="mt-5 space-y-5">
            {[
              { titre: 'Recevez un chantier', texte: 'Celexia vous transmet un chantier : vous recevez un lien.' },
              { titre: 'Contactez le client', texte: 'Ouvrez sa fiche pour appeler, noter un échange, fixer un rendez-vous ou programmer votre prochain rappel.' },
              { titre: 'Préparez et suivez le devis', texte: 'Utilisez le générateur ou déposez votre propre PDF dans le chantier. Un brouillon reste à préparer ; un devis envoyé attend la réponse du client.' },
              { titre: 'Confirmez la signature puis la fin des travaux', texte: 'Déposez le devis signé pour justifier le montant retenu. « Devis signé » et « Chantier terminé » correspondent à deux étapes distinctes.' },
              { titre: 'Consultez votre commission', texte: 'Le relevé présente le montant retenu, le taux et les sommes dues ou réglées. Pour une question ou un paiement à rapprocher, contactez Celexia.' },
            ].map((etape, index) => <li key={etape.titre} className="flex gap-4"><span aria-hidden className="mt-0.5 w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}.</span><div><h3 className="text-[13px] font-medium">{etape.titre}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{etape.texte}</p></div></li>)}
          </ol>
          <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">Une note décrit un échange. Une étape indique l’avancement du chantier. Mettez les deux à jour lorsque c’est nécessaire pour que l’agence dispose du bon contexte.</p>
        </section>
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="questions-artisan">
        <div className="border-b border-border px-5 py-4"><h2 id="questions-artisan" className="text-base font-medium">Les repères utiles</h2></div>
        <div className="divide-y divide-border">
          {[
            { question: 'Étape, attente et rappel : quelle différence ?', reponse: 'L’étape décrit ce qui a été réalisé : contact, rendez-vous, devis, signature, travaux terminés. La mise en attente conserve cet avancement. Un rappel indique quand reprendre contact ; il ne confirme pas que le client a répondu.' },
            { question: 'Pourquoi un devis apparaît-il dans « À traiter » ?', reponse: 'Un devis envoyé peut apparaître dans cette liste après 15 jours sans mise à jour du dossier. Ce délai ne prouve pas que le client n’a pas répondu. Notez votre échange, actualisez l’étape ou programmez le prochain rappel.' },
            { question: 'Faut-il créer deux devis pour le même chantier ?', reponse: 'Non. Vous pouvez préparer un devis dans Mes devis ou déposer un PDF réalisé avec votre logiciel. La fiche chantier rassemble les documents et le suivi de cette même affaire. Reprenez un brouillon existant si vous souhaitez simplement le compléter.' },
            { question: 'Comment vérifier un devis avant de l’envoyer ?', reponse: 'Dans le générateur, ouvrez Aperçu pour consulter les pages du PDF, puis revenez à la modification si nécessaire. Télécharger conserve une copie du document. L’aperçu et le téléchargement n’envoient rien au client ; l’envoi reste une action distincte.' },
            { question: 'À quoi servent les métrés ?', reponse: 'Ils aident à préparer les quantités à partir d’une carte, de photos ou d’une estimation automatique. Vérifiez les résultats sur place et renseignez vos corrections avant de chiffrer. Une estimation ne remplace pas une mesure vérifiée.' },
            { question: 'Puis-je reprendre un dessin enregistré ?', reponse: 'Dans les métrés du chantier, ouvrez « Déjà enregistré » puis « Voir sur la carte ». Vous pouvez renommer et modifier les points de vos dessins manuels de surface ou de longueur. Enregistrer remplace ce dessin ; les quantités confirmées sur place restent distinctes.' },
            { question: 'Pourquoi la création de devis est-elle indisponible ?', reponse: 'Consultez Mon entreprise : le contrat doit être signé, les assurances à jour et leur validation effectuée par Celexia. Une erreur de connexion est indiquée séparément et peut être réessayée.' },
            { question: 'Que faire d’un chantier que je ne poursuis plus ?', reponse: 'Si le client ne donne pas suite, indiquez « Perdu », choisissez un motif et précisez le contexte. Si vous ne pouvez pas prendre le chantier, utilisez le retrait avec son motif. Le dossier reste consultable dans les chantiers perdus. La reprise est proposée lorsqu’il est encore disponible.' },
          ].map(({ question, reponse }) => <details key={question} className="group px-5"><summary className="min-h-14 cursor-pointer py-4 text-sm font-medium marker:text-muted-foreground">{question}</summary><p className="max-w-4xl pb-5 pl-4 text-sm leading-6 text-muted-foreground">{reponse}</p></details>)}
        </div>
      </section>
      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">Celexia — mise en relation client ↔ artisan. Vos coordonnées et celles de vos clients ne sont utilisées que pour le suivi de vos chantiers.</p>
    </footer>
  )
}
