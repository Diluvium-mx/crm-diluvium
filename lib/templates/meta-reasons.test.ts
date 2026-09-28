import { describe, expect, it } from "vitest";
import { rejectionNotice, statusNotice, submitNotice } from "./meta-reasons";

describe("rejectionNotice", () => {
  it("explica cada motivo conocido de Meta y dice qué hacer", () => {
    for (const reason of ["INVALID_FORMAT", "PROMOTIONAL", "TAG_CONTENT_MISMATCH", "INCORRECT_CATEGORY", "ABUSIVE_CONTENT", "SCAM"]) {
      const n = rejectionNotice("hola_buenas_tardes", reason);
      expect(n.title).toBe('Meta rechazó la plantilla "hola_buenas_tardes"');
      expect(n.why.length).toBeGreaterThan(20);
      expect(n.whatToDo.length).toBeGreaterThan(0);
    }
    expect(rejectionNotice("x", "invalid_format").why).toMatch(/huecos/);
    expect(rejectionNotice("x", "PROMOTIONAL").whatToDo[0]).toMatch(/Marketing/);
  });

  it("sin motivo (o uno nuevo de Meta) da las causas más comunes y la apelación", () => {
    for (const reason of [null, "NONE_NEW_CODE"]) {
      const n = rejectionNotice("x", reason);
      expect(n.why).toMatch(/no dio un motivo/);
      expect(n.whatToDo.join(" ")).toMatch(/apelar/);
    }
  });
});

describe("statusNotice", () => {
  it("pausada y desactivada tienen aviso; las demás no", () => {
    expect(statusNotice("x", "PAUSED")?.title).toMatch(/pausó/);
    expect(statusNotice("x", "disabled")?.title).toMatch(/desactivó/);
    expect(statusNotice("x", "APPROVED")).toBeNull();
    expect(statusNotice("x", "PENDING")).toBeNull();
  });
});

describe("submitNotice", () => {
  it("cita lo que contestó Meta y reconoce los casos comunes", () => {
    expect(submitNotice("crear", "Template name already exists").whatToDo[0]).toMatch(/otro nombre/);
    expect(submitNotice("editar", "Edit limit reached for template").whatToDo[0]).toMatch(/1 al día/);
    expect(submitNotice("editar", "Template is PENDING").whatToDo[0]).toMatch(/revisión/);
    expect(submitNotice("enviar", "Template name does not exist in the translation").whatToDo[0]).toMatch(/Sincronizar/);
    const generic = submitNotice("crear", "Invalid parameter");
    expect(generic.title).toBe("WhatsApp (Meta) no dejó crear");
    expect(generic.why).toBe("Lo que contestó: «Invalid parameter».");
    expect(generic.whatToDo.at(-1)).toMatch(/Code/);
  });
});
