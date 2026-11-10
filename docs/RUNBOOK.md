# RUNBOOK — Despliegue, operación y recuperación

> Este manual lo ejecutas tú: el código no despliega por sí solo. Cada comando usa valores de ejemplo
> (`<REGION>`, `<ACCOUNT_ID>`, dominios) que debes reemplazar. Verifica nombres de planes y precios vigentes
> de Render/AWS antes de aplicar.

## 1. Qué se despliega

| Pieza | Qué es |
|---|---|
| **api** | Imagen del `Dockerfile` de la raíz (Node 20, usuario sin privilegios, solo producción). Con `RUN_MIGRATIONS=true` aplica migraciones al arrancar. |
| **PostgreSQL 16** | Contenedor (staging) o servicio administrado (RDS / Render pago). |
| **S3** | Bucket **privado** de archivos (fotos, PDF de certificados, autorizaciones de menores). |
| **backup** | Imagen de `deploy/backup`: `pg_dump` diario a un segundo bucket S3, con verificación. |
| **Correo** | SMTP real (Amazon SES, etc.). Mailpit y MinIO son solo para desarrollo. |

Los archivos ya **no** se guardan en disco local (el disco de ECS/Render es efímero): todo va a S3.

## 2. Variables de entorno

Plantillas: `.env.example` (desarrollo) y `.env.staging.example` (staging). Obligatorias: `DATABASE_URL`, `JWT_SECRET`,
`CERT_HMAC_SECRET` (distinto del anterior), `FRONTEND_URL`, `CORS_ORIGIN` (producción), `SMTP_HOST`, `MAIL_FROM`, `S3_BUCKET`, `S3_REGION`.
La API **no arranca** con secretos de menos de 32 caracteres o con valores de ejemplo. Genera secretos con `openssl rand -hex 48`.
En AWS no pongas `S3_ACCESS_KEY/S3_SECRET_KEY`: la tarea usa su **rol IAM**.

## 3. Staging en un servidor propio (Docker Compose + HTTPS)

```bash
cp .env.staging.example .env.staging          # completa todo
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build
docker compose --env-file .env.staging -f docker-compose.staging.yml logs -f api   # debe decir "migraciones aplicadas"
# primer administrador (la clave no queda guardada en ningún archivo)
docker compose --env-file .env.staging -f docker-compose.staging.yml exec \
  -e ADMIN_SEED_EMAIL=admin@tudominio.com -e ADMIN_SEED_PASSWORD='UnaClaveLarga2026' api node dist/seed.js
curl https://api-staging.tudominio.com/api/v1/health
```
Requisitos: DNS del dominio apuntando al servidor y puertos 80/443 abiertos (Caddy emite el certificado solo).

## 4. Render

1. Sube el repositorio a GitHub/GitLab. En Render: **New > Blueprint** y elige el repo (usa `render.yaml`).
2. Completa las variables marcadas `sync: false` (`FRONTEND_URL`, SMTP, S3, bucket de respaldos…).
3. Usa un plan de **pago** para la base de datos: la gratuita se elimina a los 30 días y no tiene respaldos.
4. Primer deploy: la API aplica las migraciones sola. Crea el admin con **Shell** del servicio:
   `ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... node dist/seed.js`.
5. El cron `centro-actoral-backup` corre a las 02:00 de Colombia (07:00 UTC).

## 5. AWS ECS Fargate (producción)

```bash
export R=<REGION> A=<ACCOUNT_ID>
# 1) Repositorios de imágenes
aws ecr create-repository --repository-name centro-actoral-api    --region $R
aws ecr create-repository --repository-name centro-actoral-backup --region $R
aws ecr get-login-password --region $R | docker login --username AWS --password-stdin $A.dkr.ecr.$R.amazonaws.com
docker build -t $A.dkr.ecr.$R.amazonaws.com/centro-actoral-api:latest . && docker push $A.dkr.ecr.$R.amazonaws.com/centro-actoral-api:latest
docker build -t $A.dkr.ecr.$R.amazonaws.com/centro-actoral-backup:latest deploy/backup && docker push $A.dkr.ecr.$R.amazonaws.com/centro-actoral-backup:latest

# 2) Buckets PRIVADOS (archivos y respaldos)
for B in centro-actoral-prod-media centro-actoral-prod-backups; do
  aws s3api create-bucket --bucket $B --region $R $( [ "$R" != us-east-1 ] && echo "--create-bucket-configuration LocationConstraint=$R" )
  aws s3api put-public-access-block --bucket $B --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-versioning --bucket $B --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket $B --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
done
aws s3api put-bucket-lifecycle-configuration --bucket centro-actoral-prod-backups --lifecycle-configuration file://deploy/backup/s3-lifecycle.json

# 3) Secretos (nunca en el repositorio)
aws secretsmanager create-secret --name centro-actoral/JWT_SECRET        --secret-string "$(openssl rand -hex 48)"
aws secretsmanager create-secret --name centro-actoral/CERT_HMAC_SECRET  --secret-string "$(openssl rand -hex 48)"
aws secretsmanager create-secret --name centro-actoral/DATABASE_URL      --secret-string 'postgresql://centroactoral:<CLAVE>@<ENDPOINT_RDS>:5432/dbcentroactoral'
# ... SMTP_USER, SMTP_PASS, DB_PASSWORD, BACKUP_HEARTBEAT_URL (ver deploy/ecs/task-definition.json)

# 4) Base de datos: RDS PostgreSQL 16 privado, cifrado, con respaldos automáticos y protección contra borrado
aws rds create-db-instance --db-instance-identifier centro-actoral-db --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.small --allocated-storage 20 --storage-encrypted --no-publicly-accessible \
  --backup-retention-period 14 --deletion-protection --master-username centroactoral --master-user-password '<CLAVE>' \
  --db-name dbcentroactoral --vpc-security-group-ids <SG_DB> --db-subnet-group-name <SUBNET_GROUP>   # + --multi-az en producción

# 5) Roles IAM: ejecución (ECR, logs, secretos), tarea de la API (deploy/ecs/iam-task-policy.json) y tarea de respaldo (iam-backup-policy.json)
# 6) Logs, clúster y servicio
aws logs create-log-group --log-group-name /ecs/centro-actoral-api --region $R
aws logs create-log-group --log-group-name /ecs/centro-actoral-backup --region $R
aws ecs create-cluster --cluster-name centro-actoral
aws ecs register-task-definition --cli-input-json file://deploy/ecs/task-definition.json
aws ecs create-service --cluster centro-actoral --service-name centro-actoral-api --task-definition centro-actoral-api \
  --desired-count 2 --launch-type FARGATE --health-check-grace-period-seconds 90 \
  --network-configuration "awsvpcConfiguration={subnets=[<SUBNETS_PRIVADAS>],securityGroups=[<SG_API>],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=<TG_ARN>,containerName=api,containerPort=3000"
# ALB con certificado ACM (HTTPS), health check del target group: /api/v1/health

# 7) Primer administrador (tarea de una sola vez; la clave solo vive en este comando)
aws ecs run-task --cluster centro-actoral --task-definition centro-actoral-api --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<SUBNET>],securityGroups=[<SG_API>]}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/seed.js"],"environment":[{"name":"ADMIN_SEED_EMAIL","value":"admin@tudominio.com"},{"name":"ADMIN_SEED_PASSWORD","value":"<CLAVE_LARGA>"}]}]}'

# 8) Respaldo diario 02:00 Colombia (07:00 UTC) con EventBridge
aws ecs register-task-definition --cli-input-json file://deploy/ecs/backup-task-definition.json
aws events put-rule --name centro-actoral-backup-diario --schedule-expression "cron(0 7 * * ? *)"
aws events put-targets --rule centro-actoral-backup-diario --targets file://<destino-ecs>.json   # apunta a la tarea centro-actoral-backup
```
El flujo `.github/workflows/ci.yml` automatiza prueba → imagen → despliegue (`DEPLOY_ECS=true` en las variables del repositorio, rol OIDC en `AWS_ROLE_ARN`).
Con varias réplicas, el *rate limit* de la API es **por réplica** (en memoria); para un límite global habría que añadir Redis.

## 6. Migraciones

- Se aplican solas con `RUN_MIGRATIONS=true` (lock entre réplicas, una transacción por archivo, checksum para detectar archivos editados).
- Manual: `node dist/db/migrate.js`. Reconoce bases creadas con `docker-entrypoint-initdb.d` y las "adopta" sin repetir nada.
- Nunca edites una migración ya aplicada: crea `007_...sql`.
- Antes de migrar producción: **respaldo manual** (`docker compose run --rm backup /usr/local/bin/backup.sh`, o snapshot de RDS).

## 7. Respaldos y restauración (RNF-12)

| | Objetivo |
|---|---|
| **RPO** (datos que podrías perder) | ≤ 24 h con el `pg_dump` diario; ≤ 5 min si usas la restauración a un punto en el tiempo de RDS |
| **RTO** (tiempo para volver) | ≈ 1 h (estimado; confírmalo con una prueba real) |
| **Retención** | Diarios 30 días, mensuales 12 meses (regla de ciclo de vida del bucket) |
| **Verificación** | Cada respaldo se valida (`pg_restore --list`, tamaño, SHA-256). El día 1 de cada mes se restaura el último en una base temporal (`restore-check.sh`) |
| **Alerta** | Si defines `BACKUP_HEARTBEAT_URL` (healthchecks.io), te avisa si un respaldo falla **o no se ejecuta** |

**Restaurar (staging con Docker Compose):**
```bash
C="docker compose --env-file .env.staging -f docker-compose.staging.yml"
$C run --rm backup aws s3 ls s3://<BUCKET>/postgres/ --recursive | tail            # elige el respaldo
$C run --rm backup /usr/local/bin/restore.sh s3://<BUCKET>/postgres/2026/10/dbcentroactoral-20261005-020000.dump dbcentroactoral_restaurada
$C exec postgres psql -U <USUARIO> -d dbcentroactoral_restaurada -c "SELECT count(*) FROM actores;"   # verifica
$C stop api
$C exec postgres psql -U <USUARIO> -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='dbcentroactoral';"
$C exec postgres psql -U <USUARIO> -d postgres -c "ALTER DATABASE dbcentroactoral RENAME TO dbcentroactoral_antigua; ALTER DATABASE dbcentroactoral_restaurada RENAME TO dbcentroactoral;"
$C start api            # conserva la base antigua unos días antes de borrarla
```
**RDS:** `aws rds restore-db-instance-to-point-in-time ...` crea una instancia nueva; cambia `DATABASE_URL` y despliega.
**Archivos (S3):** el versionado del bucket permite recuperar objetos borrados o sobrescritos; para desastres de región, activa replicación entre regiones.

## 8. Reversa (rollback)

1. Imagen anterior: ECS → `update-service --task-definition centro-actoral-api:<revisión anterior>`; Render → *Rollback*; Compose → `docker compose ... up -d` con la etiqueta anterior.
2. Si la migración nueva fue el problema: restaura el respaldo previo al despliegue (sección 7). Las migraciones no tienen "bajada" automática.

## 9. Lista de verificación antes de producción

- [ ] Secretos de 48+ caracteres distintos entre sí; ninguno en el repositorio ni en el historial de git.
- [ ] `SWAGGER_ENABLED=false`, `CORS_ORIGIN` con el dominio real, HTTPS en el balanceador, `TRUST_PROXY=true`.
- [ ] Buckets privados con acceso público bloqueado, versionado y cifrado; IAM de mínimo privilegio.
- [ ] Base de datos privada (sin IP pública), cifrada, con respaldos y protección contra borrado.
- [ ] Un respaldo restaurado con éxito al menos una vez (`restore-check.sh`) y alerta de latido activa.
- [ ] Certificado `.p12` de una entidad acreditada si el Centro necesita firma con validez legal (`CERT_P12_BASE64`).
- [ ] Política de tratamiento de datos (Ley 1581 de 2012) revisada por quien asesora legalmente al Centro.
- [ ] Logo en `api/assets/logo.png`, nombre del firmante y cargo configurados.

## 10. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| La API no arranca: "Configuración inválida" | Falta una variable o un secreto es débil; el mensaje dice cuál |
| `La migración 00X ya se aplicó y su contenido cambió` | Se editó un `.sql` aplicado; restaura el original y crea una migración nueva |
| Las URLs de archivos no abren en el navegador | `S3_PUBLIC_ENDPOINT` incorrecto (solo MinIO) o URL vencida (`SIGNED_URL_TTL`) |
| `403 AccessDenied` al subir | El rol de la tarea no tiene `s3:PutObject` sobre el bucket |
| El respaldo falla con "version mismatch" | La imagen de respaldo debe usar la misma versión mayor de PostgreSQL que la base (16) |
