#!/usr/bin/env python3
"""Déploie le Code node du workflow n8n (emails CRM Celexia).

Lit la clé et les paramètres depuis l'environnement (charge d'abord les secrets) :
    source scripts/ops-env.sh && python3 scripts/deploy-n8n.py

Met à jour le node Code (celui qui contient 'envoyer_lien_mission') avec le
contenu de n8n/crm-celexia-events.code.js, puis PUT le workflow.
"""
import os, json, sys, urllib.request, urllib.error

KEY = os.environ.get('N8N_API_KEY') or os.environ.get('N8N_KEY')
if not KEY:
    sys.exit("N8N_API_KEY manquant — complète .env.secrets.local puis: source scripts/ops-env.sh")
BASE = os.environ.get('N8N_API_BASE', 'https://n8n.srv1241880.hstgr.cloud/api/v1')
WID = os.environ.get('N8N_WORKFLOW_ID', 'PkhPQia4Ci2wwsCn')
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CODE = open(os.path.join(HERE, 'n8n', 'crm-celexia-events.code.js')).read()


def req(method, path, body=None):
    r = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json'},
        method=method)
    try:
        return json.loads(urllib.request.urlopen(r).read().decode())
    except urllib.error.HTTPError as e:
        sys.exit("HTTP %s — %s" % (e.code, e.read().decode()[:900]))


wf = req('GET', '/workflows/' + WID)
node = next((n for n in wf['nodes']
             if 'envoyer_lien_mission' in n.get('parameters', {}).get('jsCode', '')), None)
if not node:
    sys.exit("Code node introuvable dans le workflow " + WID)
node['parameters']['jsCode'] = CODE
payload = {'name': wf['name'], 'nodes': wf['nodes'],
           'connections': wf['connections'], 'settings': wf.get('settings', {})}
res = req('PUT', '/workflows/' + WID, payload)
print("✅ Déployé — workflow:", res.get('name'), "| updatedAt:", res.get('updatedAt'))
print("Branches à jour : projet_assigne, relance_contrat, relance_inaction (+ encadré projet).")
