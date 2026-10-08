// Enlaces de la pantalla final del formulario de opinión (docs/opiniones.md): mandar
// la foto por WhatsApp, compartir con un vecino (con el código) y el del formulario.
// Puro.
import { whatsappPhoneLink } from "@/lib/contacts/whatsapp-link";

/** Abre el chat con la empresa para mandar la foto o el video (cae en el CRM). */
export function enlaceFoto(telefonoEmpresa: string): string {
  return whatsappPhoneLink(telefonoEmpresa, "Hola, les mando la foto de cómo me quedó la compuerta.");
}

/**
 * Abre WhatsApp para que el cliente elija a quién mandarle el mensaje. El mensaje
 * trae el enlace al chat de la empresa con su código ya escrito: así se sabe quién
 * lo recomendó.
 */
export function enlaceCompartir(telefonoEmpresa: string, organizacion: string, codigo: string): string {
  const alChat = whatsappPhoneLink(
    telefonoEmpresa,
    `Hola, vengo de parte de un cliente de ${organizacion}. Mi código es ${codigo}.`,
  );
  const mensaje = `Yo puse una compuerta anti-inundaciones de ${organizacion}. Si a usted también se le mete el agua, escríbales aquí: ${alChat}`;
  return `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
}

/** Enlace público al formulario. */
export function enlaceOpinion(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/opinion/${token}`;
}
