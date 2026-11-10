-- ==========================================
-- 003 - Endurecimiento de seguridad e integridad
-- ==========================================

-- Bloqueo por intentos fallidos e invalidación de sesiones tras cambio de contraseña
ALTER TABLE administradores
    ADD COLUMN intentos_fallidos          integer   NOT NULL DEFAULT 0,
    ADD COLUMN bloqueado_hasta            timestamp,
    ADD COLUMN contrasena_actualizada_en  timestamp NOT NULL DEFAULT now();

-- Integridad de datos
ALTER TABLE actores
    ADD CONSTRAINT ck_actores_correo_minuscula CHECK (correo = lower(correo)),
    ADD CONSTRAINT ck_actores_terminos         CHECK (acepta_terminos),
    ADD CONSTRAINT ck_actores_nacimiento       CHECK (fecha_nacimiento <= CURRENT_DATE);
ALTER TABLE administradores
    ADD CONSTRAINT ck_admin_correo_minuscula   CHECK (correo = lower(correo));
ALTER TABLE convocatorias       ADD CONSTRAINT ck_conv_cupo  CHECK (cupo_maximo > 0);
ALTER TABLE cursos_y_talleres   ADD CONSTRAINT ck_curso_cupo CHECK (cupo_maximo > 0);
ALTER TABLE experiencias_actor  ADD CONSTRAINT ck_exp_anio   CHECK (anio BETWEEN 1900 AND 2100);

-- Un actor no puede postularse dos veces a la misma convocatoria
ALTER TABLE postulaciones_castings
    ADD CONSTRAINT uq_postulacion_unica UNIQUE (convocatoria_id, actor_id);

-- Índices en llaves foráneas y filtros frecuentes
CREATE INDEX idx_acudientes_actor     ON acudientes_legales (actor_id);
CREATE INDEX idx_experiencias_actor   ON experiencias_actor (actor_id);
CREATE INDEX idx_redes_actor          ON redes_sociales_actor (actor_id);
CREATE INDEX idx_multimedia_actor     ON archivos_multimedia (actor_id);
CREATE INDEX idx_postulaciones_actor  ON postulaciones_castings (actor_id);
CREATE INDEX idx_perfiles_estado      ON perfiles_actores (estado);
CREATE INDEX idx_auditoria_entidad    ON historial_auditoria (entidad_afectada, entidad_id);
