// Uso: npm run costos:correo                   → manda el reporte de costos del mes anterior (GitHub lo corre el
//                                                día 3 de cada mes: .github/workflows/costos-mes.yml)
//      COSTOS_MES=2026-10 npm run costos:correo → el de otro mes
//      npm run costos:correo -- --probar        → no manda nada: guarda el correo como HTML en la carpeta temporal
//                                                y dice dónde (para verlo antes en la Mac)
//
// Reporte mensual de costos del CRM (decisión del dueño 28-oct-2026; docs/costos.md). Lee la base con DATABASE_URL:
// en GitHub es la URL de SOLO LECTURA de los respaldos, con TLS autenticado si viene PGSSLROOTCERT, y la sesión
// además se abre en solo lectura. Manda por la API de Zoho (lib/costos/zoho.ts) de COSTOS_CORREO_DE a
// COSTOS_CORREO_PARA, en pesos (promedio del dólar del mes, Diario Oficial: lib/costos/tipo-cambio.ts) y dólares.
// El log solo dice qué mes se mandó o el error: el repo es público (nada de montos ni correos).
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { cargarReporte } from "@/lib/costos/cargar";
import { asuntoCorreo, htmlCorreo } from "@/lib/costos/correo";
import { mesAnterior, mesDe } from "@/lib/costos/mes";
import { leerTipoCambio } from "@/lib/costos/tipo-cambio";
import { type ZohoConfig, enviarCorreoZoho, zohoConfigFromEnv } from "@/lib/costos/zoho";
import * as schema from "@/lib/db/schema";
import { safeErrorMessage } from "@/lib/log/safe-error";

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fallar(motivo: string): never {
  console.error(`[costos] ${motivo}`);
  process.exit(1);
}

async function main() {
  const probar = process.argv.includes("--probar");
  const now = new Date();
  const mes = process.env.COSTOS_MES ? mesDe(process.env.COSTOS_MES) : mesAnterior(now);

  const url = process.env.DATABASE_URL;
  if (!url) fallar("Falta DATABASE_URL.");

  let envio: { de: string; para: string; zoho: ZohoConfig } | null = null;
  if (!probar) {
    const zoho = zohoConfigFromEnv();
    if ("faltan" in zoho) fallar(`Faltan variables de Zoho: ${zoho.faltan.join(", ")} (docs/costos.md › Conectar Zoho).`);
    const de = process.env.COSTOS_CORREO_DE ?? "";
    const para = process.env.COSTOS_CORREO_PARA ?? "";
    if (!CORREO_RE.test(de) || !CORREO_RE.test(para)) fallar("Falta COSTOS_CORREO_DE o COSTOS_CORREO_PARA, o no es un correo.");
    envio = { de, para, zoho: zoho.config };
  }

  // verify-ca, como los respaldos: valida la cadena contra la CA fijada; el nombre del host es el del proxy de Railway.
  const ca = process.env.PGSSLROOTCERT ? readFileSync(process.env.PGSSLROOTCERT, "utf8") : null;
  const client = postgres(url, {
    max: 1,
    ssl: ca ? { ca, rejectUnauthorized: true, checkServerIdentity: () => undefined } : undefined,
    connection: { application_name: "costos-mes", default_transaction_read_only: true, statement_timeout: 120_000 },
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  try {
    const orgs = await db.select({ id: schema.organization.id, name: schema.organization.name }).from(schema.organization).orderBy(asc(schema.organization.createdAt));
    if (!orgs.length) fallar("No hay organizaciones en la base.");
    // Promedio del dólar del mes (Diario Oficial). Si falla, el correo sale en dólares con un aviso.
    const tipoCambio = await leerTipoCambio(mes);
    for (const org of orgs) {
      const reporte = await cargarReporte(db, org, mes, now, tipoCambio);
      const asunto = asuntoCorreo(reporte);
      const html = htmlCorreo(reporte);
      if (!envio) {
        const archivo = join(tmpdir(), `costos-${mes.clave}-${org.id}.html`);
        writeFileSync(archivo, html);
        console.log(`[costos] ${asunto}\n         ${archivo}`);
        continue;
      }
      await enviarCorreoZoho(envio.zoho, { de: envio.de, para: envio.para, asunto, html });
      console.log(`[costos] Correo de costos de ${mes.nombre} mandado (organización ${orgs.indexOf(org) + 1} de ${orgs.length}).`);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((e: unknown) => fallar(safeErrorMessage(e)));
