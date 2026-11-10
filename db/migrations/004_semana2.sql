-- ==========================================
-- 004 - Semana 2: staging de perfiles, multimedia y moderación
-- ==========================================

-- 1) Auditoría: nuevo tipo de acción + detalle estructurado
ALTER TYPE tipo_accion_auditoria_enum ADD VALUE IF NOT EXISTS 'ACCION_ADMINISTRADOR';
ALTER TABLE historial_auditoria ADD COLUMN detalle jsonb;

-- 2) tipo_multimedia_enum del plan (la tabla aún no se usaba; se mapean valores viejos por si acaso)
ALTER TABLE archivos_multimedia ALTER COLUMN tipo_archivo TYPE text;
DROP TYPE tipo_multimedia_enum;
CREATE TYPE tipo_multimedia_enum AS ENUM
    ('FOTO_PERFIL', 'FOTO_BOOK', 'REEL_PRESENTACION', 'ENLACE_PORTAFOLIO', 'DOCUMENTO');
ALTER TABLE archivos_multimedia
    ALTER COLUMN tipo_archivo TYPE tipo_multimedia_enum
    USING (CASE tipo_archivo
              WHEN 'FOTO'  THEN 'FOTO_BOOK'
              WHEN 'VIDEO' THEN 'REEL_PRESENTACION'
              WHEN 'AUDIO' THEN 'DOCUMENTO'
              ELSE tipo_archivo
           END)::tipo_multimedia_enum;

-- 3) Metadatos de multimedia
--    url_archivo: clave del objeto en S3 (almacenamiento='S3') o URL canónica (almacenamiento='EXTERNO')
ALTER TABLE archivos_multimedia
    ADD COLUMN almacenamiento  varchar(10) NOT NULL DEFAULT 'S3'
        CHECK (almacenamiento IN ('S3', 'EXTERNO')),
    ADD COLUMN url_miniatura   text,
    ADD COLUMN mime_type       varchar(100),
    ADD COLUMN tamano_bytes    integer CHECK (tamano_bytes >= 0),
    ADD COLUMN ancho           integer,
    ADD COLUMN alto            integer,
    ADD COLUMN proveedor_video varchar(20) CHECK (proveedor_video IN ('YOUTUBE', 'VIMEO')),
    ADD COLUMN id_video        varchar(64),
    ADD CONSTRAINT ck_multimedia_externo CHECK (almacenamiento <> 'EXTERNO' OR proveedor_video IS NOT NULL);

CREATE INDEX idx_multimedia_actor_tipo ON archivos_multimedia (actor_id, tipo_archivo);
-- Un mismo enlace no se registra dos veces en el perfil
CREATE UNIQUE INDEX uq_multimedia_enlace
    ON archivos_multimedia (actor_id, tipo_archivo, url_archivo) WHERE almacenamiento = 'EXTERNO';

-- 4) Bloqueo por intentos fallidos también para actores (login de actor)
ALTER TABLE actores
    ADD COLUMN intentos_fallidos integer NOT NULL DEFAULT 0,
    ADD COLUMN bloqueado_hasta   timestamp;

-- 5) Doble estado de perfiles: versiones
CREATE TYPE estado_version_enum AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'HISTORICA');

CREATE TABLE perfiles_versiones (
    version_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id               uuid NOT NULL,
    numero_version         integer NOT NULL CHECK (numero_version > 0),
    datos                  jsonb NOT NULL,
    estado                 estado_version_enum NOT NULL DEFAULT 'PENDIENTE',
    motivo_rechazo         text,
    creado_en              timestamp NOT NULL DEFAULT now(),
    revisado_en            timestamp,
    revisado_por_admin_id  uuid,
    CONSTRAINT fk_version_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE,
    CONSTRAINT fk_version_admin FOREIGN KEY (revisado_por_admin_id)
        REFERENCES administradores (admin_id),
    CONSTRAINT uq_version_numero UNIQUE (actor_id, numero_version)
);
-- Máximo un borrador pendiente y una versión pública vigente por actor
CREATE UNIQUE INDEX uq_version_pendiente ON perfiles_versiones (actor_id) WHERE estado = 'PENDIENTE';
CREATE UNIQUE INDEX uq_version_vigente   ON perfiles_versiones (actor_id) WHERE estado = 'APROBADA';
CREATE INDEX idx_versiones_estado ON perfiles_versiones (estado, creado_en);

-- Versión 1 de los perfiles que ya existían
INSERT INTO perfiles_versiones
    (actor_id, numero_version, datos, estado, motivo_rechazo, revisado_en, revisado_por_admin_id, creado_en)
SELECT actor_id, 1,
       jsonb_build_object(
           'nombre_artistico',  nombre_artistico,
           'tiene_experiencia', tiene_experiencia,
           'biografia',         biografia,
           'foto_perfil_url',   foto_perfil_url,
           'estatura_cm',       estatura_cm,
           'color_ojos',        color_ojos,
           'color_cabello',     color_cabello,
           'tono_piel',         tono_piel,
           'contextura',        contextura),
       (CASE estado WHEN 'PENDIENTE' THEN 'PENDIENTE'
                    WHEN 'APROBADO'  THEN 'APROBADA'
                    ELSE 'RECHAZADA' END)::estado_version_enum,
       motivo_rechazo, revisado_en, revisado_por_admin_id, actualizado_en
FROM perfiles_actores;
