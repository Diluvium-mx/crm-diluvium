// Links de pago del Agente IA (30-oct-2026): reglas puras (claves, monto, lada, texto) y la herramienta.
import { describe, expect, it } from "vitest";
import { defaultStages } from "@/lib/contacts/stages";
import { phoneParts } from "@/lib/phone";
import { buildAgentTools, mergeHandoffToolCalls, TOOL_ACTUALIZAR_DETALLE, TOOL_AVISO_VENDEDOR, TOOL_LINK_PAGO, validateToolCalls, type ValidToolCall } from "@/lib/ai/runtime/tools";
import { ladaSinLinks, linkCuadra, linkPagoDescription, linksDelAgente, mensajesLink, opcionesDe, TEXTOS_DE_FABRICA, totalQueCubre, validateLinksPago, validateTextosLink, type LinkPago } from "./links-pago";

const link = (posicion: number, nombre: string, monto: number, cubre: "total" | "mitad", meses: number, url: string, soloVendedor = false): LinkPago => ({ id: `l${posicion}`, nombre, monto, cubre, meses, url, soloVendedor, posicion });

const LINKS = [
  link(2, "2 compuertas estándar", 11_000, "total", 6, "https://mpago.la/EJEMPLO2"),
  link(1, "1 compuerta estándar", 5_500, "total", 6, "https://mpago.la/EJEMPLO1"),
  link(3, "Medida especial anticipo", 3_500, "mitad", 0, "https://mpago.li/EJEMPLO3"),
  link(4, "Medida especial liquidación", 3_500, "mitad", 0, "https://mpago.li/EJEMPLO3"),
];

const lada = (e164: string) => {
  const p = phoneParts(e164);
  return ladaSinLinks(p.phoneCountryIso, p.phoneCountryCode);
};

describe("links de pago: reglas", () => {
  it("claves por posición, sin acentos y sin repetir", () => {
    expect(opcionesDe(LINKS).map((o) => o.clave)).toEqual(["1_compuerta_estandar", "2_compuertas_estandar", "medida_especial_anticipo", "medida_especial_liquidacion"]);
    expect(opcionesDe([link(1, "Pago", 1, "total", 0, "https://a.b"), link(2, "pago", 2, "total", 0, "https://a.b"), link(3, "¡¡!!", 3, "total", 0, "https://a.b")]).map((o) => o.clave)).toEqual(["pago", "pago_2", "link"]);
  });

  it("el link cobra el total o la mitad, al centavo", () => {
    expect(totalQueCubre(LINKS[2])).toBe(7_000);
    expect(linkCuadra(LINKS[1], 5_500)).toBe(true);
    expect(linkCuadra(LINKS[1], 11_000)).toBe(false);
    expect(linkCuadra(LINKS[2], 7_000)).toBe(true);
    expect(linkCuadra(LINKS[2], 3_500)).toBe(false);
    expect(linkCuadra({ monto: 0.1 + 0.2, cubre: "total" }, 0.3)).toBe(true);
  });

  it("lada: México, +1 y sin teléfono sí reciben; Perú, España, Ecuador o Chile nunca", () => {
    expect(lada("+526681234567")).toBeNull();
    expect(lada("+16195550100")).toBeNull();
    expect(lada("+14165550100")).toBeNull();
    expect(ladaSinLinks(null, null)).toBeNull();
    for (const e164 of ["+51987654321", "+34612345678", "+593991234567", "+56912345678"]) expect(lada(e164)).not.toBeNull();
    expect(lada("+51987654321")).toContain("Perú");
  });

  it("dos mensajes: el del link (monto, link exacto y cómo pagar) y, aparte, el de los datos de envío", () => {
    expect(mensajesLink(LINKS[1])).toEqual([
      "Aquí le paso el link para pagar $5,500 con tarjeta por MercadoPago ✅\n\nhttps://mpago.la/EJEMPLO1\n\nPuede pagar con tarjeta de crédito o débito, y con crédito elegir hasta 6 meses sin intereses.",
      "Una vez realizado el pago, nos apoya con sus datos de envío:\nNombre de quien recibe\nDirección\nCódigo postal\nTeléfono\nCorreo electrónico",
    ]);
    expect(mensajesLink(LINKS[2])[0]).toContain("$3,500");
    expect(mensajesLink(LINKS[2])[0]).toContain("Es un pago de contado con tarjeta de crédito o débito.");
    // Textos editados: variables con o sin espacios; el 2.º vacío no sale.
    expect(mensajesLink(LINKS[1], { mensaje1: "Link {{ link }} por {{monto}}", mensaje2: "  " })).toEqual(["Link https://mpago.la/EJEMPLO1 por $5,500"]);
  });

  it("textos editables: {{link}} obligatorio en el 1.º; solo valen {{monto}}, {{link}} y {{forma_de_pago}}", () => {
    expect(validateTextosLink(TEXTOS_DE_FABRICA)).toEqual([]);
    expect(validateTextosLink({ mensaje1: "Aquí está el link", mensaje2: "" })).toEqual(["El mensaje 1 debe llevar {{link}} (ahí va el link)."]);
    expect(validateTextosLink({ mensaje1: "{{link}} {{nombre}}", mensaje2: "Hola {{cliente}}" })).toEqual([
      "El mensaje 1 tiene {{nombre}}: solo valen {{monto}}, {{link}} y {{forma_de_pago}}.",
      "El mensaje 2 tiene {{cliente}}: solo valen {{monto}}, {{link}} y {{forma_de_pago}}.",
    ]);
    expect(validateTextosLink({ mensaje1: " ", mensaje2: "" })).toContain("Falta el mensaje 1.");
  });

  it("los «Solo vendedor» (precio especial) nunca son del Agente IA", () => {
    const conEspecial = [...LINKS, link(5, "2 compuertas (especial)", 10_400, "total", 6, "https://mpago.la/EJEMPLO9", true)];
    expect(linksDelAgente(conEspecial).map((l) => l.nombre)).not.toContain("2 compuertas (especial)");
    expect(linksDelAgente(conEspecial)).toHaveLength(4);
  });

  it("validación del editor: https, nombre sin repetir, monto positivo", () => {
    const ok = LINKS.map(({ nombre, monto, cubre, meses, url }) => ({ nombre, monto, cubre, meses, url }));
    expect(validateLinksPago(ok)).toEqual([]);
    expect(validateLinksPago([{ ...ok[0], url: "mpago.la/EJEMPLO2" }])).toEqual(["El link debe empezar con https:// (cópialo completo de MercadoPago)."]);
    expect(validateLinksPago([{ ...ok[0], url: "http://mpago.la/EJEMPLO2" }])).toHaveLength(1);
    expect(validateLinksPago([ok[0], { ...ok[1], nombre: "2 COMPUERTAS ESTANDAR" }])).toEqual(["El nombre «2 COMPUERTAS ESTANDAR» está repetido."]);
    expect(validateLinksPago([{ ...ok[0], monto: 0 }])).toEqual(["El monto debe ser mayor a cero."]);
    expect(validateLinksPago([{ ...ok[0], nombre: " " }])).toEqual(["Falta el nombre."]);
  });

  it("la descripción de la herramienta dice qué cobra cada opción y que el modelo no escribe el link", () => {
    const d = linkPagoDescription(opcionesDe(LINKS));
    expect(d).toContain("1_compuerta_estandar = 1 compuerta estándar: cobra $5,500, hasta 6 meses sin intereses");
    expect(d).toContain("medida_especial_anticipo = Medida especial anticipo: cobra $3,500, la mitad de un total de $7,000, de contado");
    expect(d).toContain("nunca escribas tú un link de pago");
    expect(d).not.toContain("mpago");
  });
});

describe("links de pago: herramienta enviar_link_pago", () => {
  const stages = defaultStages();
  const opciones = opcionesDe(LINKS);

  it("solo se ofrece con opciones, antes de actualizar_detalle (orden estable)", () => {
    expect(Object.keys(buildAgentTools([], stages).tools)).not.toContain(TOOL_LINK_PAGO);
    const keys = Object.keys(buildAgentTools([], stages, opciones).tools);
    expect(keys.slice(-3)).toEqual([TOOL_AVISO_VENDEDOR, TOOL_LINK_PAGO, TOOL_ACTUALIZAR_DETALLE]);
  });

  it("valida la opción, una por respuesta; sin la herramienta ofrecida se ignora", () => {
    const t = buildAgentTools([], stages, opciones);
    const { valid, ignored } = validateToolCalls(
      [
        { toolName: TOOL_LINK_PAGO, input: { opcion: "2_compuertas_estandar" } },
        { toolName: TOOL_LINK_PAGO, input: { opcion: "1_compuerta_estandar" } },
        { toolName: TOOL_LINK_PAGO, input: { opcion: "3_compuertas" } },
      ],
      t,
    );
    expect(valid).toEqual([{ kind: "link", opcion: opciones[1] }]);
    expect(ignored).toEqual([`${TOOL_LINK_PAGO}: opción inválida`]);
    const sinLinks = validateToolCalls([{ toolName: TOOL_LINK_PAGO, input: { opcion: "1_compuerta_estandar" } }], buildAgentTools([], stages));
    expect(sinLinks.valid).toEqual([]);
    expect(sinLinks.ignored).toEqual([`${TOOL_LINK_PAGO}: herramienta no ofrecida en este chat`]);
  });

  it("traspaso: el link del Modelo 1 se conserva si el Modelo 2 no pidió uno", () => {
    const l = (i: number): ValidToolCall => ({ kind: "link", opcion: opciones[i] });
    expect(mergeHandoffToolCalls([l(0)], []).filter((c) => c.kind === "link")).toEqual([l(0)]);
    expect(mergeHandoffToolCalls([l(0)], [l(1)]).filter((c) => c.kind === "link")).toEqual([l(1)]);
  });
});
