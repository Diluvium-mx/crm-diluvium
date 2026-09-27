// Uso: npm run mensajes-rapidos:cargar -- [--org <id>] [--confirmar]
// Carga los 22 mensajes rápidos de Diluvium (lib/snippets/mensajes-rapidos-diluvium.ts)
// en UNA organización, por NOMBRE:
// - si no existe uno con ese nombre, lo crea;
// - si existe con otro texto, actualiza su texto ("Buenas tardes" pasa a "Buenas tardes 🌅");
// - si ya está igual, no lo toca. Correrlo dos veces no duplica nada.
// Los demás mensajes rápidos de la organización NO se tocan ni se borran.
// Sin --confirmar solo SIMULA: dice qué crearía, qué actualizaría y qué dejaría igual.
// Sin --org toma la única organización con owner (si hay más de una, pide --org).
import { parseArgs } from "node:util";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { member, organization, snippets } from "@/lib/db/schema";
import { planSnippetLoad, verifySnippetLoad, type ExistingSnippet, type SnippetLoadPlan } from "@/lib/snippets/carga";
import { MENSAJES_RAPIDOS_DILUVIUM } from "@/lib/snippets/mensajes-rapidos-diluvium";

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function resolveOrganization(orgArg: string | undefined): Promise<{ id: string; name: string }> {
  if (orgArg) {
    const [org] = await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.id, orgArg.trim()))
      .limit(1);
    if (!org) throw new Error(`No existe la organización ${orgArg}`);
    return org;
  }
  const orgs = await db
    .selectDistinct({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.role, "owner"));
  if (orgs.length !== 1) {
    const list = orgs.map((org) => `${org.id} ("${org.name}")`).join(", ");
    throw new Error(`Hay ${orgs.length} organizaciones con owner: indica --org <id>. ${list}`);
  }
  return orgs[0];
}

// Toda lectura y escritura va acotada a la organización (CLAUDE.md §7).
async function snippetsOf(executor: Db | Tx, organizationId: string, lock = false): Promise<ExistingSnippet[]> {
  const query = executor
    .select({ id: snippets.id, name: snippets.name, body: snippets.body })
    .from(snippets)
    .where(eq(snippets.organizationId, organizationId))
    .orderBy(asc(snippets.name));
  return lock ? query.for("update") : query;
}

function preview(body: string, max = 70): string {
  // Por caracteres completos (no UTF-16): así un emoji nunca queda partido.
  const chars = [...body.replace(/\n/g, " ↵ ")];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

function printPlan(plan: SnippetLoadPlan): void {
  console.log(`\nCREARÍA (${plan.create.length}):`);
  for (const item of plan.create) console.log(`  + ${item.name} — ${preview(item.body)}`);
  console.log(`\nACTUALIZARÍA (${plan.update.length}):`);
  for (const change of plan.update) {
    const renamed = change.from.name !== change.to.name;
    const rebody = change.from.body !== change.to.body;
    const what = [renamed ? "nombre" : null, rebody ? "texto" : null].filter(Boolean).join(" y ");
    console.log(`  ~ "${change.from.name}"${renamed ? ` → "${change.to.name}"` : ""} (${what})`);
    if (rebody) {
      console.log(`      antes: ${preview(change.from.body, 120)}`);
      console.log(`      ahora: ${preview(change.to.body, 120)}`);
    }
  }
  console.log(`\nDEJARÍA IGUAL (${plan.unchanged.length}):`);
  for (const row of plan.unchanged) console.log(`  = ${row.name}`);
  console.log(`\nOTROS de la organización, NO se tocan (${plan.untouched.length}):`);
  for (const row of plan.untouched) console.log(`  · ${row.name}`);
  if (plan.similar.length > 0) {
    console.log(`\nAVISO — se parecen a uno de la lista pero NO se tocan (revisar a mano):`);
    for (const { existing, desiredName } of plan.similar) console.log(`  ! "${existing.name}" ≈ "${desiredName}"`);
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { org: { type: "string" }, confirmar: { type: "boolean", default: false } },
  });
  const org = await resolveOrganization(values.org);
  const before = await snippetsOf(db, org.id);
  console.log(`Organización: "${org.name}" (${org.id})`);
  console.log(`Mensajes rápidos ANTES: ${before.length}`);

  const plan = planSnippetLoad(before, MENSAJES_RAPIDOS_DILUVIUM);
  printPlan(plan);

  if (!values.confirmar) {
    const total = before.length + plan.create.length;
    console.log(`\nSimulación: no se escribió nada. Con --confirmar quedarían ${total} mensajes rápidos.`);
    return 0;
  }
  if (plan.create.length === 0 && plan.update.length === 0) {
    console.log("\nNada que escribir: la organización ya tiene la lista tal cual.");
  } else {
    // Se vuelve a leer y planear DENTRO de la transacción, con las filas bloqueadas,
    // por si alguien editó un mensaje rápido entre la simulación y la escritura.
    const applied = await db.transaction(async (tx) => {
      const current = await snippetsOf(tx, org.id, true);
      const fresh = planSnippetLoad(current, MENSAJES_RAPIDOS_DILUVIUM);
      const now = new Date();
      for (const change of fresh.update) {
        await tx
          .update(snippets)
          .set({ name: change.to.name, body: change.to.body, variables: [], updatedAt: now })
          .where(and(eq(snippets.id, change.id), eq(snippets.organizationId, org.id)));
      }
      if (fresh.create.length > 0) {
        await tx.insert(snippets).values(
          fresh.create.map((item) => ({
            id: crypto.randomUUID(),
            organizationId: org.id,
            name: item.name,
            body: item.body,
            variables: [],
          })),
        );
      }
      return fresh;
    });
    const shown = JSON.stringify([plan.create, plan.update]);
    if (JSON.stringify([applied.create, applied.update]) !== shown) {
      console.log("\nAVISO: algo cambió entre la lectura y la escritura; se aplicó lo que había en ese momento:");
      printPlan(applied);
    }
    console.log(`\nEscrito: ${applied.create.length} creado(s), ${applied.update.length} actualizado(s).`);
    plan.untouched = applied.untouched;
  }

  const after = await snippetsOf(db, org.id);
  const problems = verifySnippetLoad(after, MENSAJES_RAPIDOS_DILUVIUM, plan.untouched);
  console.log(`Mensajes rápidos DESPUÉS: ${after.length}`);
  if (problems.length > 0) {
    console.log("¡REVISAR!");
    for (const problem of problems) console.log(`  ✗ ${problem}`);
    return 2;
  }
  console.log(`Verificado: los ${MENSAJES_RAPIDOS_DILUVIUM.length} de la lista están una sola vez con su texto exacto y los otros ${plan.untouched.length} siguen iguales.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
