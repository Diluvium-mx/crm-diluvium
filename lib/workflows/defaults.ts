// Workflows predeterminados de la Fase D (docs/fase-d-diseno.md §1). Textos
// redactados desde el Goal de Ángela y sus FAQs (definición 4 del dueño): el
// admin los ajusta después en la pestaña Automatización. Puro: sin DB.
//
// Palabras clave: los predeterminados nacen SIN palabras clave. En AUTO el agente
// ya tiene cada workflow como herramienta y decide con el contexto; una palabra
// suelta ("vi su video en Facebook") mandaría contenido que nadie pidió y
// quemaría el "una vez por conversación". El admin las agrega si las quiere.
// Reglas del Goal que respetan estos textos: mensajes breves para celular, sin
// listas ni catálogo, "tamaño" (nunca "talla"), precios tal cual la base
// ($5,500 estándar, $7,000 a la medida, $3,000 mini, tapones $749/$799/$849),
// no reenviar contenido ya compartido (once_per_conversation).
import type { StepPayload } from "./steps";

export type DefaultWorkflow = {
  slug: string;
  name: string;
  agentDescription: string;
  triggerAgent: boolean;
  triggerKeywords: string[];
  triggerCommand: string | null;
  oncePerConversation: boolean;
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
      "Responde primero su duda en texto y luego llama esta herramienta. No la uses si ya se envió en esta conversación.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/tabla",
    oncePerConversation: true,
    steps: [
      text("Te comparto la tabla de tamaños de las compuertas estándar. Solo ubica el ancho de tu entrada, de lateral a lateral, y ahí ves el tamaño que te corresponde."),
      media("Tabla de tamaños — compuerta estándar (PNG/JPG)"),
    ],
  },
  {
    slug: "tabla_tamanos_mini",
    name: "Tabla de tamaños (mini)",
    agentDescription:
      "Envía la imagen con la tabla de tamaños de las mini compuertas (30 cm de alto, XXCH a XXG, entradas de 62 a 123 cm). " +
      "Úsala solo cuando el cliente ya confirmó que necesita menor altura y pregunte tamaños o pida la tabla. " +
      "Nunca la ofrezcas por tu cuenta. No la uses si ya se envió en esta conversación.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/mini",
    oncePerConversation: true,
    steps: [
      text("Esta es la tabla de tamaños de las mini compuertas, de 30 cm de alto. Ubica el ancho de tu entrada y ahí está el tamaño que te corresponde."),
      media("Tabla de tamaños — mini compuerta (PNG/JPG)"),
    ],
  },
  {
    slug: "datos_bancarios",
    name: "Datos bancarios",
    agentDescription:
      "Envía la imagen con los datos bancarios para depósito o transferencia y mueve al contacto a 'Cerca de compra'. " +
      "Úsala únicamente cuando el cliente ya tiene tamaño y total definidos y elige pagar por transferencia o depósito. " +
      "No la uses si ya se envió en esta conversación ni después de que el cliente mandó un comprobante.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/banco",
    oncePerConversation: true,
    steps: [
      text("Perfecto. Te comparto los datos para tu transferencia o depósito. Cuando lo realices, mándame aquí mismo tu comprobante para continuar con tu pedido."),
      media("Datos bancarios (imagen con banco, CLABE y beneficiario)"),
      { kind: "set_stage", stage: "cerca_compra" },
    ],
  },
  {
    slug: "video_instalacion_estandar",
    name: "Video de instalación (estándar)",
    agentDescription:
      "Envía el video de instalación de la compuerta estándar como archivo. " +
      "Úsala cuando el cliente pregunte cómo se instala, cómo se coloca, si es difícil, o pida el video. " +
      "Responde primero en texto (no requiere obra ni herramientas especiales) y luego llama esta herramienta. No la uses si ya se envió.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/video",
    oncePerConversation: true,
    steps: [
      text("Aquí te va el video de instalación. Está pensada para que tú mismo la coloques en pocos minutos, sin obra ni herramientas especiales."),
      media("Video de instalación — compuerta estándar (MP4 H.264, ≤16 MB)"),
    ],
  },
  {
    slug: "video_instalacion_medida",
    name: "Video de instalación (a la medida)",
    agentDescription:
      "Envía el video de instalación de la compuerta hecha a la medida (entradas de 121 a 250 cm) como archivo. " +
      "Úsala cuando el cliente con una entrada mayor a 120 cm pregunte cómo se instala o pida el video. No la uses si ya se envió.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/video-medida",
    oncePerConversation: true,
    steps: [
      text("Te comparto el video de instalación de la compuerta hecha a la medida. La colocación es igual de sencilla, solo cambia el tamaño."),
      media("Video de instalación — compuerta a la medida (MP4 H.264, ≤16 MB)"),
    ],
  },
  {
    slug: "video_instalacion_mini",
    name: "Video de instalación (mini)",
    agentDescription:
      "Envía el video de instalación de la mini compuerta (30 cm de alto) como archivo. " +
      "Úsala cuando el cliente que ya eligió o pregunta por una mini compuerta quiera saber cómo se instala o pida el video. No la uses si ya se envió.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/video-mini",
    oncePerConversation: true,
    steps: [
      text("Te comparto el video de instalación de la mini compuerta. Se coloca en minutos, igual que la estándar, solo que con 30 cm de alto."),
      media("Video de instalación — mini compuerta (MP4 H.264, ≤16 MB)"),
    ],
  },
  {
    slug: "tapones_inflables",
    name: "Tapones inflables",
    agentDescription:
      "Envía las imágenes y el video de los tapones inflables para coladeras y desagües. " +
      "Úsala cuando el cliente pregunte por tapones, coladeras, desagües o cómo evitar que el agua suba por el drenaje. " +
      "Responde primero con los precios en texto y luego llama esta herramienta. No la uses si ya se envió.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/tapones",
    oncePerConversation: true,
    steps: [
      text("Los tapones inflables sellan coladeras y desagües para que el agua no suba por ahí. Te mando fotos y un video para que veas cómo funcionan; se inflan con una bomba manual chica, nunca con compresor."),
      media("Tapones inflables — foto 1 (PNG/JPG)"),
      media("Tapones inflables — foto 2 (PNG/JPG)"),
      media("Tapones inflables — video (MP4 H.264, ≤16 MB)"),
    ],
  },
  {
    slug: "donde_medir",
    name: "Dónde medir la entrada",
    agentDescription:
      "Envía el video guía de dónde medir la entrada (de lateral a lateral, en el punto exacto donde se apoyará la compuerta) como archivo. " +
      "Úsala cuando el cliente pregunte cómo o dónde medir, dude de su medida, o dé una medida sin decir de dónde a dónde. " +
      "Responde primero en texto y luego llama esta herramienta. No la uses si ya se envió.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/medir",
    oncePerConversation: true,
    steps: [
      text("La medida es de lateral a lateral, en centímetros, justo en el punto donde se va a apoyar la compuerta. Te dejo un video corto para que veas dónde tomarla."),
      media("Video de dónde medir la entrada (MP4 H.264, ≤16 MB)"),
    ],
  },
  {
    slug: "medidas_especiales",
    name: "Medidas especiales (más de 250 cm)",
    agentDescription:
      "Envía el diagrama de las opciones para entradas mayores a 250 cm (fabricación especial de aprox. 280 cm, o poste central de acero con dos compuertas a la medida). " +
      "Úsala solo cuando el cliente confirme una entrada mayor a 250 cm y pregunte qué opciones hay. Nunca digas que no fabricamos. No la uses si ya se envió.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/especial",
    oncePerConversation: true,
    steps: [
      text("Para entradas mayores a 250 cm sí hay opción: una fabricación especial de aproximadamente 280 cm, o un poste central de acero con dos compuertas a la medida, una por lado. Te dejo un diagrama para que se entienda mejor."),
      media("Diagrama de medidas especiales — poste central / 280 cm (PNG/JPG)"),
    ],
  },
  {
    slug: "transferir_humano",
    name: "Pasar a humano",
    agentDescription:
      "Pasa la conversación a un asesor humano y deja de responder. " +
      "Úsala solo en los casos del Goal: el cliente pide hablar con una persona, pide un enlace para pagar con tarjeta, hay un problema de garantía, devolución, daño o pedido incompleto, " +
      "reporta un problema con Amazon o Mercado Libre, pide un descuento o condición no autorizada, menciona fraude o insulta de forma persistente, o falta información oficial. " +
      "Escribe primero una despedida breve en texto y luego llama esta herramienta con el motivo.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: "/humano",
    oncePerConversation: false,
    steps: [{ kind: "handover" }],
  },
  {
    slug: "cambiar_etapa",
    name: "Cambiar etapa del contacto",
    agentDescription:
      "Mueve al contacto a la etapa del Embudo que corresponda según la conversación: 'prospecto' cuando pregunta precio o producto, " +
      "'interesado' cuando da medidas o fotos y quiere avanzar, 'cerca_compra' cuando ya tiene total y eligió cómo pagar, " +
      "'compra' únicamente cuando el pago quedó confirmado con comprobante. Úsala en cuanto cambie el contexto; no la uses para retroceder etapas.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: null,
    oncePerConversation: false,
    // Sin pasos fijos: la etapa la trae el argumento de la herramienta (el
    // ejecutor la aplica con set_stage). Los seeds dejan el paso como plantilla.
    steps: [{ kind: "set_stage", stage: "interesado" }],
  },
  {
    slug: "pago_confirmado",
    name: "Pago confirmado",
    agentDescription:
      "Confirma la recepción de un pago y mueve al contacto a 'Compra'. " +
      "Úsala únicamente después de analizar la IMAGEN del comprobante y verificar que el monto coincide con el total cotizado en esta conversación " +
      "(o con el 50 % de anticipo de una compuerta a la medida), que el destinatario coincide con los datos bancarios y que la fecha no es futura. " +
      "Pasa como argumentos lo que leíste: monto, fecha, banco, referencia y destinatario. Escribe primero al cliente la confirmación con la petición de datos de envío " +
      "(o, si fue anticipo, que su compuerta entra en fabricación). Nunca la uses sin imagen del comprobante.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: null,
    oncePerConversation: true,
    // El aviso va PRIMERO (sube la conversación y la marca no leída) y la etapa
    // al final: nadie ve "Compra" sin ver el freno de cotejar.
    steps: [
      {
        kind: "internal_note",
        text: "Pago reportado por el agente: {{monto}} · {{banco}} · ref. {{referencia}} · {{fecha}}. Cotejar el depósito en el banco antes de enviar.",
      },
      { kind: "add_tag", tag: "cotejar depósito" },
      { kind: "set_stage", stage: "compra" },
    ],
  },
  {
    slug: "anticipo_confirmado",
    name: "Anticipo confirmado (50 % a la medida)",
    agentDescription:
      "Confirma la recepción del ANTICIPO del 50 % de una compuerta hecha a la medida ($3,500 de $7,000) y deja al contacto en 'Cerca de compra' " +
      "(la venta no está completa: falta la liquidación antes del envío). Úsala solo tras analizar la IMAGEN del comprobante y verificar monto y destinatario. " +
      "Pasa como argumentos monto, fecha, banco, referencia y destinatario. Escribe primero al cliente que su compuerta entra en fabricación y que avisarás para el pago final. " +
      "Para un pago completo usa 'Pago confirmado', no esta.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: null,
    oncePerConversation: true,
    steps: [
      {
        kind: "internal_note",
        text: "Anticipo reportado por el agente: {{monto}} · {{banco}} · ref. {{referencia}} · {{fecha}}. Cotejar en el banco; falta la liquidación antes de enviar.",
      },
      { kind: "add_tag", tag: "anticipo 50%" },
      { kind: "set_stage", stage: "cerca_compra" },
    ],
  },
  {
    slug: "pago_no_cuadra",
    name: "Comprobante que no cuadra",
    agentDescription:
      "Pasa a un asesor humano un comprobante de pago que no cuadra: el monto no coincide con lo cotizado, el destinatario es otro, la imagen no se lee o no es un comprobante. " +
      "Escribe primero al cliente, con amabilidad, qué viste y qué esperabas (por ejemplo el monto del comprobante y el total cotizado) y que un asesor lo revisa; luego llama esta herramienta con el motivo.",
    triggerAgent: true,
    triggerKeywords: [],
    triggerCommand: null,
    oncePerConversation: false,
    steps: [
      { kind: "add_tag", tag: "revisar comprobante" },
      { kind: "internal_note", text: "Comprobante que no cuadra según el agente: {{motivo}}. Revisar con el cliente." },
      { kind: "handover" },
    ],
  },
];

// Nombre de herramienta que verá el modelo (parte b). Estable y sin colisiones.
export function toolNameFor(slug: string): string {
  return `wf_${slug}`;
}
