-- ==========================================
-- 006 - Semana 4: formación (LMS) y certificados con QR
-- ==========================================

CREATE TYPE tipo_curso_enum          AS ENUM ('CURSO', 'TALLER');
CREATE TYPE estado_curso_enum        AS ENUM ('BORRADOR', 'ABIERTO', 'EN_CURSO', 'FINALIZADO', 'CANCELADO');
CREATE TYPE estado_inscripcion_enum  AS ENUM ('INSCRITO', 'LISTA_ESPERA', 'CANCELADA', 'COMPLETADA', 'NO_COMPLETADA');
CREATE TYPE tipo_actividad_enum      AS ENUM ('SESION', 'TAREA', 'EVALUACION');
CREATE TYPE tipo_certificado_enum    AS ENUM ('REGISTRO', 'CURSO');

-- 1) Cursos y talleres: tipo, estado, fechas, modalidad
ALTER TABLE cursos_y_talleres
    ADD COLUMN tipo                  tipo_curso_enum   NOT NULL DEFAULT 'CURSO',
    ADD COLUMN estado                estado_curso_enum NOT NULL DEFAULT 'BORRADOR',
    ADD COLUMN fecha_fin_curso       timestamp,
    ADD COLUMN modalidad             varchar(50) NOT NULL DEFAULT 'PRESENCIAL',
    ADD COLUMN lugar                 varchar(200),
    ADD COLUMN solo_mayores_de_edad  boolean NOT NULL DEFAULT false,
    ADD COLUMN horas_totales         integer CHECK (horas_totales > 0),
    ADD COLUMN actualizado_en        timestamp NOT NULL DEFAULT now(),
    ADD CONSTRAINT ck_curso_fechas CHECK (
        fecha_inicio_inscripcion <= fecha_inicio_curso
        AND (fecha_fin_curso IS NULL OR fecha_inicio_curso < fecha_fin_curso));
CREATE INDEX idx_cursos_estado ON cursos_y_talleres (estado, fecha_inicio_curso);

-- 2) Actividades académicas del curso
CREATE TABLE actividades_curso (
    actividad_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    curso_id        uuid NOT NULL,
    tipo            tipo_actividad_enum NOT NULL DEFAULT 'SESION',
    titulo          varchar(200) NOT NULL,
    descripcion     text,
    fecha_inicio    timestamp,
    fecha_fin       timestamp,
    lugar_o_enlace  varchar(300),
    orden           integer NOT NULL DEFAULT 0 CHECK (orden >= 0),
    creado_en       timestamp NOT NULL DEFAULT now(),
    CONSTRAINT fk_actividad_curso FOREIGN KEY (curso_id)
        REFERENCES cursos_y_talleres (curso_id) ON DELETE CASCADE,
    CONSTRAINT ck_actividad_fechas CHECK (fecha_inicio IS NULL OR fecha_fin IS NULL OR fecha_inicio <= fecha_fin)
);
CREATE INDEX idx_actividades_curso ON actividades_curso (curso_id, orden);

-- 3) Inscripciones (llave única curso + actor; lista de espera FIFO por inscrito_en)
CREATE TABLE inscripciones_curso (
    inscripcion_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    curso_id               uuid NOT NULL,
    actor_id               uuid NOT NULL,
    estado                 estado_inscripcion_enum NOT NULL,
    inscrito_en            timestamp NOT NULL DEFAULT now(),
    actualizado_en         timestamp NOT NULL DEFAULT now(),
    revisado_por_admin_id  uuid,
    notas_admin            text,
    CONSTRAINT fk_insc_curso FOREIGN KEY (curso_id)
        REFERENCES cursos_y_talleres (curso_id) ON DELETE CASCADE,
    CONSTRAINT fk_insc_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE,
    CONSTRAINT fk_insc_admin FOREIGN KEY (revisado_por_admin_id)
        REFERENCES administradores (admin_id),
    CONSTRAINT uq_inscripcion_unica UNIQUE (curso_id, actor_id)
);
CREATE INDEX idx_inscripciones_curso_estado ON inscripciones_curso (curso_id, estado, inscrito_en);
CREATE INDEX idx_inscripciones_actor        ON inscripciones_curso (actor_id);

-- 4) Certificados digitales con QR (el PDF vive en S3; aquí la evidencia verificable)
CREATE TABLE certificados (
    certificado_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                 varchar(20) NOT NULL,
    tipo                   tipo_certificado_enum NOT NULL,
    actor_id               uuid NOT NULL,
    curso_id               uuid,
    emitido_en             timestamp NOT NULL DEFAULT now(),
    vence_en               timestamp,
    revocado_en            timestamp,
    motivo_revocacion      text,
    revocado_por_admin_id  uuid,
    datos                  jsonb NOT NULL,
    firma                  varchar(100) NOT NULL,
    sha256                 varchar(64) NOT NULL,
    clave_pdf              text NOT NULL,
    CONSTRAINT uq_cert_codigo UNIQUE (codigo),
    CONSTRAINT fk_cert_actor FOREIGN KEY (actor_id)
        REFERENCES actores (actor_id) ON DELETE CASCADE,
    CONSTRAINT fk_cert_curso FOREIGN KEY (curso_id)
        REFERENCES cursos_y_talleres (curso_id),
    CONSTRAINT fk_cert_admin FOREIGN KEY (revocado_por_admin_id)
        REFERENCES administradores (admin_id),
    CONSTRAINT ck_cert_curso CHECK ((tipo = 'CURSO') = (curso_id IS NOT NULL))
);
CREATE INDEX idx_cert_actor ON certificados (actor_id, tipo, emitido_en DESC);
-- Una sola constancia vigente por actor y curso
CREATE UNIQUE INDEX uq_cert_curso_vigente
    ON certificados (actor_id, curso_id) WHERE tipo = 'CURSO' AND revocado_en IS NULL;
