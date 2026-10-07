// Cobro de Railway (7-oct-2026): lee del workspace dueño del proyecto el plan, el periodo, el uso
// de recursos en dólares y lo que va de la próxima factura. Una sola consulta GraphQL a la API
// pública de Railway. Solo LEE: no cambia nada ni cuesta nada.
//
// Token: RAILWAY_BILLING_TOKEN (token del workspace, Railway › Account Settings › Tokens). Railway
// no tiene tokens de solo lectura: este da control del workspace, por eso vive SOLO en el worker y
// el CRM solo hace la consulta de abajo. El proyecto sale de RAILWAY_PROJECT_ID, que Railway pone
// solo en cada servicio. Va en el encabezado Authorization. Detalle: docs/railway-costos.md.
import { z } from "zod";

const ENDPOINT = "https://backboard.railway.com/graphql/v2";
const TIMEOUT_MS = 20_000;
const BODY_PREVIEW = 200;

export type RailwayBillingConfig = { token: string; projectId: string };

export type PostLike = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<Response>;

// null = falta el token o el proyecto: el worker no lee nada y la tarjeta no aparece.
export function railwayBillingConfigFromEnv(env: Record<string, string | undefined> = process.env): RailwayBillingConfig | null {
  const token = env.RAILWAY_BILLING_TOKEN?.trim();
  const projectId = env.RAILWAY_PROJECT_ID?.trim();
  if (!token || !projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  return { token, projectId };
}

// Quita el token de un texto de error (por si Railway lo repitiera).
export function redactRailwayToken(text: string, token: string): string {
  return token ? text.split(token).join("[token oculto]") : text;
}

export type RailwayReading = {
  workspaceId: string;
  plan: string | null;
  state: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  usageUsd: number | null;
  nextInvoiceUsd: number | null;
  nextInvoiceAt: Date | null;
};

const QUERY = `query CobroRailway($projectId: String!) {
  project(id: $projectId) {
    workspace {
      id
      plan
      customer {
        currentUsage
        state
        billingPeriod { start end }
        subscriptions { status nextInvoiceDate nextInvoiceCurrentTotal }
      }
    }
  }
}`;

const date = z
  .string()
  .nullish()
  .transform((v) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  });

const responseSchema = z.object({
  data: z
    .object({
      project: z
        .object({
          workspace: z.object({
            id: z.string(),
            plan: z.string().nullish(),
            customer: z
              .object({
                currentUsage: z.number().nullish(),
                state: z.string().nullish(),
                billingPeriod: z.object({ start: date, end: date }).nullish(),
                subscriptions: z
                  .array(
                    z.object({
                      status: z.string().nullish(),
                      nextInvoiceDate: date,
                      // En centavos de dólar.
                      nextInvoiceCurrentTotal: z.number().nullish(),
                    }),
                  )
                  .nullish(),
              })
              .nullish(),
          }),
        })
        .nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// PURO: respuesta de Railway → lectura. Lanza si Railway contestó con error o sin el proyecto.
export function parseRailwayBilling(json: unknown): RailwayReading {
  const parsed = responseSchema.parse(json);
  if (parsed.errors?.length) throw new Error(`Railway respondió: ${parsed.errors.map((e) => e.message).join(" · ").slice(0, BODY_PREVIEW)}`);
  const workspace = parsed.data?.project?.workspace;
  if (!workspace) throw new Error("Railway no devolvió el proyecto (¿el token es de otro workspace?)");
  const customer = workspace.customer;
  if (!customer) throw new Error("Railway no devolvió el cobro del workspace (¿el token no tiene permiso de ver la facturación?)");
  // La suscripción viva (Hobby/Pro); si hubiera varias, la primera activa.
  const subs = customer.subscriptions ?? [];
  const sub = subs.find((s) => s.status === "active") ?? subs[0];
  return {
    workspaceId: workspace.id,
    plan: workspace.plan ?? null,
    state: customer.state ?? null,
    periodStart: customer.billingPeriod?.start ?? null,
    periodEnd: customer.billingPeriod?.end ?? null,
    usageUsd: typeof customer.currentUsage === "number" ? round6(customer.currentUsage) : null,
    nextInvoiceUsd: typeof sub?.nextInvoiceCurrentTotal === "number" ? round6(sub.nextInvoiceCurrentTotal / 100) : null,
    nextInvoiceAt: sub?.nextInvoiceDate ?? null,
  };
}

export async function readRailwayBilling(config: RailwayBillingConfig, options: { fetchImpl?: PostLike } = {}): Promise<RailwayReading> {
  const fetchImpl: PostLike = options.fetchImpl ?? fetch;
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ query: QUERY, variables: { projectId: config.projectId } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Railway respondió ${res.status}: ${redactRailwayToken(body.replace(/\s+/g, " "), config.token).slice(0, BODY_PREVIEW)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Railway respondió algo que no es JSON (${res.status})`);
  }
  return parseRailwayBilling(json);
}
