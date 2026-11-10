-- ==========================================
-- 001 - Esquema base (script original + enums nuevos)
-- ==========================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ENUMS
CREATE TYPE tipo_documento_enum        AS ENUM ('CC', 'CE', 'PASAPORTE', 'NIT');
CREATE TYPE estado_perfil_enum         AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');
CREATE TYPE estado_convocatoria_enum   AS ENUM ('BORRADOR', 'ABIERTA', 'CERRADA');
CREATE TYPE estado_postulacion_enum    AS ENUM ('PENDIENTE', 'ACEPTADA', 'RECHAZADA');
CREATE TYPE tipo_multimedia_enum       AS ENUM ('FOTO', 'VIDEO', 'AUDIO', 'DOCUMENTO');
CREATE TYPE tipo_accion_auditoria_enum AS ENUM ('CREAR', 'ACTUALIZAR', 'ELIMINAR');

-- TABLAS
CREATE TABLE actores (
    actor_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    correo            varchar(201) NOT NULL,
    contrasena_hash   varchar(201) NOT NULL,
    nombre_completo   varchar(200) NOT NULL,
    tipo_documento    tipo_documento_enum NOT NULL,
    numero_documento  varchar(50) NOT NULL,
    fecha_nacimiento  date NOT NULL,
    municipio         varchar(100) NOT NULL,
    ciudad            varchar(100) NOT NULL,
    telefono          varchar(20) NOT NULL,
    acepta_terminos   boolean NOT NULL,
    esta_activo       boolean NOT NULL,
    creado_en         timestamp NOT NULL DEFAULT now()
);

CREATE TABLE administradores (
    admin_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    correo            varchar(201) NOT NULL,
    contrasena_hash   varchar(201) NOT NULL,
    nombre            varchar(100) NOT NULL,
    apellido          varchar(100) NOT NULL,
    esta_activo       boolean NOT NULL,
    creado_en         timestamp NOT NULL DEFAULT now()
);

CREATE TABLE perfiles_actores (
    actor_id                uuid PRIMARY KEY,
    nombre_artistico        varchar(100),
    tiene_experiencia       boolean NOT NULL,
    biografia               text,
    foto_perfil_url         text,
    estado                  estado_perfil_enum NOT NULL,
    motivo_rechazo          text,
    revisado_en             timestamp,
    revisado_por_admin_id   uuid,
    actualizado_en          timestamp NOT NULL DEFAULT now(),
    CONSTRAINT fk_perfil_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE,
    CONSTRAINT fk_perfil_admin FOREIGN KEY (revisado_por_admin_id)
        REFERENCES administradores (admin_id)
);

CREATE TABLE acudientes_legales (
    acudiente_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id                    uuid NOT NULL,
    nombre_acudiente            varchar(200) NOT NULL,
    documento_acudiente         varchar(50) NOT NULL,
    telefono_acudiente          varchar(20) NOT NULL,
    correo_acudiente            varchar(201) NOT NULL,
    url_documento_autorizacion  text NOT NULL,
    esta_verificado             boolean NOT NULL,
    verificado_por_admin_id     uuid,
    CONSTRAINT fk_acudiente_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE,
    CONSTRAINT fk_acudiente_admin FOREIGN KEY (verificado_por_admin_id)
        REFERENCES administradores (admin_id)
);

CREATE TABLE habilidades (
    habilidad_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre        varchar(100) NOT NULL UNIQUE,
    tipo          varchar(50) NOT NULL DEFAULT 'ESPECIALIDAD',  -- AREA, ESPECIALIDAD, SKILL
    descripcion   text
);

CREATE TABLE actores_habilidades (
    actor_id          uuid NOT NULL,
    habilidad_id      uuid NOT NULL,
    descripcion_otra  varchar(100),
    PRIMARY KEY (actor_id, habilidad_id),
    CONSTRAINT fk_ah_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE,
    CONSTRAINT fk_ah_habilidad FOREIGN KEY (habilidad_id)
        REFERENCES habilidades (habilidad_id) ON DELETE CASCADE
);

COMMENT ON TABLE actores_habilidades IS
    'Tabla intermedia: relación muchos a muchos entre actores y habilidades (especialidades)';

CREATE TABLE experiencias_actor (
    experiencia_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id               uuid NOT NULL,
    nombre_proyecto        varchar(100) NOT NULL,
    tipo_produccion        varchar(100) NOT NULL,
    rol_desempenado        varchar(100) NOT NULL,
    anio                   integer NOT NULL,
    director_o_productora  varchar(100),
    CONSTRAINT fk_experiencia_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE
);

CREATE TABLE redes_sociales_actor (
    red_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    uuid NOT NULL,
    plataforma  varchar(100) NOT NULL,
    url_perfil  text NOT NULL,
    CONSTRAINT fk_red_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE
);

CREATE TABLE archivos_multimedia (
    multimedia_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id       uuid NOT NULL,
    url_archivo    text NOT NULL,
    tipo_archivo   tipo_multimedia_enum NOT NULL,
    titulo         varchar(100),
    subido_en      timestamp NOT NULL DEFAULT now(),
    CONSTRAINT fk_multimedia_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE
);

CREATE TABLE cursos_y_talleres (
    curso_id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creado_por_admin_id       uuid NOT NULL,
    titulo                    varchar(200) NOT NULL,
    descripcion               text,
    instructor                varchar(100),
    fecha_inicio_inscripcion  timestamp NOT NULL,
    fecha_inicio_curso        timestamp NOT NULL,
    es_proceso_formacion      boolean NOT NULL,
    cupo_maximo               integer NOT NULL,
    creado_en                 timestamp NOT NULL DEFAULT now(),
    CONSTRAINT fk_curso_admin FOREIGN KEY (creado_por_admin_id)
        REFERENCES administradores (admin_id)
);

CREATE TABLE noticias (
    noticia_id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creado_por_admin_id          uuid NOT NULL,
    titulo                       varchar(200) NOT NULL,
    resumen_para_carta           varchar(200) NOT NULL,
    resumen_para_galeria         text NOT NULL,
    imagen_url                   text,
    inicio_descripcion_semestre  date,
    publicado_en                 timestamp NOT NULL DEFAULT now(),
    CONSTRAINT fk_noticia_admin FOREIGN KEY (creado_por_admin_id)
        REFERENCES administradores (admin_id)
);

CREATE TABLE convocatorias (
    convocatoria_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creado_por_admin_id  uuid NOT NULL,
    titulo               varchar(200) NOT NULL,
    descripcion          text NOT NULL,
    requisitos           text,
    ubicacion            varchar(100),
    modalidad            varchar(50) NOT NULL,
    cupo_maximo          integer NOT NULL,
    fecha_cierre         timestamp NOT NULL,
    estado               estado_convocatoria_enum NOT NULL,
    creado_en            timestamp NOT NULL DEFAULT now(),
    CONSTRAINT fk_convocatoria_admin FOREIGN KEY (creado_por_admin_id)
        REFERENCES administradores (admin_id)
);

CREATE TABLE postulaciones_castings (
    postulacion_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convocatoria_id  uuid NOT NULL,
    actor_id         uuid NOT NULL,
    estado           estado_postulacion_enum NOT NULL,
    postulado_en     timestamp NOT NULL DEFAULT now(),
    CONSTRAINT fk_post_convocatoria FOREIGN KEY (convocatoria_id)
        REFERENCES convocatorias (convocatoria_id) ON DELETE CASCADE,
    CONSTRAINT fk_post_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE
);

CREATE TABLE historial_auditoria (
    log_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_accion            tipo_accion_auditoria_enum NOT NULL,
    entidad_afectada       varchar(100) NOT NULL,
    entidad_id             uuid NOT NULL,
    realizado_por_admin_id uuid,
    realizado_por_actor_id uuid,
    observacion_accion     text,
    creado_en              timestamp NOT NULL DEFAULT now(),
    CONSTRAINT fk_audit_admin FOREIGN KEY (realizado_por_admin_id)
        REFERENCES administradores (admin_id),
    CONSTRAINT fk_audit_actor FOREIGN KEY (realizado_por_actor_id)
        REFERENCES actores (actor_id)
);
