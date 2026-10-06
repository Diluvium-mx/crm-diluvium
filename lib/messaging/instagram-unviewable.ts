// Lo que el cliente mandó por Instagram y el CRM no puede mostrar (6-oct-2026, dueño: «como
// tarjeta, no como mensaje del cliente»). PURO (sin BD).
//
// El mensaje se guarda con la etiqueta como texto (la Bandeja lo cuenta y el Agente IA sabe que
// el cliente mandó algo que no se pudo ver), pero el chat lo pinta como TARJETA de aviso, igual
// que el «mensaje no disponible» de WhatsApp (Meta 131060). Va por el texto guardado, así que
// también cambian los mensajes viejos.

/** Meta no deja ver el contenido (noRenderableContent). */
export const INSTAGRAM_WITHHELD = "📎 Instagram no deja ver este mensaje en el CRM; ábrelo en la app de Instagram";
/** Foto o video temporal («ver una vez»): llega sin archivo. */
export const INSTAGRAM_EPHEMERAL = "📎 Mandó una foto o video temporal; Instagram no deja verlo en el CRM, ábrelo en la app de Instagram";

const CARD_TEXT: Record<string, string> = {
  [INSTAGRAM_WITHHELD]: "El cliente mandó un mensaje que Instagram no deja ver aquí: ábrelo en la app de Instagram.",
  [INSTAGRAM_EPHEMERAL]: "El cliente mandó una foto o video temporal. Instagram no deja verlo aquí: ábrelo en la app de Instagram.",
};

/** Texto de la tarjeta si el mensaje es algo de Instagram que no se puede ver; null si es un mensaje normal. */
export function instagramUnviewableCard(body: string | null | undefined): string | null {
  return body ? (CARD_TEXT[body.trim()] ?? null) : null;
}
