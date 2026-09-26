import { describe, expect, it } from "vitest";
import { parseContactUpdated } from "./contact-updated-payload";

const base = {
  contactId: "c1",
  contactName: "Juan Pérez",
  changes: ["etapa"],
  stageFrom: "prospecto",
  stageTo: "interesado",
  by: "agente",
  byUserId: null,
  byName: null,
  at: "2026-09-26T16:00:00.000Z",
};

describe("parseContactUpdated", () => {
  it("lee un cambio de etapa del agente", () => {
    expect(parseContactUpdated(base)).toEqual({
      type: "contact.updated",
      contactId: "c1",
      contactName: "Juan Pérez",
      changes: ["etapa"],
      stage: { from: "prospecto", to: "interesado" },
      by: { kind: "agente" },
      at: "2026-09-26T16:00:00.000Z",
    });
  });

  it("vendedor con nombre y automatización con quien la disparó", () => {
    expect(parseContactUpdated({ ...base, by: "vendedor", byUserId: "u1", byName: "Daniel" })?.by).toEqual({
      kind: "vendedor",
      userId: "u1",
      name: "Daniel",
    });
    expect(parseContactUpdated({ ...base, by: "automatizacion", byUserId: "u2" })?.by).toEqual({ kind: "automatizacion", userId: "u2" });
    expect(parseContactUpdated({ ...base, by: "automatizacion" })?.by).toEqual({ kind: "automatizacion", userId: null });
  });

  it("sin etapa de → a, el cambio de etapa se descarta (lo demás queda)", () => {
    const event = parseContactUpdated({ ...base, changes: ["etapa", "temperatura"], stageFrom: null, stageTo: null });
    expect(event?.changes).toEqual(["temperatura"]);
    expect(event?.stage).toBeUndefined();
    expect(parseContactUpdated({ ...base, stageTo: null })).toBeNull();
  });

  it("descarta lo que no cuadra", () => {
    expect(parseContactUpdated({ ...base, contactId: "" })).toBeNull();
    expect(parseContactUpdated({ ...base, changes: "etapa" })).toBeNull();
    expect(parseContactUpdated({ ...base, changes: ["otra"] })).toBeNull();
    expect(parseContactUpdated({ ...base, by: "vendedor", byUserId: null })).toBeNull();
    expect(parseContactUpdated({ ...base, by: "nadie" })).toBeNull();
  });
});
