// Armado de chat.txt y formatos de la exportación de un contacto (ARCO, 7-oct-2026).
import { describe, expect, it } from "vitest";
import { buildChatTxt, messageText, type ChatTxtMessage } from "./chat-txt";
import { exportZipName, mazatlanDateTime, speakerOf } from "./format";

const msg = (over: Partial<ChatTxtMessage> & Pick<ChatTxtMessage, "id" | "at">): ChatTxtMessage => ({
  direction: "in",
  source: "contact",
  type: "text",
  body: null,
  transcripcion: null,
  deleted: false,
  attachments: [],
  ...over,
});

describe("chat.txt de la exportación", () => {
  it("una línea por mensaje: hora de Mazatlán, quién habló y lo que dijo", () => {
    const txt = buildChatTxt({
      contactName: "Juan Pérez",
      handle: "+52 668 123 4567",
      // 18:30 en Mazatlán (UTC-7).
      exportedAt: new Date("2026-10-08T01:30:00Z"),
      filePaths: new Map([["m2:0", "archivos/2026-10-03_1013_1-foto.jpg"]]),
      conversations: [
        {
          channelLabel: "WhatsApp",
          messages: [
            msg({ id: "m1", at: new Date("2026-10-03T17:12:30Z"), body: "Hola, ¿cuánto cuesta?" }),
            msg({ id: "m2", at: new Date("2026-10-03T17:13:00Z"), type: "image", body: "Así entra el agua", attachments: [{ type: "image" }] }),
            msg({ id: "m3", at: new Date("2026-10-03T17:14:00Z"), direction: "out", source: "ai_agent", body: "Hola, soy Ángela.\nCon gusto te ayudo." }),
            msg({ id: "m4", at: new Date("2026-10-03T17:15:00Z"), direction: "out", source: "crm", type: "document", attachments: [{ type: "document", fileName: "tabla-tamanos.pdf" }] }),
            msg({ id: "m5", at: new Date("2026-10-03T17:16:00Z"), type: "audio", attachments: [{ type: "audio" }], transcripcion: "Mañana le mando las medidas" }),
            msg({ id: "m6", at: new Date("2026-10-03T17:17:00Z"), direction: "out", source: "ai_agent", type: "system_note", body: "Aviso para el vendedor" }),
            msg({ id: "m7", at: new Date("2026-10-03T17:18:00Z"), direction: "out", source: "business_app", body: "Le marco al rato", deleted: true }),
            msg({ id: "m8", at: new Date("2026-10-03T17:19:00Z"), direction: "out", source: "crm", type: "template", body: "Hola Juan, ¿sigue interesado?" }),
          ],
        },
      ],
    });
    expect(txt).toBe(
      [
        "Chat de Juan Pérez (+52 668 123 4567)",
        "Exportado el 2026-10-07 18:30 (hora de Mazatlán)",
        "",
        "── WhatsApp ──",
        "[2026-10-03 10:12] Cliente: Hola, ¿cuánto cuesta?",
        "[2026-10-03 10:13] Cliente: [foto: archivos/2026-10-03_1013_1-foto.jpg] Así entra el agua",
        "[2026-10-03 10:14] Agente IA: Hola, soy Ángela.\nCon gusto te ayudo.",
        "[2026-10-03 10:15] Vendedor: [documento: tabla-tamanos.pdf]",
        "[2026-10-03 10:16] Cliente: [audio] (transcripción: «Mañana le mando las medidas»)",
        "[2026-10-03 10:18] Vendedor: Le marco al rato (lo borró quien lo envió)",
        "[2026-10-03 10:19] Vendedor: [plantilla] Hola Juan, ¿sigue interesado?",
        "",
      ].join("\n"),
    );
    // La nota interna del Agente IA para el vendedor no va.
    expect(txt).not.toContain("Aviso para el vendedor");
  });

  it("sin chats o sin mensajes lo dice; un mensaje sin nada no queda en blanco", () => {
    const empty = buildChatTxt({ contactName: "Ana", handle: null, exportedAt: new Date("2026-10-08T01:30:00Z"), filePaths: new Map(), conversations: [] });
    expect(empty).toBe("Chat de Ana\nExportado el 2026-10-07 18:30 (hora de Mazatlán)\n\nSin chats.\n");
    const noMsgs = buildChatTxt({
      contactName: "Ana",
      handle: "@ana · Instagram",
      exportedAt: new Date("2026-10-08T01:30:00Z"),
      filePaths: new Map(),
      conversations: [{ channelLabel: "Instagram", messages: [] }],
    });
    expect(noMsgs).toContain("── Instagram ──\nSin mensajes.\n");
    expect(messageText(msg({ id: "x", at: new Date(), type: "unknown" }), new Map())).toBe("[mensaje no compatible]");
    expect(messageText(msg({ id: "x", at: new Date(), type: "location", body: "Av. del Mar 100" }), new Map())).toBe("[ubicación] Av. del Mar 100");
  });

  it("quién habló: cliente, Agente IA o vendedor (CRM, celular u otra app)", () => {
    expect(speakerOf({ direction: "in", source: "contact" })).toBe("Cliente");
    expect(speakerOf({ direction: "out", source: "ai_agent" })).toBe("Agente IA");
    expect(speakerOf({ direction: "out", source: "crm" })).toBe("Vendedor");
    expect(speakerOf({ direction: "out", source: "business_app" })).toBe("Vendedor");
  });

  it("nombre del zip y fechas en hora de Mazatlán", () => {
    // 23:30 del 7 en Mazatlán = 06:30 UTC del 8: el zip lleva el día de Mazatlán.
    const now = new Date("2026-10-08T06:30:00Z");
    expect(mazatlanDateTime(now)).toBe("2026-10-07 23:30:00");
    expect(exportZipName("José Ñúñez  O'Brien", now)).toBe("contacto-jose-nunez-o-brien-2026-10-07.zip");
    expect(exportZipName("   ", now)).toBe("contacto-sin-nombre-2026-10-07.zip");
    expect(exportZipName("🌧️🌧️", now)).toBe("contacto-sin-nombre-2026-10-07.zip");
  });
});
