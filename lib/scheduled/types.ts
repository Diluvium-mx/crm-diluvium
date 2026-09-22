// Contrato de los mensajes programados para la UI (A6).

export type ScheduledStatus = "scheduled" | "sending" | "sent" | "failed" | "cancelled";

export type ScheduledView = {
  id: string;
  kind: "text" | "template";
  body: string;
  sendAt: Date;
  cancelIfInbound: boolean;
  status: ScheduledStatus;
  /** manual | cliente_escribio */
  cancelReason: string | null;
  errorMessage: string | null;
};

export type ScheduleInput =
  | {
      conversationId: string;
      kind: "text";
      text: string;
      /** Hora local de Mazatlán, "YYYY-MM-DDTHH:mm". */
      sendAtLocal: string;
      cancelIfInbound: boolean;
    }
  | {
      conversationId: string;
      kind: "template";
      templateId: string;
      templateParams: string[];
      sendAtLocal: string;
      cancelIfInbound: boolean;
    };

export type ScheduleEditInput = {
  sendAtLocal: string;
  cancelIfInbound: boolean;
  /** Solo para kind=text. */
  text?: string;
};

export type ScheduleResult = { ok: true } | { ok: false; message: string };
