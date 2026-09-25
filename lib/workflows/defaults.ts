// Workflows predeterminados de la Fase D (docs/fase-d-diseno.md §1): SOLO envíos
// de media (24-sep-2026). Etapa, avisos y comprobantes son acciones internas del
// agente (lib/ai/runtime/actions.ts), no workflows; "Restaurar predeterminados"
// nunca vuelve a crear los viejos de cobro/humano/etapa. Textos y
// palabras clave IGUALES a los workflows de GHL (auditoría del dueño, 24-sep-2026);
// el admin los ajusta después en la pestaña Automatización. Puro: sin DB.
//
// Palabras clave: coincidencia "contiene" sin mayúsculas ni acentos, como GHL.
// Por palabra clave cada workflow se manda UNA vez por contacto (marca en el
// contacto, como la etiqueta "medidas enviadas" de GHL); por comando del
// vendedor y por petición del agente se manda siempre. Los workflows NUNCA
// pausan al agente. Datos bancarios, tabla mini, dónde medir y medidas
// especiales no llevan palabra clave (solo agente y comando).
// Como GHL, el texto de un paso de imagen/video va como PIE del adjunto (un solo
// mensaje de WhatsApp: Zernio manda `message` junto con `attachmentUrl`); un
// paso de solo texto sigue siendo un mensaje aparte.
// Reglas del Goal que respetan estos textos: "tamaño" (nunca "talla"), precios
// tal cual la base ($5,500 estándar, $7,000 a la medida, $3,000 mini, tapones
// $749/$799/$849).
import type { StepPayload } from "./steps";

export type DefaultWorkflow = {
  slug: string;
  name: string;
  agentDescription: string;
  triggerAgent: boolean;
  triggerKeywords: string[];
  triggerCommand: string | null;
  steps: StepPayload[];
};

const media = (title: string, caption?: string): StepPayload => ({ kind: "send_media", assetId: null, title, ...(caption ? { caption } : {}) });
const text = (t: string): StepPayload => ({ kind: "send_text", text: t });

export const DEFAULT_WORKFLOWS: readonly DefaultWorkflow[] = [
  {
    slug: "tabla_tamanos_estandar",
    name: "Tabla de tamaños (estándar)",
    agentDescription:
      "Envía la imagen con la tabla de tamaños de las compuertas estándar (XCH a XG, entradas de 69 a 120 cm). " +
      "Úsala cuando el cliente pregunte qué tamaños hay, cómo saber cuál le queda, o pida la tabla. " +
      "Responde primero su duda en texto y luego llama esta herramienta.",
    triggerAgent: true,
    triggerKeywords: ["tamaños", "medidas", "tallas", "que tamaño son", "que medidas hay", "cuales son las medidas"],
    triggerCommand: "/tabla",
    steps: [
      { kind: "wait", seconds: 30 },
      media("Tabla de tamaños — compuerta estándar (PNG/JPG)", "Aquí le comparto una foto de los tamaños estándar disponibles para envío inmediato 🙌"),
    ],
  },
  {
    slug: "tabla_tamanos_mini",
    name: "Tabla de tamaños (mini)",
    agentDescription:
      "Envía la imagen con la tabla de tamaños de las mini compuertas (30 cm de alto, XXCH a XXG, entradas de 62 a 123 cm). " +
      "Úsala solo cuando el cliente ya confirmó que necesita menor altura y pregunte tamaños o pida la tabla. " +
      "Nunca la ofrezcas por tu cuenta.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/mini",
    steps: [
      media("Tabla de tamaños — mini compuerta (PNG/JPG)", "Aquí le comparto una foto de los tamaños de las mini compuertas 🙌"),
    ],
  },
  {
    slug: "datos_bancarios",
    name: "Datos bancarios",
    agentDescription:
      "Envía la imagen con los datos bancarios para depósito o transferencia (el CRM mueve al contacto a 'Cerca de compra'). " +
      "Úsala únicamente cuando el cliente ya tiene tamaño y total definidos y elige pagar por transferencia o depósito. " +
      "No la uses después de que el cliente mandó un comprobante.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/banco",
    steps: [
      media("Datos bancarios (imagen con banco, cuenta y beneficiario)", "Aquí le paso nuestros datos bancarios ✅"),
    ],
  },
  {
    slug: "video_instalacion_estandar",
    name: "Video de instalación (estándar)",
    agentDescription:
      "Envía el video de instalación de la compuerta estándar como archivo. " +
      "Úsala cuando el cliente pregunte cómo se instala, cómo se coloca, si es difícil, o pida el video. " +
      "Responde primero en texto (no requiere obra ni herramientas especiales) y luego llama esta herramienta.",
    triggerAgent: true,
    triggerKeywords: ["como se instalan", "como se ponen", "como es el proceso de instalación", "instalacion", "instalación", "ponen"],
    triggerCommand: "/video",
    steps: [
      media(
        "Video de instalación — compuerta estándar (MP4 H.264, ≤16 MB)",
        "Aquí le comparto un video de la instalación de las compuertas tamaño estándar 🙌\n\nEstán diseñadas para que el cliente las instale en menos de 15 minutos",
      ),
    ],
  },
  {
    slug: "video_instalacion_medida",
    name: "Video de instalación (a la medida)",
    agentDescription:
      "Envía el video de instalación de la compuerta hecha a la medida (entradas de 121 a 250 cm) como archivo. " +
      "Úsala cuando el cliente con una entrada mayor a 120 cm pregunte cómo se instala o pida el video.",
    triggerAgent: true,
    triggerKeywords: ["hecha a la medida", "es para una cochera", "no le queda", "es para un porton", "portón"],
    triggerCommand: "/video-medida",
    steps: [
      media(
        "Video de instalación — compuerta a la medida (MP4 H.264, ≤16 MB)",
        "Aquí le comparto un video de instalación de las compuertas hechas a la medida 🙌\n\nComo máximo fabricamos compuertas de 2.50mts de ancho",
      ),
    ],
  },
  {
    slug: "video_instalacion_mini",
    name: "Video de instalación (mini)",
    agentDescription:
      "Envía el video de instalación de la mini compuerta (30 cm de alto) como archivo. " +
      "Úsala cuando el cliente que ya eligió o pregunta por una mini compuerta quiera saber cómo se instala o pida el video.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/video-mini",
    steps: [
      media("Video de instalación — mini compuerta (MP4 H.264, ≤16 MB)", "Aquí le comparto un video de la instalación de las mini compuertas 🙌"),
    ],
  },
  {
    slug: "tapones_inflables",
    name: "Tapones inflables",
    agentDescription:
      "Envía la explicación con precios y el video de instalación de los tapones inflables para tuberías y desagües. " +
      "Úsala cuando el cliente pregunte por tapones, coladeras, desagües o cómo evitar que el agua suba por el drenaje.",
    triggerAgent: true,
    triggerKeywords: ["tapones", "tapones inflables"],
    triggerCommand: "/tapones",
    steps: [
      text(
        "El Tapón Inflable Anti Inundaciones se introduce en la tubería y, al inflarse, bloquea de manera segura el paso del agua\n\n" +
          "Su costo depende del tamaño, por ejemplo:\n\nDe 2\" = $749\nDe 3\" = $799\nDe 4\" = $849\n\nTodos los tapones incluyen el envío e IVA",
      ),
      media("Tapones inflables — video (MP4 H.264, ≤16 MB)", "Aquí le comparto el video de instalación de los tapones inflables 🙌"),
    ],
  },
  {
    slug: "donde_medir",
    name: "Dónde medir la entrada",
    agentDescription:
      "Envía el video guía de dónde medir la entrada (de lateral a lateral, en el punto exacto donde se apoyará la compuerta) como archivo. " +
      "Úsala cuando el cliente pregunte cómo o dónde medir, dude de su medida, o dé una medida sin decir de dónde a dónde. " +
      "Responde primero en texto y luego llama esta herramienta.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/medir",
    steps: [
      media(
        "Video de dónde medir la entrada (MP4 H.264, ≤16 MB)",
        "La medida es de lateral a lateral, en centímetros, justo en el punto donde se va a apoyar la compuerta. Te dejo un video corto para que veas dónde tomarla.",
      ),
    ],
  },
  {
    slug: "medidas_especiales",
    name: "Medidas especiales (más de 250 cm)",
    agentDescription:
      "Envía el diagrama de las opciones para entradas mayores a 250 cm (fabricación especial de aprox. 280 cm, o poste central de acero con dos compuertas a la medida). " +
      "Úsala solo cuando el cliente confirme una entrada mayor a 250 cm y pregunte qué opciones hay. Nunca digas que no fabricamos.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/especial",
    steps: [
      media(
        "Diagrama de medidas especiales — poste central / 280 cm (PNG/JPG)",
        "Para entradas mayores a 250 cm sí hay opción: una fabricación especial de aproximadamente 280 cm, o un poste central de acero con dos compuertas a la medida, una por lado. Te dejo un diagrama para que se entienda mejor.",
      ),
    ],
  },
];

// Nombre de herramienta que verá el modelo (parte b). Estable y sin colisiones.
export function toolNameFor(slug: string): string {
  return `wf_${slug}`;
}
