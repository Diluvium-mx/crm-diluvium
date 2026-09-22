-- Rangos iniciales para todas las organizaciones que ya existen. El conflicto
-- se ignora para que la siembra sea idempotente por organización, línea y talla.
INSERT INTO "tallas_compuerta" (
	"id",
	"organization_id",
	"linea",
	"talla",
	"min_cm",
	"max_cm",
	"posicion"
)
SELECT
	gen_random_uuid()::text,
	"organization"."id",
	seed."linea"::"linea_compuerta",
	seed."talla",
	seed."min_cm",
	seed."max_cm",
	seed."posicion"
FROM "organization"
CROSS JOIN (
	VALUES
		('mini', 'XXCH', 62, 70, 1),
		('mini', 'XCH', 71, 79, 2),
		('mini', 'CH', 80, 88, 3),
		('mini', 'M', 89, 97, 4),
		('mini', 'G', 98, 106, 5),
		('mini', 'XG', 107, 115, 6),
		('mini', 'XXG', 116, 123, 7),
		('estandar', 'Estándar', 69, 120, 1),
		('estandar', 'A la medida', 121, 250, 2)
) AS seed("linea", "talla", "min_cm", "max_cm", "posicion")
ON CONFLICT ("organization_id", "linea", "talla") DO NOTHING;
