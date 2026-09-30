-- Miniaturas de la Biblioteca (30-sep-2026, pedido del dueño: Multimedia sin espera). JPEG chico
-- (240×240) en base64 que hace el navegador al subir el archivo o, para los que ya estaban, la primera
-- vez que alguien abre Multimedia. Llega con la lista: Multimedia ya no descarga los videos para
-- pintar su primer cuadro. Columna nullable sin valor por defecto: no reescribe la tabla.
-- IDEMPOTENTE (IF NOT EXISTS) y con lock_timeout, igual que la 0051.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "thumbnail" text;
