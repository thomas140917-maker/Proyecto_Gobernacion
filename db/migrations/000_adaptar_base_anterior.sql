-- ==========================================
-- 000 - Adaptación de una base de datos del proyecto ANTERIOR (frontend v1–v4)
--
-- Es un NO-OP en una base nueva y en una base que ya es de este backend.
-- Solo actúa si encuentra el esquema anterior (tablas del proyecto Express) y todavía
-- no existe `perfiles_versiones`. Deja la base en el estado en que la dejaría
-- 001_schema.sql para que 002..006 se apliquen sin errores, y conserva los datos.
-- Los valores viejos se guardan en columnas *_legacy; 007 los convierte.
-- ==========================================
DO $legacy$
BEGIN
  IF to_regclass('public.actores') IS NULL THEN RETURN; END IF;
  IF to_regclass('public.perfiles_versiones') IS NOT NULL THEN RETURN; END IF;
  IF to_regclass('public.historial_auditoria') IS NULL THEN RETURN; END IF;

  -- Marca que usa 007 para saber que debe convertir datos (y que borra al terminar)
  CREATE TABLE IF NOT EXISTS _adopcion_legacy (hecho boolean);

  -- ---------- enums que crea 001 (el proyecto anterior no los tenía) ----------
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_convocatoria_enum') THEN
    CREATE TYPE estado_convocatoria_enum AS ENUM ('BORRADOR', 'ABIERTA', 'CERRADA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_postulacion_enum') THEN
    CREATE TYPE estado_postulacion_enum AS ENUM ('PENDIENTE', 'ACEPTADA', 'RECHAZADA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_multimedia_enum') THEN
    CREATE TYPE tipo_multimedia_enum AS ENUM ('FOTO', 'VIDEO', 'AUDIO', 'DOCUMENTO');
  END IF;

  -- ---------- convocatorias: el estado era estado_perfil_enum + columna "borrador" ----------
  IF to_regclass('public.convocatorias') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'convocatorias' AND column_name = 'borrador') THEN
      ALTER TABLE convocatorias ADD COLUMN borrador boolean NOT NULL DEFAULT false;
    END IF;
    ALTER TABLE convocatorias ALTER COLUMN estado TYPE text USING estado::text;
    ALTER TABLE convocatorias ALTER COLUMN estado TYPE estado_convocatoria_enum
      USING (CASE WHEN borrador THEN 'BORRADOR' ELSE 'ABIERTA' END)::estado_convocatoria_enum;
    UPDATE convocatorias SET cupo_maximo = 1 WHERE cupo_maximo IS NULL OR cupo_maximo <= 0;
  END IF;

  -- ---------- postulaciones: el estado era estado_perfil_enum + columna "etapa" ----------
  IF to_regclass('public.postulaciones_castings') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'postulaciones_castings' AND column_name = 'etapa') THEN
      ALTER TABLE postulaciones_castings ADD COLUMN etapa varchar(20);
    END IF;
    ALTER TABLE postulaciones_castings ALTER COLUMN estado TYPE text USING estado::text;
    UPDATE postulaciones_castings
       SET etapa = COALESCE(etapa, CASE estado WHEN 'APROBADO' THEN 'SELECCIONADO'
                                                WHEN 'RECHAZADO' THEN 'NO_SELECCIONADO' ELSE 'EN_REVISION' END);
    ALTER TABLE postulaciones_castings ALTER COLUMN estado TYPE estado_postulacion_enum
      USING (CASE estado WHEN 'APROBADO' THEN 'ACEPTADA' WHEN 'RECHAZADO' THEN 'RECHAZADA' ELSE 'PENDIENTE' END)::estado_postulacion_enum;
  END IF;

  -- ---------- multimedia: tipo_archivo era varchar ----------
  IF to_regclass('public.archivos_multimedia') IS NOT NULL THEN
    ALTER TABLE archivos_multimedia ALTER COLUMN tipo_archivo TYPE tipo_multimedia_enum
      USING (CASE upper(tipo_archivo) WHEN 'VIDEO' THEN 'VIDEO' WHEN 'AUDIO' THEN 'AUDIO'
                                      WHEN 'DOCUMENTO' THEN 'DOCUMENTO' ELSE 'FOTO' END)::tipo_multimedia_enum;
  END IF;

  -- ---------- perfiles_actores: columnas que 002/005 vuelven a crear con otro formato ----------
  IF to_regclass('public.perfiles_actores') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'color_ojos') THEN
      ALTER TABLE perfiles_actores RENAME COLUMN color_ojos TO color_ojos_legacy;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'color_cabello') THEN
      ALTER TABLE perfiles_actores RENAME COLUMN color_cabello TO color_cabello_legacy;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'contextura') THEN
      ALTER TABLE perfiles_actores RENAME COLUMN contextura TO contextura_legacy;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'estatura_cm') THEN
      ALTER TABLE perfiles_actores RENAME COLUMN estatura_cm TO estatura_cm_legacy;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_actores' AND column_name = 'genero') THEN
      ALTER TABLE perfiles_actores RENAME COLUMN genero TO genero_legacy;
    END IF;
    -- 007 lee estas columnas: se garantiza que existan aunque el esquema anterior fuera más antiguo
    ALTER TABLE perfiles_actores
      ADD COLUMN IF NOT EXISTS color_ojos_legacy text,
      ADD COLUMN IF NOT EXISTS color_cabello_legacy text,
      ADD COLUMN IF NOT EXISTS contextura_legacy text;
  END IF;

  -- ---------- cursos: estado y modalidad chocan con las columnas que crea 006 ----------
  IF to_regclass('public.cursos_y_talleres') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cursos_y_talleres' AND column_name = 'estado') THEN
      ALTER TABLE cursos_y_talleres RENAME COLUMN estado TO estado_legacy;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cursos_y_talleres' AND column_name = 'modalidad') THEN
      ALTER TABLE cursos_y_talleres RENAME COLUMN modalidad TO modalidad_legacy;
    END IF;
    UPDATE cursos_y_talleres SET cupo_maximo = 1 WHERE cupo_maximo IS NULL OR cupo_maximo <= 0;
    UPDATE cursos_y_talleres SET fecha_inicio_inscripcion = fecha_inicio_curso
     WHERE fecha_inicio_inscripcion > fecha_inicio_curso;
  END IF;

  -- ---------- experiencias: 003 exige 1900 <= anio <= 2100 ----------
  IF to_regclass('public.experiencias_actor') IS NOT NULL THEN
    UPDATE experiencias_actor SET anio = EXTRACT(YEAR FROM now())::int WHERE anio NOT BETWEEN 1900 AND 2100;
  END IF;
END
$legacy$;
