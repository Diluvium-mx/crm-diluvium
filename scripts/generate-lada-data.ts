// Uso: npx tsx scripts/generate-lada-data.ts
// Regenera lib/phone-lada-data.ts desde los datos de geocodificación de
// libphonenumber de Google para +52 (resources/geocoding/es/52.txt), fijados a una
// versión publicada. Copia las filas TAL CUAL (prefijo → texto); el formato de la
// UI (estado abreviado) lo hace lib/phone-lada.ts. Para actualizar: cambia
// VERSION, corre el script y revisa el diff.
import { writeFileSync } from "node:fs";

const VERSION = "v9.0.9";
const SOURCE = `https://raw.githubusercontent.com/google/libphonenumber/${VERSION}/resources/geocoding/es/52.txt`;
const OUT = new URL("../lib/phone-lada-data.ts", import.meta.url);

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`No se pudo descargar ${SOURCE}: HTTP ${res.status}`);
  const rows: [string, string][] = [];
  for (const line of (await res.text()).split(/\r?\n/)) {
    const m = line.match(/^(52\d+)\|(.+)$/);
    if (m) rows.push([m[1], m[2].trim()]);
  }
  if (rows.length < 300) throw new Error(`Solo ${rows.length} filas: el archivo cambió de forma, revisa ${SOURCE}`);
  const body = rows.map(([prefix, place]) => `  "${prefix}": ${JSON.stringify(place)},`).join("\n");
  writeFileSync(
    OUT,
    `// GENERADO por scripts/generate-lada-data.ts — no editar a mano.
// Fuente: libphonenumber de Google ${VERSION}, resources/geocoding/es/52.txt
// ${SOURCE}
// (Apache License 2.0; Google lo generó del plan de numeración que México comunicó
// a la UIT). Prefijo = "52" + los primeros dígitos del número nacional → lugar.
export const LADA_PLACES: Readonly<Record<string, string>> = {
${body}
};
`,
  );
  console.log(`${rows.length} prefijos escritos en lib/phone-lada-data.ts`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
