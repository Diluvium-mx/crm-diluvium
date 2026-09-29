// Reglas FIJAS de palabra clave (decisiones del dueño; no se ven ni se editan en el editor). PURO.
//
// «Precio y medidas» (29-sep-2026): si al INICIO un mismo mensaje dispararía «Precio 2» y la Tabla
// de tamaños (estándar) a la vez ("¿Qué precio tiene y qué medidas son?", "Precio y medidas ?"),
// sale «Información»: trae la explicación, la foto de la tabla, el precio y la pregunta — la
// respuesta completa que busca ese cliente. En prod pasó 7 veces en 3 días (5 al inicio); sin la
// regla ganaba la Tabla ("medidas" es más larga que "precio") y el precio quedaba en el aire.
// Se identifican por su `slug` (no cambia al renombrar). Si falta alguno de los tres, o
// «Información» no puede salir (ya salió, ya no es el inicio, llegó a su máximo), no aplica y se
// decide como siempre. Alternativa acordada si esto falla: «palabras combinadas» en el editor
// ("precio + medidas").
export const PRECIO_Y_MEDIDAS = {
  precio: "precio_2_6100",
  tabla: "tabla_tamanos_estandar",
  gana: "informacion_8b3c",
} as const;

/**
 * `firing`: slugs de los workflows que ESTE mensaje dispararía (palabra clave y todo lo que les
 * permite salir). `canWin`: ¿«Información» puede salir ahora? Devuelve el slug ganador o null.
 */
export function fixedRuleWinner(firing: ReadonlySet<string>, canWin: (slug: string) => boolean): string | null {
  const r = PRECIO_Y_MEDIDAS;
  return firing.has(r.precio) && firing.has(r.tabla) && canWin(r.gana) ? r.gana : null;
}
