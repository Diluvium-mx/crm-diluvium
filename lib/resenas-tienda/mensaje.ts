// El mensaje que pide la reseña en Amazon o Mercado Libre (27-oct-2026, texto aprobado por el
// dueño, docs/opiniones.md § Amazon y Mercado Libre). PURO y SIN IA: texto fijo con el saludo
// de la hora del cliente, como los seguimientos (nunca el nombre del perfil). Sin nada a cambio
// ni «5 estrellas»: las dos tiendas castigan las reseñas pedidas así.
import { greetingFor } from "@/lib/followups/message";
import { TIENDA_NOMBRE, type Tienda } from "./tiendas";

// Sin enlace configurado, dónde se deja la reseña dentro de la tienda.
const DONDE: Readonly<Record<Tienda, string>> = {
  amazon: "La puede dejar en Amazon, en «Mis pedidos» › la compuerta › «Escribir una opinión del producto».",
  mercado_libre: "La puede dejar en Mercado Libre, en «Mis compras» › la compuerta › «Opinar».",
};

export function mensajeResena(tienda: Tienda, enlace: string | null, t: Date, zone: string): string {
  const donde = enlace ? `Aquí la puede dejar: ${enlace}` : DONDE[tienda];
  return [
    `Hola, ${greetingFor(t, zone)}, le escribo de parte del equipo de Diluvium. Gracias por elegir nuestra compuerta en ${TIENDA_NOMBRE[tienda]}. Cuando ya la tenga instalada, ¿nos ayudaría con su opinión ahí? Si puede, con una foto o un video de cómo le quedó; a otras familias les ayuda mucho para decidirse.`,
    donde,
    "Y si gusta mandarnos la foto por aquí también, se lo agradecemos mucho.",
  ].join("\n\n");
}
