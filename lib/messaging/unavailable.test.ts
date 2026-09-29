import { describe, expect, it } from "vitest";
import {
  completedMetadata,
  isHiddenNotice,
  isUnavailableNotice,
  noDisponibleEstado,
  noticeDisplayText,
  resolvedMetadata,
  UNAVAILABLE_CODE,
  UNAVAILABLE_REPLY_TEXT,
  unavailableCode,
  verifyingMetadata,
} from "./unavailable";

const NOTICE = { code: 131060, title: "This message is unavailable.", details: "This message is currently unavailable." };

describe('aviso "no disponible" de Meta', () => {
  it("lo reconoce solo por metadata.unsupported", () => {
    expect(isUnavailableNotice({ unsupported: NOTICE })).toBe(true);
    expect(isUnavailableNotice({ referral: { source_id: "1" } })).toBe(false);
    expect(isUnavailableNotice({ unsupported: null })).toBe(false);
    expect(isUnavailableNotice(null)).toBe(false);
    expect(isUnavailableNotice(undefined)).toBe(false);
  });

  it("al completarse conserva lo previo, suma lo nuevo y deja de ser aviso", () => {
    const at = new Date("2026-09-27T01:37:26Z");
    const merged = completedMetadata(
      { unsupported: NOTICE, anuncioRespaldo: { resultado: "atribuido" } },
      { referral: { source_id: "120250108412590604" } },
      at,
    );
    expect(isUnavailableNotice(merged)).toBe(false);
    expect(merged).toEqual({
      anuncioRespaldo: { resultado: "atribuido" },
      referral: { source_id: "120250108412590604" },
      noDisponibleAntes: { ...NOTICE, completadoEn: "2026-09-27T01:37:26.000Z" },
    });
  });
});

describe("doble verificación (caso SDA, 29-sep-2026)", () => {
  const at = new Date("2026-09-29T00:16:39Z");

  it("el estado vive en metadata.noDisponible y solo verificando/sombra se ocultan", () => {
    const verifying = verifyingMetadata({ unsupported: NOTICE }, at);
    expect(noDisponibleEstado(verifying)).toBe("verificando");
    expect(isHiddenNotice(verifying)).toBe(true);
    const shadow = resolvedMetadata(verifying, "sombra", at, { mensajeReal: "m2" });
    expect(isHiddenNotice(shadow)).toBe(true);
    expect(shadow.noDisponible).toEqual({ estado: "sombra", desde: at.toISOString(), verificadoEn: at.toISOString(), mensajeReal: "m2" });
    const confirmed = resolvedMetadata(verifying, "sin_contenido", at);
    expect(isHiddenNotice(confirmed)).toBe(false);
    expect(noDisponibleEstado({ noDisponible: { estado: "otro" } })).toBeNull();
    expect(noDisponibleEstado(null)).toBeNull();
  });

  it("código del aviso: 131060 del primer mensaje; 131051 es otro caso", () => {
    expect(unavailableCode({ unsupported: NOTICE })).toBe(UNAVAILABLE_CODE);
    expect(unavailableCode({ unsupported: { code: "131051" } })).toBe(131051);
    expect(unavailableCode({ referral: {} })).toBeNull();
  });

  it("texto visible: 'Recibiendo mensaje…' mientras se verifica y la tarjeta aprobada al confirmar", () => {
    expect(noticeDisplayText(verifyingMetadata({ unsupported: NOTICE }, at))).toBe("Recibiendo mensaje…");
    expect(noticeDisplayText(resolvedMetadata({ unsupported: NOTICE }, "sin_contenido", at))).toBe(
      "El cliente escribió, pero WhatsApp no pasó el mensaje al CRM. Míralo en el celular.",
    );
    expect(noticeDisplayText({ unsupported: NOTICE })).toBeNull();
    expect(UNAVAILABLE_REPLY_TEXT).toBe(
      "¡Hola! Gracias por escribirnos 😊 Tuvimos una falla técnica y su mensaje no nos llegó. ¿Nos ayudas escribiéndolo de nuevo para seguir con su atención?",
    );
  });

  it("al completarse con el real se quita la verificación y queda registrada en noDisponibleAntes", () => {
    const merged = completedMetadata(resolvedMetadata(verifyingMetadata({ unsupported: NOTICE }, at), "sin_contenido", at), {}, at);
    expect(merged.noDisponible).toBeUndefined();
    expect(isUnavailableNotice(merged)).toBe(false);
    expect(merged.noDisponibleAntes).toMatchObject({ code: 131060, verificacion: "sin_contenido" });
  });
});
