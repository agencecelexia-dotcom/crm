// PostgreSQL WASM en mémoire : toutes les migrations métier sont exécutées.
// Seuls les services Supabase (auth/storage), cron et les appels HTTP sont
// remplacés par des stubs sans réseau. Aucun secret ni projet distant utilisé.
// La fonction de trigger historique notif_projet_assigne, référencée en 0064
// mais absente des migrations précédentes, est simulée ici uniquement.
// Les fonctions pgcrypto utilisées dans ce banc ne servent qu'aux fixtures.
import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../..', import.meta.url))
const db=new PGlite()
await db.exec(`
create role anon; create role authenticated; create role service_role;
create function public.notif_projet_assigne() returns trigger language plpgsql as $$ begin return new; end $$;
create schema auth; create schema storage; create schema extensions; create schema net; create schema cron;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'service_role') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table storage.buckets(id text primary key,name text,public boolean default false, file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
create function storage.extension(name text) returns text language sql immutable as $$ select (string_to_array(name,'.'))[array_length(string_to_array(name,'.'),1)] $$;
create function public.gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(left(repeat(md5(random()::text),ceil(n/16.0)::int),n*2),'hex') $$;
create function public.digest(t text, algo text) returns bytea language sql immutable as $$ select sha256(convert_to(t,'UTF8')) $$;
create function public.digest(t bytea, algo text) returns bytea language sql immutable as $$ select sha256(t) $$;
create function extensions.digest(t text, algo text) returns bytea language sql immutable as $$ select public.digest(t,algo) $$;
create function extensions.digest(t bytea, algo text) returns bytea language sql immutable as $$ select public.digest(t,algo) $$;
create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$ select public.gen_random_bytes(n) $$;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint language sql as $$ select 1::bigint $$;
create table net._http_response(id bigint,status_code integer,content text,timed_out boolean,error_msg text,created timestamptz default now());
create table cron.job(jobid bigint,jobname text,active boolean,schedule text,command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ select 1::bigint $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ select true $$;
create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null) returns void language sql as $$ select $$;
`)
const files=(await readdir(root+'/supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()
let count=0
for(const f of files){
 let sql=await readFile(root+'/supabase/migrations/'+f,'utf8')
 sql=sql.replace(/create extension if not exists (?:pg_net|pg_cron|pgcrypto)(?: with schema extensions)?\s*;/gi,'')
 try {await db.exec(sql); count++}
 catch(e){console.error('Échec migration',f,e.message,e.where ?? '');await db.close();process.exit(1)}
}
console.log('Migrations chargées',count,'/',files.length)
const tests=(await readdir(root+'/supabase/tests')).filter(f=>/^artisan_.*_audit\.sql$/.test(f)).sort()
for(const f of tests){
 try { await db.exec(await readFile(root+'/supabase/tests/'+f,'utf8')); console.log('OK',f) }
 catch(e){ console.error('Échec SQL',f,e.message,e.where ?? '');await db.close();process.exit(1) }
}
if(tests.length===0){ console.error('Aucun scénario SQL artisan trouvé');await db.close();process.exit(1) }
console.log(tests.length,'suites SQL réussies (PostgreSQL local, aucun réseau)')
await db.close()
