import { describe, expect, it } from "vitest";
import { createSerialSaves, type SaveOutcome } from "./serial-saves";

/** Promesa que el test resuelve o rechaza a mano (latencia controlada). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deja correr las microtareas pendientes (encadenado de promesas). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Servidor falso: cada pedido queda colgado hasta que el test lo suelta, y al
 * soltarlo se "escribe" en `db` (así se ve en qué orden llegaron las escrituras).
 */
function fakeServer() {
  const db: Record<string, unknown> = {};
  const inFlight: { field: string; value: unknown; done: ReturnType<typeof deferred<void>> }[] = [];
  return {
    db,
    inFlight,
    write(field: string, value: unknown) {
      return () => {
        const done = deferred<void>();
        inFlight.push({ field, value, done });
        return done.promise.then(() => {
          db[field] = value;
          return value;
        });
      };
    },
    /** Termina el pedido en vuelo número `i` (bien o con error). */
    finish(i: number, error?: Error) {
      const req = inFlight[i];
      if (error) req.done.reject(error);
      else req.done.resolve();
    },
  };
}

describe("createSerialSaves", () => {
  it("un segundo guardado del mismo campo no sale hasta que termina el primero", async () => {
    const saves = createSerialSaves();
    const server = fakeServer();
    const a = saves.save("monto", server.write("monto", 100));
    const b = saves.save("monto", server.write("monto", 200));
    await flush();
    expect(server.inFlight.map((r) => r.value)).toEqual([100]);

    server.finish(0);
    await flush();
    expect(server.inFlight.map((r) => r.value)).toEqual([100, 200]);
    server.finish(1);

    expect(await a).toEqual({ status: "saved", result: 100, latest: false });
    expect(await b).toEqual({ status: "saved", result: 200, latest: true });
    expect(server.db.monto).toBe(200);
  });

  it("los pedidos de en medio se reemplazan sin salir: solo sale el último", async () => {
    const saves = createSerialSaves();
    const server = fakeServer();
    const a = saves.save("pct", server.write("pct", 10));
    const b = saves.save("pct", server.write("pct", 20));
    const c = saves.save("pct", server.write("pct", 30));
    expect(await b).toEqual({ status: "superseded" });

    server.finish(0);
    await flush();
    server.finish(1);
    expect(await a).toMatchObject({ status: "saved", latest: false });
    expect(await c).toMatchObject({ status: "saved", latest: true });
    expect(server.inFlight.map((r) => r.value)).toEqual([10, 30]);
    expect(server.db.pct).toBe(30);
  });

  it("la respuesta vieja no se aplica aunque llegue después de pedir otro valor", async () => {
    // Lo que haría la interfaz: mostrar solo respuestas `latest`.
    const saves = createSerialSaves();
    const server = fakeServer();
    let shown: unknown = "original";
    const apply = (outcome: SaveOutcome<unknown>) => {
      if (outcome.status === "saved" && outcome.latest) shown = outcome.result;
    };
    const first = saves.save("nivel", server.write("nivel", 50)).then(apply);
    await flush();
    const second = saves.save("nivel", server.write("nivel", 80)).then(apply);

    server.finish(0);
    await first;
    expect(shown).toBe("original"); // la de 50 ya no es la última: no pisa nada
    await flush();
    server.finish(1);
    await second;
    expect(shown).toBe(80);
    expect(server.db.nivel).toBe(80);
  });

  it("si falla un guardado viejo no es el último (la interfaz no revierte)", async () => {
    const saves = createSerialSaves();
    const server = fakeServer();
    const a = saves.save("monto", server.write("monto", 100));
    await flush();
    const b = saves.save("monto", server.write("monto", 200));

    server.finish(0, new Error("red"));
    expect(await a).toMatchObject({ status: "failed", latest: false });
    await flush();
    server.finish(1);
    expect(await b).toMatchObject({ status: "saved", latest: true });
    expect(server.db.monto).toBe(200);
  });

  it("si falla el último, lo dice (la interfaz revierte a lo confirmado)", async () => {
    const saves = createSerialSaves();
    const server = fakeServer();
    const a = saves.save("monto", server.write("monto", 100));
    await flush();
    server.finish(0);
    await a;
    const b = saves.save("monto", server.write("monto", 200));
    await flush();
    const error = new Error("sin red");
    server.finish(1, error);
    expect(await b).toEqual({ status: "failed", error, latest: true });
    expect(server.db.monto).toBe(100);
  });

  it("campos distintos van en carriles distintos: no se esperan entre sí", async () => {
    const saves = createSerialSaves();
    const server = fakeServer();
    void saves.save("monto", server.write("monto", 1));
    void saves.save("pct", server.write("pct", 2));
    await flush();
    expect(server.inFlight.map((r) => r.field)).toEqual(["monto", "pct"]);
  });

  it("un carril compartido serializa campos distintos sin descartar ninguno", async () => {
    // Una entrada: ancho y línea se escriben juntos en el servidor.
    const saves = createSerialSaves();
    const server = fakeServer();
    const ancho = saves.save("anchoCm", server.write("anchoCm", 120), "entrada");
    const linea = saves.save("linea", server.write("linea", "mini"), "entrada");
    await flush();
    expect(server.inFlight.map((r) => r.field)).toEqual(["anchoCm"]);

    server.finish(0);
    await flush();
    server.finish(1);
    expect(await ancho).toMatchObject({ status: "saved", latest: true });
    expect(await linea).toMatchObject({ status: "saved", latest: true });
    expect(server.db).toEqual({ anchoCm: 120, linea: "mini" });
  });

  it("en un carril compartido solo se reemplaza el pedido pendiente del mismo campo", async () => {
    const saves = createSerialSaves();
    const server = fakeServer();
    void saves.save("anchoCm", server.write("anchoCm", 100), "entrada");
    const linea = saves.save("linea", server.write("linea", "mini"), "entrada");
    const ancho2 = saves.save("anchoCm", server.write("anchoCm", 110), "entrada");
    const ancho3 = saves.save("anchoCm", server.write("anchoCm", 120), "entrada");
    expect(await ancho2).toEqual({ status: "superseded" });

    for (let i = 0; i < 3; i++) {
      await flush();
      server.finish(i);
    }
    expect(await linea).toMatchObject({ status: "saved", latest: true });
    expect(await ancho3).toMatchObject({ status: "saved", latest: true });
    expect(server.inFlight.map((r) => r.value)).toEqual([100, "mini", 120]);
    expect(server.db).toEqual({ anchoCm: 120, linea: "mini" });
  });

  it("un error síncrono del pedido se reporta y el carril sigue", async () => {
    const saves = createSerialSaves();
    const boom = new Error("síncrono");
    const a = saves.save("x", () => {
      throw boom;
    });
    const b = saves.save("y", () => Promise.resolve("ok"), "x");
    expect(await a).toEqual({ status: "failed", error: boom, latest: true });
    expect(await b).toEqual({ status: "saved", result: "ok", latest: true });
  });

  it("tras vaciarse el carril, un pedido nuevo sale de inmediato", async () => {
    const saves = createSerialSaves();
    const server = fakeServer();
    const a = saves.save("monto", server.write("monto", 1));
    await flush();
    server.finish(0);
    await a;
    void saves.save("monto", server.write("monto", 2));
    await flush();
    expect(server.inFlight.map((r) => r.value)).toEqual([1, 2]);
  });
});
