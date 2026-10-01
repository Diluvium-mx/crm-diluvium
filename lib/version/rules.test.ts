import { describe, expect, it } from "vitest";
import {
  ACTION_NOT_FOUND_HEADER,
  esAccionNoEncontrada,
  esArchivoDelCrm,
  esCancelacion,
  esDelCrm,
  esDelVendedor,
  esVersionDistinta,
  senalDeRespuesta,
} from "./rules";

const ORIGEN = "https://crm-diluvium-production.up.railway.app";
const headers = (h: Record<string, string> = {}) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

describe("aviso de actualización: reglas", () => {
  it("solo cuenta peticiones al mismo CRM, nunca la consulta de versión", () => {
    expect(esDelCrm("/dashboard", ORIGEN)).toBe(true);
    expect(esDelCrm(`${ORIGEN}/api/inbox/adjuntos`, ORIGEN)).toBe(true);
    expect(esDelCrm("https://bucket.t3.storageapi.dev/x.jpg", ORIGEN)).toBe(false);
    expect(esDelCrm("/api/version", ORIGEN)).toBe(false);
    expect(esDelCrm(`${ORIGEN}/api/version?x=1`, ORIGEN)).toBe(false);
  });

  it("los archivos del CRM son los de /_next/", () => {
    expect(esArchivoDelCrm(`${ORIGEN}/_next/static/chunks/36vwz2n4bb9w4.js`, ORIGEN)).toBe(true);
    expect(esArchivoDelCrm(`${ORIGEN}/logo-diluvium.png`, ORIGEN)).toBe(false);
    expect(esArchivoDelCrm("https://cdn.otro.com/_next/static/x.js", ORIGEN)).toBe(false);
  });

  it("una acción que ya no existe es segura; 404 y 5xx se revisan; lo demás no", () => {
    const r = (status: number, h?: Record<string, string>, url = "/dashboard") => senalDeRespuesta({ url: `${ORIGEN}${url}`, status, headers: headers(h) }, ORIGEN);
    expect(r(404, { [ACTION_NOT_FOUND_HEADER]: "1" })).toBe("segura");
    expect(r(404)).toBe("revisar");
    expect(r(500)).toBe("revisar");
    expect(r(502)).toBe("revisar");
    expect(r(200)).toBeNull();
    expect(r(400)).toBeNull();
    expect(r(401)).toBeNull();
    expect(r(413)).toBeNull();
    expect(r(500, {}, "/api/version")).toBeNull();
    expect(senalDeRespuesta({ url: "https://graph.facebook.com/x", status: 500, headers: headers() }, ORIGEN)).toBeNull();
  });

  it("reconoce el error de Next de acción no encontrada y las cancelaciones", () => {
    const accion = new Error('Server Action "abc" was not found on the server.');
    accion.name = "UnrecognizedActionError";
    expect(esAccionNoEncontrada(accion)).toBe(true);
    expect(esAccionNoEncontrada(new Error("otra cosa"))).toBe(false);
    expect(esAccionNoEncontrada("UnrecognizedActionError")).toBe(false);
    expect(esCancelacion(new DOMException("cancelado", "AbortError"))).toBe(true);
    expect(esCancelacion(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("dos versiones solo son distintas si ambas se conocen", () => {
    expect(esVersionDistinta("a1b2c3", "d4e5f6")).toBe(true);
    expect(esVersionDistinta("a1b2c3", "a1b2c3")).toBe(false);
    expect(esVersionDistinta("", "d4e5f6")).toBe(false);
    expect(esVersionDistinta("a1b2c3", "")).toBe(false);
    expect(esVersionDistinta("a1b2c3", undefined)).toBe(false);
    expect(esVersionDistinta("a1b2c3", 42)).toBe(false);
  });
});

describe("aviso de actualización: solo lo que hizo el vendedor", () => {
  it("cuenta la petición que salió hasta 3 s después de un gesto", () => {
    expect(esDelVendedor(10_000, 9_500)).toBe(true);
    expect(esDelVendedor(10_000, 7_000)).toBe(true);
    expect(esDelVendedor(10_001, 7_000)).toBe(false);
  });
  it("sin gesto, o un refresco automático lejos del último gesto, no cuenta", () => {
    expect(esDelVendedor(10_000, null)).toBe(false);
    expect(esDelVendedor(60_000, 1_000)).toBe(false);
    expect(esDelVendedor(9_000, 10_000)).toBe(false);
  });
});
