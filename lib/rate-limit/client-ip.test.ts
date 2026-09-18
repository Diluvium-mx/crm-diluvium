import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, normalizeIpForKey } from "./client-ip";

const xff = (value: string) => new Headers({ "x-forwarded-for": value });

describe("clientIpFromHeaders", () => {
  it("toma el primer valor por defecto (IP que se conectó al edge de Railway)", () => {
    expect(clientIpFromHeaders(xff("203.0.113.7, 151.101.1.1, 100.64.0.2"))).toBe("203.0.113.7");
  });

  it("ignora x-real-ip (roto tras Fastly)", () => {
    const headers = new Headers({ "x-real-ip": "151.101.1.1", "x-forwarded-for": "203.0.113.7" });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("acepta índices desde la derecha", () => {
    expect(clientIpFromHeaders(xff("1.1.1.1, 2.2.2.2, 3.3.3.3"), -1)).toBe("3.3.3.3");
    expect(clientIpFromHeaders(xff("1.1.1.1, 2.2.2.2, 3.3.3.3"), -2)).toBe("2.2.2.2");
    expect(clientIpFromHeaders(xff("1.1.1.1, 2.2.2.2, 3.3.3.3"), 1)).toBe("2.2.2.2");
  });

  it("devuelve null sin header, con índice fuera de rango o con basura", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
    expect(clientIpFromHeaders(xff(""))).toBeNull();
    expect(clientIpFromHeaders(xff(" , ,"))).toBeNull();
    expect(clientIpFromHeaders(xff("1.1.1.1"), 3)).toBeNull();
    expect(clientIpFromHeaders(xff("1.1.1.1"), -2)).toBeNull();
    expect(clientIpFromHeaders(xff("not-an-ip, 1.1.1.1"))).toBeNull();
    expect(clientIpFromHeaders(xff("unknown"))).toBeNull();
  });
});

describe("normalizeIpForKey", () => {
  it("conserva IPv4 y le quita el puerto", () => {
    expect(normalizeIpForKey("198.51.100.4")).toBe("198.51.100.4");
    expect(normalizeIpForKey("198.51.100.4:51234")).toBe("198.51.100.4");
  });

  it("rechaza IPv4 inválidas", () => {
    expect(normalizeIpForKey("999.1.1.1")).toBeNull();
    expect(normalizeIpForKey("1.2.3")).toBeNull();
  });

  it("convierte IPv4 mapeada en IPv6 a IPv4", () => {
    expect(normalizeIpForKey("::ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(normalizeIpForKey("::FFFF:198.51.100.4")).toBe("198.51.100.4");
  });

  it("agrupa IPv6 por /64 para que rotar dentro del prefijo no evada el límite", () => {
    const a = normalizeIpForKey("2001:db8:abcd:12:1::1");
    const b = normalizeIpForKey("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
    expect(normalizeIpForKey("2001:db8:abcd:13::1")).not.toBe(a);
  });

  it("maneja IPv6 comprimida, con corchetes/puerto, con zona y con cola IPv4", () => {
    expect(normalizeIpForKey("::1")).toBe("0:0:0:0::/64");
    expect(normalizeIpForKey("[2001:db8::1]:443")).toBe("2001:db8:0:0::/64");
    expect(normalizeIpForKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(normalizeIpForKey("64:ff9b:1:2::192.0.2.1")).toBe("64:ff9b:1:2::/64");
  });
});
