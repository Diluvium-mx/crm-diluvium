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
  asesor: "Asesor sin respuesta",
  objecion: "Lo va a pensar",
};

export type TemplateSectionKey = "daniel" | "seguimiento" | "otras";

export const TEMPLATE_SECTIONS: ReadonlyArray<{ key: TemplateSectionKey; title: string }> = [
  { key: "daniel", title: "Saludo de Daniel" },
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
  return base !== name ? (KNOWN_TITLES[base] ?? name) : name;
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
