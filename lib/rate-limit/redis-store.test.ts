// Unit tests del store con un cliente falso + tests de concurrencia y carga
// contra Redis REAL. Los segundos solo corren con REDIS_TEST_URL definido
// (p. ej. `redis-server` local o el Redis de staging). Usan claves con
// prefijo único y las borran al terminar, pero no apuntarlos a prod.
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRateLimitRedis } from "./redis-client";
import { RedisRateLimitStore } from "./redis-store";
import type { RateLimitRule } from "./limiter";

const rule: RateLimitRule = { name: "t", max: 3, windowMs: 1_000 };

function fakeRedis(impl: {
  status?: string;
  connect?: () => Promise<void>;
  evalsha?: () => Promise<unknown>;
  eval?: () => Promise<unknown>;
}): Redis {
  return {
    status: impl.status ?? "ready",
    connect: impl.connect ?? (() => Promise.resolve()),
    evalsha: impl.evalsha ?? (() => Promise.resolve([1, 2, 0])),
    eval: impl.eval ?? (() => Promise.resolve([1, 2, 0])),
  } as unknown as Redis;
}

describe("createRateLimitRedis", () => {
  it("falla rápido: sin cola offline, sin reintentos ni reenvío tras reconectar", () => {
    const client = createRateLimitRedis("redis://localhost:6399", { error: vi.fn() });
    expect(client.options).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      commandTimeout: 500,
    });
    expect(client.status).toBe("wait"); // no conecta al importarse
    client.disconnect();
  });

  it("un comando sin conexión lista se rechaza al instante y no queda encolado", async () => {
    const client = createRateLimitRedis("redis://localhost:6399", { error: vi.fn() });
    await expect(client.evalsha("0".repeat(40), 1, "k")).rejects.toThrow(/enableOfflineQueue/);
    client.disconnect();
  });
});

describe("RedisRateLimitStore (cliente falso)", () => {
  it.each(["connecting", "reconnecting", "end", "close"])(
    "con Redis en estado %s no emite ningún comando (no puede ejecutarse tarde)",
    async (status) => {
      const evalsha = vi.fn(() => Promise.resolve([1, 2, 0]));
      const store = new RedisRateLimitStore(fakeRedis({ status, evalsha }));
      await expect(store.hit("k", rule)).rejects.toThrow(/no está listo/);
      expect(evalsha).not.toHaveBeenCalled();
    },
  );

  it("en el primer uso (estado wait) arranca la conexión y deja pasar esa request", async () => {
    const connect = vi.fn(() => Promise.resolve());
    const evalsha = vi.fn(() => Promise.resolve([1, 2, 0]));
    const store = new RedisRateLimitStore(fakeRedis({ status: "wait", connect, evalsha }));
    await expect(store.hit("k", rule)).rejects.toThrow(/no está listo/);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(evalsha).not.toHaveBeenCalled();
  });

  it("interpreta la respuesta del script", async () => {
    const store = new RedisRateLimitStore(fakeRedis({ evalsha: async () => [0, 0, 750] }));
    expect(await store.hit("k", rule)).toEqual({ allowed: false, remaining: 0, retryAfterMs: 750 });
  });

  it("si Redis no tiene el script cacheado (NOSCRIPT) lo manda completo", async () => {
    let evalCalls = 0;
    const store = new RedisRateLimitStore(
      fakeRedis({
        evalsha: async () => {
          throw new Error("NOSCRIPT No matching script. Please use EVAL.");
        },
        eval: async () => {
          evalCalls++;
          return [1, 2, 0];
        },
      }),
    );
    expect(await store.hit("k", rule)).toMatchObject({ allowed: true, remaining: 2 });
    expect(evalCalls).toBe(1);
  });

  it("propaga otros errores y respuestas inesperadas (el limiter decide dejar pasar)", async () => {
    const failing = new RedisRateLimitStore(
      fakeRedis({ evalsha: () => Promise.reject(new Error("READONLY")) }),
    );
    await expect(failing.hit("k", rule)).rejects.toThrow("READONLY");

    const weird = new RedisRateLimitStore(fakeRedis({ evalsha: async () => "OK" }));
    await expect(weird.hit("k", rule)).rejects.toThrow(/inesperada/);
  });

  it("corta con timeout si Redis no responde", async () => {
    const store = new RedisRateLimitStore(
      fakeRedis({ evalsha: () => new Promise(() => {}) }),
      20,
    );
    await expect(store.hit("k", rule)).rejects.toThrow(/no respondió/);
  });
});

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

describe.skipIf(!REDIS_TEST_URL)("RedisRateLimitStore (Redis real)", () => {
  const prefix = `rl-test:${randomUUID()}:`;
  // Varias conexiones = varias instancias de la app compitiendo por la misma clave.
  const clients: Redis[] = [];
  let stores: RedisRateLimitStore[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 4; i++) {
      const client = new Redis(REDIS_TEST_URL as string, { lazyConnect: true });
      await client.connect();
      clients.push(client);
    }
    stores = clients.map((c) => new RedisRateLimitStore(c, 5_000));
  });

  afterAll(async () => {
    const keys = await clients[0].keys(`${prefix}*`);
    if (keys.length) await clients[0].del(...keys);
    await Promise.all(clients.map((c) => c.quit()));
  });

  it("concurrencia: 400 hits simultáneos desde 4 conexiones → exactamente `max` aceptados", async () => {
    const key = `${prefix}burst`;
    const burst: RateLimitRule = { name: "burst", max: 25, windowMs: 60_000 };
    const results = await Promise.all(
      Array.from({ length: 400 }, (_, i) => stores[i % stores.length].hit(key, burst)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(25);
    expect(await clients[0].zcard(key)).toBe(25);

    const remaining = results.filter((r) => r.allowed).map((r) => r.remaining).sort((a, b) => a - b);
    expect(remaining).toEqual(Array.from({ length: 25 }, (_, i) => i)); // 0..24, sin repetidos
    for (const r of results.filter((r) => !r.allowed)) {
      expect(r.retryAfterMs).toBeGreaterThan(0);
      expect(r.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("ventana deslizante con reloj de Redis: bloquea y libera tras Retry-After", async () => {
    const key = `${prefix}slide`;
    const short: RateLimitRule = { name: "slide", max: 3, windowMs: 400 };
    for (let i = 0; i < 3; i++) expect((await stores[0].hit(key, short)).allowed).toBe(true);
    const blocked = await stores[1].hit(key, short);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(400);

    await new Promise((r) => setTimeout(r, blocked.retryAfterMs + 30));
    expect((await stores[2].hit(key, short)).allowed).toBe(true);
  });

  it("pone TTL a la clave para que Redis la borre sola", async () => {
    const key = `${prefix}ttl`;
    await stores[0].hit(key, { name: "ttl", max: 5, windowMs: 2_000 });
    const pttl = await clients[0].pttl(key);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(2_000);
  });

  it("carga: 10 000 hits concurrentes sobre 200 IPs → exactamente 200 × max aceptados", async () => {
    const load: RateLimitRule = { name: "load", max: 10, windowMs: 60_000 };
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 10_000 }, (_, i) =>
        stores[i % stores.length].hit(`${prefix}load:${i % 200}`, load),
      ),
    );
    const elapsedMs = performance.now() - started;

    expect(results.filter((r) => r.allowed)).toHaveLength(200 * 10);
    for (let ip = 0; ip < 200; ip += 37) {
      expect(await clients[0].zcard(`${prefix}load:${ip}`)).toBe(10);
    }
    console.info(
      `[rate-limit carga] 10000 hits en ${elapsedMs.toFixed(0)} ms ` +
        `(${((10_000 / elapsedMs) * 1000).toFixed(0)} hits/s)`,
    );
  }, 60_000);
});
