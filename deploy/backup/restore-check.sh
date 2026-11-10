#!/bin/sh
# Prueba mensual: restaura el ÚLTIMO respaldo en una base temporal y comprueba que tiene datos legibles.
# Un respaldo que nunca se probó no es un respaldo.
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env
: "${BACKUP_S3_BUCKET:?}"
PREFIJO="${BACKUP_S3_PREFIX:-postgres}"
BASE="restore_check_$(date +%s)"
OK=0

aviso() { u="${BACKUP_CHECK_HEARTBEAT_URL:-}"; [ -n "$u" ] && wget -q -T 10 -O /dev/null "${u}$1" || true; }
al_salir() {
  dropdb --maintenance-db=postgres --if-exists "$BASE" 2>/dev/null || true
  if [ "$OK" -ne 1 ]; then echo "[restore-check] ERROR: la restauración de prueba falló" >&2; aviso /fail; fi
}
trap al_salir EXIT

ULTIMO="$(aws s3 ls "s3://${BACKUP_S3_BUCKET}/${PREFIJO}/" --recursive | grep '\.dump$' | sort | tail -n 1 | awk '{print $4}')"
[ -n "$ULTIMO" ] || { echo "[restore-check] no hay respaldos en s3://${BACKUP_S3_BUCKET}/${PREFIJO}/" >&2; exit 1; }
echo "[restore-check] probando s3://${BACKUP_S3_BUCKET}/${ULTIMO}"

/usr/local/bin/restore.sh "s3://${BACKUP_S3_BUCKET}/${ULTIMO}" "$BASE"
ACTORES="$(psql --dbname="$BASE" -tAc 'SELECT count(*) FROM actores')"
ADMINS="$(psql --dbname="$BASE" -tAc 'SELECT count(*) FROM administradores')"
echo "[restore-check] OK: ${ACTORES} actores, ${ADMINS} administradores en el respaldo"
OK=1
aviso ""
