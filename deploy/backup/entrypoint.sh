#!/bin/sh
# Guarda las variables de entorno para que cron (que arranca sin ellas) pueda leerlas.
set -eu
export -p > /etc/backup.env
chmod 600 /etc/backup.env
if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  /usr/local/bin/backup.sh || echo "[backup] el respaldo inicial falló (revisa los mensajes anteriores)"
fi
echo "[backup] cron activo (TZ=${TZ}): respaldo diario 02:00; verificación de restauración el día 1 de cada mes 03:30"
exec crond -f -l 8
