// Contrato Plantillas backend → UI. Solo tipos: la UI (Client Components) lo
// importa sin arrastrar el servidor. Las plantillas son las APROBADAS por Meta
// (para FUERA de la ventana de 24 h); usan variables POSICIONALES {{1}}, {{2}},
// distinto de los Fragmentos ({{nombre}}).

/** Variable posicional del cuerpo de una plantilla. `index` es 1-based ({{1}}). */
export type TemplateVariable = { index: number; example?: string };

export type TemplateView = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  /** APPROVED | PENDING | REJECTED | IN_APPEAL | PAUSED | DISABLED | PENDING_DELETION | … */
  status: string;
  /** Texto del componente BODY (con los {{n}} sin rellenar). */
  bodyText: string | null;
  variables: TemplateVariable[];
  /** true solo si se puede ENVIAR (aprobada por Meta). */
  sendable: boolean;
};

/** Solo se envían las aprobadas (regla de Meta). */
export function isTemplateSendable(status: string): boolean {
  return status.toUpperCase() === "APPROVED";
}
