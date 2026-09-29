-- Búsqueda DENTRO de los chats (29-sep-2026, decisión del dueño): la lupa amarilla de la
-- Bandeja y el Embudo busca una palabra en todos los mensajes (texto, pies de foto y
-- transcripciones de notas de voz), sin acentos, ñ ni mayúsculas. Buscar "%palabra%" en toda
-- la tabla sin índice tarda ~0.5 s con 300,000 mensajes (prueba local); con este índice de
-- trigramas, milisegundos.
-- 1) pg_trgm: extensión que viene con Postgres (contrib; "trusted" desde PG 13). No es un
--    servicio externo. La imagen del restore de prueba (postgres:18) también la trae.
-- 2) El índice es sobre la MISMA expresión que usa lib/inbox/chat-search.ts
--    (messageSearchText): si una cambia, la otra también, o Postgres deja de usarlo.
--    Las letras son las de lib/text/search.ts (SQL_SEARCH_FROM / SQL_SEARCH_TO).
-- Solo agrega un índice: no toca ninguna fila. drizzle corre en una transacción
-- (CONCURRENTLY no se puede): mientras se construye, las escrituras en `messages` esperan
-- (segundos con decenas de miles de filas; el worker reintenta). El lock_timeout evita
-- quedarse esperando el lock si la tabla está ocupada (falla y el pre-deploy se reintenta).
-- IDEMPOTENTE (IF NOT EXISTS), igual que la 0044. Drizzle no administra este índice (va
-- solo aquí, no en lib/db/schema): es de expresión con operador de pg_trgm.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_busqueda_idx" ON "messages" USING gin (lower(translate(coalesce("body", '') || ' ' || coalesce("transcripcion", ''), 'áàäâãÁÀÄÂÃéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ', 'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunncc')) gin_trgm_ops);--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
