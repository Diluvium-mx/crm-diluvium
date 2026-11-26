// Prueba GUARDIANA del rol «Solo lectura» (26-nov-2026, lib/auth/solo-lectura.ts).
// 1. Las Server Actions que ese rol SÍ puede usar (las de consulta) son exactamente las de la lista
//    de abajo. Declarar otra como consulta obliga a agregarla aquí, a propósito: solo si NO guarda,
//    envía, borra ni gasta nada. Una acción nueva sin declarar queda bloqueada sola (falla cerrado).
// 2. Toda ruta de API que escribe (POST/PUT/PATCH/DELETE) y pide la sesión la pide con
//    `acceso: "cambio"`: en una ruta, sin decirlo, cuenta como consulta.
// 3. Todo `catch (error)` de una Server Action empieza con `relanzarSoloLectura(error)` (o relanza):
//    si atrapara el rechazo y devolviera su propio «No se pudo…», el aviso no saldría. Un `catch {}`
//    sin variable solo en una acción de consulta o en los casos revisados de abajo.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

const CONSULTAS = [
  "lib/actions/agente-actividad.ts › getAgentActivity",
  "lib/actions/agente-conversacion.ts › getContactAgentStatus",
  "lib/actions/agente-conversacion.ts › getConversationAgent",
  "lib/actions/agente-ia-editor.ts › getAgentEditor",
  "lib/actions/agente-lector.ts › getLectorStatus",
  "lib/actions/contact-arco.ts › getContactArcoSummary",
  "lib/actions/contact-qualification.ts › getContactDetails",
  "lib/actions/contact-qualification.ts › getContactQualification",
  "lib/actions/contact-qualification.ts › listSizeRanges",
  "lib/actions/contacts.ts › buscarEnEmbudo",
  "lib/actions/contacts.ts › getContactsByIds",
  "lib/actions/contacts.ts › getContactsChangedSince",
  "lib/actions/contacts.ts › getEntradaMas",
  "lib/actions/contacts.ts › getFunnelSignals",
  "lib/actions/contacts.ts › getFunnelSignalsSince",
  "lib/actions/contacts.ts › listContacts",
  "lib/actions/contacts.ts › loadEmbudo",
  "lib/actions/envios.ts › buscarCodigoPostal",
  "lib/actions/envios.ts › getEnvioForm",
  "lib/actions/envios.ts › getEnvioPanel",
  "lib/actions/funnel-stages.ts › getContactCountsByStage",
  "lib/actions/funnel-stages.ts › getFunnelStages",
  "lib/actions/historial.ts › getChangeDiff",
  "lib/actions/historial.ts › getChangeHistory",
  "lib/actions/links-pago-chat.ts › listLinksPagoDelChat",
  "lib/actions/media-library.ts › getMediaAssets",
  // Se manda sola al ver un archivo sin miniatura: con este rol no guarda nada (return antes).
  "lib/actions/media-library.ts › saveMediaThumbnailAction",
  "lib/actions/scheduled.ts › listScheduledMessages",
  "lib/actions/seguimientos.ts › getFollowUp",
  "lib/actions/seguimientos.ts › getFollowUpTemplateOptions",
  "lib/actions/send-failures.ts › loadSendFailureLines",
  "lib/actions/snippets.ts › listSnippets",
  "lib/actions/spelling.ts › getSpellingWords",
  "lib/actions/team.ts › listSellers",
  "lib/actions/templates.ts › listTemplates",
  "lib/actions/workflows.ts › listConversationsForTest",
  "lib/actions/workflows.ts › listWorkflowCommands",
  "lib/actions/workflows.ts › listWorkflowQuickSends",
  "lib/actions/workflows.ts › listWorkflowRuns",
  "lib/actions/workflows.ts › listWorkflows",
  "lib/clima/actions.ts › leerCintaClima",
  "lib/inbox/actions.ts › getConversation",
  "lib/inbox/actions.ts › getConversationByContact",
  "lib/inbox/actions.ts › getConversationItems",
  "lib/inbox/actions.ts › listChatMatches",
  "lib/inbox/actions.ts › listConversations",
  "lib/inbox/actions.ts › listMessages",
  // Se manda sola al abrir un chat: con este rol no marca nada (return antes).
  "lib/inbox/actions.ts › markConversationRead",
  "lib/inbox/actions.ts › searchChatsByContact",
];

// `catch {}` revisados en acciones que no son de consulta: su `try` no cubre la sesión.
const CATCH_SIN_VARIABLE = new Set([
  // Re-sincroniza después del alta, ya con la sesión revisada.
  "lib/actions/templates.ts › createTemplate",
]);

function* files(dir: string, test: (name: string) => boolean): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) yield* files(full, test);
    else if (test(name)) yield full;
  }
}

/** Cuerpo de cada `export async function` del archivo (hasta el siguiente export). */
function exportedBodies(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /\nexport (?:async )?function (\w+)/g;
  const marks = [...src.matchAll(re)];
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? src.length) : src.length;
    out.push({ name: m[1], body: src.slice(start, end) });
  });
  return out;
}

const DECLARA_CONSULTA = /acceso: "consulta"|requireActiveOrganizationId\("consulta"\)/;

describe("regla: «Solo lectura» (lib/auth/solo-lectura.ts)", () => {
  it("las Server Actions de consulta son exactamente las de la lista", () => {
    const encontradas: string[] = [];
    for (const dir of ["lib", "app"]) {
      for (const file of files(join(ROOT, dir), (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))) {
        const src = readFileSync(file, "utf8");
        if (!/^["']use server["']/m.test(src)) continue;
        const rel = relative(ROOT, file);
        for (const { name, body } of exportedBodies(src)) if (DECLARA_CONSULTA.test(body)) encontradas.push(`${rel} › ${name}`);
      }
    }
    expect(encontradas.sort()).toEqual([...CONSULTAS].sort());
  });

  it("todo catch de una Server Action deja pasar el rechazo de solo lectura", () => {
    const tragan: string[] = [];
    for (const dir of ["lib", "app"]) {
      for (const file of files(join(ROOT, dir), (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))) {
        const src = readFileSync(file, "utf8");
        if (!/^["']use server["']/m.test(src)) continue;
        const rel = relative(ROOT, file);
        for (const { name, body } of exportedBodies(src)) {
          for (const m of body.matchAll(/catch \((\w+)\) \{\s*([^\n]*)/g)) {
            const [, variable, primera] = m;
            if (!primera.startsWith(`relanzarSoloLectura(${variable});`) && !primera.startsWith(`throw ${variable};`)) tragan.push(`${rel} › ${name}`);
          }
          if (/catch \{/.test(body) && !DECLARA_CONSULTA.test(body) && !CATCH_SIN_VARIABLE.has(`${rel} › ${name}`)) tragan.push(`${rel} › ${name} (catch sin variable)`);
        }
      }
    }
    expect(tragan, "primera línea del catch: relanzarSoloLectura(error)").toEqual([]);
  });

  it("las rutas de API que escriben piden la sesión con acceso: cambio", () => {
    const sinCandado: string[] = [];
    for (const file of files(join(ROOT, "app", "api"), (n) => n === "route.ts")) {
      const src = readFileSync(file, "utf8");
      if (!/export async function (POST|PUT|PATCH|DELETE)\b/.test(src) || !src.includes("requireActiveMembership(")) continue;
      const llamadas = src.match(/requireActiveMembership\([^)]*\)/g) ?? [];
      if (llamadas.some((l) => !l.includes('acceso: "cambio"'))) sinCandado.push(relative(ROOT, file));
    }
    expect(sinCandado, 'usa requireActiveMembership({ acceso: "cambio" })').toEqual([]);
  });
});
