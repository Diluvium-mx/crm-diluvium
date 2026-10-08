// Contactos que ESTA pestaña está borrando ahora (ARCO, 7-oct-2026). El aviso en vivo
// `contact.deleted` llega en cuanto la base confirma, ANTES de que termine el borrado de archivos:
// si la Bandeja o el Embudo cerraran el Detalle en ese momento, se llevarían la ventana de borrar
// con su resultado (p. ej. «quedaron 3 archivos · Reintentar»). Mientras está aquí, el tablero
// solo anota que llegó el aviso y la ventana lo quita al cerrarse. Sin lógica de datos.
const deleting = new Map<string, boolean>();

export function startDeleting(contactId: string): void {
  deleting.set(contactId, false);
}

/** ¿La ventana de esta pestaña lo está borrando? (el tablero no lo quita todavía). */
export function isDeletingHere(contactId: string): boolean {
  return deleting.has(contactId);
}

/** El tablero recibió `contact.deleted` de uno que se está borrando aquí. */
export function noteDeletedEvent(contactId: string): void {
  if (deleting.has(contactId)) deleting.set(contactId, true);
}

/** Termina; devuelve si mientras tanto llegó el aviso de que sí se borró. */
export function finishDeleting(contactId: string): boolean {
  const arrived = deleting.get(contactId) ?? false;
  deleting.delete(contactId);
  return arrived;
}
