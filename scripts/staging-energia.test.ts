import { describe, expect, it } from "vitest";
import { decidirRevision, despliegueParaEncender, leerEstado, ultimaVisita, type Despliegue } from "./staging-energia";

const STAGING = "9b5a8446-266c-4d1c-8038-278324d290e6";
const AHORA = Date.parse("2026-10-28T20:00:00Z");
const HORA = 3_600_000;

function despliegue(parcial: Partial<Despliegue> & { status: string; createdAt: string }): Despliegue {
  return {
    id: `d-${parcial.createdAt}`,
    statusUpdatedAt: null,
    environmentId: STAGING,
    canRedeploy: true,
    meta: { branch: "staging", commitHash: "df5886a99bd3", imageDigest: "sha256:abc" },
    ...parcial,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("leerEstado", () => {
  it("separa lo prendido de lo que va subiendo y toma la subida más reciente", () => {
    const estado = leerEstado([
      despliegue({ status: "QUEUED", createdAt: iso(AHORA - 10 * 60_000) }),
      despliegue({ status: "SUCCESS", createdAt: iso(AHORA - 3 * HORA), statusUpdatedAt: iso(AHORA - 2.5 * HORA) }),
      despliegue({ status: "REMOVED", createdAt: iso(AHORA - 5 * HORA), statusUpdatedAt: iso(AHORA - HORA) }),
    ]);
    expect(estado.prendidos.map((d) => d.status)).toEqual(["SUCCESS"]);
    expect(estado.subiendo.map((d) => d.status)).toEqual(["QUEUED"]);
    expect(estado.ultimaSubida).toBe(AHORA - 10 * 60_000);
  });

  it("cuenta cuándo quedó lista la versión activa (una cola larga de Railway no la apaga recién subida)", () => {
    const estado = leerEstado([
      despliegue({ status: "SUCCESS", createdAt: iso(AHORA - 3 * HORA), statusUpdatedAt: iso(AHORA - 30 * 60_000) }),
    ]);
    expect(estado.ultimaSubida).toBe(AHORA - 30 * 60_000);
  });

  it("no cuenta como subida el momento en que se quitó un despliegue viejo", () => {
    const estado = leerEstado([
      despliegue({ status: "REMOVED", createdAt: iso(AHORA - 5 * HORA), statusUpdatedAt: iso(AHORA - 60_000) }),
    ]);
    expect(estado.prendidos).toEqual([]);
    expect(estado.ultimaSubida).toBe(AHORA - 5 * HORA);
  });

  it("sin despliegues no hay subida", () => {
    expect(leerEstado([]).ultimaSubida).toBeNull();
  });
});

describe("ultimaVisita", () => {
  it("es el final del último tramo con visitas", () => {
    const ts = Math.floor(AHORA / 1000) - 3600;
    expect(ultimaVisita([{ ts: ts - 300, value: 2 }, { ts, value: 1 }, { ts: ts + 300, value: 0 }], 300)).toBe(
      (ts + 300) * 1000,
    );
  });

  it("sin visitas es null", () => {
    expect(ultimaVisita([], 300)).toBeNull();
    expect(ultimaVisita([{ ts: 1, value: 0 }], 300)).toBeNull();
  });
});

describe("decidirRevision", () => {
  const prendido = (horasDesdeSubida: number) =>
    leerEstado([despliegue({ status: "SUCCESS", createdAt: iso(AHORA - horasDesdeSubida * HORA) })]);
  const apagado = leerEstado([despliegue({ status: "REMOVED", createdAt: iso(AHORA - 9 * HORA) })]);

  it("apaga si web y worker llevan 2 h sin visitas ni subidas", () => {
    const decision = decidirRevision([prendido(5), prendido(5)], AHORA - 3 * HORA, AHORA);
    expect(decision.apagar).toBe(true);
    expect(decision.motivo).toBe("lleva 3 h sin visitas ni subidas");
  });

  it("no apaga si alguien lo abrió hace poco", () => {
    expect(decidirRevision([prendido(5), prendido(5)], AHORA - 20 * 60_000, AHORA)).toEqual({
      apagar: false,
      motivo: "se usó hace 20 min",
    });
  });

  it("no apaga si hubo una subida o un encendido hace menos de 2 h, aunque nadie lo haya abierto", () => {
    expect(decidirRevision([prendido(1.5), prendido(5)], null, AHORA).apagar).toBe(false);
  });

  it("justo a las 2 h ya apaga", () => {
    expect(decidirRevision([prendido(2), prendido(2)], null, AHORA).apagar).toBe(true);
  });

  it("no apaga encima de una subida en curso", () => {
    const subiendo = leerEstado([despliegue({ status: "BUILDING", createdAt: iso(AHORA - 9 * HORA) })]);
    expect(decidirRevision([prendido(9), subiendo], null, AHORA)).toEqual({
      apagar: false,
      motivo: "hay una subida en curso",
    });
  });

  it("si ya está apagado no hace nada", () => {
    expect(decidirRevision([apagado, apagado], null, AHORA)).toEqual({ apagar: false, motivo: "ya está apagado" });
  });

  it("apaga aunque solo uno de los dos siga prendido", () => {
    expect(decidirRevision([apagado, prendido(4)], null, AHORA).apagar).toBe(true);
  });
});

describe("despliegueParaEncender", () => {
  it("vuelve a prender la versión más reciente de la rama staging", () => {
    const elegido = despliegueParaEncender([
      despliegue({ id: "nuevo", status: "REMOVED", createdAt: iso(AHORA - HORA) }),
      despliegue({ id: "viejo", status: "REMOVED", createdAt: iso(AHORA - 5 * HORA) }),
    ]);
    expect(elegido?.id).toBe("nuevo");
  });

  it("nunca prende una versión de main (lo que pasó el 23, 24 y 27-oct)", () => {
    const elegido = despliegueParaEncender([
      despliegue({
        id: "main",
        status: "REMOVED",
        createdAt: iso(AHORA - HORA),
        meta: { branch: "main", commitHash: "de1c567", imageDigest: "sha256:x" },
      }),
      despliegue({ id: "staging", status: "REMOVED", createdAt: iso(AHORA - 2 * HORA) }),
    ]);
    expect(elegido?.id).toBe("staging");
  });

  it("salta subidas que fallaron o que nunca llegaron a construirse", () => {
    const elegido = despliegueParaEncender([
      despliegue({ id: "fallo", status: "FAILED", createdAt: iso(AHORA - HORA) }),
      despliegue({
        id: "sin-imagen",
        status: "REMOVED",
        createdAt: iso(AHORA - 2 * HORA),
        meta: { branch: "staging", commitHash: "abc" },
      }),
      despliegue({ id: "bueno", status: "REMOVED", createdAt: iso(AHORA - 3 * HORA) }),
    ]);
    expect(elegido?.id).toBe("bueno");
  });

  it("sin versión de staging devuelve null", () => {
    expect(despliegueParaEncender([despliegue({ status: "REMOVED", createdAt: iso(AHORA), canRedeploy: false })])).toBeNull();
  });
});
