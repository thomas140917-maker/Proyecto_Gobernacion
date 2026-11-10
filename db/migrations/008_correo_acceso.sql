-- ==========================================
-- 008 - Verificación de correo y recuperación de contraseña (actores y administradores)
-- Solo agrega. Se guarda el HASH (sha256) del token, nunca el token en claro.
-- Los actores que ya existían se consideran verificados (no se les pide verificar de nuevo).
-- ==========================================
ALTER TABLE actores ADD COLUMN IF NOT EXISTS correo_verificado_en timestamp;
UPDATE actores SET correo_verificado_en = COALESCE(creado_en, now()) WHERE correo_verificado_en IS NULL;

CREATE TABLE IF NOT EXISTS tokens_correo (
    token_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo        varchar(20) NOT NULL CHECK (tipo IN ('VERIFICACION', 'RECUPERACION')),
    actor_id    uuid REFERENCES actores (actor_id) ON DELETE CASCADE,
    admin_id    uuid REFERENCES administradores (admin_id) ON DELETE CASCADE,
    token_hash  varchar(64) NOT NULL UNIQUE,
    expira_en   timestamp NOT NULL,
    usado_en    timestamp,
    creado_en   timestamp NOT NULL DEFAULT now(),
    CONSTRAINT ck_token_dueno CHECK ((actor_id IS NOT NULL)::int + (admin_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_tokens_correo_actor ON tokens_correo (actor_id, tipo);
CREATE INDEX IF NOT EXISTS idx_tokens_correo_admin ON tokens_correo (admin_id, tipo);
