// Preguntas del formulario de opinión y validación de lo que manda el cliente
// (docs/opiniones.md). Lo usan la página pública (antes de enviar) y la ruta
// /api/opinion (al guardar). Puro.
import { z } from "zod";
import { TOKEN_RE } from "./codigo";

export const LLUVIA = [
  { id: "resistio", label: "Sí, y resistió" },
  { id: "se_metio", label: "Sí, y se metió agua" },
  { id: "todavia_no", label: "Todavía no" },
] as const;

export const PERMISO = [
  { id: "con_nombre", label: "Sí, con mi nombre" },
  { id: "sin_nombre", label: "Sí, sin mi nombre" },
  { id: "no", label: "No, solo para ustedes" },
] as const;

export type Lluvia = (typeof LLUVIA)[number]["id"];
export type Permiso = (typeof PERMISO)[number]["id"];

export const TEXTO_MAX = 1000;
export const NOMBRE_MAX = 80;
export const CIUDAD_MAX = 80;

const LLUVIA_IDS = LLUVIA.map((o) => o.id) as [Lluvia, ...Lluvia[]];
const PERMISO_IDS = PERMISO.map((o) => o.id) as [Permiso, ...Permiso[]];

export const respuestaSchema = z
  .object({
    token: z.string().regex(TOKEN_RE, "Este enlace no es válido."),
    estrellas: z
      .number({ error: "Elija de 1 a 5 estrellas." })
      .int("Elija de 1 a 5 estrellas.")
      .min(1, "Elija de 1 a 5 estrellas.")
      .max(5, "Elija de 1 a 5 estrellas."),
    texto: z.string().trim().max(TEXTO_MAX, `Escriba máximo ${TEXTO_MAX} letras.`).default(""),
    lluvia: z.enum(LLUVIA_IDS, { error: "Díganos si ya le tocó una lluvia." }),
    permiso: z.enum(PERMISO_IDS, { error: "Díganos si podemos compartir su opinión." }),
    nombre: z.string().trim().max(NOMBRE_MAX, `Escriba máximo ${NOMBRE_MAX} letras.`).default(""),
    ciudad: z.string().trim().max(CIUDAD_MAX, `Escriba máximo ${CIUDAD_MAX} letras.`).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.permiso === "con_nombre" && !v.nombre) {
      ctx.addIssue({ code: "custom", path: ["nombre"], message: "Escriba su nombre para compartirlo." });
    }
  });

export type RespuestaEntrada = z.input<typeof respuestaSchema>;
export type Respuesta = z.output<typeof respuestaSchema>;

/** Texto exacto del permiso que se guarda con la respuesta (respaldo del consentimiento). */
export function textoPermiso(organizacion: string, permiso: Permiso): string {
  if (permiso === "con_nombre") {
    return `Autorizo a ${organizacion} a compartir mi opinión en sus redes y anuncios con mi nombre y mi ciudad.`;
  }
  if (permiso === "sin_nombre") {
    return `Autorizo a ${organizacion} a compartir mi opinión en sus redes y anuncios sin mi nombre.`;
  }
  return `No autorizo a ${organizacion} a compartir mi opinión: es solo para su equipo.`;
}

/**
 * Lo que se guarda: sin nombre ni ciudad si no autorizó publicarlos (menos datos
 * personales), y vacíos como null.
 */
export function aGuardar(r: Respuesta, organizacion: string) {
  const conNombre = r.permiso === "con_nombre";
  return {
    estrellas: r.estrellas,
    texto: r.texto || null,
    lluvia: r.lluvia,
    permiso: r.permiso,
    nombre: conNombre ? r.nombre || null : null,
    ciudad: conNombre ? r.ciudad || null : null,
    permisoTexto: textoPermiso(organizacion, r.permiso),
  };
}

export function etiquetaLluvia(id: string | null): string | null {
  return LLUVIA.find((o) => o.id === id)?.label ?? null;
}

export function etiquetaPermiso(id: string | null): string | null {
  if (id === "con_nombre") return "Con su nombre";
  if (id === "sin_nombre") return "Sin su nombre";
  if (id === "no") return "No publicar";
  return null;
}
