-- lock_timeout: drizzle corre todas las migraciones en UNA transacción; si un
-- ALTER no consigue su lock en 5 s, falla (y se reintenta) en vez de bloquear el
-- tráfico. Se restablece al final para no afectar a las migraciones siguientes.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
