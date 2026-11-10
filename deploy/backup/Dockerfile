# Respaldos automáticos de PostgreSQL -> S3. Usa la misma versión mayor que la base (16).
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli tzdata
ENV TZ=America/Bogota
COPY backup.sh restore.sh restore-check.sh entrypoint.sh /usr/local/bin/
COPY crontab /etc/crontabs/root
RUN chmod +x /usr/local/bin/*.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
