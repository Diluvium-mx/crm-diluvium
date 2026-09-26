-- Anuncios de Meta: estado Activa/Pausada leído de Meta cada hora (lib/ads/meta-status.ts).
-- status_checked_at = última lectura buena; si es vieja (Meta falló), la tabla muestra "—".
-- IDEMPOTENTE (IF NOT EXISTS), igual que la 0035.
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "status_checked_at" timestamp;
