#!/bin/sh
# Restaura un respaldo en una base NUEVA (nunca sobrescribe la actual).
# Uso: restore.sh s3://bucket/postgres/2026/10/dbcentroactoral-20261005-020000.dump [nombre_base_destino]
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env
ORIGEN="${1:?Indica la ruta s3:// del respaldo}"
DESTINO="${2:-${PGDATABASE:?}_restaurada}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

aws s3 cp "$ORIGEN" "$TMP/respaldo.dump" --only-show-errors
if aws s3 cp "${ORIGEN}.sha256" "$TMP/respaldo.sha256" --only-show-errors 2>/dev/null; then
  ( cd "$TMP" && echo "$(cut -d' ' -f1 respaldo.sha256)  respaldo.dump" | sha256sum -c - )   # integridad
fi

echo "[restore] creando la base ${DESTINO}"
createdb --maintenance-db=postgres "$DESTINO"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DESTINO" "$TMP/respaldo.dump"
echo "[restore] listo: base '${DESTINO}'."
echo "          Para reemplazar la de producción: detén la API, renombra la actual y renombra '${DESTINO}' (ver docs/RUNBOOK.md)."
