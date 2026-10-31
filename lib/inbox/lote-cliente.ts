// Lote de lecturas, lado de la pestaña (auditoría de velocidad B1/B2, 31-oct-2026). Next manda las Server
// Actions de una pestaña UNA POR UNA, así que cada lectura suelta hacía fila (y el «Enviar» detrás de ellas).
// Aquí las lecturas que se piden casi al mismo tiempo (10 ms) viajan juntas en una sola acción, que el
// servidor corre en paralelo (lote-servidor.ts), y solo hay UN viaje de lecturas en la fila a la vez: lo que
// llega mientras tanto se junta para el siguiente. Al abrir un chat se PRECARGA de un jalón lo que piden sus
// piezas (encabezado, mensajes, Agente IA, Detalle…), que al montarse toman su respuesta sin otro viaje.
import { MAX_LOTE, type PedidoLectura, type RespuestaLectura } from "@/lib/inbox/lote-tipos";

const VENTANA_MS = 10;
// Lo precargado sirve si alguien lo pide en este tiempo (las piezas del chat se montan en cuanto llega su
// encabezado); después se pide de nuevo. Un aviso en vivo de ese chat o contacto lo descarta antes.
const PRECARGA_MS = 5_000;

type Lector = (...args: never) => Promise<unknown>;
export type Transporte = (pedidos: PedidoLectura[]) => Promise<RespuestaLectura[]>;
type Reloj = { ahora: () => number; esperar: (fn: () => void, ms: number) => unknown };
type Espera = { resolve: (valor: unknown) => void; reject: (error: unknown) => void };

const relojReal: Reloj = { ahora: () => Date.now(), esperar: (fn, ms) => setTimeout(fn, ms) };

export function crearLote<F extends Record<string, Lector>>(transporte: Transporte, reloj: Reloj = relojReal) {
  type Nombre = keyof F & string;
  type Pedido<N extends Nombre> = [N, ...Parameters<F[N]>];

  const cola = new Map<string, { nombre: string; args: unknown[]; esperan: Espera[] }>();
  const precargadas = new Map<string, { promesa: Promise<unknown>; vence: number; ids: string[] }>();
  let enVuelo = false;
  let programado = false;

  const clave = (nombre: string, args: unknown[]) => `${nombre}:${JSON.stringify(args)}`;

  function programar() {
    if (programado || enVuelo) return;
    programado = true;
    reloj.esperar(() => {
      programado = false;
      void enviar();
    }, VENTANA_MS);
  }

  async function enviar() {
    if (enVuelo || cola.size === 0) return;
    const tanda = [...cola.entries()].slice(0, MAX_LOTE);
    for (const [k] of tanda) cola.delete(k);
    enVuelo = true;
    try {
      const respuestas = await transporte(tanda.map(([, p]) => ({ nombre: p.nombre, args: p.args })));
      tanda.forEach(([, p], i) => {
        const r = respuestas[i];
        for (const e of p.esperan) {
          if (r?.ok) e.resolve(r.valor);
          else e.reject(new Error("No se pudo leer."));
        }
      });
    } catch (error) {
      // Sin conexión o despliegue nuevo: todas las de la tanda fallan, como fallaría cada acción suelta.
      for (const [, p] of tanda) for (const e of p.esperan) e.reject(error);
    } finally {
      enVuelo = false;
      if (cola.size > 0) programar();
    }
  }

  function pedir(nombre: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const k = clave(nombre, args);
      const igual = cola.get(k);
      // La misma lectura pedida dos veces antes de salir viaja una vez.
      if (igual) igual.esperan.push({ resolve, reject });
      else cola.set(k, { nombre, args, esperan: [{ resolve, reject }] });
      programar();
    });
  }

  /** Igual que llamar la Server Action, pero viaja en el lote (o toma lo precargado). */
  function leer<N extends Nombre>(nombre: N, ...args: Parameters<F[N]>): ReturnType<F[N]> {
    const k = clave(nombre, args);
    const lista = precargadas.get(k);
    if (lista) {
      precargadas.delete(k); // una sola vez: la siguiente lectura ya es fresca
      if (lista.vence > reloj.ahora()) return lista.promesa as ReturnType<F[N]>;
    }
    return pedir(nombre, args) as ReturnType<F[N]>;
  }

  /** Pide ya estas lecturas para que quien las pida en los próximos segundos no haga otro viaje. */
  function precargar(pedidos: ReadonlyArray<{ [N in Nombre]: Pedido<N> }[Nombre]>) {
    const vence = reloj.ahora() + PRECARGA_MS;
    for (const [nombre, ...args] of pedidos) {
      const promesa = pedir(nombre, args);
      promesa.catch(() => undefined); // si nadie la toma, su falla no queda suelta
      const ids = args.filter((a): a is string => typeof a === "string");
      precargadas.set(clave(nombre, args), { promesa, vence, ids });
    }
  }

  /** Llegó un aviso en vivo de este chat o contacto: lo precargado de él ya puede estar viejo. */
  function olvidarPrecarga(id: string) {
    for (const [k, p] of precargadas) if (p.ids.includes(id)) precargadas.delete(k);
  }

  return { leer, precargar, olvidarPrecarga };
}
