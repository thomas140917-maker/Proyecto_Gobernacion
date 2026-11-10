#!/bin/sh
# Respaldo lógico de PostgreSQL -> S3. Falla con código != 0 ante cualquier error (no deja pasar un respaldo malo).
# Variables: PGHOST PGUSER PGPASSWORD PGDATABASE BACKUP_S3_BUCKET [BACKUP_S3_PREFIX] [BACKUP_HEARTBEAT_URL] [BACKUP_SSE]
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env
: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}" "${BACKUP_S3_BUCKET:?}"

PREFIJO="${BACKUP_S3_PREFIX:-postgres}"
SELLO="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
ARCHIVO="$TMP/${PGDATABASE}-${SELLO}.dump"
SSE_ARG=""
[ "${BACKUP_SSE:-AES256}" != "none" ] && SSE_ARG="--sse ${BACKUP_SSE:-AES256}"
OK=0

# Aviso a un monitor externo (healthchecks.io): éxito = URL; fallo = URL/fail. Si no llega nada, también alerta.
aviso() { [ -n "${BACKUP_HEARTBEAT_URL:-}" ] && wget -q -T 10 -O /dev/null "${BACKUP_HEARTBEAT_URL}$1" || true; }
al_salir() {
  rm -rf "$TMP"
  if [ "$OK" -ne 1 ]; then echo "[backup] ERROR: el respaldo falló" >&2; aviso /fail; fi
}
trap al_salir EXIT

echo "[backup] inicio ${SELLO} (${PGDATABASE}@${PGHOST})"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$ARCHIVO"

pg_restore --list "$ARCHIVO" > /dev/null          # el archivo se puede leer
TAMANO="$(wc -c < "$ARCHIVO")"
if [ "$TAMANO" -lt 2048 ]; then echo "[backup] archivo sospechosamente pequeño (${TAMANO} bytes)" >&2; exit 1; fi
( cd "$TMP" && sha256sum "$(basename "$ARCHIVO")" > "$(basename "$ARCHIVO").sha256" )

DEST="s3://${BACKUP_S3_BUCKET}/${PREFIJO}/$(date +%Y/%m)"
aws s3 cp "$ARCHIVO" "$DEST/" --only-show-errors $SSE_ARG
aws s3 cp "$ARCHIVO.sha256" "$DEST/" --only-show-errors $SSE_ARG

# Día 1 de cada mes: copia con retención larga (la regla de ciclo de vida de ${PREFIJO}-mensual/ la conserva 12 meses)
if [ "$(date +%d)" = "01" ]; then
  aws s3 cp "$ARCHIVO" "s3://${BACKUP_S3_BUCKET}/${PREFIJO}-mensual/" --only-show-errors $SSE_ARG
  aws s3 cp "$ARCHIVO.sha256" "s3://${BACKUP_S3_BUCKET}/${PREFIJO}-mensual/" --only-show-errors $SSE_ARG
fi

OK=1
aviso ""
echo "[backup] OK ${DEST}/$(basename "$ARCHIVO") (${TAMANO} bytes)"
