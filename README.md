# Centro Actoral de Boyacá — Sitio web unido (frontend + backend)

Este proyecto es el **backend original (NestJS + Prisma + PostgreSQL + S3/MinIO) sin cambios de funcionalidad**, al que se le sumó el
**sitio web** (carpeta `public/`) y una capa `api/web/` que lo conecta. Todo corre en **un solo puerto (3000)**.

## Qué se agregó (y qué no se tocó)

| Qué | Dónde | Nota |
|---|---|---|
| Sitio web (HTML/JS/CSS) | `public/` | Adaptado a los catálogos, estados y reglas del backend |
| Rutas del sitio `/api/*` | `api/web/` | JavaScript plano; usa **la misma BD, el mismo JWT y las mismas reglas** que `/api/v1` |
| Montaje | `api/src/main.ts` (3 líneas) | `require('../web').montar(...)` antes de helmet; no toca `/api/v1` ni `/api/docs` |
| Migración `000_adaptar_base_anterior.sql` | `db/migrations/` | No hace nada en una base nueva; adapta una base del proyecto anterior |
| Migración `007_frontend.sql` | `db/migrations/` | Solo **agrega** columnas/tablas (ocupación, nivel, idiomas, formación, reportes, noticias, imágenes…) |
| Dependencias | `api/package.json` | `express`, `multer`, `jsonwebtoken` (los demás ya estaban) |
| Dockerfile / compose / `.env.example` | raíz | Copian `web/` y `public/`; `FRONTEND_URL`/`CORS_ORIGIN` ahora apuntan a `:3000` |

Los servicios, DTOs, controladores, `schema.prisma`, migraciones 001–006, el runner de migraciones y Swagger **no se modificaron**.

## Cómo correrlo (base nueva)

```bash
cp .env.example .env            # cambia contraseñas y JWT_SECRET (openssl rand -hex 48)
docker compose up -d --build
# el primer administrador se crea solo al arrancar la API con ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD de .env (no hay que correr seed)
```

Abre **http://localhost:3000** (sitio), http://localhost:3000/api/docs (Swagger), http://localhost:8025 (correos), http://localhost:9001 (MinIO).
Inicio de sesión de actor y administrador: botón de cuenta (arriba a la derecha) → *Iniciar sesión*.

**Desde el celular** (misma red Wi‑Fi): en `.env` pon `CORS_ORIGIN=http://localhost:3000,http://TU_IP:3000` y `S3_PUBLIC_ENDPOINT=http://TU_IP:9000`
(las fotos se piden a MinIO), reinicia con `docker compose up -d` y abre `http://TU_IP:3000`. Cambia también `ports` de `api` y `minio` de
`127.0.0.1:` a `0.0.0.0:` si quieres que escuchen fuera de tu PC.

## Cómo conservar tu base de datos anterior

1. **Antes de borrar el Docker viejo**, saca una copia:
   `docker exec <contenedor_postgres_viejo> pg_dump -U <usuario> <base> > respaldo.sql`
   (y copia la carpeta `uploads/` del proyecto anterior junto a este `docker-compose.yml`).
2. `cp .env.example .env` y `docker compose up -d postgres` (crea una base nueva con el esquema del backend).
3. Reemplaza esa base por tu respaldo:
   ```bash
   docker compose exec postgres psql -U $POSTGRES_USER -d postgres -c "DROP DATABASE $POSTGRES_DB" -c "CREATE DATABASE $POSTGRES_DB"
   docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < respaldo.sql
   ```
4. En `.env` pon `RUN_MIGRATIONS=true` y levanta todo: `docker compose up -d --build`.
   El runner **adopta** tu base (marca 001 como aplicada), ejecuta `000` (adapta tablas viejas) y luego 002–007 (agregan lo del backend y convierten los datos).
5. Tus usuarios entran con la contraseña de siempre: el hash viejo se **actualiza al esquema nuevo en el primer ingreso**.
   El administrador del proyecto anterior sigue siendo el mismo.

Qué se convierte: géneros/colores a códigos del backend, estados de convocatorias (`ACTIVA/EN_PAUSA/CERRADA`), cursos (`ABIERTO/FINALIZADO…`), postulaciones
(`POSTULADO…SELECCIONADO/RECHAZADO`), videos subidos → siguen visibles (`/uploads/…`, solo lectura); los nuevos videos se publican como enlaces de YouTube/Vimeo.
Las fotos antiguas se ven mientras exista la carpeta `uploads/`; las nuevas van a MinIO/S3.

## Reglas que ahora aplica el sitio (vienen del backend)

- Contraseña de **8+ caracteres con letras y números**; 5 intentos fallidos bloquean la cuenta 15 minutos.
- Foto de perfil, biografía y demás **características pasan por aprobación**: lo público no cambia hasta que un administrador apruebe; el rechazo exige motivo (20+ caracteres).
- **Vitrina pública**: solo perfiles aprobados, de mayores de edad, con autorización expresa; muestra nombre artístico o primer nombre y **edad aparente** (nunca edad real ni contacto).
- Menores de edad: acudiente y autorización firmada obligatorios; un administrador debe **verificar al acudiente** antes de aprobar. El documento nunca es público.
- Cursos: cupos, **lista de espera** automática, cancelación y estados por fechas. Convocatorias: requisitos del perfil buscado y compatibilidad calculada.

## Correos: verificación de cuenta y recuperar contraseña

| Qué | Cómo |
|---|---|
| Al registrarse | El actor recibe un correo con un enlace `FRONTEND_URL/verificar.html#token=...` (válido 48 h, un solo uso). La cuenta funciona sin verificar; en «Mi perfil» aparece un aviso con «Reenviar verificación». |
| «¿Olvidaste tu contraseña?» | `recuperar.html` → correo con enlace a `restablecer.html#token=...` (30 min, un solo uso) → el usuario escribe la nueva contraseña. Sirve para actores **y** administradores. |
| Seguridad | Respuesta siempre igual (no revela si el correo existe), token aleatorio de 256 bits guardado solo como hash SHA-256, consumo atómico, límite de solicitudes por IP, el token viaja en el fragmento `#` (no queda en logs) y se borra de la barra del navegador. Al restablecer se desbloquea la cuenta y se invalidan sesiones de administrador anteriores; se envía aviso de «contraseña cambiada». |
| Endpoints | `POST /api/olvide-contrasena`, `POST /api/restablecer-contrasena`, `POST /api/verificar-correo`, `POST /api/reenviar-verificacion` (actor autenticado). |
| Base de datos | Migración `008_correo_acceso.sql` (tabla `tokens_correo`, columna `actores.correo_verificado_en`). Los actores que ya existían quedan como verificados. |
| Ver los correos en desarrollo | Con Docker: **Mailpit** en http://localhost:8025. Sin SMTP configurado, el enlace se escribe en el log del servidor. |
| Producción | Define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` y `FRONTEND_URL` (con la URL pública real: los enlaces se arman con ella). |

## Qué se probó y qué no

Probado en el entorno de desarrollo (PostgreSQL 16 real): migraciones (base nueva, base del proyecto anterior, doble ejecución), más de 50 pruebas de extremo a extremo de la capa `api/web/`
(registro, login, versiones de perfil, vitrina, cursos con lista de espera, convocatorias, auditoría, base anterior) y un recorrido en navegador de todas las pantallas
(registro de 5 pasos, aprobación, edición, creación de cursos/convocatorias, postulación).

**No se pudo probar aquí** (sin acceso a npm/Docker en el entorno): el arranque de NestJS con el montaje en `main.ts`, `docker compose up --build`, subida real a MinIO/S3, `sharp`, `helmet`,
`express/multer/bcrypt` reales (se probaron equivalentes) y el **envío SMTP real** (con `nodemailer`/Mailpit): los flujos de verificación y recuperación se probaron de punta a punta con el enlace escrito en el log. Si algo falla al construir la imagen, revisa primero `docker compose logs api`.

---

# Centro Actoral de Boyacá — Backend (Semanas 1 a 4)

**Rama:** `feature/P2_BE_Semana1_DDL_Auth_RegistroActor`
**Alcance:** RF-01, RF-02, RF-05, RF-18, RF-19, RF-20 (recuperación), RNF-01, RNF-04.

## Stack

| Capa | Tecnología |
|---|---|
| API | NestJS 10 + TypeScript |
| ORM | Prisma 5 (mapea la BD existente; **el SQL es la fuente de verdad**) |
| BD | PostgreSQL 16 |
| Auth | JWT (8 h) + bcrypt (cost 12) |
| Correo | Nodemailer (Mailpit en desarrollo) |
| Docs | Swagger en `/api/docs` |

## Arranque rápido (Docker)

Requisitos: Docker Desktop (o Docker Engine + Compose v2).

```bash
cp .env.example .env          # edita contraseñas y JWT_SECRET
docker compose up -d --build
docker compose exec api node dist/seed.js   # crea el primer admin (clave de 12+ caracteres)
```

| Servicio | URL |
|---|---|
| API | http://localhost:3000/api/v1 |
| Swagger | http://localhost:3000/api/docs |
| pgAdmin | http://localhost:5050 |
| Mailpit (correos) | http://localhost:8025 |
| MinIO (consola S3, solo desarrollo) | http://localhost:9001 |
| PostgreSQL (desde tu PC) | `localhost:5433` |

### Conectar pgAdmin

- **Dentro de Docker** (pgAdmin en `:5050`): *Register → Server* con host `postgres`, puerto `5432`, usuario/clave del `.env`, BD `dbcentroactoral`.
- **pgAdmin instalado en tu PC:** host `localhost`, puerto `5433`.

### Base de datos

Las migraciones de `db/migrations/` se ejecutan solas en orden (`001`, `002`) **solo la primera vez** que se crea el volumen. Para reiniciar desde cero:

```bash
docker compose down -v && docker compose up -d --build
```

Si prefieres usar tu base `postgres` actual (la de las 7 tablas viejas), ejecuta en este orden en pgAdmin: `db/legacy_cleanup.sql` (**borra datos**), `001_schema.sql`, `002_ajustes_s1.sql`, y apunta `DATABASE_URL` a esa BD.

| Migración | Contenido |
|---|---|
| `001_schema.sql` | Script original + enums `estado_convocatoria_enum`, `estado_postulacion_enum`, `tipo_multimedia_enum` |
| `003_seguridad.sql` | Bloqueo por intentos fallidos, invalidación de sesiones, CHECKs de integridad, UNIQUE de postulación, índices en FK |
| `002_ajustes_s1.sql` | UNIQUE en `actores.numero_documento`, `actores.correo`, `administradores.correo`; defaults; rasgos físicos en `perfiles_actores`; tabla `tokens_recuperacion` |

## Endpoints

### `POST /api/v1/auth/admin/login`
```json
{ "correo": "admin@centroactoral.com", "contrasena": "Cambia1234" }
```
→ `200 { "access_token": "...", "token_type": "Bearer", "expires_in": 28800, "admin": {...} }`
Claims: `sub`, `correo`, `nombre`, `rol: "ADMIN"`, `iss`, `aud`, `iat`, `exp` (8 h), firmado con HS256.
Límite: 5 intentos/min por IP **y** bloqueo de la cuenta 15 min tras 5 contraseñas incorrectas seguidas.

### `GET /api/v1/auth/admin/me`
Requiere `Authorization: Bearer <token>`. Devuelve el admin de la sesión (el frontend lo usa para validar el token al cargar).

### `GET /api/v1/health`
Comprueba API + conexión a BD (lo usa el healthcheck de Docker).

### `POST /api/v1/auth/admin/recover-password`
```json
{ "correo": "admin@centroactoral.com" }
```
Responde siempre lo mismo (no revela si el correo existe). Envía un enlace con token de un solo uso, válido 30 min (en desarrollo se ve en Mailpit). El enlace lleva el token en el fragmento: `FRONTEND_URL/admin/reset-password#token=...` (el frontend debe leerlo de `location.hash`). En BD solo se guarda el hash SHA-256.

### `POST /api/v1/auth/admin/reset-password`
```json
{ "token": "<64 caracteres del enlace>", "nueva_contrasena": "NuevaClaveSegura123" }
```

### `POST /api/v1/actores/registro-publico` (multipart, sin login)

```bash
curl -X POST http://localhost:3000/api/v1/actores/registro-publico \
  -F correo=ana@correo.com -F contrasena=Segura1234 \
  -F nombre_completo="Ana Pérez" -F tipo_documento=CC -F numero_documento=1052000111 \
  -F fecha_nacimiento=1998-05-20 -F municipio=Tunja -F ciudad=Tunja -F telefono=3101234567 \
  -F acepta_terminos=true -F tiene_experiencia=false \
  -F estatura_cm=165 -F color_ojos=Café \
  -F foto_perfil=@foto.jpg
```

Para un **menor de 18** hay que enviar además `nombre_acudiente`, `documento_acudiente`, `telefono_acudiente`, `correo_acudiente` y el archivo `documento_autorizacion`; si falta algo → `400` con `campos_faltantes`.

| Código | Caso |
|---|---|
| 201 | Creado: `actores` + `perfiles_actores` (`estado = PENDIENTE`) [+ `acudientes_legales`] + registro en `historial_auditoria` (todo en una transacción) |
| 400 | Validación, menor sin acudiente/autorización, archivo no permitido |
| 409 | `numero_documento` o `correo` ya inscritos |

Archivos: foto (jpg/png/webp) y autorización (pdf/jpg/png), máx. 5 MB. Se guardan en `UPLOAD_DIR` con nombre aleatorio y en la BD queda la ruta relativa. Si la petición falla, los archivos subidos se borran.

## Decisiones a tener en cuenta

- `actores.contrasena_hash` es `NOT NULL` en el esquema, por eso el registro público pide `contrasena` (se guarda con bcrypt). No se inicia sesión de actor en esta semana.
- `PENDIENTE_REVISION` del plan se implementa como `PENDIENTE` (valor del enum existente).
- Los archivos de autorización **no se sirven estáticamente** (son datos sensibles); su descarga se expondrá en una semana posterior detrás de `JwtAuthGuard`.
- `JwtAuthGuard` ya está disponible (`src/auth/jwt-auth.guard.ts`) para proteger los endpoints de admin de las próximas semanas.
- Fechas: la BD usa `timestamp` sin zona; el contenedor corre en UTC.

## Estructura

```
.
├── docker-compose.yml
├── .env.example
├── db/
│   ├── migrations/001_schema.sql, 002_ajustes_s1.sql
│   └── legacy_cleanup.sql
└── api/
    ├── Dockerfile
    ├── prisma/schema.prisma
    └── src/
        ├── auth/       login, recover-password, reset-password, JwtAuthGuard
        ├── actores/    registro-publico (DTO, upload, servicio, limpieza de archivos)
        ├── mail/  prisma/  seed.ts  main.ts
```

## Flujo de ramas

```bash
git checkout -b feature/P2_BE_Semana1_DDL_Auth_RegistroActor
git add . && git commit -m "feat(s1): DDL, auth admin y registro público de actores"
git push -u origin feature/P2_BE_Semana1_DDL_Auth_RegistroActor
# Abrir Pull Request hacia develop
```

## Desarrollo sin Docker para la API

```bash
cd api && npm install && npx prisma generate
# DATABASE_URL apuntando a localhost:5433 y demás variables del .env exportadas
npm run start:dev
```

## Seguridad (v2)

| Área | Medida |
|---|---|
| Contraseñas | bcrypt (cost 12) con pre-hash SHA-256: sin truncado a 72 bytes. Admins: mínimo 12 caracteres |
| Login | Comparación bcrypt siempre (también si el usuario no existe), mensaje único, bloqueo de cuenta tras 5 fallos, rate-limit por IP |
| JWT | HS256 fijado, `iss`/`aud` verificados; el guard comprueba en BD que el admin siga activo y que no haya cambiado la contraseña después de emitir el token |
| Recuperación | Respuesta inmediata e idéntica exista o no el correo; token de 256 bits (solo se guarda su hash), un solo uso atómico, 30 min; al restablecer se invalidan sesiones y se audita |
| Archivos | Límite de tamaño/campos, whitelist de tipos, **verificación de magic bytes**, nombre aleatorio, borrado si la petición falla, no se sirven estáticamente |
| Entradas | Normalización (trim, sin caracteres de control, correo en minúsculas, documento sin puntos/espacios), `whitelist` + `forbidNonWhitelisted` |
| Configuración | La API no arranca sin `JWT_SECRET` fuerte (≥32) ni con el valor de ejemplo; CORS cerrado por defecto; Swagger apagable; helmet con CSP cuando Swagger está desactivado |
| Docker | Puertos solo en `127.0.0.1`, variables obligatorias con `:?`, API con sistema de archivos de solo lectura, `cap_drop: ALL`, `no-new-privileges`, healthcheck |
| BD | CHECKs (correo en minúsculas, términos aceptados, fecha de nacimiento no futura, cupos > 0), UNIQUE de postulación, índices en FK |

### Pruebas
```bash
cd api && npm install && npm test
```

### Pendiente recomendado (no incluido)
- CAPTCHA (Turnstile/reCAPTCHA) en `registro-publico` contra bots.
- Generar y versionar `package-lock.json` (`npm install` en `api/`) y cambiar el Dockerfile a `npm ci`.
- HTTPS y reverse proxy en producción (con `TRUST_PROXY=true`).
- Copias de seguridad de Postgres y del volumen `uploads`.
- Si ya habías levantado la v1, recrea la BD (`docker compose down -v`): las migraciones corren solo con volumen vacío y el hash de contraseñas cambió (pre-hash).

---

# Semana 2 — Staging de perfiles, multimedia y moderación

**Rama:** `feature/P2_BE_Semana2_Staging_Multimedia_Engine`
**Alcance:** RF-03, RF-04, RF-06, RNF-03, RNF-04, RNF-13.

> Si ya tenías la BD de la Semana 1: `docker compose down -v` y vuelve a levantar (las migraciones corren solo con volumen vacío),
> o ejecuta `db/migrations/004_semana2.sql` a mano. Añade al `.env` las variables `S3_*` de `.env.example` y reconstruye (`--build`).

## Migración `004_semana2.sql`

| Cambio | Detalle |
|---|---|
| `tipo_accion_auditoria_enum` | + `ACCION_ADMINISTRADOR`; `historial_auditoria.detalle jsonb` guarda qué se hizo (aprobar/rechazar, versión, campos) |
| `tipo_multimedia_enum` | `FOTO_PERFIL`, `FOTO_BOOK`, `REEL_PRESENTACION`, `ENLACE_PORTAFOLIO`, `DOCUMENTO` |
| `archivos_multimedia` | + `almacenamiento` (`S3`/`EXTERNO`), `url_miniatura`, `mime_type`, `tamano_bytes`, `ancho`, `alto`, `proveedor_video`, `id_video`; enlace único por actor |
| `perfiles_versiones` | Doble estado: `datos` (jsonb) + `estado` `PENDIENTE`/`APROBADA`/`RECHAZADA`/`HISTORICA`. Índices únicos parciales: máx. 1 pendiente y 1 vigente por actor |
| `actores` | + `intentos_fallidos`, `bloqueado_hasta` (login de actor) |

## Cómo funciona el doble estado

- `perfiles_actores` = **versión pública vigente**. Cada envío de perfil crea una fila en `perfiles_versiones`.
- El registro público (Semana 1) ya crea la versión 1 en `PENDIENTE`.
- **Aprobar** (una transacción): la versión vigente pasa a `HISTORICA`, la pendiente a `APROBADA`, se copian los datos a `perfiles_actores` y se audita.
- **Rechazar**: la versión pasa a `RECHAZADA` con la justificación. Si el actor ya tenía versión pública, su perfil sigue `APROBADO` (solo se rechazó el borrador); si no, el perfil queda `RECHAZADO`.
- Un **menor** solo se aprueba si su acudiente está verificado.
- Dos admins resolviendo a la vez: gana uno, el otro recibe `409`.
- `{id}` en las rutas de perfiles = `actor_id`.
- Límite actual: hasta que el actor pueda editar su perfil (siguiente semana), el diff compara la versión 1 contra "vacío".

## Endpoints de moderación (requieren `Authorization: Bearer <token de admin>`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/admin/perfiles/pendientes?page=1&limit=20` | Versiones en revisión (más antiguas primero), con `es_menor_de_edad` y `acudiente_verificado` |
| GET | `/api/v1/admin/perfiles/{id}/diff` | Borrador vs. versión pública: cada campo trae `publicado`, `borrador`, `cambiado` |
| PUT | `/api/v1/admin/perfiles/{id}/aprobar` | Body opcional `{"version_id":"..."}` (si cambió → 409) |
| PUT | `/api/v1/admin/perfiles/{id}/rechazar` | Body `{"motivo":"... (20–1000 caracteres)"}` |
| GET | `/api/v1/admin/acudientes/pendientes` | Acudientes sin verificar |
| PUT | `/api/v1/admin/acudientes/{id}/verificar` | Marca al acudiente como verificado |
| GET | `/api/v1/admin/acudientes/{id}/documento` | Descarga la autorización (queda registrada la consulta) |

Cada acción escribe en `historial_auditoria` con `tipo_accion = ACCION_ADMINISTRADOR` y el detalle en `detalle`.

## Multimedia

### Login de actor
`POST /api/v1/auth/actor/login` `{ "correo": "...", "contrasena": "..." }` → JWT con rol `ACTOR` (4 h, audiencia distinta a la del admin).
Un actor solo puede gestionar **su propio** `{id}`; un admin puede gestionar cualquiera.

### `POST /api/v1/actores/{id}/multimedia` (multipart, requiere token)

| `tipo` | Qué envías | Reglas |
|---|---|---|
| `FOTO_PERFIL` | `archivo` (jpg/png/webp) | Una sola: la nueva reemplaza a la anterior |
| `FOTO_BOOK` | `archivo` (jpg/png/webp) | Máx. 10 |
| `REEL_PRESENTACION` | `url` | Enlace https de YouTube/Vimeo. Máx. 3 |
| `ENLACE_PORTAFOLIO` | `url` | Enlace https de YouTube/Vimeo. Máx. 5 |
| `DOCUMENTO` | `archivo` (pdf, máx. 5 MB) | Máx. 5 |

```bash
TOKEN=...   # de /auth/actor/login
curl -X POST http://localhost:3000/api/v1/actores/$ACTOR_ID/multimedia \
  -H "Authorization: Bearer $TOKEN" -F tipo=FOTO_BOOK -F titulo="Retrato" -F archivo=@foto.jpg

curl -X POST http://localhost:3000/api/v1/actores/$ACTOR_ID/multimedia \
  -H "Authorization: Bearer $TOKEN" -F tipo=REEL_PRESENTACION -F url="https://youtu.be/dQw4w9WgXcQ"
```

Además: `GET /actores/{id}/multimedia?tipo=` (lista con URLs firmadas) y `DELETE /actores/{id}/multimedia/{multimediaId}`.

### Seguridad y procesamiento de archivos
- Se valida el MIME declarado **y** los magic bytes; después Sharp decodifica la imagen (si está dañada → 422).
- Sharp: corrige la orientación, **elimina EXIF/GPS**, limita a 2048 px, convierte a **WebP optimizado** y genera **miniatura 400×400**. Rechaza imágenes de más de 40 megapíxeles.
- Máx. 3 imágenes procesándose a la vez, 20 en cola; después responde `503` (RNF de resiliencia).
- Si falla la subida o el guardado en BD, se borran los objetos ya subidos (sin huérfanos). El cupo se garantiza con un lock por actor.
- Bucket **privado**: la API entrega URLs firmadas que vencen en `SIGNED_URL_TTL` segundos (por defecto 900).
- Enlaces: solo `https`, host exacto de YouTube/Vimeo (no sirve `youtube.com.evil.com`), sin credenciales, ID de video validado y guardado en forma canónica.
- Cada alta/baja queda en `historial_auditoria`.

### AWS S3 en producción
Deja `S3_ENDPOINT` y `S3_PUBLIC_ENDPOINT` vacíos, `S3_FORCE_PATH_STYLE=false`, `S3_AUTO_CREATE_BUCKET=false`, crea el bucket **con acceso público bloqueado** y usa un usuario IAM con permisos solo de `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` sobre ese bucket.
Para Cloudinary habría que implementar otra versión de `StorageService` con la misma interfaz.

## Notas
- La foto enviada en el **registro público** (Semana 1) sigue guardándose en disco local y forma parte del snapshot del perfil; las fotos del book/perfil gestionadas aquí van a S3.
- No hay FFmpeg: los reels son enlaces, no archivos de video.
- Los documentos PDF se guardan tal cual (no se sanitizan); se sirven con `Content-Disposition: attachment`.
- RNF-03, RNF-04 y RNF-13: el plan no incluye su texto; las medidas de arriba (límites, resiliencia, auditoría, privacidad) son lo que se implementó. Si tienen metas medibles, ajusto los valores.

## Pruebas
```bash
cd api && npm install && npm test   # fechas, contraseñas, enlaces de video, diff de perfiles
```

## Flujo de ramas (Semana 2)
```bash
git checkout -b feature/P2_BE_Semana2_Staging_Multimedia_Engine
git add . && git commit -m "feat(s2): staging de perfiles, multimedia S3+Sharp y panel de moderación"
git push -u origin feature/P2_BE_Semana2_Staging_Multimedia_Engine
```

---

# Semana 3 — Convocatorias, casting inteligente, Kanban y vitrina pública

**Rama:** `feature/P2_BE_Semana3_Casting_Kanban_Search`
**Alcance:** RF-07, RF-08, RF-09, RF-10, RF-11, RF-15 (el texto de RF-15 no estaba en el plan: ver "Notas").

> Con la BD de semanas anteriores: `docker compose down -v` y reconstruir (`--build`), o ejecutar `db/migrations/005_semana3.sql`.
> Nueva dependencia: `@nestjs/schedule` (se instala con el build).

## Migración `005_semana3.sql`

| Cambio | Detalle |
|---|---|
| Enums del plan | `estado_convocatoria_enum` = `PROXIMA, ACTIVA, EN_PAUSA, CERRADA`; `estado_postulacion_enum` = `POSTULADO, EN_REVISION, PRESELECCIONADO, SELECCIONADO, RECHAZADO` |
| `perfiles_actores` | + `genero`, `edad_aparente_min/max`, `dialecto`, `provincia` (van en las versiones: pasan por moderación) y `autoriza_vitrina_publica` (**no** se versiona: efecto inmediato) |
| `convocatorias` | + `fecha_apertura`, edad aparente, estatura, `generos`, `tonos_piel`, `colores_ojos`, `colores_cabello`, `dialectos`, `provincias`, `municipios`, `solo_mayores_de_edad`. `cupo_maximo` = **vacantes** |
| `convocatorias_habilidades` | Destrezas requeridas (`obligatoria` true/false) |
| `postulaciones_castings` | + `compatibilidad` (0-100), `detalle_compatibilidad`, `notas_admin`, `revisado_por_admin_id`, `actualizado_en`. **Llave única `convocatoria_id + actor_id`** (`uq_postulacion_unica`, desde la migración 003) |
| `habilidades` | Catálogo inicial de 27 destrezas |
| Índices | Parcial para la vitrina (`APROBADO` + autorizado), por provincia, destreza, kanban y estado de convocatoria |

Las listas controladas (género, tono de piel, ojos, cabello, dialecto, provincia, modalidad) están en **`api/src/common/catalogos.ts`**: para ajustarlas edita solo ese archivo.

## Convocatorias

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/api/v1/convocatorias` | Admin | Crea el casting. Con `fecha_apertura` futura queda `PROXIMA`; sin fecha (o pasada), `ACTIVA` |
| PUT | `/api/v1/convocatorias/{id}` | Admin | Edita parámetros (no si está `CERRADA`; el cupo no puede bajar de los ya seleccionados) |
| PATCH | `/api/v1/convocatorias/{id}/estado` | Admin | `{"estado":"EN_PAUSA","motivo":"..."}` |
| GET | `/api/v1/convocatorias` | Público | Solo `ACTIVA` y `PROXIMA`. Con token de admin: todas y `?estado=` |
| GET | `/api/v1/convocatorias/{id}` | Público | Una convocatoria no visible responde 404 al público |

Transiciones: `PROXIMA → ACTIVA`, `ACTIVA ⇄ EN_PAUSA`, cualquiera → `CERRADA` (final). Una tarea programada (cada minuto) abre las `PROXIMA` cuya `fecha_apertura` llegó y cierra las vencidas; queda en auditoría.
Fechas: envíalas en ISO 8601 **con zona horaria** (ej. `2026-11-01T08:00:00-05:00`).

### Requisitos duros vs. blandos
- **Duros (bloquean con 422 y lista de motivos):** género, edad aparente, estatura, solo mayores de edad, destrezas con `obligatoria: true`.
- **Blandos (solo suman a la compatibilidad 0-100):** tono de piel, ojos, cabello, dialecto, ubicación (provincia **o** municipio), destrezas deseables.
- Pesos: género 15, edad 20, estatura 15, destrezas obligatorias 25, tono/ojos/cabello/dialecto 5 c/u, ubicación 10, destrezas deseables 15. Solo cuentan los criterios que la convocatoria define.

## Postulaciones

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/api/v1/postulaciones` | Actor | `{"convocatoria_id":"..."}`. El actor sale del token |
| GET | `/api/v1/postulaciones/mias` | Actor | Sus postulaciones (sin notas internas) |
| DELETE | `/api/v1/postulaciones/{id}` | Actor | Retiro (solo en `POSTULADO` / `EN_REVISION`) |
| PATCH | `/api/v1/postulaciones/{id}/estado` | Admin | `{"estado":"PRESELECCIONADO","estado_anterior":"EN_REVISION","notas":"..."}` |

Reglas al postularse: convocatoria `ACTIVA` y no vencida (409), perfil `APROBADO` (403), menor solo con acudiente verificado (403), requisitos duros (422), **una sola postulación por convocatoria y actor (409)**, garantizado por la llave única incluso con peticiones en paralelo.
Reglas del Kanban: transiciones válidas (no se salta a `SELECCIONADO` sin pasar por `PRESELECCIONADO`), `RECHAZADO` exige `notas` (mín. 10 caracteres), no se superan las vacantes, `estado_anterior` evita mover una tarjeta desactualizada (409), todo con lock por convocatoria y auditoría.

## Casting (admin)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/convocatorias/{id}/kanban` | Una columna por estado, tarjetas ordenadas por compatibilidad, totales y vacantes libres (máx. 500 tarjetas) |
| GET | `/api/v1/convocatorias/{id}/candidatos-sugeridos?min_compatibilidad=60` | Actores aprobados que cumplen los requisitos duros, rankeados por compatibilidad, con `ya_postulado` |

Los candidatos incluyen a actores que no autorizaron la vitrina pública (es una herramienta interna del Centro) y a menores solo si la convocatoria los admite y su acudiente está verificado.

## Vitrina pública (sin login)

`GET /api/v1/vitrina/actores` — filtros combinables:

| Parámetro | Ejemplo |
|---|---|
| `estatura_min`, `estatura_max` | `160`, `175` |
| `tono_piel`, `dialecto`, `genero`, `provincia` | códigos de `/vitrina/filtros` |
| `municipio` | `Tunja` (sin distinguir mayúsculas) |
| `edad` | edad aparente buscada |
| `habilidades` + `habilidades_modo` | `id1,id2` + `todas` (por defecto) o `alguna` |
| `page`, `limit` | máx. 50 por página |

Otros: `GET /vitrina/actores/{id}` (perfil completo con galería) y `GET /vitrina/filtros` (catálogos y destrezas para armar los filtros).

**Privacidad (por diseño):**
- Solo perfiles `APROBADO`, de **mayores de edad**, activos y con `autoriza_vitrina_publica = true` (por defecto `false`; el actor lo cambia con `PUT /actores/{id}/vitrina` y el cambio es inmediato).
- Nunca se devuelven correo, teléfono, documento, fecha de nacimiento ni apellidos (sin nombre artístico, solo el primer nombre). Los `DOCUMENTO` jamás se publican.
- Un perfil que no cumple las condiciones responde 404 (no se revela que existe). Límite de 30 peticiones/min por IP.
- Género y rasgos fenotípicos son datos sensibles (Ley 1581 de 2012, Habeas Data): **conviene que el asesor legal del Centro revise la política de tratamiento y el texto de consentimiento antes de publicar**.

## Edición de perfil del actor (cierra el flujo de staging)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/actores/{id}/perfil` | Perfil público, borrador pendiente y último rechazo con su motivo |
| PUT | `/api/v1/actores/{id}/perfil` | Envía cambios: crea o actualiza el **borrador pendiente**; lo público no cambia hasta que un admin apruebe |
| GET/PUT | `/api/v1/actores/{id}/habilidades` | Destrezas del actor (máx. 15; reemplaza el conjunto) |
| PUT | `/api/v1/actores/{id}/vitrina` | `{"autoriza_vitrina_publica": true}` |

Con esto el `diff` de la Semana 2 ya compara contra la versión pública real. Los campos del registro público también aceptan los nuevos datos (`genero`, `edad_aparente_min/max`, `dialecto`, `provincia`, `autoriza_vitrina_publica`); `tono_piel`, `color_ojos` y `color_cabello` ahora usan las listas controladas.

## Flujo de prueba sugerido (Swagger `/api/docs`)
1. Admin: `POST /auth/admin/login` → `GET /vitrina/filtros` (copia los ids de destrezas) → `POST /convocatorias`.
2. Actor: registro público (con `genero`, `estatura_cm`, `edad_aparente_*`, `autoriza_vitrina_publica=true`) → admin aprueba el perfil → `POST /auth/actor/login`.
3. Actor: `POST /postulaciones` (prueba también con un actor que no cumple: devuelve 422 con los motivos y repetir devuelve 409).
4. Admin: `GET /convocatorias/{id}/kanban` → `PATCH /postulaciones/{id}/estado`.
5. Público: `GET /vitrina/actores?estatura_min=160&provincia=CENTRO`.

## Notas
- **RF-15:** el plan no incluye su texto. Si no está cubierto por lo anterior, pásalo y se ajusta.
- **Provincia** vive en el perfil (no en `actores`), así es editable y pasa por moderación. El municipio sigue en `actores`.
- **Multimedia sin moderar:** la foto de la vitrina sale de `FOTO_PERFIL` (miniatura de la Semana 2), que no pasa por revisión. Moderar multimedia es tema de una semana posterior; mientras tanto un admin puede borrar archivos.
- **Destrezas** del actor se guardan directo (no versionadas).
- Retirar una postulación la borra (queda constancia en `historial_auditoria`), por eso el actor podría volver a postularse.
- Escala: el ranking de candidatos se calcula en memoria sobre máx. 500 actores; si hay más, la respuesta trae `truncado: true`. Para miles de perfiles convendría mover el puntaje a SQL.

## Pruebas
```bash
cd api && npm install && npm test   # + motor de compatibilidad, transiciones, límite de mayoría de edad
```

## Flujo de ramas (Semana 3)
```bash
git checkout -b feature/P2_BE_Semana3_Casting_Kanban_Search
git add . && git commit -m "feat(s3): convocatorias, postulaciones, kanban, casting inteligente y vitrina"
git push -u origin feature/P2_BE_Semana3_Casting_Kanban_Search
```

---

# Semana 4 — Formación (LMS), certificados con QR, analítica y despliegue

**Rama:** `feature/P2_BE_Semana4_LMS_Reportes_Deploy`
**Alcance:** RF-12, RF-13, RF-17 y RNF-12 (respaldos). El texto de RNF-05, RNF-10 y RNF-14 no estaba en el plan: ver "Notas".

> **Importante, cambios que rompen compatibilidad con la Semana 3:**
> 1. Nuevos secretos obligatorios: `CERT_HMAC_SECRET` (≥ 32 caracteres, distinto de `JWT_SECRET`). Agrégalo al `.env`.
> 2. El `Dockerfile` ahora está en la **raíz** del repositorio (contexto = raíz) y las migraciones viajan dentro de la imagen.
> 3. La foto y la autorización del registro público ya **no se guardan en disco** sino en S3. Los archivos de pruebas anteriores guardados en disco no se migran.
> 4. Con una base ya creada: `docker compose exec api node dist/db/migrate.js` (adopta lo aplicado y agrega la 006), o `docker compose down -v` para empezar de cero.

## Migración `006_semana4.sql`
`cursos_y_talleres` (+ `tipo`, `estado`, `fecha_fin_curso`, `modalidad`, `lugar`, `horas_totales`, `solo_mayores_de_edad`), `actividades_curso`,
`inscripciones_curso` (llave única curso + actor), `certificados` (código aleatorio, firma de integridad, hash del PDF, revocación; una sola
constancia vigente por actor y curso).

## Formación (LMS)

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST / PUT / DELETE | `/api/v1/cursos[/{id}]` | Admin | Crea (nace en `BORRADOR`, oculto), edita (solo `BORRADOR`/`ABIERTO`) y elimina (solo borrador sin inscripciones) |
| PATCH | `/api/v1/cursos/{id}/estado` | Admin | `BORRADOR → ABIERTO → EN_CURSO → FINALIZADO`; cancelar cancela también las inscripciones |
| GET | `/api/v1/cursos`, `/cursos/{id}` | Público | Solo `ABIERTO` y `EN_CURSO`, con `cupos_disponibles`. Con token de admin: todos, `?estado=&tipo=` |
| POST / GET / PUT / DELETE | `/api/v1/cursos/{id}/actividades[/{actividadId}]` | Admin escribe; admin o inscrito lee | Sesiones, tareas y evaluaciones (los enlaces de sesión no son públicos y deben ser `https`) |
| **POST** | **`/api/v1/cursos/{id}/inscripcion`** | Actor | Inscribe con control de cupos; curso lleno → **lista de espera** |
| DELETE | `/api/v1/cursos/{id}/inscripcion` | Actor | Cancela; el primero de la lista de espera entra solo |
| GET | `/api/v1/inscripciones/mias` | Actor | Sus inscripciones y su posición en la espera |
| GET / PATCH | `/api/v1/cursos/{id}/inscripciones[/{inscripcionId}]` | Admin | Lista y marca `COMPLETADA` / `NO_COMPLETADA` / `CANCELADA` |

Reglas: inscripciones solo con el curso `ABIERTO` y dentro de la ventana de fechas; un menor necesita acudiente verificado y el curso no puede ser
`solo_mayores_de_edad`; el cupo no se supera ni con peticiones simultáneas (lock por curso); si el admin cancela a alguien, esa persona no puede reinscribirse sola.
Una tarea programada (cada minuto) pasa los cursos a `EN_CURSO` y `FINALIZADO` según sus fechas. Si una inscripción deja de estar `COMPLETADA`, su constancia se revoca.

## Certificados con QR

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/api/v1/certificados/registro` | Actor | **Devuelve el PDF** del certificado de registro (requiere perfil `APROBADO`); el código va en el encabezado `X-Certificado-Codigo` |
| POST | `/api/v1/certificados/curso/{cursoId}` | Actor | PDF de la constancia de un curso `COMPLETADA` |
| GET | `/api/v1/certificados/mis` · `/certificados/{id}/pdf` | Actor (admin: el PDF) | Lista y descarga del PDF guardado |
| **GET** | **`/api/v1/verificacion/{codigo}`** | **Público** | Es lo que abre el QR: estado y datos mínimos |
| PUT | `/api/v1/admin/certificados/{id}/revocar` | Admin | Revoca con motivo (auditado) |

- **Vigencia del certificado de registro:** `CERT_VIGENCIA_DIAS` (90 por defecto). Deja de ser válido si vence, se revoca, el perfil deja de estar `APROBADO` o la cuenta se desactiva. La constancia de curso no vence (solo se revoca).
- **Verificación pública:** estados `VIGENTE`, `VENCIDO`, `REVOCADO`, `NO_VIGENTE_REGISTRO`, `INTEGRIDAD_COMPROMETIDA`. Muestra nombre (solo iniciales si es menor), documento enmascarado y fechas; nunca contacto. Código aleatorio de 80 bits, límite de 20 consultas/min y sin caché.
- **Hash del documento:** la verificación devuelve el SHA-256 del PDF emitido; quien tenga el archivo puede comprobar con `sha256sum` que no fue alterado.
- **Firma:** *siempre* hay una firma de integridad (HMAC) sobre los datos, comprobada en cada verificación. La **firma digital PAdES con validez legal** exige un `.p12` de una entidad de certificación acreditada: pon `CERT_P12_BASE64` y `CERT_P12_PASSWORD` y el PDF sale firmado; si la firma falla no se emite el documento. Sin `.p12` el PDF lo dice con honestidad ("firmado electrónicamente por el sistema; se valida en línea").
- Configura nombre, firmante, cargo y color con `INSTITUCION_*`; el logo va en `api/assets/logo.png`. El QR apunta a `VERIFY_BASE_URL/{codigo}` (por defecto `FRONTEND_URL/verificar/{codigo}`; el frontend debe llamar a `GET /verificacion/{codigo}`).

## Analítica y reportes (RF-17, solo admin)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/admin/reportes/estadisticas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` | Actores por provincia, rangos etarios, perfiles por estado y **% aprobados**, postulaciones activas, registros por mes, convocatorias por estado |
| GET | `/api/v1/admin/reportes/estadisticas/export?formato=csv\|pdf` | Mismo contenido exportado (el CSV neutraliza fórmulas de Excel y lleva BOM UTF-8) |

Definiciones: el rango filtra por **fecha de registro** (hora de Colombia); la edad es la real, calculada hoy; *postulación activa* = `POSTULADO`, `EN_REVISION` o `PRESELECCIONADO` en una convocatoria `ACTIVA` o `EN_PAUSA`. Solo datos agregados (sin datos personales), caché de 60 s, exportaciones auditadas.

## Contenerización y despliegue

| Archivo | Para qué |
|---|---|
| `Dockerfile` | Multi-stage (build → dependencias de producción → runtime), usuario sin privilegios, `HEALTHCHECK`, migraciones opcionales al arrancar |
| `docker-compose.staging.yml` + `deploy/Caddyfile` + `.env.staging.example` | Staging en un servidor con HTTPS automático, base sin puertos expuestos y contenedor de respaldos |
| `render.yaml` | Blueprint de Render (API + base de datos + cron de respaldo) |
| `deploy/ecs/` | Definiciones de tarea de ECS Fargate (API y respaldo) y políticas IAM de mínimo privilegio |
| `.github/workflows/ci.yml` | Pruebas, compilación, imágenes y despliegue opcional a ECS |
| `api/src/db/migrate.ts` | Ejecutor de migraciones (lock, transacción por archivo, checksum, adopta bases existentes) |
| `docs/RUNBOOK.md` | Guía paso a paso: Compose, Render, ECS, respaldos, restauración, reversa y lista de verificación |

**Respaldos (RNF-12):** `deploy/backup` hace `pg_dump` diario a las 02:00 (Colombia) hacia un bucket S3 distinto al de los archivos, valida cada archivo (lectura, tamaño, SHA-256), guarda una copia mensual de larga retención, restaura el último respaldo cada mes en una base temporal para comprobar que sirve y avisa a un monitor externo (healthchecks.io) si falla o deja de ejecutarse. La retención (30 días / 12 meses) la aplica el bucket (`s3-lifecycle.json`). Corre como tarea aparte, no dentro de la API, para no duplicarse con varias réplicas.

## Notas
- **No pude desplegar ni ejecutar nada:** el entorno no tiene red ni acceso a tus cuentas. El código se revisó a mano (imports verificados, scripts `sh -n`, JSON/YAML válidos), pero el primer `docker build` y el primer despliegue son la prueba real. Valida los nombres de plan de Render y las versiones de las acciones de CI antes de aplicarlos.
- **Firma PAdES sin probar:** la integración (`@signpdf`) no se pudo ejercitar sin un certificado. Pruébala en staging con un `.p12` de prueba antes de ofrecerla.
- **RNF-05, RNF-10, RNF-14:** el plan no incluye su texto. Si son metas medibles (tiempos de respuesta, disponibilidad, retención), pásalas y se ajustan los valores.
- **Sin `package-lock.json`:** genéralo (`cd api && npm install`) y súbelo; el Dockerfile y el CI usan `npm ci` automáticamente cuando existe.
- El *rate limit* es por réplica (memoria); con varias réplicas conviene Redis.
- Al eliminar un actor, sus PDF y archivos en S3 no se borran solos (la base sí). Define una política de retención con el Centro.
- No se envían correos de "te asignaron un cupo" cuando alguien sale de la lista de espera (el actor lo ve en `/inscripciones/mias`).

## Pruebas
```bash
cd api && npm install && npm test   # + utilidades de certificados, CSV, transiciones de formación
```

## Flujo de ramas (Semana 4)
```bash
git checkout -b feature/P2_BE_Semana4_LMS_Reportes_Deploy
git add . && git commit -m "feat(s4): LMS, certificados QR, reportes y despliegue"
git push -u origin feature/P2_BE_Semana4_LMS_Reportes_Deploy
```
