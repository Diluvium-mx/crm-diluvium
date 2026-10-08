import { afterEach, describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { logError, safeErrorMessage } from "./safe-error";

const PHONE = "+526680001234";
const pgError = Object.assign(new Error('duplicate key value violates unique constraint "contacts_org_phone"'), {
  code: "23505",
  detail: `Key (phone_e164)=(${PHONE}) already exists.`,
});
const queryError = () => new DrizzleQueryError('insert into "contacts" ("phone_e164", "first_name") values ($1, $2)', [PHONE, "Ana Pérez"], pgError);

describe("safeErrorMessage (S3: errores sin datos de clientes)", () => {
  it("de una consulta deja el código, el motivo y el SQL, nunca los parámetros ni el detail", () => {
    const text = safeErrorMessage(queryError());
    expect(text).toContain("23505");
    expect(text).toContain("contacts_org_phone");
    expect(text).toContain('insert into "contacts"');
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain("Ana Pérez");
  });
  it("otros errores conservan su mensaje (cortado si traen un «params:» dentro)", () => {
    expect(safeErrorMessage(new Error("Zernio respondió 500"))).toBe("Zernio respondió 500");
    expect(safeErrorMessage(new Error(`Failed query: select 1\nparams: ${PHONE}`))).not.toContain(PHONE);
    expect(safeErrorMessage("texto")).toBe("texto");
  });
});

describe("logError", () => {
  afterEach(() => vi.restoreAllMocks());
  it("no imprime la pila de una consulta (repite los parámetros)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("[prueba]", queryError());
    const printed = spy.mock.calls.flat().map(String).join(" ");
    expect(printed).toContain("[prueba]");
    expect(printed).not.toContain(PHONE);
  });
  it("de la pila de otro error solo imprime las líneas «at …» (no repite un mensaje con «params:»)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("[prueba]", new Error(`Failed query: select 1\nparams: ${PHONE}`));
    const printed = spy.mock.calls.flat().map(String).join(" ");
    expect(printed).toContain("Failed query: select 1");
    expect(printed).toContain("at ");
    expect(printed).not.toContain(PHONE);
  });
});
