// Cómo se ORDENAN y se NOMBRAN las plantillas en el selector 📄 (composer, 🕒 Programar mensaje
// y primer mensaje de Contactos): secciones por prefijo y un título amigable para las conocidas
// (el nombre técnico de Meta se sigue viendo chico debajo). Puro, para testearlo solo.
import { matchesSearch } from "@/lib/text/search";

/** Título por la parte del nombre que va después de `seg_` o `daniel_`. */
const KNOWN_TITLES: Readonly<Record<string, string>> = {
  precio: "Precio sin respuesta",
  informacion: "Solo información",
  info_duda: "¿Le quedó alguna duda?",
  valorar: "Valorar la compra",
  medidas: "Faltan medidas",
  medidas_recordatorio: "Faltan medidas (recordatorio)",
  medidas_cotizacion: "Faltan medidas (utilidad)",
  foto_entrada: "Foto de la entrada",
  asesor: "Asesor sin respuesta",
  objecion: "Lo va a pensar",
};

/** Título de las conocidas que no son `seg_` ni `daniel_`. */
const OTHER_TITLES: Readonly<Record<string, string>> = {
  resena_tienda: "Reseña en tienda",
};

/**
 * Plantillas cuyo {{1}} no es el nombre del cliente: con qué se llena al elegirla (se puede
 * cambiar). La reseña por WhatsApp solo se pide en Mercado Libre; la de Amazon, en Seller Central
 * (docs/opiniones.md § 7).
 */
const FIRST_VALUES: Readonly<Record<string, string>> = {
  resena_tienda: "Mercado Libre",
};

export function templateFirstValue(name: string): string | undefined {
  return FIRST_VALUES[name];
}

export type TemplateSectionKey = "daniel" | "seguimiento" | "otras";

export const TEMPLATE_SECTIONS: ReadonlyArray<{ key: TemplateSectionKey; title: string }> = [
  // Las `daniel_*` conservan su nombre en Meta (no se puede cambiar); desde el 26-oct-2026 su texto dice Carlos,
  // el vendedor nuevo (Daniel renunció).
  { key: "daniel", title: "Saludo de Carlos" },
  { key: "seguimiento", title: "Seguimiento" },
  { key: "otras", title: "Otras" },
];

export function templateSection(name: string): TemplateSectionKey {
  if (name.startsWith("daniel_")) return "daniel";
  if (name.startsWith("seg_")) return "seguimiento";
  return "otras";
}

/** Título amigable de una plantilla conocida; si no se conoce, su nombre técnico. */
export function templateTitle(name: string): string {
  const base = name.replace(/^(seg|daniel)_/, "");
  return base !== name ? (KNOWN_TITLES[base] ?? name) : (OTHER_TITLES[name] ?? name);
}

/**
 * Texto que se muestra en la lista: en las de «Saludo de Carlos» todas empiezan con el mismo
 * saludo, así que se enseña lo que cambia (lo que va después del primer párrafo).
 */
export function templateSnippet(name: string, bodyText: string): string {
  if (templateSection(name) !== "daniel") return bodyText;
  const rest = bodyText.split(/\n\s*\n/).slice(1).join("\n\n").trim();
  return rest || bodyText;
}

type Groupable = { name: string; bodyText: string | null };

/** ¿La plantilla coincide con lo buscado? (nombre, título o texto; sin acentos ni mayúsculas). */
export function templateMatches(template: Groupable, query: string): boolean {
  return [template.name, templateTitle(template.name), template.bodyText ?? ""].some((text) => matchesSearch(text, query));
}

/** Secciones en orden fijo, sin las vacías; dentro, el orden en que llegaron. */
export function groupTemplates<T extends Groupable>(templates: readonly T[], query = ""): Array<{ key: TemplateSectionKey; title: string; items: T[] }> {
  const visible = templates.filter((t) => templateMatches(t, query));
  return TEMPLATE_SECTIONS.map((section) => ({ ...section, items: visible.filter((t) => templateSection(t.name) === section.key) })).filter(
    (section) => section.items.length > 0,
  );
}
