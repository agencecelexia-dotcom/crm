-- 0017 — « Fait à … » = ville de l'artisan (signataire) dans la fonction de secours
create or replace function public.ensure_engagement_contrat(p_artisan_id uuid)
returns public.contrats
language plpgsql
security definer
set search_path = public
as $func$
declare
  a public.artisans;
  c public.contrats;
  v_contenu text;
  v_sig text;
begin
  select * into a from public.artisans where id = p_artisan_id;
  if a.id is null then
    return null;
  end if;

  select * into c
  from public.contrats
  where artisan_id = p_artisan_id
  order by created_at asc
  limit 1;

  if c.id is not null then
    return c;
  end if;

  select valeur into v_sig from public.app_settings where cle = 'apporteur_signature';

  v_contenu := $ctr$CONTRAT D’APPORT D’AFFAIRES
Mise en relation et apport d’affaires
La clientèle apportée demeure la clientèle propre de CELEXIA — simple mise en relation, sans cession
Entre les soussignés
La société CELEXIA, société par actions simplifiée unipersonnelle (SASU) au capital social de 1 000 euros, immatriculée au Registre du Commerce et des Sociétés de Créteil sous le numéro 939 306 429, identifiée à la TVA sous le numéro FR41 939 306 429, dont le siège social est situé 27 bis rue François Rolland, 94130 Nogent-sur-Marne, représentée par M. Thomas Aubigeon, en sa qualité de Président,
Ci-après dénommée « l’Apporteur » ou « CELEXIA », d’une part,
Et
La société $ctr$
    || coalesce(a.societe,'')
    || $ctr$, $ctr$
    || coalesce(a.forme_juridique,'')
    || $ctr$, au capital de $ctr$
    || coalesce(a.capital_social,'')
    || $ctr$ euros, immatriculée au RCS / Répertoire des Métiers de $ctr$
    || coalesce(a.ville_immatriculation,'')
    || $ctr$ sous le numéro SIREN $ctr$
    || coalesce(a.siren,'')
    || $ctr$, dont le siège social est situé $ctr$
    || concat_ws(', ', a.adresse, a.code_postal, a.ville)
    || $ctr$, représentée par $ctr$
    || coalesce(a.representant,'')
    || $ctr$, en sa qualité de $ctr$
    || coalesce(a.qualite_representant,'')
    || $ctr$, dûment habilité(e),
Ci-après dénommée « le Partenaire » ou « l’Artisan », d’autre part,
Ci-après désignées ensemble « les Parties » et individuellement « une Partie ».
Préambule
CELEXIA exerce une activité d’apport d’affaires et de mise en relation. Elle conçoit, finance et déploie à ses frais des actions de communication et de publicité (notamment des campagnes Google Local Services Ads) destinées à identifier des particuliers ou professionnels (les « Clients ») ayant un projet de travaux. CELEXIA reçoit et qualifie elle-même l’ensemble des demandes entrantes.
Les Clients ainsi identifiés et qualifiés constituent la clientèle propre de CELEXIA. Par le présent contrat, CELEXIA met cette clientèle en relation avec le Partenaire en vue de la réalisation des travaux.
Il importe de distinguer la mise en relation de toute cession de clientèle. CELEXIA ne cède, ne vend ni ne transfère sa clientèle au Partenaire : elle conserve la pleine propriété et la maîtrise de sa clientèle et se borne à présenter le Client au Partenaire pour la seule réalisation de l’Affaire concernée. Le Partenaire reconnaît n’accéder au Client que par l’intermédiaire de CELEXIA et pour les besoins de cette Affaire.
Le Partenaire est un professionnel du bâtiment disposant des compétences, qualifications, autorisations et assurances requises pour réaliser les prestations relevant de son corps de métier.
CELEXIA n’exécute aucun travaux et n’intervient pas dans la relation contractuelle entre le Partenaire et le Client. Son rôle se limite strictement à la mise en relation. Les Parties sont des professionnels indépendants.
C’est dans ce cadre qu’elles sont convenues de ce qui suit.
Article 1 – Objet du contrat
Le présent contrat a pour objet de définir les conditions dans lesquelles CELEXIA transmet au Partenaire des opportunités d’affaires (les « Affaires ») correspondant à son métier et à sa zone d’intervention, ainsi que la rémunération due à CELEXIA en contrepartie de cet apport.
La transmission d’une Affaire s’analyse en une mise en relation : CELEXIA présente au Partenaire un Client issu de sa propre clientèle, sans lui en céder ni transférer la propriété. Le présent contrat ne constitue ni une cession de clientèle, ni un mandat, ni une exclusivité au profit du Partenaire.
Il est conclu pour l’ensemble des Affaires, présentes et futures : signé une seule fois, il demeure valable pour tous les projets que CELEXIA transmettra ultérieurement au Partenaire, sans qu’une nouvelle signature soit nécessaire.
Article 2 – Définitions
Affaire / Lead : toute demande d’un Client transmise par CELEXIA au Partenaire, comprenant à minima l’identité du Client, ses coordonnées et la nature du projet.
Client : le particulier ou professionnel à l’origine de la demande de travaux, identifié et qualifié par CELEXIA et relevant de sa clientèle propre, mis en relation avec le Partenaire par CELEXIA.
Mise en relation : la présentation par CELEXIA, au Partenaire, d’un Client issu de sa clientèle propre, en vue de la réalisation d’une Affaire ; elle n’emporte aucune cession, vente ni transfert de clientèle.
Devis signé : tout devis, bon de commande ou marché accepté par le Client et émanant du Partenaire (ou de toute entité qui lui est liée), portant sur une Affaire transmise par CELEXIA.
Acompte : toute somme versée par le Client au Partenaire à la signature du devis ou avant le démarrage des travaux.
Montant TTC : le montant toutes taxes comprises (TTC) total du Devis signé, avenants et travaux complémentaires inclus.
Article 3 – Obligations de CELEXIA
Transmettre au Partenaire, avec diligence, les Affaires correspondant à son métier et à sa zone géographique d’intervention.
Communiquer au Partenaire les informations utiles en sa possession sur le projet du Client (nature, localisation, coordonnées).
Agir loyalement et n’effectuer aucune déclaration trompeuse auprès des Clients quant à son rôle de simple intermédiaire.
CELEXIA est tenue d’une obligation de moyens. Elle ne garantit ni un volume d’Affaires, ni la conclusion effective d’un contrat entre le Partenaire et le Client.
Article 4 – Obligations du Partenaire
Contacter le Client dans les meilleurs délais, et en tout état de cause sous 48 heures ouvrées suivant la transmission de l’Affaire.
Établir un devis, réaliser les travaux et facturer le Client en son nom propre, sous sa seule responsabilité.
Informer CELEXIA, sans délai, de la suite donnée à chaque Affaire (sans suite, devis envoyé, devis signé) et transmettre une copie du devis signé ainsi que son montant et le montant de l’acompte encaissé.
Exécuter les travaux dans les règles de l’art, conformément à la réglementation applicable et aux engagements pris envers le Client.
Disposer, pendant toute la durée du contrat, des qualifications, autorisations et assurances nécessaires (cf. Article 10).
Article 5 – Rémunération de l’Apporteur
En contrepartie de l’apport d’Affaires, le Partenaire verse à CELEXIA une commission égale à 10 % du Montant TTC (toutes taxes comprises) de chaque Devis signé issu d’une Affaire transmise par CELEXIA.
La commission est due dès la signature du devis par le Client. En cas d’avenant ou de travaux complémentaires sur la même Affaire, la commission s’applique également au montant additionnel.
Article 6 – Paiement de la commission sur l’acompte
La commission est payable par le Partenaire dès l’encaissement de l’acompte versé par le Client à la signature du devis, et au plus tard dans un délai de 15 jours suivant cet encaissement.
Le Partenaire règle ainsi la commission par prélèvement sur l’acompte client, de sorte qu’il n’avance aucune somme sur ses propres fonds. Si le montant de l’acompte est inférieur au montant de la commission due, le Partenaire en règle le solde dans le même délai.
À réception de l’information du devis signé, CELEXIA émet une facture de commission ; le règlement intervient par virement bancaire sur le compte indiqué par CELEXIA.
Tout retard de paiement entraîne de plein droit l’application de pénalités au taux d’intérêt légal majoré, ainsi que l’indemnité forfaitaire pour frais de recouvrement de quarante (40) euros prévue par la loi.
Article 7 – Transparence et suivi des Affaires
Le Partenaire s’engage à déclarer loyalement et exhaustivement les suites données aux Affaires. À la demande de CELEXIA, il justifie de l’état de chaque Affaire transmise (devis, contrat, facture client, acompte).
Toute dissimulation d’un Devis signé ou d’un acompte encaissé constitue un manquement grave autorisant la résiliation immédiate du contrat, sans préjudice du paiement des commissions dues et de dommages-intérêts.
Article 8 – Non-contournement
Le Client présenté relevant de la clientèle propre de CELEXIA, le Partenaire reconnaît n’y accéder que par l’intermédiaire de CELEXIA. En conséquence, pendant la durée du contrat et pour une période de 24 mois suivant la transmission d’une Affaire, le Partenaire s’interdit de traiter, directement ou indirectement (y compris via un tiers, un proche, une autre société ou un sous-traitant), toute Affaire ou tout Client présenté par CELEXIA sans verser la commission prévue à l’Article 5.
Tout contournement rend exigible la commission correspondante, majorée d’une indemnité forfaitaire égale à 30 % de son montant.
Article 9 – Indépendance des Parties et responsabilité
Les Parties sont des professionnels juridiquement et financièrement indépendants. Le présent contrat ne crée entre elles aucune société, aucun mandat de représentation, aucun lien de subordination ni de franchise.
CELEXIA agit exclusivement en qualité d’intermédiaire. Elle n’est pas partie au contrat de travaux conclu entre le Partenaire et le Client et n’encourt aucune responsabilité au titre de la réalisation, de la qualité, des délais, du prix ou du service après-vente des travaux, qui relèvent de la seule responsabilité du Partenaire.
Article 10 – Qualifications, assurances et garanties
Le Partenaire déclare et garantit être titulaire de l’ensemble des qualifications, agréments et assurances obligatoires pour son activité, notamment, le cas échéant, une assurance de responsabilité civile professionnelle et une assurance de responsabilité décennale en cours de validité. Il s’engage à en justifier à première demande de CELEXIA et à maintenir ces garanties pendant toute la durée du contrat.
Article 11 – Données personnelles (RGPD)
Chaque Partie traite les données personnelles des Clients dans le respect du Règlement (UE) 2016/679 (RGPD) et de la loi « Informatique et Libertés ». Les coordonnées des Clients transmises par CELEXIA ne peuvent être utilisées par le Partenaire qu’aux fins d’exécution de l’Affaire concernée, à l’exclusion de toute prospection non consentie ou de toute cession à un tiers.
Article 12 – Durée, résiliation
Le contrat prend effet à la date de sa signature pour une durée indéterminée. Chaque Partie peut y mettre fin à tout moment, par écrit, moyennant un préavis de 30 jours.
Les commissions afférentes aux Devis signés avant la fin du contrat, ainsi que les obligations de non-contournement (Article 8) et de paiement, survivent à la résiliation.
En cas de manquement grave (notamment dissimulation d’une Affaire ou d’un acompte, ou contournement), le contrat peut être résilié de plein droit, sans préavis, quinze (15) jours après une mise en demeure restée sans effet.
Article 13 – Confidentialité
Les Parties s’engagent à conserver confidentielles les informations échangées dans le cadre du contrat (Affaires, Clients, conditions commerciales), pendant toute sa durée et deux (2) ans après son terme.
Article 14 – Droit applicable et règlement des litiges
Le présent contrat est régi par le droit français. En cas de différend, les Parties s’efforceront de trouver une solution amiable. À défaut, le litige sera porté devant le Tribunal de commerce de Créteil, dans le ressort du siège social de CELEXIA.
Fait à $ctr$
    || coalesce(a.ville,'')
    || $ctr$, le {{DATE_SIGNATURE}}, en deux exemplaires originaux.
Les signatures ci-dessous, précédées de la mention « Lu et approuvé », valent consentement plein et entier des Parties, conformément à l’article 1367 du Code civil.
Pour l’Apporteur (CELEXIA)	Pour le Partenaire ($ctr$
    || coalesce(a.societe,'')
    || $ctr$)
M. Thomas Aubigeon, Président	$ctr$
    || coalesce(a.representant,'')
    || $ctr$, $ctr$
    || coalesce(a.qualite_representant,'')
    || $ctr$
Signature :	Signature (« Lu et approuvé ») :$ctr$;

  insert into public.contrats (artisan_id, contenu, apporteur_signature)
  values (p_artisan_id, v_contenu, v_sig)
  returning * into c;

  return c;
end;
$func$;

grant execute on function public.ensure_engagement_contrat(uuid) to authenticated;
