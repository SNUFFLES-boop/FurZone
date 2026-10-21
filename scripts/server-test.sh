#!/usr/bin/env bash
# Starts a throwaway Postgres database and PostgREST with FurZone's schema, then runs test/server.test.mjs.
# Needs: psql access as a superuser (PGHOST/PGUSER/PGPASSWORD), and downloads PostgREST if it isn't on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=furzone_server_test
WORK="$(mktemp -d)"
cleanup() {
    status=$?
    if [ "$status" -ne 0 ] && [ -f "$WORK/pgrst.log" ]; then
        echo "---- PostgREST log ----"
        cat "$WORK/pgrst.log"
    fi
    kill "${PGRST_PID:-0}" 2>/dev/null || true
    rm -rf "$WORK"
    exit "$status"
}
trap cleanup EXIT
echo "server test: using $(psql --version), PostgREST ${PGRST_VERSION:-v12.2.3}"

PGRST="$(command -v postgrest || true)"
if [ -z "$PGRST" ]; then
    curl -sSL -o "$WORK/pgrst.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
    tar -xf "$WORK/pgrst.tar.xz" -C "$WORK"
    PGRST="$WORK/postgrest"
fi

# Supabase's auth and storage schemas, as in test/schema.test.js, plus the API login role.
node -e "
const t = require('fs').readFileSync('test/schema.test.js', 'utf8');
const start = t.indexOf('const SUPABASE_STANDINS = \`') + 27;
let s = t.slice(start, t.indexOf('\`;', start));
s = s.replace(\"current_setting('request.jwt.claim.sub', true)\",
  \"coalesce(current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claims', true)::jsonb->>'sub')\");
s = s.replace(/create role (anon|authenticated) nologin;/g, '');
process.stdout.write(s);
" > "$WORK/standins.sql"

psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d postgres <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'furzone_api') then create role furzone_api login password 'api' noinherit; end if;
end $$;
grant anon, authenticated, service_role to furzone_api;
SQL
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$WORK/standins.sql" -f supabase/schema.sql 2> "$WORK/schema.log" \
    || { grep -v NOTICE "$WORK/schema.log"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111', 'a@example.com', '{"username":"owner1"}'),
 ('22222222-2222-4222-8222-222222222222', 'b@example.com', '{"username":"fur2"}');
insert into public.staff (user_id, role) values ('11111111-1111-4111-8111-111111111111', 'owner');
SQL

export PGRST_JWT_SECRET="local-only-secret-for-the-server-test-0123456789"
export PGRST_URL="http://localhost:3999"
cat > "$WORK/pgrst.conf" <<CONF
db-uri = "postgres://furzone_api:api@${PGHOST:-localhost}:${PGPORT:-5432}/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$PGRST_JWT_SECRET"
server-port = 3999
CONF
"$PGRST" "$WORK/pgrst.conf" > "$WORK/pgrst.log" 2>&1 &
PGRST_PID=$!
for _ in $(seq 1 60); do curl -s -o /dev/null "$PGRST_URL/" && break; sleep 0.5; done
curl -s -o /dev/null "$PGRST_URL/" || { echo "PostgREST didn't start"; exit 1; }
node test/server.test.mjs
