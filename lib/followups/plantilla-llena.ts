// Plantillas que puede mandar un seguimiento y su texto ya lleno (docs/seguimientos.md §23). PURO.
// Un seguimiento solo llena el {{1}} con CUÁNDO escribió el cliente («la semana pasada»…), nunca con el nombre
// del perfil (6-oct-2026): sirven las plantillas sin datos y las de frase de tiempo (`seg_*` y, si las elige un
// vendedor con «Editar mensaje», las `daniel_*`). Las que piden otro dato no se ofrecen ni salen.
import { templateMaxIndex } from "@/lib/messaging/template-format";
import { PICKER_TIME_PHRASE_TEMPLATES } from "./cases";
import { timePhrase } from "./time-phrase";

/** ¿El seguimiento sabe llenar esta plantilla? */
export function followUpCanFill(name: string, body: string | null): boolean {
  const count = templateMaxIndex(body);
  return count === 0 || (count === 1 && PICKER_TIME_PHRASE_TEMPLATES.has(name));
}

/** El {{1}} de la plantilla: cuándo escribió el cliente, visto desde la hora en que sale. "" si no lleva. */
export function followUpTemplateValue(name: string, lastClientAt: Date | null, sendAt: Date, zone: string): string {
  return PICKER_TIME_PHRASE_TEMPLATES.has(name) && lastClientAt ? timePhrase(lastClientAt, sendAt, zone) : "";
}

/** El texto tal como le llegaría al cliente. */
export function fillFollowUpTemplate(name: string, body: string, lastClientAt: Date | null, sendAt: Date, zone: string): string {
  return body.replace(/\{\{\s*1\s*\}\}/g, followUpTemplateValue(name, lastClientAt, sendAt, zone));
}
