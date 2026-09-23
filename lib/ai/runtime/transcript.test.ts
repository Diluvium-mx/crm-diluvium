import { describe, expect, it } from "vitest";
import { buildModelMessages, MAX_MESSAGE_CHARS, messageText, toTranscriptLines, type ThreadMessage } from "./transcript";

let n = 0;
function msg(direction: "in" | "out", body: string | null, extra: Partial<ThreadMessage> = {}): ThreadMessage {
  n++;
  return { id: `m${n}`, direction, type: "text", body, templateName: null, attachments: [], ...extra };
}

describe("messageText", () => {
  it("cuerpo + notas de adjuntos; plantilla sin cuerpo", () => {
    expect(
      messageText(msg("in", "mira", { attachments: [{ type: "document", url: "u", fileName: "F.pdf" }] })),
    ).toBe("mira [documento: F.pdf]");
    expect(messageText(msg("out", null, { type: "template", templateName: "saludo" }))).toBe("[plantilla: saludo]");
    expect(messageText(msg("in", null, { type: "audio", attachments: [{ type: "audio", url: "u" }] }))).toBe("[audio]");
  });
});

describe("toTranscriptLines", () => {
  it("marca los pendientes por id", () => {
    const a = msg("out", "hola");
    const b = msg("in", "precio?");
    expect(toTranscriptLines([a, b], new Set([b.id]))).toEqual([
      { role: "diluvium", text: "hola", pending: false },
      { role: "cliente", text: "precio?", pending: true },
    ]);
  });
});

describe("buildModelMessages", () => {
  it("entrante → user, saliente → assistant; fusiona seguidos del mismo rol", () => {
    const out = buildModelMessages([msg("in", "hola"), msg("in", "precio?"), msg("out", "5,500"), msg("in", "ok")], new Map());
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out[0].content).toEqual([
      { type: "text", text: "hola" },
      { type: "text", text: "precio?" },
    ]);
    expect(out[1].content).toBe("5,500");
  });

  it("descarta los assistant iniciales (el hilo abre con el cliente)", () => {
    const out = buildModelMessages([msg("out", "promo"), msg("in", "hola")], new Map());
    expect(out.map((m) => m.role)).toEqual(["user"]);
  });

  it("imágenes del cliente con URL firmada como parte image; sin URL, nota de texto", () => {
    const withImg = msg("in", "así está la entrada", {
      attachments: [
        { type: "image", url: "zernio", storageKey: "k1" },
        { type: "image", url: "zernio" }, // aún sin descargar
      ],
    });
    const out = buildModelMessages([withImg], new Map([["k1", "https://bucket/k1?sig=1"]]));
    expect(out[0].content).toEqual([
      { type: "text", text: "así está la entrada [imagen]" },
      { type: "image", image: new URL("https://bucket/k1?sig=1") },
    ]);
  });

  it("respeta el cupo de imágenes (las más recientes)", () => {
    const rows = [1, 2, 3].map((i) =>
      msg("in", null, { type: "image", attachments: [{ type: "image", url: "z", storageKey: `k${i}` }] }),
    );
    const urls = new Map(rows.map((_, i) => [`k${i + 1}`, `https://b/k${i + 1}`]));
    const out = buildModelMessages(rows, urls, 2);
    const parts = out[0].content as { type: string; image?: URL; text?: string }[];
    expect(parts.filter((p) => p.type === "image").map((p) => p.image!.toString())).toEqual([
      "https://b/k2",
      "https://b/k3",
    ]);
    expect(parts.filter((p) => p.type === "text").map((p) => p.text)).toEqual(["[imagen]"]);
  });
});

describe("tope de texto por mensaje (costo por llamada acotado)", () => {
  it("un mensaje enorme del cliente llega recortado al filtro y al cerebro", () => {
    const huge = "x".repeat(MAX_MESSAGE_CHARS * 5);
    expect(messageText(msg("in", huge)).length).toBeLessThan(MAX_MESSAGE_CHARS + 20);
    const [user] = buildModelMessages([msg("in", huge)], new Map());
    const parts = user.content as { type: string; text: string }[];
    expect(parts[0].text.length).toBeLessThan(MAX_MESSAGE_CHARS + 20);
    expect(parts[0].text.endsWith("[recortado]")).toBe(true);
  });
});
