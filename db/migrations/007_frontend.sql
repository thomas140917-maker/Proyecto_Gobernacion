-- ==========================================
-- 007 - Frontend del Centro Actoral: columnas/tablas que el sitio necesita y el backend aún no tenía
--
-- Solo AGREGA (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS). Prisma ignora las
-- columnas que no están en schema.prisma, por lo que la API existente no cambia su comportamiento.
-- Al final convierte los datos de una base del proyecto anterior (si 000 la adaptó).
-- ==========================================

-- 1) Perfil del actor: datos de presentación que no se moderan
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'perfiles_numero_seq') THEN
    CREATE SEQUENCE perfiles_numero_seq;
  END IF;
END $$;

ALTER TABLE perfiles_actores
    ADD COLUMN IF NOT EXISTS nivel_experiencia     varchar(20),
    ADD COLUMN IF NOT EXISTS ocupacion             varchar(120),
    ADD COLUMN IF NOT EXISTS disponible            boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS disponibilidad_viajar boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS talla_ropa            varchar(30),
    ADD COLUMN IF NOT EXISTS talla_calzado         varchar(30),
    ADD COLUMN IF NOT EXISTS agencia_nombre        varchar(150),
    ADD COLUMN IF NOT EXISTS agencia_correo        varchar(201),
    ADD COLUMN IF NOT EXISTS restringido           boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS motivo_restriccion    text,
    ADD COLUMN IF NOT EXISTS numero_solicitud      integer DEFAULT nextval('perfiles_numero_seq');

ALTER TABLE actores_habilidades ADD COLUMN IF NOT EXISTS nivel varchar(20);

CREATE TABLE IF NOT EXISTS idiomas_actor (
    idioma_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id   uuid NOT NULL REFERENCES actores (actor_id) ON DELETE CASCADE,
    idioma     varchar(60) NOT NULL,
    nivel      varchar(40)
);
CREATE TABLE IF NOT EXISTS formacion_actor (
    formacion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id     uuid NOT NULL REFERENCES actores (actor_id) ON DELETE CASCADE,
    periodo      varchar(40),
    titulo       varchar(200) NOT NULL,
    institucion  varchar(200)
);
CREATE TABLE IF NOT EXISTS reportes_perfil (
    reporte_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id   uuid NOT NULL REFERENCES actores (actor_id) ON DELETE CASCADE,
    motivo     text NOT NULL,
    estado     varchar(12) NOT NULL DEFAULT 'PENDIENTE',
    creado_en  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_idiomas_actor    ON idiomas_actor (actor_id);
CREATE INDEX IF NOT EXISTS idx_formacion_actor  ON formacion_actor (actor_id);
CREATE INDEX IF NOT EXISTS idx_reportes_estado  ON reportes_perfil (estado, creado_en);

-- 2) Cursos, convocatorias y noticias: campos visuales / editoriales
ALTER TABLE cursos_y_talleres
    ADD COLUMN IF NOT EXISTS categoria   varchar(60),
    ADD COLUMN IF NOT EXISTS requisitos  text,
    ADD COLUMN IF NOT EXISTS imagen_url  text;

ALTER TABLE convocatorias
    ADD COLUMN IF NOT EXISTS tipo_oportunidad    varchar(40),
    ADD COLUMN IF NOT EXISTS entidad             varchar(120),
    ADD COLUMN IF NOT EXISTS perfiles_requeridos text,
    ADD COLUMN IF NOT EXISTS imagen_url          text;

ALTER TABLE noticias
    ADD COLUMN IF NOT EXISTS categoria  varchar(40),
    ADD COLUMN IF NOT EXISTS enlace     text,
    ADD COLUMN IF NOT EXISTS borrador   boolean NOT NULL DEFAULT false;

-- 3) Avance académico del actor en el curso (0-100)
ALTER TABLE inscripciones_curso
    ADD COLUMN IF NOT EXISTS progreso smallint NOT NULL DEFAULT 0 CHECK (progreso BETWEEN 0 AND 100);

-- 4) Conversión de datos de la base anterior (solo si 000 la adaptó)
DO $conv$
DECLARE
  hay_legacy   boolean := to_regclass('public._adopcion_legacy') IS NOT NULL;
  hay_perfiles boolean := hay_legacy;
  hay_cursos   boolean := hay_legacy AND EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_name = 'cursos_y_talleres' AND column_name = 'estado_legacy');
  hay_post     boolean := hay_legacy AND EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_name = 'postulaciones_castings' AND column_name = 'etapa');
BEGIN
  IF NOT hay_legacy THEN RETURN; END IF;
  -- ---- perfiles: género/estatura vivían en "actores"; rasgos eran texto libre ----
  IF hay_perfiles THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'actores' AND column_name = 'genero') THEN
      UPDATE perfiles_actores p SET
        genero = CASE lower(a.genero) WHEN 'mujer' THEN 'FEMENINO' WHEN 'hombre' THEN 'MASCULINO'
                                      WHEN 'no binario' THEN 'NO_BINARIO' ELSE NULL END
        FROM actores a WHERE a.actor_id = p.actor_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'actores' AND column_name = 'estatura_cm') THEN
      UPDATE perfiles_actores p SET estatura_cm = a.estatura_cm
        FROM actores a WHERE a.actor_id = p.actor_id AND a.estatura_cm BETWEEN 50 AND 250;
    END IF;

    UPDATE perfiles_actores SET
      color_ojos = CASE
        WHEN color_ojos_legacy ILIKE '%negr%' THEN 'NEGROS'   WHEN color_ojos_legacy ILIKE '%caf%'  THEN 'CAFES'
        WHEN color_ojos_legacy ILIKE '%avell%' OR color_ojos_legacy ILIKE '%miel%' THEN 'AVELLANA'
        WHEN color_ojos_legacy ILIKE '%verd%' THEN 'VERDES'   WHEN color_ojos_legacy ILIKE '%azul%' THEN 'AZULES'
        WHEN color_ojos_legacy ILIKE '%gris%' THEN 'GRISES'   END,
      color_cabello = CASE
        WHEN color_cabello_legacy ILIKE '%negr%' THEN 'NEGRO'
        WHEN color_cabello_legacy ILIKE '%cast%' OR color_cabello_legacy ILIKE '%caf%' THEN 'CASTANO'
        WHEN color_cabello_legacy ILIKE '%rubi%' THEN 'RUBIO'
        WHEN color_cabello_legacy ILIKE '%pelir%' OR color_cabello_legacy ILIKE '%roj%' THEN 'PELIRROJO'
        WHEN color_cabello_legacy ILIKE '%can%' THEN 'CANOSO'
        WHEN color_cabello_legacy ILIKE '%calv%' OR color_cabello_legacy ILIKE '%sin cab%' THEN 'SIN_CABELLO' END,
      contextura = contextura_legacy;

    -- tez / acento / edad_actoral (columnas del proyecto anterior, si existen)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'tez') THEN
      UPDATE perfiles_actores SET tono_piel = CASE
        WHEN tez ILIKE '%muy clar%' THEN 'MUY_CLARA' WHEN tez ILIKE '%clar%' THEN 'CLARA'
        WHEN tez ILIKE '%trigu%' THEN 'TRIGUENA'    WHEN tez ILIKE '%moren%' THEN 'MORENA'
        WHEN tez ILIKE '%oscur%' OR tez ILIKE '%negr%' THEN 'OSCURA' END;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'acento') THEN
      UPDATE perfiles_actores SET dialecto = CASE
        WHEN acento ILIKE '%neutr%' THEN 'NEUTRO'    WHEN acento ILIKE '%boyac%' THEN 'BOYACENSE'
        WHEN acento ILIKE '%cach%' OR acento ILIKE '%bogot%' THEN 'CACHACO'
        WHEN acento ILIKE '%paisa%' OR acento ILIKE '%antioq%' THEN 'PAISA'
        WHEN acento ILIKE '%coste%' OR acento ILIKE '%caribe%' THEN 'COSTENO'
        WHEN acento ILIKE '%vall%' THEN 'VALLUNO'     WHEN acento ILIKE '%santander%' THEN 'SANTANDEREANO'
        WHEN acento ILIKE '%llan%' THEN 'LLANERO'     WHEN acento ILIKE '%pacif%' THEN 'PACIFICO'
        WHEN acento ILIKE '%pastu%' THEN 'PASTUSO' END;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'edad_actoral') THEN
      UPDATE perfiles_actores p SET edad_aparente_min = LEAST(m[1]::int, m[2]::int), edad_aparente_max = GREATEST(m[1]::int, m[2]::int)
        FROM (SELECT actor_id, regexp_matches(edad_actoral, '(\d{1,2})\D+(\d{1,2})') AS m FROM perfiles_actores) x
       WHERE x.actor_id = p.actor_id AND m[1]::int BETWEEN 0 AND 100 AND m[2]::int BETWEEN 0 AND 100;
    END IF;

    -- reel / portafolio (texto) -> enlaces de multimedia si son de YouTube o Vimeo
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'reel_url') THEN
      INSERT INTO archivos_multimedia (actor_id, url_archivo, tipo_archivo, almacenamiento, proveedor_video, id_video, titulo)
      SELECT actor_id, reel_url, 'REEL_PRESENTACION', 'EXTERNO',
             CASE WHEN reel_url ~* 'vimeo\.com' THEN 'VIMEO' ELSE 'YOUTUBE' END,
             COALESCE(substring(reel_url from '(?:v=|youtu\.be/|vimeo\.com/)([A-Za-z0-9_-]{5,})'), 'enlace'), 'Reel'
        FROM perfiles_actores
       WHERE reel_url ~* '^https://(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/'
      ON CONFLICT DO NOTHING;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'portafolio_url') THEN
      INSERT INTO archivos_multimedia (actor_id, url_archivo, tipo_archivo, almacenamiento, proveedor_video, id_video, titulo)
      SELECT actor_id, portafolio_url, 'ENLACE_PORTAFOLIO', 'EXTERNO',
             CASE WHEN portafolio_url ~* 'vimeo\.com' THEN 'VIMEO' ELSE 'YOUTUBE' END,
             COALESCE(substring(portafolio_url from '(?:v=|youtu\.be/|vimeo\.com/)([A-Za-z0-9_-]{5,})'), 'enlace'), 'Portafolio'
        FROM perfiles_actores
       WHERE portafolio_url ~* '^https://(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/'
      ON CONFLICT DO NOTHING;
    END IF;

    -- foto de perfil -> también es un registro FOTO_PERFIL de multimedia (así la usa la vitrina)
    INSERT INTO archivos_multimedia (actor_id, url_archivo, tipo_archivo, almacenamiento, titulo)
    SELECT p.actor_id, p.foto_perfil_url, 'FOTO_PERFIL', 'S3', 'Foto de perfil'
      FROM perfiles_actores p
     WHERE p.foto_perfil_url IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM archivos_multimedia m WHERE m.actor_id = p.actor_id AND m.tipo_archivo = 'FOTO_PERFIL');

    -- las versiones 1 que creó 004 se hicieron antes de esta conversión: se rehacen con los datos finales
    UPDATE perfiles_versiones v SET datos = jsonb_build_object(
        'nombre_artistico', p.nombre_artistico, 'tiene_experiencia', p.tiene_experiencia, 'biografia', p.biografia,
        'foto_perfil_url', p.foto_perfil_url, 'estatura_cm', p.estatura_cm, 'color_ojos', p.color_ojos,
        'color_cabello', p.color_cabello, 'tono_piel', p.tono_piel, 'contextura', p.contextura, 'genero', p.genero,
        'edad_aparente_min', p.edad_aparente_min, 'edad_aparente_max', p.edad_aparente_max,
        'dialecto', p.dialecto, 'provincia', p.provincia)
      FROM perfiles_actores p
     WHERE p.actor_id = v.actor_id AND v.numero_version = 1 AND v.estado IN ('APROBADA', 'PENDIENTE', 'RECHAZADA');

    -- cambios de foto/descripción que estaban esperando aprobación -> versión PENDIENTE
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'foto_pendiente_url') THEN
      INSERT INTO perfiles_versiones (actor_id, numero_version, datos, estado)
      SELECT p.actor_id,
             COALESCE((SELECT max(numero_version) FROM perfiles_versiones v WHERE v.actor_id = p.actor_id), 0) + 1,
             COALESCE((SELECT datos FROM perfiles_versiones v WHERE v.actor_id = p.actor_id AND v.estado = 'APROBADA'), '{}'::jsonb)
               || jsonb_build_object('biografia', COALESCE(p.biografia_pendiente, p.biografia),
                                     'foto_perfil_url', COALESCE(p.foto_pendiente_url, p.foto_perfil_url)),
             'PENDIENTE'
        FROM perfiles_actores p
       WHERE p.estado = 'APROBADO' AND (p.foto_pendiente_url IS NOT NULL OR p.biografia_pendiente IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM perfiles_versiones v WHERE v.actor_id = p.actor_id AND v.estado = 'PENDIENTE');
    END IF;
  END IF;

  -- ---- cursos: estados y modalidades nuevos ----
  IF hay_cursos THEN
    UPDATE cursos_y_talleres SET
      estado = CASE estado_legacy WHEN 'BORRADOR' THEN 'BORRADOR' WHEN 'FINALIZADO' THEN 'FINALIZADO' ELSE 'ABIERTO' END::estado_curso_enum,
      modalidad = CASE upper(translate(COALESCE(modalidad_legacy, ''), 'ÍíÁáÉéÓóÚú', 'IiAaEeOoUu'))
                    WHEN 'VIRTUAL' THEN 'VIRTUAL' WHEN 'HIBRIDA' THEN 'HIBRIDA' ELSE 'PRESENCIAL' END,
      fecha_fin_curso = COALESCE(fecha_fin_curso, fecha_inicio_curso + interval '30 days');
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cursos_y_talleres' AND column_name = 'duracion_horas') THEN
      UPDATE cursos_y_talleres SET horas_totales = duracion_horas WHERE duracion_horas > 0 AND horas_totales IS NULL;
    END IF;
  END IF;

  -- ---- inscripciones: tabla vieja (inscripciones_cursos) -> inscripciones_curso ----
  IF to_regclass('public.inscripciones_cursos') IS NOT NULL THEN
    INSERT INTO inscripciones_curso (curso_id, actor_id, estado, inscrito_en, progreso)
    SELECT i.curso_id, i.actor_id,
           (CASE i.estado WHEN 'COMPLETADA' THEN 'COMPLETADA' ELSE 'INSCRITO' END)::estado_inscripcion_enum,
           COALESCE(i.inscrito_en, now()), LEAST(100, GREATEST(0, COALESCE(i.progreso, 0)))
      FROM inscripciones_cursos i
     ON CONFLICT (curso_id, actor_id) DO NOTHING;
  END IF;

  -- ---- convocatorias: borradores y modalidades ----
  IF hay_legacy AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'convocatorias' AND column_name = 'borrador') THEN
    UPDATE convocatorias SET estado = 'EN_PAUSA' WHERE borrador AND estado = 'PROXIMA';
  END IF;
  UPDATE convocatorias SET modalidad = CASE upper(translate(modalidad, 'ÍíÁáÉéÓóÚú', 'IiAaEeOoUu'))
                                         WHEN 'VIRTUAL' THEN 'VIRTUAL' WHEN 'HIBRIDA' THEN 'HIBRIDA' ELSE 'PRESENCIAL' END
   WHERE modalidad NOT IN ('PRESENCIAL', 'VIRTUAL', 'HIBRIDA');

  -- ---- postulaciones: la etapa vieja manda sobre el estado de 3 valores ----
  IF hay_post THEN
    UPDATE postulaciones_castings SET estado = CASE etapa
        WHEN 'EN_SELECCION' THEN 'PRESELECCIONADO' WHEN 'SELECCIONADO' THEN 'SELECCIONADO'
        WHEN 'NO_SELECCIONADO' THEN 'RECHAZADO' WHEN 'EN_REVISION' THEN 'EN_REVISION' ELSE estado::text
      END::estado_postulacion_enum
     WHERE etapa IS NOT NULL;
  END IF;
END
$conv$;
DROP TABLE IF EXISTS _adopcion_legacy;
