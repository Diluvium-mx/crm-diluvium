// Alarma de envíos que fallan en serie (P4, 22-oct-2026): reglas puras.
import { describe, expect, it } from "vitest";
import { alarmingGroups, sendFailureBannerLines, sendFailureProblems, type SendFailureGroup } from "./send-failures";

const group = (code: string, count: number, sample: string | null = null): SendFailureGroup => ({ code, count, sample });

describe("alarmingGroups", () => {
  it("3 o más con el mismo código es alarma; 2 no", () => {
    expect(alarmingGroups([group("131053", 3), group("131026", 2)])).toEqual([group("131053", 3)]);
  });

  it("los códigos esperados del día a día no alarman (límite de marketing, experimento, baja)", () => {
    expect(alarmingGroups([group("131049", 9), group("130472", 4), group("131050", 3)])).toEqual([]);
  });

  it("el de más fallas va primero", () => {
    expect(alarmingGroups([group("send_unconfirmed", 3), group("131053", 58)]).map((g) => g.code)).toEqual(["131053", "send_unconfirmed"]);
  });
});

describe("sendFailureProblems (issue PÚBLICO)", () => {
  it("solo conteo y código, nunca el texto del error", () => {
    const problems = sendFailureProblems([group("131053", 58, "Media upload error: https://bucket/secreto")]);
    expect(problems).toEqual(["58 envíos fallaron con el mismo error (código 131053) en la última hora"]);
    expect(problems.join(" ")).not.toContain("secreto");
  });
});

describe("sendFailureBannerLines (franja de la Bandeja)", () => {
  it("dice el motivo en palabras simples", () => {
    expect(sendFailureBannerLines([group("131053", 5, "Media upload error")])).toEqual([
      "5 envíos no le llegaron a los clientes en la última hora por el mismo motivo: WhatsApp no pudo subir el archivo. Revisa los chats con tarjeta.",
    ]);
  });

  it("sin alarma, sin franja", () => {
    expect(sendFailureBannerLines([group("131053", 2)])).toEqual([]);
  });
});
