#!/usr/bin/env python3
"""Applique UNE migration SQL sur la base de production, dans une transaction.

    source scripts/ops-env.sh && python3 scripts/appliquer-migration.py supabase/migrations/0200_xxx.sql

Passe par l'API Management de Supabase (SUPABASE_SBP_TOKEN). Le fichier est
exécuté entre `begin;` et `commit;` : une erreur annule tout. Ne fait rien
d'autre — aucune vérification préalable des fonctions remplacées : la faire
avant (comparaison prod / dépôt).
"""
import json, os, sys, urllib.request, urllib.error

if len(sys.argv) != 2 or not sys.argv[1].startswith('supabase/migrations/') or not sys.argv[1].endswith('.sql'):
    sys.exit("Usage : python3 scripts/appliquer-migration.py supabase/migrations/<fichier>.sql")
REF = os.environ.get('SUPABASE_PROJECT_REF')
TOKEN = os.environ.get('SUPABASE_SBP_TOKEN')
if not REF or not TOKEN:
    sys.exit("Secrets absents : lancer d'abord `source scripts/ops-env.sh`.")

sql = open(sys.argv[1], encoding='utf-8').read()
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{REF}/database/query",
    data=json.dumps({"query": "begin;\n" + sql + "\ncommit;"}).encode(),
    headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "crm-ops"},
)
try:
    urllib.request.urlopen(req, timeout=60).read()
except urllib.error.HTTPError as e:
    sys.exit(f"❌ Échec ({e.code}) — rien n'a été appliqué :\n{e.read().decode()[:1500]}")
print(f"✅ Migration appliquée : {os.path.basename(sys.argv[1])}")
