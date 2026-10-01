// Primer nombre del contacto para llenar solo el hueco {{1}} de una plantilla (1-oct-2026,
// como GHL con {{contact.first_name}}). Puro. Si el "nombre" es en realidad un teléfono o
// no trae letras (contactos sin nombre de perfil), no se llena: lo escribe el vendedor.
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return /\p{L}/u.test(first) ? first : "";
}
