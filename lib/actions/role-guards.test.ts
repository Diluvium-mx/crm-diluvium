import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  requireActiveMembership: vi.fn(),
  revalidatePath: vi.fn(),
  saveProfile: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: doubles.revalidatePath }));
vi.mock("@/lib/auth/active-organization", () => ({
  requireActiveMembership: doubles.requireActiveMembership,
}));

// Estas pruebas llegan solo hasta la guarda o la primera validación. Los dobles
// evitan abrir Postgres/Redis y hacen explícito si una acción cruza ese límite.
vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => {
      throw new Error("La acción no debía llegar a la base de datos");
    }),
  },
}));
vi.mock("@/lib/workflows/triggers", () => ({ onContactStageEntered: vi.fn() }));
vi.mock("@/lib/contacts/funnel-signals", () => ({
  MAX_SIGNAL_CONVERSATIONS: 200,
  funnelSignalsForOrg: vi.fn(),
}));
vi.mock("@/lib/import/persist", () => ({ importParsedContacts: vi.fn() }));
vi.mock("@/lib/agente-ia/model-cost-store", () => ({
  brainUsageTotals: vi.fn(),
  priceOverrides: vi.fn(),
}));
vi.mock("@/lib/agente-ia/editor-store", () => {
  class EditorNotFoundError extends Error {}
  return {
    EditorNotFoundError,
    createFaq: vi.fn(),
    deleteFaq: vi.fn(),
    loadEditor: vi.fn(),
    restoreFaqs: vi.fn(),
    restoreGoal: vi.fn(),
    saveBrainModel: vi.fn(),
    saveGoal: vi.fn(),
    saveModel1: vi.fn(),
    saveModel1Stages: vi.fn(),
    saveProfile: doubles.saveProfile,
    updateFaq: vi.fn(),
  };
});

describe("guardas de rol en Server Actions", () => {
  let importContactsFromCsv: typeof import("./contacts").importContactsFromCsv;
  let addAiTopup: typeof import("./ai-spend").addAiTopup;
  let updateAgentProfile: typeof import("./agente-ia-editor").updateAgentProfile;

  beforeAll(async () => {
    ({ importContactsFromCsv } = await import("./contacts"));
    ({ addAiTopup } = await import("./ai-spend"));
    ({ updateAgentProfile } = await import("./agente-ia-editor"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("importContactsFromCsv rechaza al agent antes de leer o validar el archivo", async () => {
    doubles.requireActiveMembership.mockResolvedValue({
      organizationId: "org_role_guard",
      userId: "user_role_guard",
      role: "agent",
    });

    await expect(importContactsFromCsv(new FormData())).rejects.toThrow(
      "No tienes permiso para importar contactos",
    );
  });

  it("importContactsFromCsv deja pasar al admin hasta la validación del archivo", async () => {
    doubles.requireActiveMembership.mockResolvedValue({
      organizationId: "org_role_guard",
      userId: "user_role_guard",
      role: "admin",
    });

    await expect(importContactsFromCsv(new FormData())).rejects.toThrow(
      "Sube un archivo CSV.",
    );
  });

  it("addAiTopup rechaza al agent sin intentar insertar", async () => {
    doubles.requireActiveMembership.mockResolvedValue({
      organizationId: "org_role_guard",
      userId: "user_role_guard",
      role: "agent",
    });

    await expect(
      addAiTopup({ provider: "openai", amountUsd: 20, toppedUpOn: "2026-09-24" }),
    ).resolves.toEqual({
      ok: false,
      message: "Solo un administrador registra recargas.",
    });
  });

  it("updateAgentProfile permite al agent y delega el guardado validado", async () => {
    doubles.requireActiveMembership.mockResolvedValue({
      organizationId: "org_role_guard",
      userId: "user_role_guard",
      role: "agent",
    });
    doubles.saveProfile.mockResolvedValue(undefined);

    await expect(updateAgentProfile({ agentName: "  Ángela  " })).resolves.toEqual({
      ok: true,
    });
    expect(doubles.saveProfile).toHaveBeenCalledWith("org_role_guard", {
      agentName: "Ángela",
    });
    expect(doubles.revalidatePath).toHaveBeenCalledWith("/agente-ia");
  });
});
