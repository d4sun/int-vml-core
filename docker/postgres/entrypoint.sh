#!/bin/sh
# Minimal replacement for the official image's entrypoint: first start creates
# the cluster, the user, the development database and runs the scripts in
# /docker-entrypoint-initdb.d. Later starts go straight to the server.
set -eu

BIN=/usr/bin
POSTGRES_USER="${POSTGRES_USER:-vml}"
POSTGRES_DB="${POSTGRES_DB:-vml_dev}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"

if [ "${1:-}" != "postgres" ]; then
  exec "$@"
fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[postgres] initialising cluster in $PGDATA"
  pwfile="$(mktemp)"
  printf '%s' "$POSTGRES_PASSWORD" > "$pwfile"
  "$BIN/initdb" -D "$PGDATA" -U "$POSTGRES_USER" --pwfile="$pwfile" \
    --auth-local=trust --auth-host=scram-sha-256 >/dev/null
  rm -f "$pwfile"
  # Password logins from any address. The port is published on 127.0.0.1 only
  # (compose.yaml); the official image does the same.
  echo "host all all all scram-sha-256" >> "$PGDATA/pg_hba.conf"

  # Start a private server (local only, no TCP) to create the databases.
  "$BIN/pg_ctl" -D "$PGDATA" -o "-c listen_addresses='' -c unix_socket_directories=/tmp" -w start >/dev/null
  "$BIN/psql" -h /tmp -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"$POSTGRES_DB\""

  for script in /docker-entrypoint-initdb.d/*.sql; do
    [ -e "$script" ] || continue
    echo "[postgres] running $script"
    "$BIN/psql" -h /tmp -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -f "$script"
  done

  "$BIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null
  echo "[postgres] initialisation complete"
fi

exec "$BIN/postgres" -D "$PGDATA" -c listen_addresses='*'
