// Llaves de candados advisory compartidas entre módulos (texto puro, sin DB).

/**
 * Candado de contactos por organización: la ingesta de WhatsApp lo toma
 * COMPARTIDO al resolver/crear un contacto; el importador de contactos lo toma
 * EXCLUSIVO. Así un webhook y un CSV con el mismo teléfono no insertan dos
 * contactos a la vez (el teléfono no es único por los duplicados de GHL).
 */
export function contactsImportLockKey(orgId: string): string {
  return `contacts-import:${orgId}`;
}
