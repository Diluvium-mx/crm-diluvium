// Prueba GUARDIANA (9-oct-2026, CARD_ACTIONS_NO_REVALIDATE en lib/actions/contacts.ts): las
// acciones de tarjeta del Embudo y la Bandeja no llaman revalidatePath. Con él, Next re-renderiza
// la página desde la que se llamó dentro de la respuesta (~600 KB por clic en el Embudo).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(__dirname, "contacts.ts"), "utf8");
const CARD_ACTIONS = ["createContact", "updateContactStage", "updateContactTemperature", "setContactDestacado"];

// Cuerpo de `export async function <name>(` hasta la siguiente función exportada.
function body(name: string): string {
  const start = SRC.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`no encontré ${name} en contacts.ts`);
  const next = SRC.indexOf("\nexport ", start + 1);
  return SRC.slice(start, next < 0 ? undefined : next);
}

describe("acciones de tarjeta sin revalidatePath", () => {
  it.each(CARD_ACTIONS)("%s no re-renderiza la página", (name) => {
    expect(body(name)).not.toMatch(/\brevalidatePath\(/);
  });
});
