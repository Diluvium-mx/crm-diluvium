import { describe, expect, it } from "vitest";
import { crearLote, type Transporte } from "./lote-cliente";
import { MAX_LOTE, type PedidoLectura, type RespuestaLectura } from "./lote-tipos";

type Lectores = {
  uno: (id: string) => Promise<string>;
  dos: (id: string, opciones?: { limit?: number }) => Promise<number>;
};

// Reloj de prueba: la ventana de 10 ms corre cuando la prueba dice (`pasar`), y el «ahora» se mueve a mano.
function relojDePrueba() {
  let ahora = 0;
  let pendientes: Array<() => void> = [];
  return {
    reloj: { ahora: () => ahora, esperar: (fn: () => void) => void pendientes.push(fn) },
    pasar() {
      const listos = pendientes;
      pendientes = [];
      for (const fn of listos) fn();
    },
    adelantar(ms: number) {
      ahora += ms;
    },
  };
}

// Transporte que guarda cada viaje y contesta cuando la prueba lo suelta.
function transporteDePrueba(responder: (p: PedidoLectura) => RespuestaLectura = (p) => ({ ok: true, valor: `${p.nombre}:${p.args.join(",")}` })) {
  const viajes: PedidoLectura[][] = [];
  const sueltos: Array<() => void> = [];
  const transporte: Transporte = (pedidos) => {
    viajes.push(pedidos);
    return new Promise((resolve) => sueltos.push(() => resolve(pedidos.map(responder))));
  };
  return {
    transporte,
    viajes,
    soltar() {
      sueltos.shift()?.();
    },
  };
}

const vaciar = () => new Promise((r) => setTimeout(r, 0));

describe("lote de lecturas (pestaña)", () => {
  it("las lecturas pedidas casi juntas viajan en una sola acción y cada quien recibe la suya", async () => {
    const t = relojDePrueba();
    const red = transporteDePrueba();
    const { leer } = crearLote<Lectores>(red.transporte, t.reloj);
    const a = leer("uno", "c1");
    const b = leer("dos", "c1", { limit: 30 });
    t.pasar();
    expect(red.viajes).toHaveLength(1);
    expect(red.viajes[0].map((p) => p.nombre)).toEqual(["uno", "dos"]);
    red.soltar();
    await expect(a).resolves.toBe("uno:c1");
    await expect(b).resolves.toBe("dos:c1,[object Object]");
  });

  it("la misma lectura pedida dos veces antes de salir viaja una vez", async () => {
    const t = relojDePrueba();
    const red = transporteDePrueba();
    const { leer } = crearLote<Lectores>(red.transporte, t.reloj);
    const a = leer("uno", "c1");
    const b = leer("uno", "c1");
    t.pasar();
    expect(red.viajes[0]).toHaveLength(1);
    red.soltar();
    await expect(Promise.all([a, b])).resolves.toEqual(["uno:c1", "uno:c1"]);
  });

  it("solo un viaje de lecturas a la vez: lo que llega mientras tanto se junta para el siguiente", async () => {
    const t = relojDePrueba();
    const red = transporteDePrueba();
    const { leer } = crearLote<Lectores>(red.transporte, t.reloj);
    const a = leer("uno", "c1");
    t.pasar();
    const b = leer("uno", "c2");
    const c = leer("uno", "c3");
    t.pasar();
    expect(red.viajes).toHaveLength(1); // b y c esperan a que vuelva el primero
    red.soltar();
    await a;
    t.pasar();
    expect(red.viajes).toHaveLength(2);
    expect(red.viajes[1].map((p) => p.args[0])).toEqual(["c2", "c3"]);
    red.soltar();
    await expect(Promise.all([b, c])).resolves.toEqual(["uno:c2", "uno:c3"]);
  });

  it("una lectura que falla rechaza solo a quien la pidió", async () => {
    const t = relojDePrueba();
    const red = transporteDePrueba((p) => (p.args[0] === "malo" ? { ok: false } : { ok: true, valor: "bien" }));
    const { leer } = crearLote<Lectores>(red.transporte, t.reloj);
    const a = leer("uno", "malo");
    const b = leer("uno", "c1");
    t.pasar();
    red.soltar();
    await expect(a).rejects.toThrow("No se pudo leer.");
    await expect(b).resolves.toBe("bien");
  });

  it("si el viaje entero falla (sin conexión) fallan todas las de esa tanda y la siguiente sale", async () => {
    const t = relojDePrueba();
    let llamadas = 0;
    const transporte: Transporte = async (pedidos) => {
      llamadas++;
      if (llamadas === 1) throw new Error("sin conexión");
      return pedidos.map(() => ({ ok: true, valor: "otra vez" }));
    };
    const { leer } = crearLote<Lectores>(transporte, t.reloj);
    const a = leer("uno", "c1");
    t.pasar();
    await expect(a).rejects.toThrow("sin conexión");
    const b = leer("uno", "c1");
    t.pasar();
    await expect(b).resolves.toBe("otra vez");
  });

  it(`más de ${MAX_LOTE} lecturas se parten en tandas`, async () => {
    const t = relojDePrueba();
    const red = transporteDePrueba();
    const { leer } = crearLote<Lectores>(red.transporte, t.reloj);
    const todas = Array.from({ length: MAX_LOTE + 3 }, (_, i) => leer("uno", `c${i}`));
    t.pasar();
    expect(red.viajes[0]).toHaveLength(MAX_LOTE);
    red.soltar();
    await vaciar();
    t.pasar();
    expect(red.viajes[1]).toHaveLength(3);
    red.soltar();
    await expect(Promise.all(todas)).resolves.toHaveLength(MAX_LOTE + 3);
  });

  it("lo precargado se toma sin otro viaje, una sola vez", async () => {
    const t = relojDePrueba();
    const red = transporteDePrueba();
    const { leer, precargar } = crearLote<Lectores>(red.transporte, t.reloj);
    precargar([
      ["uno", "c1"],
      ["dos", "c1", { limit: 30 }],
    ]);
    t.pasar();
    red.soltar();
    await vaciar();
    await expect(leer("dos", "c1", { limit: 30 })).resolves.toBe("dos:c1,[object Object]");
    expect(red.viajes).toHaveLength(1);
    // La segunda vez ya es fresca.
    const otra = leer("dos", "c1", { limit: 30 });
    t.pasar();
    expect(red.viajes).toHaveLength(2);
    red.soltar();
    await otra;
  });

  it("con otros argumentos no toma lo precargado", () => {
    const t = relojDePrueba();
    const red = transporteDePrueba();
    const { leer, precargar } = crearLote<Lectores>(red.transporte, t.reloj);
    precargar([["dos", "c1", { limit: 30 }]]);
    void leer("dos", "c1", { limit: 100 });
    t.pasar();
    expect(red.viajes[0].map((p) => p.args)).toEqual([
      ["c1", { limit: 30 }],
      ["c1", { limit: 100 }],
    ]);
  });

  it("lo precargado vence: pasado el tiempo se vuelve a pedir", async () => {
    const t = relojDePrueba();
    const red = transporteDePrueba();
    const { leer, precargar } = crearLote<Lectores>(red.transporte, t.reloj);
    precargar([["uno", "c1"]]);
    t.pasar();
    red.soltar();
    t.adelantar(5_001);
    void leer("uno", "c1");
    t.pasar();
    expect(red.viajes).toHaveLength(1); // espera a que vuelva el primero…
    await vaciar();
    t.pasar();
    expect(red.viajes).toHaveLength(2); // …y la vencida sale aparte
  });

  it("un aviso en vivo del chat o del contacto descarta lo precargado de él", async () => {
    const t = relojDePrueba();
    const red = transporteDePrueba();
    const { leer, precargar, olvidarPrecarga } = crearLote<Lectores>(red.transporte, t.reloj);
    precargar([
      ["uno", "c1"],
      ["uno", "contacto9"],
    ]);
    t.pasar();
    red.soltar();
    await vaciar();
    olvidarPrecarga("c1");
    void leer("uno", "c1");
    await expect(leer("uno", "contacto9")).resolves.toBe("uno:contacto9");
    t.pasar();
    expect(red.viajes).toHaveLength(2);
    expect(red.viajes[1].map((p) => p.args[0])).toEqual(["c1"]);
  });

  it("una precarga que falla y nadie toma no queda como error suelto", async () => {
    const t = relojDePrueba();
    const red = transporteDePrueba(() => ({ ok: false }));
    const { precargar } = crearLote<Lectores>(red.transporte, t.reloj);
    precargar([["uno", "c1"]]);
    t.pasar();
    red.soltar();
    await vaciar(); // si quedara suelto, Vitest marcaría «unhandled rejection»
    expect(red.viajes).toHaveLength(1);
  });
});
