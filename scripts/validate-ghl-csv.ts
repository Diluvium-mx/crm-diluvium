// Uso: npx tsx scripts/validate-ghl-csv.ts <ruta-al-export.csv>
//
// Valida un export de contactos de GHL con el MISMO parser que usa la
// importación (lib/import/ghl-contacts-csv) y reporta los conteos que hay que
// revisar ANTES del import real: canal, etapa (desde Opportunities, la más
// avanzada), sin teléfono, con email, tags de negocio y país. No toca la base
// de datos. Pensado para correr contra el archivo completo antes del respaldo
// fresco y el import a producción.
import { readFileSync } from "node:fs";
import {
  parseGhlContactsCsv,
  type ContactStage,
  type SourceChannel,
} from "@/lib/import/ghl-contacts-csv";

const path = process.argv[2];
if (!path) {
  console.error("Falta la ruta al CSV. Uso: npx tsx scripts/validate-ghl-csv.ts <archivo.csv>");
  process.exit(2);
}

const csv = readFileSync(path, "utf8");
const result = parseGhlContactsCsv(csv);

if (!result.ok) {
  console.error("❌ El CSV tiene errores de formato; no se importaría nada:");
  for (const e of result.errors.slice(0, 20)) {
    console.error(`  fila ${e.rowNumber} (${e.code}): ${e.message}`);
  }
  process.exit(1);
}

const { rows, skipped, totalRows, columnsPresent } = result;

const channel: Record<SourceChannel, number> = { whatsapp: 0, fb: 0, instagram: 0 };
const stage: Record<ContactStage, number> = {
  inbox: 0,
  prospecto: 0,
  interesado: 0,
  cerca_compra: 0,
  compra: 0,
};
let withoutPhone = 0;
let invalidPhones = 0;
let withEmail = 0;
let emptyStage = 0; // Opportunities vacía (se guarda como inbox por default)
let unrecognizedStages = 0;
let withCountry = 0;
const businessTags = new Map<string, number>();
const ids = new Map<string, number>();

for (const r of rows) {
  channel[r.sourceChannel] += 1;
  stage[r.stage] += 1;
  if (r.phoneMissing) withoutPhone += 1;
  if (r.phoneInvalid) invalidPhones += 1;
  if (r.email) withEmail += 1;
  if (r.pipelineStage === null) emptyStage += 1;
  if (!r.stageRecognized) unrecognizedStages += 1;
  if (r.country) withCountry += 1;
  for (const t of r.tags) businessTags.set(t, (businessTags.get(t) ?? 0) + 1);
  ids.set(r.ghlContactId, (ids.get(r.ghlContactId) ?? 0) + 1);
}

const dupIds = [...ids.entries()].filter(([, n]) => n > 1);

const fmt = (n: number) => n.toLocaleString("es-MX");
console.log(`\n== Validación GHL: ${path} ==`);
console.log(`Columnas detectadas:`, columnsPresent);
console.log(`\nFilas de datos: ${fmt(totalRows)}`);
console.log(`  Importables:   ${fmt(rows.length)}`);
console.log(`  Omitidas:      ${fmt(skipped.length)}`);
if (skipped.length) {
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  for (const [reason, n] of byReason) console.log(`    - ${reason}: ${fmt(n)}`);
}

console.log(`\nCanal (source_channel):`);
console.log(`  Facebook (fb): ${fmt(channel.fb)}`);
console.log(`  Instagram:     ${fmt(channel.instagram)}`);
console.log(`  WhatsApp:      ${fmt(channel.whatsapp)}`);

console.log(`\nEtapa (más avanzada desde Opportunities):`);
for (const [k, v] of Object.entries(stage)) console.log(`  ${k}: ${fmt(v)}`);
console.log(`  (de esos inbox, ${fmt(emptyStage)} venían con Opportunities vacía)`);
console.log(`  Etapas con valor pero no reconocidas (→ inbox): ${fmt(unrecognizedStages)}`);

console.log(`\nContacto:`);
console.log(`  Sin teléfono:      ${fmt(withoutPhone)}`);
console.log(`  Teléfono inválido: ${fmt(invalidPhones)}`);
console.log(`  Con email:         ${fmt(withEmail)}`);
console.log(`  Con país:          ${fmt(withCountry)}`);
console.log(`  Contact Id duplicados: ${fmt(dupIds.length)}`);

console.log(`\nTags de negocio conservadas (${businessTags.size} distintas):`);
for (const [t, n] of [...businessTags.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${fmt(n).padStart(7)}  ${t}`);
}
console.log("");
