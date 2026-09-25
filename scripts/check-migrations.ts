// Uso: npm run db:check                 → falla (código 1) si falta alguna migración del journal
//      npm run db:check -- --wait 900   → espera hasta 900 s a que aparezcan (pre-deploy del worker:
//                                         el web las aplica en su propio pre-deploy)
//
// Es el candado del despliegue (docs/migraciones.md): corre en el pre-deploy de
// Railway del web (después de `drizzle-kit migrate`) y del worker. Si falla, el
// despliegue NO avanza y la versión anterior sigue atendiendo, sin caída.
import { db } from "@/lib/db";
import { compareMigrations, describeReport, migrationHashes, readApplied, readJournal } from "@/lib/db/migration-check";

function waitSeconds(argv: string[]): number {
  const i = argv.indexOf("--wait");
  if (i === -1) return 0;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

async function main(): Promise<number> {
  const journal = readJournal();
  const hashes = migrationHashes(journal);
  const deadline = Date.now() + waitSeconds(process.argv.slice(2)) * 1000;
  let lastLog = 0;
  for (;;) {
    const report = compareMigrations(journal, await readApplied(db), hashes);
    if (report.ok) {
      console.info(`[migraciones] ${describeReport(report)}`);
      return 0;
    }
    if (Date.now() >= deadline) {
      console.error(`[migraciones] ${describeReport(report)}`);
      return 1;
    }
    if (Date.now() - lastLog >= 60_000) {
      console.info(`[migraciones] esperando: faltan ${report.missing.map((m) => m.tag).join(", ")}`);
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error("[migraciones] no se pudo revisar la base:", error);
    process.exit(1);
  });
