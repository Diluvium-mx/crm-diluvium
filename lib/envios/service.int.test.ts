// Guías de Envia desde el Detalle (docs/envios.md) contra Postgres REAL (TEST_DATABASE_URL) con un Envia y
// un bucket falsos: generar apunta la fila antes de pedir la guía y una llave repetida no genera (ni cobra)
// otra; un error de Envia queda guardado tal cual; la guía creada guarda su PDF y la copia para imprimir;
// cancelar solo una creada y de la misma cuenta; otra organización no ve nada; borrar el contacto (ARCO)
// se lleva sus guías y sus PDF.
import { degrees, PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnviaClient, GeneratedLabel, RateOption } from "@/lib/envia/client";
import type { ObjectStorage } from "@/lib/storage/s3";
import type { EnviosDeps } from "./service";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const session = vi.hoisted(() => ({
  current: { organizationId: "org_envio_a", userId: "u_envio_daniel", role: "agent" } as { organizationId: string; userId: string; role: string } | null,
}));
vi.mock("@/lib/auth/active-organization", () => ({
  requireActiveMembership: async () => {
    if (!session.current) throw new Error("No autenticado.");
    return session.current;
  },
}));

const bucket = vi.hoisted(() => {
  const objects = new Map<string, Uint8Array>();
  const state = { failPut: false };
  const storage: ObjectStorage = {
    putStream: async (key, body) => {
      if (state.failPut) throw new Error("bucket caído");
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
      objects.set(key, new Uint8Array(Buffer.concat(chunks)));
    },
    exists: async (key) => objects.has(key),
    head: async () => null,
    deleteObject: async (key) => {
      objects.delete(key);
    },
    signedGetUrl: async () => "https://bucket.test/firmada",
    getBytes: async (key) => {
      const data = objects.get(key);
      if (!data) throw new Error("no existe");
      return data;
    },
    async *listObjects(prefix) {
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) yield { key, lastModified: new Date() };
    },
  };
  return { objects, state, storage };
});
vi.mock("@/lib/storage/s3", () => {
  class StorageNotConfiguredError extends Error {}
  return { objectStorage: () => bucket.storage, StorageNotConfiguredError };
});

const ORG_A = "org_envio_a";
const ORG_B = "org_envio_b";
const DANIEL = "u_envio_daniel";
const MARIA = "c_envio_maria";
const AJENO = "c_envio_ajeno";

const DEST = {
  name: "María López",
  phone: "6681112233",
  email: null,
  street: "Av. Ejemplo",
  number: "123",
  district: "Centro",
  city: "Los Mochis",
  state: "SI",
  stateName: "Sinaloa",
  postalCode: "81200",
  reference: "Portón negro",
};
const CAJA = { packageName: "Compuerta Chica", content: "Compuerta Anti-Inundaciones", lengthCm: 91, widthCm: 14, heightCm: 66, weightKg: 13 };
const ORIGEN = { name: "Diluvium", phone: "6680000000", street: "Calle Origen", city: "Los Mochis", state: "SI", country: "MX" as const, postalCode: "81200" };

async function labelPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(i === pages - 1 ? [288, 432] : [612, 792]);
    page.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
    if (i === pages - 1) page.setRotation(degrees(0));
  }
  return doc.save();
}

type FakeEnvia = EnviaClient & { generated: number; canceled: string[]; nextError: Error | null; origins: Awaited<ReturnType<EnviaClient["listOrigins"]>> };

function fakeEnvia(label: GeneratedLabel, pdf: Uint8Array, rates: Record<string, RateOption[] | Error>): FakeEnvia {
  const fake: FakeEnvia = {
    generated: 0,
    canceled: [],
    nextError: null,
    origins: [{ address: ORIGEN, favorite: true }],
    lookupZip: async () => null,
    listPackages: async () => [],
    listOrigins: async () => fake.origins,
    rate: async (req) => {
      const r = rates[req.carrier];
      if (r instanceof Error) throw r;
      return r ?? [];
    },
    generate: async () => {
      fake.generated++;
      if (fake.nextError) throw fake.nextError;
      return label;
    },
    cancel: async (_carrier, tracking) => {
      fake.canceled.push(tracking);
      return { balanceReturned: true, balanceReturnDate: null };
    },
    downloadLabel: async () => pdf,
  };
  return fake;
}

const LABEL: GeneratedLabel = {
  shipmentId: "166819",
  trackingNumber: "LMM01WE0191229",
  trackingNumbers: ["LMM01WE0191229"],
  trackUrl: "https://test.envia.com/rastreo?label=LMM01WE0191229",
  labelUrl: "https://s3.us-east-2.amazonaws.com/envia-staging/x.pdf",
  price: 310,
  currency: "MXN",
  balance: 9000,
};

describe.skipIf(!TEST_DATABASE_URL)("guías de Envia (Postgres real)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  let s: typeof import("@/lib/db/schema");
  let d: typeof import("drizzle-orm");
  let service: typeof import("./service");
  let store: typeof import("./store");
  let route: typeof import("@/app/api/envios/[shipmentId]/guia/route");
  let arco: typeof import("@/lib/contacts/arco/delete");
  let envia: FakeEnvia;
  let deps: EnviosDeps;
  const actor = { organizationId: ORG_A, userId: DANIEL };

  const createInput = (requestKey = crypto.randomUUID()) => ({
    contactId: MARIA,
    destination: DEST,
    packages: [CAJA],
    declaredValue: 5500,
    insured: false,
    requestKey,
    carrier: "paquetexpress",
    service: "ground",
    serviceLabel: "Terrestre",
  });

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    s = await import("@/lib/db/schema");
    d = await import("drizzle-orm");
    service = await import("./service");
    store = await import("./store");
    route = await import("@/app/api/envios/[shipmentId]/guia/route");
    arco = await import("@/lib/contacts/arco/delete");
  });

  afterAll(async () => {
    if (db) await (db.$client as unknown as { end: () => Promise<void> }).end();
  });

  beforeEach(async () => {
    session.current = { organizationId: ORG_A, userId: DANIEL, role: "agent" };
    bucket.objects.clear();
    bucket.state.failPut = false;
    await db.delete(s.organization).where(d.inArray(s.organization.id, [ORG_A, ORG_B]));
    await db.delete(s.user).where(d.eq(s.user.id, DANIEL));
    await db.insert(s.organization).values([
      { id: ORG_A, name: "Diluvium", slug: "envio-a", createdAt: new Date() },
      { id: ORG_B, name: "Otra", slug: "envio-b", createdAt: new Date() },
    ]);
    await db.insert(s.user).values({ id: DANIEL, name: "Daniel", email: "envio-daniel@example.test" });
    await db.insert(s.member).values({ id: "m_envio_daniel", organizationId: ORG_A, userId: DANIEL, role: "agent", createdAt: new Date() });
    await db.insert(s.contacts).values([
      { id: MARIA, organizationId: ORG_A, firstName: "María", lastName: "López", phoneE164: "+526681112233", stage: "prospecto" },
      { id: AJENO, organizationId: ORG_B, firstName: "Ajeno", phoneE164: "+526687777777", stage: "prospecto" },
    ]);
    envia = fakeEnvia(LABEL, await labelPdf(3), {
      paquetexpress: [{ carrier: "paquetexpress", service: "ground", serviceLabel: "Terrestre", price: 310, currency: "MXN", delivery: "3-5 días" }],
      estafeta: [{ carrier: "estafeta", service: "ground", serviceLabel: "Terrestre", price: 295.5, currency: "MXN", delivery: null }],
    });
    deps = { env: "sandbox", canGenerate: true, client: envia, storage: () => bucket.storage };
  });

  it("cotiza las dos paqueterías, la más barata primero; una que falla no tapa a la otra", async () => {
    const ok = await service.quoteShipment(deps, actor, { ...createInput(), packages: [CAJA] });
    expect(ok.options.map((o) => [o.carrier, o.price])).toEqual([
      ["estafeta", 295.5],
      ["paquetexpress", 310],
    ]);
    deps = { ...deps, client: { ...envia, rate: async (r) => (r.carrier === "estafeta" ? Promise.reject(new (await import("@/lib/envia/client")).EnviaApiError("Estafeta no da servicio.", 400)) : envia.rate(r)) } };
    const partial = await service.quoteShipment(deps, actor, createInput());
    expect(partial.options).toHaveLength(1);
    expect(partial.errors).toEqual([{ carrier: "estafeta", message: "Estafeta no da servicio." }]);
  });

  it("genera: fila creada con rastreo y precio, el PDF de Envia y la copia para imprimir (solo la última página)", async () => {
    const res = await service.createShipment(deps, actor, createInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.shipment).toMatchObject({ status: "creada", environment: "sandbox", carrier: "paquetexpress", trackingNumber: "LMM01WE0191229", price: 310 });
    const row = await store.getShipment(ORG_A, res.shipment.id);
    expect(row?.labelKey).toBe(`org/${ORG_A}/envios/${res.shipment.id}/guia-envia.pdf`);
    expect(row?.packages).toEqual([{ ...CAJA, declaredValue: 5500 }]);
    const printDoc = await PDFDocument.load(bucket.objects.get(row!.printKey!)!);
    expect(printDoc.getPageCount()).toBe(1);
    expect(Math.round(printDoc.getPage(0).getWidth())).toBe(612);
  });

  it("la misma llave (doble clic) no genera otra guía", async () => {
    const input = createInput();
    const [a, b] = await Promise.all([service.createShipment(deps, actor, input), service.createShipment(deps, actor, input)]);
    const again = await service.createShipment(deps, actor, input);
    expect(envia.generated).toBe(1);
    expect([a.ok, b.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(again.ok && again.shipment.trackingNumber).toBe("LMM01WE0191229");
    expect(await store.listContactShipments(ORG_A, MARIA)).toHaveLength(1);
  });

  it("un error de Envia queda guardado tal cual y la misma llave no vuelve a pedir", async () => {
    const { EnviaApiError } = await import("@/lib/envia/client");
    envia.nextError = new EnviaApiError("No hay saldo suficiente en Envia.", 402);
    const input = createInput();
    const res = await service.createShipment(deps, actor, input);
    expect(res).toMatchObject({ ok: false, message: "No hay saldo suficiente en Envia.", shipment: { status: "fallida", errorMessage: "No hay saldo suficiente en Envia." } });
    const again = await service.createShipment(deps, actor, input);
    expect(again).toMatchObject({ ok: false, message: "No hay saldo suficiente en Envia." });
    expect(envia.generated).toBe(1);
  });

  it("sin dirección de origen favorita no se pide la guía", async () => {
    envia.origins = [
      { address: ORIGEN, favorite: false },
      { address: { ...ORIGEN, name: "Bodega" }, favorite: false },
    ];
    const res = await service.createShipment(deps, actor, createInput());
    expect(res).toMatchObject({ ok: false, message: expect.stringContaining("ninguna es la favorita") });
    expect(envia.generated).toBe(0);
  });

  it("si el bucket falla la guía sigue creada y la ruta de impresión la arma al primer clic", async () => {
    bucket.state.failPut = true;
    const res = await service.createShipment(deps, actor, createInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await store.getShipment(ORG_A, res.shipment.id))?.printKey).toBeNull();
    bucket.state.failPut = false;
    process.env.ENVIA_API_TOKEN = "token-de-pruebas";
    process.env.ENVIA_ENV = "sandbox";
    const realClient = await import("@/lib/envia/client");
    const spy = vi.spyOn(realClient, "enviaClient").mockReturnValue(envia);
    try {
      const pdf = await route.GET(new Request("http://localhost/api/envios/x/guia"), { params: Promise.resolve({ shipmentId: res.shipment.id }) });
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
      expect((await store.getShipment(ORG_A, res.shipment.id))?.printKey).not.toBeNull();
    } finally {
      spy.mockRestore();
      delete process.env.ENVIA_API_TOKEN;
      delete process.env.ENVIA_ENV;
    }
  });

  it("la ruta sirve la copia para imprimir; otra organización recibe 404", async () => {
    const res = await service.createShipment(deps, actor, createInput());
    if (!res.ok) throw new Error(res.message);
    const ok = await route.GET(new Request("http://localhost/x"), { params: Promise.resolve({ shipmentId: res.shipment.id }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Disposition")).toContain("guia-paquetexpress-LMM01WE0191229.pdf");
    session.current = { organizationId: ORG_B, userId: DANIEL, role: "agent" };
    const ajena = await route.GET(new Request("http://localhost/x"), { params: Promise.resolve({ shipmentId: res.shipment.id }) });
    expect(ajena.status).toBe(404);
    expect(await store.getShipment(ORG_B, res.shipment.id)).toBeNull();
  });

  it("cancelar: solo una creada, de la misma cuenta de Envia", async () => {
    const res = await service.createShipment(deps, actor, createInput());
    if (!res.ok) throw new Error(res.message);
    expect(await service.cancelShipment({ ...deps, env: "production" }, actor, res.shipment.id)).toMatchObject({ ok: false, message: expect.stringContaining("otra cuenta") });
    const canceled = await service.cancelShipment(deps, actor, res.shipment.id);
    expect(canceled).toMatchObject({ ok: true, shipment: { status: "cancelada" }, refundNote: expect.stringContaining("regresa el dinero") });
    expect(envia.canceled).toEqual(["LMM01WE0191229"]);
    expect(await service.cancelShipment(deps, actor, res.shipment.id)).toMatchObject({ ok: false });
  });

  it("candado del saldo: con la cuenta real sin ENVIA_GENERAR=si no se apunta ni se pide ninguna guía", async () => {
    const res = await service.createShipment({ ...deps, env: "production", canGenerate: false }, actor, createInput());
    expect(res).toEqual({ ok: false, message: service.GENERATE_LOCKED });
    expect(envia.generated).toBe(0);
    expect(await store.listContactShipments(ORG_A, MARIA)).toHaveLength(0);
    // Cotizar sí (no cobra).
    expect((await service.quoteShipment({ ...deps, env: "production", canGenerate: false }, actor, createInput())).options).toHaveLength(2);
  });

  it("un contacto de otra organización no recibe guías", async () => {
    expect(await service.createShipment(deps, actor, { ...createInput(), contactId: AJENO })).toEqual({ ok: false, message: "El contacto ya no existe." });
    expect(envia.generated).toBe(0);
  });

  it("borrar el contacto (ARCO) se lleva sus guías y sus PDF", async () => {
    const res = await service.createShipment(deps, actor, createInput());
    if (!res.ok) throw new Error(res.message);
    expect([...bucket.objects.keys()]).toHaveLength(2);
    const out = await arco.deleteContactAndData({ organizationId: ORG_A, userId: DANIEL, contactId: MARIA }, { storage: () => bucket.storage, cancelAgentJob: async () => undefined });
    expect(out.status).toBe("deleted");
    expect(bucket.objects.size).toBe(0);
    expect(await store.getShipment(ORG_A, res.shipment.id)).toBeNull();
  });
});
