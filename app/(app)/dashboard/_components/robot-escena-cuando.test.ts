import { describe, expect, it } from "vitest";
import { elegirEscena, ESCENA_MS, ESCENA_TONO_MS, finDeEspera, siguienteEscena, vistaDe, type EntradaPildora, type FotoPildora } from "./robot-escena-cuando";

const programado: FotoPildora = {
  estado: "activo",
  id: "f1",
  dueAt: "2026-10-14T01:00:00.000Z",
  enviados: 0,
  ultimoSalio: false,
  cara: "normal",
  etiqueta: "mar 18:00",
  tono: "azul",
};
const suspendido: FotoPildora = { ...programado, cara: "dormido", tono: "ambar" };
const cancelado: FotoPildora = { estado: "cancelado", id: null, dueAt: null, enviados: 0, ultimoSalio: false, cara: "cancelado", etiqueta: null, tono: "gris" };
const dormido: FotoPildora = { ...cancelado, estado: "dormido", cara: "dormido" };
const baja: FotoPildora = { ...cancelado, estado: "baja", etiqueta: "Se dio de baja", tono: "rojo" };

describe("escena de la píldora del seguimiento", () => {
  it("disparo al pasar a Cancelado, desde programado o desde dormido (Apagar)", () => {
    expect(elegirEscena(programado, cancelado)).toBe("disparo");
    expect(elegirEscena(suspendido, cancelado)).toBe("disparo");
    expect(elegirEscena(dormido, cancelado)).toBe("disparo");
    expect(elegirEscena(cancelado, cancelado)).toBeNull();
  });

  it("reparación al reactivar: despierta o se vuelve a dormir según la carita nueva", () => {
    expect(elegirEscena(cancelado, programado)).toBe("reparacion");
    expect(elegirEscena(cancelado, suspendido)).toBe("reparacion-dormido");
    expect(elegirEscena(cancelado, dormido)).toBe("reparacion-dormido");
    expect(elegirEscena(cancelado, baja)).toBeNull();
  });

  it("avión cuando el mismo seguimiento tiene un mensaje más y sí salió", () => {
    const salio = { ...programado, enviados: 1, ultimoSalio: true, dueAt: "2026-10-16T01:00:00.000Z", etiqueta: "jue 18:00" };
    expect(elegirEscena(programado, salio)).toBe("avion");
    expect(elegirEscena(programado, { ...salio, ultimoSalio: false })).toBeNull();
    expect(elegirEscena(programado, { ...salio, id: "f2" })).toBeNull();
  });

  it("despertador con Que salga solo", () => {
    expect(elegirEscena(suspendido, programado)).toBe("despertador");
    expect(elegirEscena(programado, suspendido)).toBeNull();
  });

  it("reloj al cambiar la hora con el robot despierto", () => {
    expect(elegirEscena(programado, { ...programado, dueAt: "2026-10-15T17:00:00.000Z", etiqueta: "mié 10:00" })).toBe("reloj");
    expect(elegirEscena(suspendido, { ...suspendido, dueAt: "2026-10-15T17:00:00.000Z" })).toBeNull();
    expect(elegirEscena(programado, { ...programado, etiqueta: "hoy 18:00" })).toBeNull();
  });

  it("sin escena en lo demás: otro seguimiento, dormido, se dio de baja", () => {
    expect(elegirEscena(programado, { ...programado, id: "f2", dueAt: "2026-10-20T01:00:00.000Z" })).toBeNull();
    expect(elegirEscena(programado, dormido)).toBeNull();
    expect(elegirEscena(dormido, programado)).toBeNull();
    expect(elegirEscena(programado, baja)).toBeNull();
  });

  it("el cambio de color cae antes de que termine la escena", () => {
    for (const [escena, ms] of Object.entries(ESCENA_TONO_MS)) expect(ms).toBeLessThan(ESCENA_MS[escena as keyof typeof ESCENA_MS]);
  });
});

describe("escena en curso (anticipada y con Reactivar en dos tiempos)", () => {
  const entrada = (foto: FotoPildora, extra: Partial<EntradaPildora> = {}): EntradaPildora => ({ foto, reparando: false, despertando: false, silencio: 0, ...extra });

  it("Cancelar anticipado arranca el disparo y la confirmación igual no repite nada", () => {
    const disparo = siguienteEscena(entrada(programado), entrada(cancelado), null);
    expect(disparo?.escena).toBe("disparo");
    expect(siguienteEscena(entrada(cancelado), entrada({ ...cancelado }), disparo)).toBe(disparo);
  });

  it("si el servidor rechaza lo anticipado, regresa sin escena", () => {
    const reloj = siguienteEscena(entrada(programado), entrada({ ...programado, dueAt: "2026-10-15T17:00:00.000Z" }), null);
    expect(reloj?.escena).toBe("reloj");
    expect(siguienteEscena(entrada({ ...programado, dueAt: "2026-10-15T17:00:00.000Z" }), entrada(programado, { silencio: 1 }), reloj)).toBeNull();
  });

  it("Reactivar: golpes al presionar con la píldora como estaba, y el final al llegar la respuesta", () => {
    const golpes = siguienteEscena(entrada(cancelado), entrada(cancelado, { reparando: true }), null);
    expect(golpes).toMatchObject({ escena: "reparacion-golpes", siguiente: null, vista: cancelado });
    expect(vistaDe(programado, golpes)).toBe(cancelado);
    const conFinal = siguienteEscena(entrada(cancelado, { reparando: true }), entrada(programado), golpes);
    expect(conFinal).toMatchObject({ escena: "reparacion-golpes", siguiente: "reparacion", n: golpes?.n });
    const fin = finDeEspera(conFinal!);
    expect(fin).toMatchObject({ escena: "reparacion", tonoAntes: "gris", vista: null });
    expect(vistaDe(programado, fin).tono).toBe("gris");
    expect(siguienteEscena(entrada(cancelado, { reparando: true }), entrada(dormido), golpes)?.siguiente).toBe("reparacion-dormido");
  });

  it("Reactivar rechazado: deja de cargar sin escena", () => {
    const golpes = siguienteEscena(entrada(cancelado), entrada(cancelado, { reparando: true }), null);
    expect(siguienteEscena(entrada(cancelado, { reparando: true }), entrada(cancelado, { silencio: 1 }), golpes)).toBeNull();
  });

  it("Reactivar hecho por otro vendedor: también empieza con los golpes y ya sabe el final", () => {
    const golpes = siguienteEscena(entrada(cancelado), entrada(programado), null);
    expect(golpes).toMatchObject({ escena: "reparacion-golpes", siguiente: "reparacion", vista: cancelado });
  });

  it("los golpes siguen mientras llega la respuesta", () => {
    const golpes = siguienteEscena(entrada(cancelado), entrada(cancelado, { reparando: true }), null);
    expect(siguienteEscena(entrada(cancelado, { reparando: true }), entrada({ ...cancelado, etiqueta: null }, { reparando: true }), golpes)).toBe(golpes);
    expect(finDeEspera(golpes!)).toBeNull();
  });

  it("Despertar: la taza llega al presionar con la píldora dormida, espera «cargando» y el final según la carita nueva", () => {
    const cafe = siguienteEscena(entrada(dormido), entrada(dormido, { despertando: true }), null);
    expect(cafe).toMatchObject({ escena: "cafe", siguiente: null, vista: dormido });
    // La consulta inmediata (todavía dormido, sigue anticipado) no la interrumpe.
    expect(siguienteEscena(entrada(dormido, { despertando: true }), entrada({ ...dormido }, { despertando: true }), cafe)).toBe(cafe);
    expect(finDeEspera(cafe!)).toBeNull();
    // Llega la lectura: se programó → despierta (y la píldora conserva el gris hasta su cambio de color).
    const despierta = siguienteEscena(entrada(dormido, { despertando: true }), entrada(programado), cafe);
    expect(despierta).toMatchObject({ escena: "cafe", siguiente: "cafe-despierto", n: cafe?.n });
    expect(finDeEspera(despierta!)).toMatchObject({ escena: "cafe-despierto", tonoAntes: "gris" });
    // Sigue dormido (No seguir) o quedó suspendido: se vuelve a dormir.
    expect(siguienteEscena(entrada(dormido, { despertando: true }), entrada(dormido), cafe)?.siguiente).toBe("cafe-dormido");
    expect(siguienteEscena(entrada(dormido, { despertando: true }), entrada(suspendido), cafe)?.siguiente).toBe("cafe-dormido");
  });

  it("Despertar rechazado: deja de cargar sin escena", () => {
    const cafe = siguienteEscena(entrada(dormido), entrada(dormido, { despertando: true }), null);
    expect(siguienteEscena(entrada(dormido, { despertando: true }), entrada(dormido, { silencio: 1 }), cafe)).toBeNull();
  });
});
