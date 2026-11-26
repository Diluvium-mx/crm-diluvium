import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOLO_LECTURA_HEADER } from "@/lib/auth/solo-lectura";

// Formulario público de opinión con la sesión de «Solo lectura» (26-nov-2026): puede abrir el enlace del
// cliente, pero no contestar por él. El cliente (sin sesión) contesta igual que siempre.
const doubles = vi.hoisted(() => ({
  soloLectura: false,
  responderOpinion: vi.fn(async () => "ok" as const),
}));

vi.mock("@/lib/rate-limit", () => ({ ipRateLimiter: { check: async () => null } }));
vi.mock("@/lib/auth/active-organization", () => ({ sesionEsSoloLectura: async () => doubles.soloLectura }));
vi.mock("@/lib/opiniones/store", () => ({ responderOpinion: doubles.responderOpinion }));
vi.mock("@/lib/opiniones/respuestas", () => ({ respuestaSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) } }));

const { POST } = await import("./route");

const peticion = () =>
  new Request("http://crm.local/api/opinion", { method: "POST", body: JSON.stringify({ token: "t", calificacion: 5 }) });

describe("POST /api/opinion y «Solo lectura»", () => {
  beforeEach(() => {
    doubles.responderOpinion.mockClear();
  });

  it("con sesión de Solo lectura no guarda nada y responde el aviso", async () => {
    doubles.soloLectura = true;
    const res = await POST(peticion());
    expect(res.status).toBe(403);
    expect(res.headers.get(SOLO_LECTURA_HEADER)).toBe("1");
    expect(doubles.responderOpinion).not.toHaveBeenCalled();
  });

  it("el cliente (sin esa sesión) contesta igual que siempre", async () => {
    doubles.soloLectura = false;
    const res = await POST(peticion());
    expect(res.status).toBe(200);
    expect(doubles.responderOpinion).toHaveBeenCalledTimes(1);
  });
});
