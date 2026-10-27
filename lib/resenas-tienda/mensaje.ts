// Los textos que piden la reseña (27-oct-2026, aprobados por el dueño, docs/opiniones.md § Amazon y
// Mercado Libre). PUROS y SIN IA. Por WhatsApp solo se le pide al de Mercado Libre: la de Amazon
// se pide en Seller Central (Amazon no deja escribirle por fuera). Sin nada a cambio ni «5
// estrellas»: las tiendas castigan las reseñas pedidas así.
import { greetingFor } from "@/lib/followups/message";
import { TIENDA_NOMBRE, type Tienda } from "./tiendas";

// Dónde se deja la reseña dentro de la tienda.
const DONDE: Readonly<Record<Tienda, string>> = {
  amazon: "La puede dejar en Amazon, en «Mis pedidos» › la compuerta › «Escribir una opinión del producto».",
  mercado_libre: "La puede dejar en Mercado Libre, en «Mis compras» › la compuerta › «Opinar».",
};

/** Texto libre (ventana abierta): saludo de la hora del cliente, como los seguimientos (nunca el nombre del perfil). */
export function mensajeResena(tienda: Tienda, t: Date, zone: string): string {
  return [
    `Hola, ${greetingFor(t, zone)}, le escribo de parte del equipo de Diluvium. Gracias por elegir nuestra compuerta en ${TIENDA_NOMBRE[tienda]}. Cuando ya la tenga instalada, ¿nos ayudaría con su opinión ahí? Si puede, con una foto o un video de cómo le quedó; a otras familias les ayuda mucho para decidirse.`,
    DONDE[tienda],
    "Y si gusta mandarnos la foto por aquí también, se lo agradecemos mucho.",
  ].join("\n\n");
}

/**
 * Plantilla de Meta para cuando ya pasaron 24 h (aprobada como UTILITY el 27-oct-2026, id
 * 1798462208055679). No pide la reseña: reabre la conversación con 3 botones (Me quedó bien ·
 * Tuve un problema · Aún no la instalo); con la respuesta ya sale el texto de arriba.
 */
export const PLANTILLA_RESENA = "resena_tienda";

/** Cómo se ve la plantilla con su {{1}} (la tienda) lleno, igual que en Meta. */
export function textoPlantillaResena(tienda: Tienda): string {
  return `Hola, le escribo de parte del equipo de Diluvium por la compuerta que pidió en ${TIENDA_NOMBRE[tienda]}. ¿Ya la pudo instalar? Nos ayuda mucho saber cómo le quedó.`;
}
