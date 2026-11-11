// Los mensajes para pedir la reseña por WhatsApp Web (6-nov-2026, aprobados por el dueño,
// docs/opiniones.md § 8). PUROS y SIN IA: textos fijos que solo se llenan con el saludo de la hora
// del cliente, su nombre, el trato que eligió el vendedor, quién escribe y la tienda. El CRM ya no
// los manda: el vendedor los copia y los manda él mismo desde WhatsApp Web, sin costo.
// Reglas de las tiendas: a todos por igual (les haya ido bien o mal), sin nada a cambio y sin
// pedir «5 estrellas».
import { TIENDA_NOMBRE, type Tienda, type Trato } from "./tiendas";

// Dónde se deja la reseña dentro de la tienda.
const DONDE: Readonly<Record<Tienda, string>> = {
  amazon: "en Amazon, en «Mis pedidos» › la compuerta › «Escribir una opinión del producto»",
  mercado_libre: "en Mercado Libre, en «Mis compras» › la compuerta › «Opinar»",
};

const TRATO: Readonly<Record<Trato, string>> = { sr: "Sr.", sra: "Sra." };

/** «LETICIA» o «leticia» → «Leticia»; respeta lo que ya viene con mayúsculas y minúsculas. */
export function nombreBonito(nombre: string): string {
  const limpio = nombre.replace(/\s+/g, " ").trim();
  if (limpio !== limpio.toUpperCase() && limpio !== limpio.toLowerCase()) return limpio;
  return limpio.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, antes: string, letra: string) => antes + letra.toUpperCase());
}

export type DatosMensaje = {
  tienda: Tienda;
  /** Su primer nombre en el CRM (puede venir vacío). */
  nombre: string;
  trato: Trato | null;
  /** «buenos días» / «buenas tardes» / «buenas noches», en la hora del cliente. */
  saludo: string;
  /** Primer nombre de quien escribe (el vendedor con la sesión abierta). */
  vendedor: string | null;
};

/** Los dos primeros mensajes (van a todos) y las tres respuestas, según lo que conteste. */
export type MensajesWhatsApp = {
  saludo: string;
  pregunta: string;
  bien: string;
  problema: string;
  sinInstalar: string;
};

export function mensajesWhatsApp(d: DatosMensaje): MensajesWhatsApp {
  const nombre = nombreBonito(d.nombre);
  const aQuien = nombre ? (d.trato ? `${TRATO[d.trato]} ${nombre}` : nombre) : "";
  const vendedor = d.vendedor ? nombreBonito(d.vendedor) : "";
  const tienda = TIENDA_NOMBRE[d.tienda];
  const donde = DONDE[d.tienda];
  return {
    saludo: `Hola, ${d.saludo}${aQuien ? `, ${aQuien}` : ""}. ${vendedor ? `Le habla ${vendedor}, de Diluvium` : "Le escribo de parte de Diluvium"} 😃`,
    pregunta: `Le escribo para saber cómo le fue con su compuerta anti-inundaciones que pidió en ${tienda}. ¿Ya la pudo instalar?`,
    bien: `¡Qué gusto saberlo! Gracias por contarme. Oiga, ¿me haría un favor? ¿Podría dejar su opinión en ${tienda}? Lo que usted cuente le sirve mucho a otras personas que están viendo cómo protegerse de una inundación, y a nosotros como negocio pequeño nos ayuda bastante. Si puede, con una foto de cómo le quedó. Le toma un minuto: se deja ${donde} 🙏`,
    problema: `Gracias por decírmelo, lo vamos a resolver. Cuénteme qué pasó y, si puede, mándeme una foto para ayudarle. Cuando ya quede, si gusta dejar su opinión en ${tienda}, sea como sea su experiencia, también nos sirve mucho para mejorar. Se deja ${donde}.`,
    sinInstalar: `Sin problema. Cuando la instale, cualquier duda aquí estoy para ayudarle. Mientras tanto, si gusta, puede dejar su opinión de cómo le fue con la compra: si le llegó rápido, cómo venía el empaque y la atención. Nos ayuda muchísimo ☺️ Se deja ${donde}.`,
  };
}

/**
 * Abre su chat en WhatsApp Web con el saludo ya escrito (el vendedor solo da Enviar). null si no
 * hay teléfono.
 */
export function enlaceWhatsAppWeb(telefonoE164: string | null, texto: string): string | null {
  const digitos = (telefonoE164 ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return null;
  return `https://web.whatsapp.com/send?phone=${digitos}&text=${encodeURIComponent(texto)}`;
}
