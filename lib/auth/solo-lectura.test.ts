import { describe, expect, it } from "vitest";
import {
  esRechazoSoloLectura,
  esSoloLectura,
  respuestaSoloLectura,
  SOLO_LECTURA_DIGEST,
  SOLO_LECTURA_HEADER,
  SOLO_LECTURA_MENSAJE,
  SoloLecturaError,
} from "./solo-lectura";
import { esCajaBloqueada, esRespuestaRechazada, esTeclaQueEscribe } from "./solo-lectura-navegador";

describe("rol «Solo lectura»", () => {
  it("reconoce el rol, también junto a otros", () => {
    expect(esSoloLectura("viewer")).toBe(true);
    expect(esSoloLectura("owner, viewer")).toBe(true);
    for (const otro of ["owner", "admin", "agent", "", null, undefined, "viewers"]) expect(esSoloLectura(otro)).toBe(false);
  });

  it("el rechazo lleva el digest que Next conserva en producción", () => {
    const error = new SoloLecturaError();
    expect(error.digest).toBe(SOLO_LECTURA_DIGEST);
    expect(error.message).toBe(SOLO_LECTURA_MENSAJE);
    expect(esRechazoSoloLectura(error)).toBe(true);
    // En el navegador llega como un Error genérico que solo conserva el digest.
    expect(esRechazoSoloLectura(Object.assign(new Error("An error occurred"), { digest: SOLO_LECTURA_DIGEST }))).toBe(true);
    expect(esRechazoSoloLectura(new Error("No autenticado."))).toBe(false);
    expect(esRechazoSoloLectura(null)).toBe(false);
  });

  it("las rutas responden 403 con el encabezado y el { error } que leen las subidas", async () => {
    const res = respuestaSoloLectura();
    expect(res.status).toBe(403);
    expect(res.headers.get(SOLO_LECTURA_HEADER)).toBe("1");
    expect(await res.json()).toEqual({ error: SOLO_LECTURA_MENSAJE });
  });
});

describe("«Solo lectura» en el navegador", () => {
  const caja = (tagName: string, extra: { type?: string; isContentEditable?: boolean; enBuscador?: boolean } = {}) => ({
    tagName,
    type: extra.type,
    isContentEditable: extra.isContentEditable,
    closest: (selector: string) => (selector === "[data-buscador]" && extra.enBuscador ? ({} as Element) : null),
  });

  it("bloquea las cajas de texto y deja los buscadores y los botones", () => {
    expect(esCajaBloqueada(caja("TEXTAREA"))).toBe(true);
    for (const type of ["", "text", "email", "tel", "number", "password", "date"]) expect(esCajaBloqueada(caja("INPUT", { type }))).toBe(true);
    expect(esCajaBloqueada(caja("DIV", { isContentEditable: true }))).toBe(true);

    expect(esCajaBloqueada(caja("INPUT", { type: "search" }))).toBe(false);
    expect(esCajaBloqueada(caja("INPUT", { type: "date", enBuscador: true }))).toBe(false);
    expect(esCajaBloqueada(caja("TEXTAREA", { enBuscador: true }))).toBe(false);
    for (const type of ["checkbox", "radio", "file", "range", "button", "submit"]) expect(esCajaBloqueada(caja("INPUT", { type }))).toBe(false);
    expect(esCajaBloqueada(caja("BUTTON"))).toBe(false);
    expect(esCajaBloqueada(caja("DIV"))).toBe(false);
    expect(esCajaBloqueada(null)).toBe(false);
  });

  it("solo cuentan las teclas que escriben, borran, pegan o cortan", () => {
    const tecla = (key: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) =>
      esTeclaQueEscribe({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });
    for (const key of ["a", "Z", "1", " ", "ñ", "Backspace", "Delete"]) expect(tecla(key)).toBe(true);
    expect(tecla("v", { metaKey: true })).toBe(true);
    expect(tecla("x", { ctrlKey: true })).toBe(true);
    for (const key of ["Tab", "Escape", "ArrowLeft", "Enter", "Shift", "Meta"]) expect(tecla(key)).toBe(false);
    expect(tecla("c", { metaKey: true })).toBe(false);
    expect(tecla("a", { metaKey: true })).toBe(false);
  });

  it("reconoce el rechazo en la respuesta de una Server Action o de una ruta", async () => {
    const accion = (status: number, cuerpo: string) => new Response(cuerpo, { status, headers: { "Content-Type": "text/x-component" } });
    expect(await esRespuestaRechazada(accion(500, `0:{"a":"$@1"}\n1:E{"digest":"${SOLO_LECTURA_DIGEST}"}\n`), true)).toBe(true);
    // Otro error de la acción, una acción que salió bien, o algo que no es acción: sin aviso.
    expect(await esRespuestaRechazada(accion(500, `1:E{"digest":"123456"}\n`), true)).toBe(false);
    expect(await esRespuestaRechazada(accion(200, `0:{"ok":true,"t":"${SOLO_LECTURA_DIGEST}"}`), true)).toBe(false);
    expect(await esRespuestaRechazada(accion(500, `1:E{"digest":"${SOLO_LECTURA_DIGEST}"}`), false)).toBe(false);
    expect(await esRespuestaRechazada(respuestaSoloLectura(), false)).toBe(true);
  });

  it("leer la respuesta no se la gasta a quien la pidió", async () => {
    const res = new Response(`1:E{"digest":"${SOLO_LECTURA_DIGEST}"}`, { status: 500 });
    await esRespuestaRechazada(res, true);
    expect(await res.text()).toContain(SOLO_LECTURA_DIGEST);
  });
});
