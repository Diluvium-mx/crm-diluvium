// Uso: npm run staging:estado       → dice si staging está prendido, qué versión corre y cuándo se usó
//      npm run staging:encender     → prende el web y el worker de staging con la última versión de la rama `staging`
//                                     (la misma imagen, sin reconstruir: 1–2 min)
//      npm run staging:apagar       → los apaga ya (Postgres y Redis siguen prendidos)
//      npm run staging:revisar      → los apaga solo si llevan 2 h sin visitas ni subidas (GitHub lo corre cada hora:
//                                     .github/workflows/staging-apagado.yml)
//      cualquiera con `-- --probar` → solo dice qué haría
//
// Ahorro de Railway (punto 3 de costos, OK del dueño 28-oct-2026; docs/staging.md › Encender y apagar staging).
// Solo toca el environment staging: los IDs van fijos aquí y se comprueban antes de apagar o prender; producción nunca.
// Con RAILWAY_STAGING_TOKEN (token de PROYECTO de Railway limitado a staging; así corre en GitHub) habla directo con la
// API; sin él usa el login del CLI `railway` de la Mac. Sin dependencias ni alias: GitHub lo corre con `node` a secas.
import { execFileSync } from "node:child_process";

const API = "https://backboard.railway.com/graphql/v2";
const PROYECTO = "a59d3041-d62f-4d10-822f-2e3026ca4f21";
const STAGING = "9b5a8446-266c-4d1c-8038-278324d290e6";
const SERVICIOS = [
  { nombre: "web", id: "ade27288-c97b-4c54-99c5-6bd8b7ca4af8" },
  { nombre: "worker", id: "e2140b5d-7584-442c-8f38-67d68841f10f" },
] as const;
const RAMA = "staging";
export const HORAS_SIN_USO = 2;
const PASO_VISITAS_S = 300;

export type Despliegue = {
  id: string;
  status: string;
  createdAt: string;
  statusUpdatedAt: string | null;
  environmentId: string;
  canRedeploy: boolean;
  meta: { branch?: string; commitHash?: string; imageDigest?: string } | null;
};

export type Muestra = { ts: number; value: number };

export type Estado = {
  /** Despliegues que ocupan memoria (los que «apagar» quita). */
  prendidos: Despliegue[];
  /** Una subida en camino: no se apaga ni se prende encima de ella. */
  subiendo: Despliegue[];
  /** Último push o encendido (ms), o null si no hay despliegues. */
  ultimaSubida: number | null;
};

const PRENDIDO = new Set(["SUCCESS", "CRASHED", "SLEEPING"]);
const SUBIENDO = new Set(["QUEUED", "WAITING", "INITIALIZING", "BUILDING", "DEPLOYING", "NEEDS_APPROVAL"]);

export function leerEstado(despliegues: Despliegue[]): Estado {
  const momentos = despliegues.flatMap((d) => [
    Date.parse(d.createdAt),
    d.status === "SUCCESS" && d.statusUpdatedAt ? Date.parse(d.statusUpdatedAt) : Number.NaN,
  ]);
  const validos = momentos.filter((m) => Number.isFinite(m));
  return {
    prendidos: despliegues.filter((d) => PRENDIDO.has(d.status)),
    subiendo: despliegues.filter((d) => SUBIENDO.has(d.status)),
    ultimaSubida: validos.length > 0 ? Math.max(...validos) : null,
  };
}

/** Fin del último tramo con visitas al web (ms), o null si no hubo. Railway solo manda los tramos con tráfico. */
export function ultimaVisita(muestras: Muestra[], pasoSegundos = PASO_VISITAS_S): number | null {
  const conVisitas = muestras.filter((m) => m.value > 0);
  if (conVisitas.length === 0) return null;
  return (Math.max(...conVisitas.map((m) => m.ts)) + pasoSegundos) * 1000;
}

export type Decision = { apagar: boolean; motivo: string };

export function decidirRevision(estados: Estado[], visita: number | null, ahora: number, horas = HORAS_SIN_USO): Decision {
  if (estados.some((e) => e.subiendo.length > 0)) return { apagar: false, motivo: "hay una subida en curso" };
  if (estados.every((e) => e.prendidos.length === 0)) return { apagar: false, motivo: "ya está apagado" };
  const ultimoUso = Math.max(visita ?? 0, ...estados.map((e) => e.ultimaSubida ?? 0));
  const hace = duracion(ahora - ultimoUso);
  if (ahora - ultimoUso < horas * 3_600_000) return { apagar: false, motivo: `se usó hace ${hace}` };
  return { apagar: true, motivo: `lleva ${hace} sin visitas ni subidas` };
}

/**
 * Versión con la que se vuelve a prender: el despliegue más reciente de la rama `staging` que ya corrió (tiene imagen).
 * Nunca uno de `main`: el 23, 24 y 27-oct el web de staging recibió `main` por un despliegue a mano (docs/staging.md).
 */
export function despliegueParaEncender(despliegues: Despliegue[]): Despliegue | null {
  const candidatos = despliegues.filter(
    (d) => d.status === "REMOVED" && d.canRedeploy && d.meta?.branch === RAMA && Boolean(d.meta.imageDigest),
  );
  candidatos.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return candidatos[0] ?? null;
}

function duracion(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / 60_000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return minutos % 60 === 0 ? `${horas} h` : `${horas} h ${minutos % 60} min`;
}

const formatoMazatlan = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mazatlan",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function hora(ms: number | null): string {
  return ms === null ? "—" : formatoMazatlan.format(ms);
}

function version(d: Despliegue): string {
  return `${d.meta?.branch ?? "?"} ${(d.meta?.commitHash ?? "").slice(0, 7)}`.trim();
}

// ── Railway ──────────────────────────────────────────────────────────────────────────────────────────────────────────

type Respuesta<T> = { data?: T; errors?: { message: string }[] };

async function api<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.RAILWAY_STAGING_TOKEN;
  let respuesta: Respuesta<T>;
  if (token) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Project-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const texto = await r.text();
    try {
      respuesta = JSON.parse(texto) as Respuesta<T>;
    } catch {
      throw new Error(`Railway respondió ${r.status} sin JSON.`);
    }
  } else {
    let salida: string;
    try {
      salida = execFileSync("railway", ["api", query, "--variables", JSON.stringify(variables), "--compact", "--allow-errors"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const detalle = (error as { stderr?: string }).stderr?.trim().split("\n")[0];
      throw new Error(`No pude usar el CLI de Railway (¿sesión iniciada con \`railway login\`?). ${detalle ?? ""}`.trim());
    }
    respuesta = JSON.parse(salida) as Respuesta<T>;
  }
  if (respuesta.errors?.length) throw new Error(`Railway: ${respuesta.errors.map((e) => e.message).join("; ")}`);
  if (!respuesta.data) throw new Error("Railway no devolvió datos.");
  return respuesta.data;
}

/** Con token: comprueba que sea de staging antes de hacer nada (un token de producción se rechaza). */
async function comprobarToken(): Promise<void> {
  if (!process.env.RAILWAY_STAGING_TOKEN) return;
  const { projectToken } = await api<{ projectToken: { projectId: string; environmentId: string } }>(
    "query { projectToken { projectId environmentId } }",
  );
  if (projectToken.projectId !== PROYECTO || projectToken.environmentId !== STAGING) {
    throw new Error("RAILWAY_STAGING_TOKEN no es un token del environment staging: no toco nada.");
  }
}

async function despliegues(servicio: string): Promise<Despliegue[]> {
  const data = await api<{ deployments: { edges: { node: Despliegue }[] } }>(
    `query($input: DeploymentListInput!) { deployments(first: 20, input: $input) {
      edges { node { id status createdAt statusUpdatedAt environmentId canRedeploy meta } } } }`,
    { input: { projectId: PROYECTO, environmentId: STAGING, serviceId: servicio } },
  );
  const lista = data.deployments.edges.map((e) => e.node);
  const ajeno = lista.find((d) => d.environmentId !== STAGING);
  if (ajeno) throw new Error("Railway devolvió un despliegue de otro environment: no toco nada.");
  return lista;
}

async function visitasDelWeb(ahora: number): Promise<number | null> {
  const web = SERVICIOS[0].id;
  const data = await api<{ httpMetrics: { samples: Muestra[] } }>(
    `query($servicio: String!, $entorno: String!, $desde: DateTime!, $hasta: DateTime!, $paso: Int!) {
      httpMetrics(serviceId: $servicio, environmentId: $entorno, startDate: $desde, endDate: $hasta, stepSeconds: $paso) {
        samples { ts value } } }`,
    {
      servicio: web,
      entorno: STAGING,
      desde: new Date(ahora - 24 * 3_600_000).toISOString(),
      hasta: new Date(ahora).toISOString(),
      paso: PASO_VISITAS_S,
    },
  );
  return ultimaVisita(data.httpMetrics.samples);
}

type Servicio = { nombre: string; despliegues: Despliegue[]; estado: Estado };

async function leerServicios(): Promise<Servicio[]> {
  return Promise.all(
    SERVICIOS.map(async (s) => {
      const lista = await despliegues(s.id);
      return { nombre: s.nombre, despliegues: lista, estado: leerEstado(lista) };
    }),
  );
}

// ── Acciones ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function estado(): Promise<number> {
  const ahora = Date.now();
  const [servicios, visita] = await Promise.all([leerServicios(), visitasDelWeb(ahora)]);
  console.info("Staging (Postgres y Redis siempre prendidos):");
  for (const s of servicios) {
    const { prendidos, subiendo } = s.estado;
    const linea =
      subiendo.length > 0
        ? `subiendo ${version(subiendo[0])}`
        : prendidos.length > 0
          ? `prendido · ${version(prendidos[0])}`
          : "apagado";
    console.info(`  ${s.nombre.padEnd(7)} ${linea}`);
  }
  const subida = Math.max(...servicios.map((s) => s.estado.ultimaSubida ?? 0));
  console.info(`  Última subida: ${hora(subida || null)} · última visita (24 h): ${hora(visita)} (hora de Mazatlán)`);
  const decision = decidirRevision(
    servicios.map((s) => s.estado),
    visita,
    ahora,
  );
  console.info(`  Revisión automática: ${decision.apagar ? "lo apagaría ahora" : "no lo apagaría"} (${decision.motivo}).`);
  return 0;
}

async function apagar(servicios: Servicio[], probar: boolean): Promise<number> {
  if (servicios.some((s) => s.estado.subiendo.length > 0)) {
    console.error("[staging] Hay una subida en curso: no apago encima de ella. Vuelve a correrlo cuando termine.");
    return 1;
  }
  const porQuitar = servicios.flatMap((s) => s.estado.prendidos.map((d) => ({ nombre: s.nombre, d })));
  if (porQuitar.length === 0) {
    console.info("Staging ya está apagado.");
    return 0;
  }
  for (const { nombre, d } of porQuitar) {
    console.info(`${probar ? "[probar] " : ""}Apago ${nombre} (${version(d)}).`);
    if (!probar) await api<{ deploymentRemove: boolean }>("mutation($id: String!) { deploymentRemove(id: $id) }", { id: d.id });
  }
  if (!probar) console.info("Listo: el web y el worker de staging quedaron apagados (Postgres y Redis siguen prendidos).");
  return 0;
}

async function encender(probar: boolean): Promise<number> {
  const servicios = await leerServicios();
  let fallas = 0;
  for (const s of servicios) {
    if (s.estado.subiendo.length > 0 || s.estado.prendidos.length > 0) {
      console.info(`${s.nombre}: ya está ${s.estado.subiendo.length > 0 ? "subiendo" : "prendido"}.`);
      continue;
    }
    const d = despliegueParaEncender(s.despliegues);
    if (!d) {
      console.error(`[staging] ${s.nombre}: no encontré una versión de la rama staging para prender. Haz push a staging.`);
      fallas++;
      continue;
    }
    console.info(`${probar ? "[probar] " : ""}Prendo ${s.nombre} con ${version(d)}.`);
    if (!probar) {
      await api<{ deploymentRedeploy: { id: string } }>(
        "mutation($id: String!) { deploymentRedeploy(id: $id, usePreviousImageTag: true) { id } }",
        { id: d.id },
      );
    }
  }
  if (!probar && fallas === 0) console.info("Listo: en 1–2 min staging responde en https://crm-diluvium-staging.up.railway.app");
  return fallas > 0 ? 1 : 0;
}

async function revisar(probar: boolean): Promise<number> {
  const ahora = Date.now();
  const [servicios, visita] = await Promise.all([leerServicios(), visitasDelWeb(ahora)]);
  const decision = decidirRevision(
    servicios.map((s) => s.estado),
    visita,
    ahora,
  );
  if (!decision.apagar) {
    console.info(`Staging se queda como está: ${decision.motivo}.`);
    return 0;
  }
  console.info(`Staging ${decision.motivo}: lo apago.`);
  return apagar(servicios, probar);
}

async function main(): Promise<number> {
  const accion = process.argv[2];
  const probar = process.argv.includes("--probar");
  await comprobarToken();
  if (accion === "estado") return estado();
  if (accion === "encender") return encender(probar);
  if (accion === "apagar") return apagar(await leerServicios(), probar);
  if (accion === "revisar") return revisar(probar);
  console.error("[staging] Uso: staging-energia.ts estado|encender|apagar|revisar [--probar]");
  return 1;
}

// Solo corre como programa (npm run staging:* o `node scripts/staging-energia.ts`), no al importarlo en las pruebas.
if (process.argv[1]?.endsWith("staging-energia.ts")) {
  main().then(
    (codigo) => {
      process.exitCode = codigo;
    },
    (error: unknown) => {
      console.error(`[staging] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
