import { describe, expect, it } from "vitest";
import { parseRailwayBilling, railwayBillingConfigFromEnv, readRailwayBilling, type PostLike } from "./read";

const PROJECT = "a59d3041-d62f-4d10-822f-2e3026ca4f21";

// Forma real de la respuesta de Railway (7-oct-2026, plan Hobby).
const RESPUESTA = {
  data: {
    project: {
      workspace: {
        id: "ws-1",
        plan: "HOBBY",
        customer: {
          currentUsage: 0.6928288018001854,
          state: "ACTIVE",
          billingPeriod: { start: "2026-10-05T23:44:44.000Z", end: "2026-11-05T23:44:44.000Z" },
          subscriptions: [{ status: "active", nextInvoiceDate: "2026-11-05T23:44:44.000Z", nextInvoiceCurrentTotal: 502 }],
        },
      },
    },
  },
};

describe("railwayBillingConfigFromEnv", () => {
  it("necesita el token y el proyecto que pone Railway", () => {
    expect(railwayBillingConfigFromEnv({})).toBeNull();
    expect(railwayBillingConfigFromEnv({ RAILWAY_BILLING_TOKEN: "t" })).toBeNull();
    expect(railwayBillingConfigFromEnv({ RAILWAY_BILLING_TOKEN: "t", RAILWAY_PROJECT_ID: "no-es-id" })).toBeNull();
    expect(railwayBillingConfigFromEnv({ RAILWAY_BILLING_TOKEN: " t ", RAILWAY_PROJECT_ID: PROJECT })).toEqual({ token: "t", projectId: PROJECT });
  });
});

describe("parseRailwayBilling", () => {
  it("lee plan, periodo, uso y la próxima factura (centavos → dólares)", () => {
    expect(parseRailwayBilling(RESPUESTA)).toEqual({
      workspaceId: "ws-1",
      plan: "HOBBY",
      state: "ACTIVE",
      periodStart: new Date("2026-10-05T23:44:44.000Z"),
      periodEnd: new Date("2026-11-05T23:44:44.000Z"),
      usageUsd: 0.692829,
      nextInvoiceUsd: 5.02,
      nextInvoiceAt: new Date("2026-11-05T23:44:44.000Z"),
    });
  });

  it("falla con el mensaje de Railway si contestó con error", () => {
    expect(() => parseRailwayBilling({ data: null, errors: [{ message: "Not Authorized" }] })).toThrow("Railway respondió: Not Authorized");
  });

  it("falla claro si el token no deja ver la facturación", () => {
    const sinCobro = { data: { project: { workspace: { id: "ws-1", plan: "HOBBY", customer: null } } } };
    expect(() => parseRailwayBilling(sinCobro)).toThrow("no devolvió el cobro");
  });

  it("sin suscripción deja la factura vacía", () => {
    const json = structuredClone(RESPUESTA);
    json.data.project.workspace.customer.subscriptions = [];
    expect(parseRailwayBilling(json)).toMatchObject({ nextInvoiceUsd: null, nextInvoiceAt: null });
  });
});

describe("readRailwayBilling", () => {
  it("hace un solo POST con el token en el encabezado y el proyecto como variable", async () => {
    const calls: Parameters<PostLike>[] = [];
    const fetchImpl: PostLike = async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify(RESPUESTA));
    };
    const reading = await readRailwayBilling({ token: "tok-secreto", projectId: PROJECT }, { fetchImpl });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe("https://backboard.railway.com/graphql/v2");
    expect(url).not.toContain("tok-secreto");
    expect(init.headers.Authorization).toBe("Bearer tok-secreto");
    expect(JSON.parse(init.body).variables).toEqual({ projectId: PROJECT });
    expect(reading.plan).toBe("HOBBY");
  });

  it("un error HTTP no lleva el token", async () => {
    const fetchImpl: PostLike = async () => new Response("token tok-secreto inválido", { status: 401 });
    await expect(readRailwayBilling({ token: "tok-secreto", projectId: PROJECT }, { fetchImpl })).rejects.toThrow(
      "Railway respondió 401: token [token oculto] inválido",
    );
  });
});
