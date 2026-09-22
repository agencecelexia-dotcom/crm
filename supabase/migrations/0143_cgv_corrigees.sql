-- Trois erreurs de droit dans des conditions générales que j'ai écrites.
--
-- CE QUE L'AUDIT A RELEVÉ, ET QUI EST EXACT
--
-- 1. « Des intérêts courent DE PLEIN DROIT, SANS MISE EN DEMEURE préalable. »
--    C'est la règle entre PROFESSIONNELS (art. L441-10 du code de commerce).
--    Face à un consommateur, les intérêts moratoires ne courent qu'à compter
--    de la mise en demeure (art. 1231-6 du code civil). La clause promettait
--    donc à l'artisan un droit qu'il n'a pas.
--
-- 2. « Un acompte est versé à la commande » contredisait l'article 8 du même
--    texte. Pour un contrat conclu HORS ÉTABLISSEMENT — le cas d'un devis
--    signé chez le client, que ces CGV visent explicitement — le
--    professionnel ne peut recevoir AUCUN paiement avant l'expiration d'un
--    délai de sept jours (art. L221-10 du code de la consommation). Encaisser
--    l'acompte le jour de la signature est puni pénalement.
--
-- 3. Le formulaire type de rétractation, que l'article L221-5 impose de
--    remettre au client, n'existait nulle part. Sans lui, le délai de
--    rétractation est prolongé de douze mois (art. L221-20).
--
-- Ces conditions s'appliquent à tout artisan qui ne les a pas remplacées :
-- corriger la fonction les corrige pour tous, sans action de leur part.
--
-- RESTE À FAIRE PAR UN JURISTE
--
-- Ce texte est celui d'un ingénieur, pas d'un avocat. Il est désormais exact
-- sur ces trois points ; il n'est pas pour autant validé.

create or replace function public.cgv_par_defaut()
returns text
language sql
immutable
set search_path to 'pg_temp'
as $function$
select
'1. OBJET ET VALIDITÉ
Le présent devis décrit les travaux convenus entre l''entreprise et le client. Il est valable un mois à compter de sa date d''émission. Passé ce délai, les prix sont susceptibles d''être révisés. Sa signature vaut acceptation pleine et entière des travaux décrits et des présentes conditions.

2. PRIX
Les prix sont exprimés en euros et fermes pour la durée de validité du devis. Ils comprennent la fourniture et la pose des éléments décrits, à l''exclusion de toute prestation non mentionnée. Tout travail supplémentaire demandé en cours de chantier fera l''objet d''un avenant écrit et chiffré, accepté avant exécution.

3. CONDITIONS D''EXÉCUTION
Le client met à disposition les accès, l''eau et l''électricité nécessaires. Il signale toute particularité du support ou toute canalisation enterrée avant le démarrage. La découverte en cours de chantier d''un désordre non visible lors de la visite (support dégradé, amiante, plomb, réseau non signalé) suspend les travaux et donne lieu à un avenant.

4. PAIEMENT
Un acompte est versé à la commande, le solde à la réception des travaux. Toutefois, lorsque le contrat est conclu hors de l''établissement de l''entreprise, aucun paiement ni aucune contrepartie ne peut être reçu du client avant l''expiration d''un délai de sept jours à compter de la conclusion du contrat (article L221-10 du code de la consommation). Aucun escompte n''est accordé pour paiement anticipé. En cas de retard, des intérêts au taux d''intérêt légal en vigueur courent à compter de la mise en demeure adressée au client.

5. DÉLAIS
Les travaux débutent et s''achèvent aux dates convenues avec le client et portées au présent devis ou à sa confirmation de commande. Ces délais sont suspendus par les intempéries rendant le chantier impraticable, par la force majeure, et par tout fait du client faisant obstacle à l''avancement, notamment le défaut d''accès ou une décision attendue de sa part.

6. RÉCEPTION DES TRAVAUX
La réception est prononcée contradictoirement à l''achèvement, avec ou sans réserves. Les réserves éventuelles sont levées dans un délai convenu entre les parties. La prise de possession des lieux sans réserve vaut réception.

7. GARANTIES
Les travaux bénéficient de la garantie de parfait achèvement d''un an, de la garantie de bon fonctionnement de deux ans sur les éléments d''équipement dissociables, et de la garantie décennale sur les ouvrages de construction, dans les conditions des articles 1792 et suivants du code civil.

8. DROIT DE RÉTRACTATION
Lorsque le contrat est conclu hors de l''établissement de l''entreprise, notamment au domicile du client, celui-ci dispose d''un délai de quatorze jours pour se rétracter sans avoir à motiver sa décision ni à supporter de pénalité (article L221-18 du code de la consommation). Le délai court à compter de la conclusion du contrat. Pour l''exercer, le client notifie sa décision par une déclaration dénuée d''ambiguïté, par lettre ou par courrier électronique adressé à l''entreprise, ou au moyen du formulaire reproduit ci-après. Le client qui souhaite que les travaux commencent avant l''expiration de ce délai en fait la demande expresse et par écrit ; il reste alors redevable du coût des prestations déjà exécutées s''il se rétracte ensuite.

9. ASSURANCE
L''entreprise justifie des assurances de responsabilité civile professionnelle et de responsabilité décennale mentionnées au présent devis, pour la nature des travaux et la zone géographique qui y figurent.

10. MÉDIATION ET LITIGES
Conformément à l''article L612-1 du code de la consommation, le client peut recourir gratuitement au médiateur de la consommation dont les coordonnées figurent au présent devis, en vue de la résolution amiable d''un litige. À défaut d''accord, les tribunaux français sont seuls compétents.

11. DONNÉES PERSONNELLES
Les informations recueillies servent exclusivement à l''exécution du présent marché et à la gestion de la relation commerciale. Le client dispose d''un droit d''accès, de rectification et d''effacement en s''adressant à l''entreprise.

FORMULAIRE DE RÉTRACTATION
À compléter et renvoyer uniquement si vous souhaitez vous rétracter du contrat.
À l''attention de l''entreprise dont les coordonnées figurent en tête du présent devis :
Je vous notifie par la présente ma rétractation du contrat portant sur les travaux ci-dessus désignés.
Commandé le : ............................................
Nom du client : ............................................
Adresse du client : ............................................
Signature du client (uniquement en cas de notification sur papier) :
Date : ............................................';
$function$;

revoke execute on function public.cgv_par_defaut() from public;
grant execute on function public.cgv_par_defaut() to anon, authenticated;
