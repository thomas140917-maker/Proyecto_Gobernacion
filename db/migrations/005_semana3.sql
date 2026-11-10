-- ==========================================
-- 005 - Semana 3: convocatorias, casting, kanban y vitrina pública
-- ==========================================

-- 1) estado_convocatoria_enum del plan (mapea valores viejos por si había datos)
ALTER TABLE convocatorias ALTER COLUMN estado TYPE text;
DROP TYPE estado_convocatoria_enum;
CREATE TYPE estado_convocatoria_enum AS ENUM ('PROXIMA', 'ACTIVA', 'EN_PAUSA', 'CERRADA');
ALTER TABLE convocatorias
    ALTER COLUMN estado TYPE estado_convocatoria_enum
    USING (CASE estado WHEN 'BORRADOR' THEN 'PROXIMA' WHEN 'ABIERTA' THEN 'ACTIVA' ELSE estado END)::estado_convocatoria_enum;

-- 2) estado_postulacion_enum del plan
ALTER TABLE postulaciones_castings ALTER COLUMN estado TYPE text;
DROP TYPE estado_postulacion_enum;
CREATE TYPE estado_postulacion_enum AS ENUM
    ('POSTULADO', 'EN_REVISION', 'PRESELECCIONADO', 'SELECCIONADO', 'RECHAZADO');
ALTER TABLE postulaciones_castings
    ALTER COLUMN estado TYPE estado_postulacion_enum
    USING (CASE estado WHEN 'PENDIENTE' THEN 'POSTULADO'
                       WHEN 'ACEPTADA'  THEN 'SELECCIONADO'
                       WHEN 'RECHAZADA' THEN 'RECHAZADO'
                       ELSE estado END)::estado_postulacion_enum;
ALTER TABLE postulaciones_castings ALTER COLUMN estado SET DEFAULT 'POSTULADO';

-- 3) Perfil: datos para buscar y emparejar (los versionados pasan por moderación)
--    autoriza_vitrina_publica NO se versiona: el consentimiento (y su retiro) es inmediato.
ALTER TABLE perfiles_actores
    ADD COLUMN genero                    varchar(20),
    ADD COLUMN edad_aparente_min         smallint,
    ADD COLUMN edad_aparente_max         smallint,
    ADD COLUMN dialecto                  varchar(40),
    ADD COLUMN provincia                 varchar(40),
    ADD COLUMN autoriza_vitrina_publica  boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT ck_perfil_edad_aparente CHECK (
        (edad_aparente_min IS NULL AND edad_aparente_max IS NULL)
        OR (edad_aparente_min IS NOT NULL AND edad_aparente_max IS NOT NULL
            AND edad_aparente_min BETWEEN 0 AND 100
            AND edad_aparente_max BETWEEN edad_aparente_min AND 100));

-- 4) Convocatorias: parámetros estructurados del casting
--    cupo_maximo = número de vacantes (máximo de SELECCIONADO)
ALTER TABLE convocatorias
    ADD COLUMN fecha_apertura        timestamp,
    ADD COLUMN edad_aparente_min     smallint,
    ADD COLUMN edad_aparente_max     smallint,
    ADD COLUMN estatura_min_cm       integer,
    ADD COLUMN estatura_max_cm       integer,
    ADD COLUMN generos               text[] NOT NULL DEFAULT '{}',
    ADD COLUMN tonos_piel            text[] NOT NULL DEFAULT '{}',
    ADD COLUMN colores_ojos          text[] NOT NULL DEFAULT '{}',
    ADD COLUMN colores_cabello       text[] NOT NULL DEFAULT '{}',
    ADD COLUMN dialectos             text[] NOT NULL DEFAULT '{}',
    ADD COLUMN provincias            text[] NOT NULL DEFAULT '{}',
    ADD COLUMN municipios            text[] NOT NULL DEFAULT '{}',
    ADD COLUMN solo_mayores_de_edad  boolean NOT NULL DEFAULT false,
    ADD COLUMN actualizado_en        timestamp NOT NULL DEFAULT now(),
    ADD CONSTRAINT ck_conv_edad     CHECK (edad_aparente_min IS NULL OR edad_aparente_max IS NULL OR edad_aparente_min <= edad_aparente_max),
    ADD CONSTRAINT ck_conv_estatura CHECK (estatura_min_cm IS NULL OR estatura_max_cm IS NULL OR estatura_min_cm <= estatura_max_cm),
    ADD CONSTRAINT ck_conv_fechas   CHECK (fecha_apertura IS NULL OR fecha_apertura < fecha_cierre);

CREATE TABLE convocatorias_habilidades (
    convocatoria_id  uuid NOT NULL,
    habilidad_id     uuid NOT NULL,
    obligatoria      boolean NOT NULL DEFAULT true,
    PRIMARY KEY (convocatoria_id, habilidad_id),
    CONSTRAINT fk_ch_convocatoria FOREIGN KEY (convocatoria_id)
        REFERENCES convocatorias (convocatoria_id) ON DELETE CASCADE,
    CONSTRAINT fk_ch_habilidad FOREIGN KEY (habilidad_id)
        REFERENCES habilidades (habilidad_id) ON DELETE RESTRICT
);

-- 5) Postulaciones: seguimiento (la llave única convocatoria+actor ya existe: uq_postulacion_unica)
ALTER TABLE postulaciones_castings
    ADD COLUMN compatibilidad          smallint NOT NULL DEFAULT 0 CHECK (compatibilidad BETWEEN 0 AND 100),
    ADD COLUMN detalle_compatibilidad  jsonb,
    ADD COLUMN notas_admin             text,
    ADD COLUMN revisado_por_admin_id   uuid,
    ADD COLUMN actualizado_en          timestamp NOT NULL DEFAULT now(),
    ADD CONSTRAINT fk_post_revisor FOREIGN KEY (revisado_por_admin_id) REFERENCES administradores (admin_id);

-- 6) Índices (vitrina parcial: solo perfiles aprobados y autorizados)
CREATE INDEX idx_vitrina ON perfiles_actores (genero, dialecto, estatura_cm)
    WHERE estado = 'APROBADO' AND autoriza_vitrina_publica;
CREATE INDEX idx_perfiles_provincia      ON perfiles_actores (provincia) WHERE estado = 'APROBADO';
CREATE INDEX idx_actores_habilidad       ON actores_habilidades (habilidad_id);
CREATE INDEX idx_postulaciones_kanban    ON postulaciones_castings (convocatoria_id, estado);
CREATE INDEX idx_convocatorias_estado    ON convocatorias (estado, fecha_cierre);
CREATE INDEX idx_conv_hab_habilidad      ON convocatorias_habilidades (habilidad_id);

-- 7) Catálogo inicial de destrezas
INSERT INTO habilidades (nombre, tipo, descripcion) VALUES
    ('Canto', 'SKILL', 'Interpretación vocal'),
    ('Baile folclórico', 'SKILL', 'Danzas tradicionales colombianas'),
    ('Danza contemporánea', 'SKILL', NULL),
    ('Danza urbana', 'SKILL', NULL),
    ('Tiple y requinto', 'SKILL', 'Instrumentos de cuerda tradicionales'),
    ('Guitarra', 'SKILL', NULL),
    ('Piano', 'SKILL', NULL),
    ('Percusión', 'SKILL', NULL),
    ('Equitación', 'SKILL', NULL),
    ('Artes marciales', 'SKILL', NULL),
    ('Natación', 'SKILL', NULL),
    ('Ciclismo', 'SKILL', NULL),
    ('Conducción de moto', 'SKILL', NULL),
    ('Conducción de vehículos', 'SKILL', NULL),
    ('Acrobacia', 'SKILL', NULL),
    ('Malabares', 'SKILL', NULL),
    ('Esgrima escénica', 'SKILL', NULL),
    ('Teatro físico y mimo', 'SKILL', NULL),
    ('Improvisación', 'SKILL', NULL),
    ('Stand-up comedy', 'SKILL', NULL),
    ('Doblaje y locución', 'SKILL', NULL),
    ('Presentación y animación', 'SKILL', NULL),
    ('Manejo de títeres', 'SKILL', NULL),
    ('Maquillaje artístico', 'SKILL', NULL),
    ('Inglés', 'SKILL', 'Idioma'),
    ('Francés', 'SKILL', 'Idioma'),
    ('Lengua de señas colombiana', 'SKILL', 'Idioma')
ON CONFLICT (nombre) DO NOTHING;
