-- SOLO si quieres usar tu base "postgres" actual (la de pgAdmin con las 7 tablas viejas).
-- BORRA datos. Ejecutar antes de 001 y 002.
DROP TABLE IF EXISTS actividades_formacion, convocatorias, inscripciones_formacion,
    perfiles_actores, portafolios_multimedia, postulaciones, usuarios CASCADE;
DROP TYPE IF EXISTS tipo_documento_enum, tipo_multimedia_enum, estado_perfil_enum,
    estado_convocatoria_enum, estado_postulacion_enum, tipo_accion_auditoria_enum CASCADE;
