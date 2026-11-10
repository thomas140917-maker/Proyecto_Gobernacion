-- ==========================================
-- 002 - Ajustes Semana 1
-- ==========================================

-- Unicidad (evita inscripciones duplicadas)
ALTER TABLE actores
    ADD CONSTRAINT uq_actores_numero_documento UNIQUE (numero_documento),
    ADD CONSTRAINT uq_actores_correo UNIQUE (correo);
ALTER TABLE administradores
    ADD CONSTRAINT uq_admin_correo UNIQUE (correo);

-- Valores por defecto razonables
ALTER TABLE actores            ALTER COLUMN esta_activo     SET DEFAULT true;
ALTER TABLE administradores    ALTER COLUMN esta_activo     SET DEFAULT true;
ALTER TABLE acudientes_legales ALTER COLUMN esta_verificado SET DEFAULT false;
ALTER TABLE perfiles_actores   ALTER COLUMN estado          SET DEFAULT 'PENDIENTE';

-- Rasgos físicos en el perfil
ALTER TABLE perfiles_actores
    ADD COLUMN estatura_cm   integer CHECK (estatura_cm BETWEEN 50 AND 250),
    ADD COLUMN color_ojos    varchar(50),
    ADD COLUMN color_cabello varchar(50),
    ADD COLUMN tono_piel     varchar(50),
    ADD COLUMN contextura    varchar(50);

-- Recuperación de contraseña de administradores (RF-20)
-- Se guarda solo el HASH (sha256) del token, nunca el token en claro.
CREATE TABLE tokens_recuperacion (
    token_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    uuid NOT NULL,
    token_hash  varchar(64) NOT NULL UNIQUE,
    expira_en   timestamp NOT NULL,
    usado_en    timestamp,
    creado_en   timestamp NOT NULL DEFAULT now(),
    CONSTRAINT fk_token_admin FOREIGN KEY (admin_id)
        REFERENCES administradores (admin_id) ON DELETE CASCADE
);
CREATE INDEX idx_tokens_admin ON tokens_recuperacion (admin_id);
