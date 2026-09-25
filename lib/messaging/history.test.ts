import { describe, expect, it, vi } from "vitest";

// Esta unidad prueba una función pura; no abre Postgres.
vi.mock("@/lib/db", () => ({ db: {} }));

import { isEmptyContactName } from "./history";

describe("isEmptyContactName", () => {
  it.each([
    ["Cliente de WhatsApp", null, "+526682410001"],
    [" cliente DE whatsapp ", null, "+526682410001"],
    ["   ", null, "+526682410001"],
    ["+526682410001", null, "+526682410001"],
    ["526682410001", null, "+526682410001"],
    ["668 241 0001", null, "+526682410001"],
    ["+52 (668) 241-0001", null, "+526682410001"],
    ["+5216682410001", null, "+526682410001"],
    ["+526682410001", null, "+5216682410001"],
  ])("considera vacío el placeholder o el propio teléfono: %s", (firstName, lastName, phone) => {
    expect(isEmptyContactName(firstName, lastName, phone)).toBe(true);
  });

  it.each([
    ["Ana", null, "+526682410001"],
    ["Cliente de WhatsApp", "López", "+526682410001"],
    ["526682410001", null, null],
    ["1234567", null, "+526682410001"],
    ["6682419999", null, "+526682410001"],
  ])("conserva nombres reales o números que no corresponden: %s", (firstName, lastName, phone) => {
    expect(isEmptyContactName(firstName, lastName, phone)).toBe(false);
  });
});
