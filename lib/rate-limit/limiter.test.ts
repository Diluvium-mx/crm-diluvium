import { describe, expect, it, vi } from "vitest";
import { authRateLimitRules, isSignInEmail } from "./auth-rules";
import {
  createRateLimiter,
  rateLimitKey,
  tooManyRequests,
  withRateLimit,
  type RateLimitDecision,
  type RateLimitRule,
  type RateLimitStore,
} from "./limiter";

// Misma semántica que el script Lua de redis-store.ts, con reloj controlable.
class MemoryStore implements RateLimitStore {
  readonly entries = new Map<string, number[]>();
  constructor(private readonly now: () => number) {}

  async hit(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    await Promise.resolve(); // que las llamadas concurrentes se intercalen
    const now = this.now();
    const live = (this.entries.get(key) ?? []).filter((t) => t > now - rule.windowMs);
    if (live.length < rule.max) {
      live.push(now);
      this.entries.set(key, live);
      return { allowed: true, remaining: rule.max - live.length, retryAfterMs: 0 };
    }
    this.entries.set(key, live);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, live[0] + rule.windowMs - now) };
  }
}

const silentLog = () => ({ warn: vi.fn(), error: vi.fn() });

function setup(xffIndex = 0) {
  let now = 1_000_000;
  const store = new MemoryStore(() => now);
  const log = silentLog();
  const limiter = createRateLimiter({ store, xffIndex, log });
  return {
    store,
    log,
    limiter,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const rule: RateLimitRule = { name: "test", max: 3, windowMs: 10_000 };

function req(ip?: string, path = "/api/auth/get-session"): Request {
  const headers = new Headers();
  if (ip !== undefined) headers.set("x-forwarded-for", ip);
  return new Request(`http://localhost${path}`, { method: "POST", headers });
}

describe("createRateLimiter", () => {
  it("deja pasar hasta el máximo y responde 429 con Retry-After al excederlo", async () => {
    const { limiter } = setup();
    for (let i = 0; i < rule.max; i++) {
      expect(await limiter.check(req("203.0.113.1"), [rule])).toBeNull();
    }
    const res = await limiter.check(req("203.0.113.1"), [rule]);
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("10");
    expect(await res?.json()).toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.any(String) });
  });

  it("es una ventana deslizante: libera cupo cuando la marca más vieja sale", async () => {
    const { limiter, advance } = setup();
    await limiter.check(req("203.0.113.1"), [rule]); // t=0
    advance(4_000);
    await limiter.check(req("203.0.113.1"), [rule]); // t=4s
    await limiter.check(req("203.0.113.1"), [rule]); // t=4s
    advance(3_000); // t=7s

    const blocked = await limiter.check(req("203.0.113.1"), [rule]);
    expect(blocked?.headers.get("Retry-After")).toBe("3"); // la de t=0 vence en t=10s

    advance(3_000); // t=10s: la de t=0 ya salió, las dos de t=4s siguen
    expect(await limiter.check(req("203.0.113.1"), [rule])).toBeNull();
    expect((await limiter.check(req("203.0.113.1"), [rule]))?.status).toBe(429);
  });

  it("las requests rechazadas no alargan el bloqueo", async () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < rule.max; i++) await limiter.check(req("203.0.113.1"), [rule]);
    for (let i = 0; i < 50; i++) {
      advance(100);
      expect((await limiter.check(req("203.0.113.1"), [rule]))?.status).toBe(429);
    }
    advance(10_000 - 5_000);
    expect(await limiter.check(req("203.0.113.1"), [rule])).toBeNull();
  });

  it("aísla por IP y agrupa IPv6 por /64", async () => {
    const { limiter } = setup();
    for (let i = 0; i < rule.max; i++) await limiter.check(req("2001:db8:1:2::1"), [rule]);
    expect((await limiter.check(req("2001:db8:1:2::ffff"), [rule]))?.status).toBe(429);
    expect(await limiter.check(req("2001:db8:1:3::1"), [rule])).toBeNull();
    expect(await limiter.check(req("203.0.113.9"), [rule])).toBeNull();
  });

  it("con índice 0, los saltos agregados a la derecha no cambian el bucket", async () => {
    const { limiter } = setup();
    for (let i = 0; i < rule.max; i++) {
      await limiter.check(req(`203.0.113.1, 100.64.0.${i}`), [rule]);
    }
    expect((await limiter.check(req("203.0.113.1, 151.101.9.9"), [rule]))?.status).toBe(429);
  });

  it("sin IP resoluble usa un bucket compartido y lo registra", async () => {
    const { limiter, log, store } = setup();
    await limiter.check(req(), [rule]);
    await limiter.check(req("basura"), [rule]);
    expect(store.entries.get(rateLimitKey(rule, "unknown"))).toHaveLength(2);
    expect(log.warn).toHaveBeenCalled();
  });

  it("si una regla rechaza, las siguientes no consumen cupo", async () => {
    const { limiter, store } = setup();
    const strict: RateLimitRule = { name: "strict", max: 100, windowMs: 10_000 };
    for (let i = 0; i < rule.max; i++) await limiter.check(req("203.0.113.1"), [rule, strict]);
    await limiter.check(req("203.0.113.1"), [rule, strict]); // rechazada por `rule`
    expect(store.entries.get(rateLimitKey(strict, "203.0.113.1"))).toHaveLength(rule.max);
  });

  it("deja pasar si el store falla (Redis caído) y registra el error", async () => {
    const log = silentLog();
    const limiter = createRateLimiter({
      store: { hit: () => Promise.reject(new Error("ECONNREFUSED")) },
      log,
    });
    expect(await limiter.check(req("203.0.113.1"), [rule])).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it("concurrencia: de 200 requests simultáneas pasan exactamente `max`", async () => {
    const { limiter } = setup();
    const burst: RateLimitRule = { name: "burst", max: 17, windowMs: 60_000 };
    const results = await Promise.all(
      Array.from({ length: 200 }, () => limiter.check(req("203.0.113.1"), [burst])),
    );
    expect(results.filter((r) => r === null)).toHaveLength(17);
    expect(results.filter((r) => r?.status === 429)).toHaveLength(183);
  });
});

describe("tooManyRequests", () => {
  it("redondea Retry-After hacia arriba y nunca devuelve 0", () => {
    expect(tooManyRequests(1).headers.get("Retry-After")).toBe("1");
    expect(tooManyRequests(1_001).headers.get("Retry-After")).toBe("2");
    expect(tooManyRequests(0).headers.get("Retry-After")).toBe("1");
  });
});

describe("withRateLimit", () => {
  it("no ejecuta el handler si la request excede el límite y pasa los argumentos si no", async () => {
    const { limiter } = setup();
    const handler = vi.fn(async (_req: Request, ctx: { id: string }) => new Response(ctx.id));
    const wrapped = withRateLimit(limiter, () => [rule], handler);

    for (let i = 0; i < rule.max; i++) {
      expect(await (await wrapped(req("203.0.113.1"), { id: "ok" })).text()).toBe("ok");
    }
    expect((await wrapped(req("203.0.113.1"), { id: "ok" })).status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(rule.max);
  });
});

describe("reglas de /api/auth", () => {
  const auth: RateLimitRule = { name: "auth", max: 100, windowMs: 60_000 };
  const signIn: RateLimitRule = { name: "sign-in", max: 5, windowMs: 60_000 };
  const rules = authRateLimitRules({ auth, signIn });

  it("aplica la regla estricta solo en sign-in/email, sin importar mayúsculas ni barras", () => {
    for (const path of [
      "/api/auth/sign-in/email",
      "/api/auth/sign-in/email/",
      "/api/auth//sign-in//email",
      "/API/Auth/Sign-In/Email",
      "/api/auth/sign-in/email?callbackURL=/x",
    ]) {
      expect(isSignInEmail(req("1.1.1.1", path))).toBe(true);
      expect(rules(req("1.1.1.1", path))).toEqual([auth, signIn]);
    }
    expect(rules(req("1.1.1.1", "/api/auth/get-session"))).toEqual([auth]);
    expect(rules(req("1.1.1.1", "/api/auth/sign-in/social"))).toEqual([auth]);
  });
});
