// Unit tests del store con un cliente falso + tests de concurrencia y carga
// contra Redis REAL. Los segundos solo corren con REDIS_TEST_URL definido
// (p. ej. `redis-server` local o el Redis de staging). Usan claves con
// prefijo único y las borran al terminar, pero no apuntarlos a prod.
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRateLimitRedis } from "./redis-client";
import { RedisRateLimitStore, SLIDING_WINDOW_LUA } from "./redis-store";
import type { RateLimitRule } from "./limiter";

const rule: RateLimitRule = { name: "t", max: 3, windowMs: 1_000 };

type FakeImpl = {
  status?: string;
  connect?: (fake: FakeRedis) => Promise<void>;
  evalsha?: (...args: unknown[]) => Promise<unknown>;
  eval?: (...args: unknown[]) => Promise<unknown>;
};

// Lo mínimo de ioredis que usa el store: status, eventos, connect y scripts.
class FakeRedis extends EventEmitter {
  status: string;
  constructor(private readonly impl: FakeImpl) {
    super();
    this.status = impl.status ?? "ready";
  }
  connect() {
    return this.impl.connect ? this.impl.connect(this) : Promise.resolve();
  }
  evalsha(...args: unknown[]) {
    return this.impl.evalsha ? this.impl.evalsha(...args) : Promise.resolve([1, 2, 0]);
  }
  eval(...args: unknown[]) {
    return this.impl.eval ? this.impl.eval(...args) : Promise.resolve([1, 2, 0]);
  }
  becomeReady() {
    this.status = "ready";
    this.emit("ready");
  }
}

function fakeRedis(impl: FakeImpl): Redis {
  return new FakeRedis(impl) as unknown as Redis;
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
  it.each(["connecting", "reconnecting", "close"])(
    "con Redis en %s espera la conexión con tope y, si no llega, no emite nada",
    async (status) => {
      const evalsha = vi.fn(() => Promise.resolve([1, 2, 0]));
      const store = new RedisRateLimitStore(fakeRedis({ status, evalsha }), 500, 20);
      await expect(store.hit("k", rule)).rejects.toThrow(/no estuvo listo en 20 ms/);
      expect(evalsha).not.toHaveBeenCalled();
    },
  );

  it("con la conexión cerrada (end) falla al instante", async () => {
    const evalsha = vi.fn(() => Promise.resolve([1, 2, 0]));
    const store = new RedisRateLimitStore(fakeRedis({ status: "end", evalsha }));
    await expect(store.hit("k", rule)).rejects.toThrow(/end/);
    expect(evalsha).not.toHaveBeenCalled();
  });

  it("arranque en frío: una ráfaga concurrente espera la MISMA conexión y se limita", async () => {
    const connect = vi.fn((fake: FakeRedis) => {
      fake.status = "connecting";
      setTimeout(() => fake.becomeReady(), 15);
      return Promise.resolve();
    });
    const evalsha = vi.fn(() => Promise.resolve([1, 2, 0]));
    const fake = new FakeRedis({ status: "wait", connect, evalsha });
    const store = new RedisRateLimitStore(fake as unknown as Redis, 500, 1_000);

    const results = await Promise.all(Array.from({ length: 50 }, () => store.hit("k", rule)));
    expect(results).toHaveLength(50);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(evalsha).toHaveBeenCalledTimes(50); // ninguna pasó sin consultar a Redis
    expect(fake.listenerCount("ready")).toBe(0); // sin listeners colgando
  });

  it("pasa al script un deadline cercano y trata la respuesta 'vencido' como error", async () => {
    let deadlineArg = 0;
    const store = new RedisRateLimitStore(
      fakeRedis({
        evalsha: async (...args: unknown[]) => {
          deadlineArg = Number(args[args.length - 1]);
          return [2, 0, 0];
        },
      }),
      500,
    );
    const before = Date.now();
    await expect(store.hit("k", rule)).rejects.toThrow(/deadline/);
    expect(deadlineArg).toBeGreaterThanOrEqual(before + 500);
    expect(deadlineArg).toBeLessThanOrEqual(Date.now() + 2_000);
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

  it("un hit que Redis ejecuta después de su deadline no reserva nada", async () => {
    const key = `${prefix}late`;
    const reply = await clients[0].eval(SLIDING_WINDOW_LUA, 1, key, "60000", "5", randomUUID(), String(Date.now() - 10_000));
    expect(reply).toEqual([2, 0, 0]);
    expect(await clients[0].exists(key)).toBe(0);
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
