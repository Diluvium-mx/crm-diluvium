import { describe, expect, it } from "vitest";
import { createSerialSaves } from "./serial-saves";
import { trackSaves } from "./tracked-saves";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("trackSaves", () => {
  it("un carril con guardado en curso cuenta como tocado", async () => {
    const tracker = trackSaves(createSerialSaves());
    const snap = tracker.snapshot();
    expect(tracker.touchedSince("monto", snap)).toBe(false);
    const gate = deferred<string>();
    const pending = tracker.saves.save("monto", () => gate.promise);
    expect(tracker.touchedSince("monto", tracker.snapshot())).toBe(true);
    // Otro carril no se ve afectado.
    expect(tracker.touchedSince("nivelAguaCm", snap)).toBe(false);
    gate.resolve("ok");
    await expect(pending).resolves.toMatchObject({ status: "saved", result: "ok" });
    expect(tracker.touchedSince("monto", tracker.snapshot())).toBe(false);
  });

  it("un guardado que terminó DESPUÉS de la foto también cuenta (la lectura en vivo salió antes)", async () => {
    const tracker = trackSaves(createSerialSaves());
    const snap = tracker.snapshot();
    await tracker.saves.save("monto", async () => "ok");
    expect(tracker.touchedSince("monto", snap)).toBe(true);
    expect(tracker.touchedSince("monto", tracker.snapshot())).toBe(false);
  });

  it("cuenta por carril: las filas de entradas comparten el suyo", async () => {
    const tracker = trackSaves(createSerialSaves());
    const snap = tracker.snapshot();
    await tracker.saves.save("entrada:e1:anchoCm", async () => 1, { lane: "entradas" });
    expect(tracker.touchedSince("entradas", snap)).toBe(true);
    expect(tracker.touchedSince("entrada:e1:anchoCm", snap)).toBe(false);
  });

  it("whenIdle espera a que terminen los guardados de esos carriles", async () => {
    const tracker = trackSaves(createSerialSaves());
    await expect(tracker.whenIdle(["monto"])).resolves.toBeUndefined();
    const gateMonto = deferred<string>();
    const gateNivel = deferred<string>();
    const monto = tracker.saves.save("monto", () => gateMonto.promise);
    const nivel = tracker.saves.save("nivel", () => gateNivel.promise);
    let done = false;
    const waiting = tracker.whenIdle(["monto", "nivel"]).then(() => {
      done = true;
    });
    gateMonto.resolve("ok");
    await monto;
    await Promise.resolve();
    expect(done).toBe(false);
    gateNivel.resolve("ok");
    await nivel;
    await waiting;
    expect(done).toBe(true);
  });

  it("un fallo también libera el carril", async () => {
    const tracker = trackSaves(createSerialSaves());
    const outcome = await tracker.saves.save("monto", () => Promise.reject(new Error("red")));
    expect(outcome.status).toBe("failed");
    expect(tracker.touchedSince("monto", tracker.snapshot())).toBe(false);
  });
});
