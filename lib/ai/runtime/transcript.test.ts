import { describe, expect, it } from "vitest";
import { buildModelMessages, fitHistory, MAX_MESSAGE_CHARS, messageText, type ThreadMessage } from "./transcript";

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
    const out = buildModelMessages(rows, urls, { maxImages: 2 });
    const parts = out[0].content as { type: string; image?: URL; text?: string }[];
    expect(parts.filter((p) => p.type === "image").map((p) => p.image!.toString())).toEqual([
      "https://b/k2",
      "https://b/k3",
    ]);
    expect(parts.filter((p) => p.type === "text").map((p) => p.text)).toEqual(["[imagen]"]);
  });
});

describe("protecciones técnicas del historial", () => {
  it("un mensaje pegado gigante llega recortado al cerebro", () => {
    const huge = "x".repeat(MAX_MESSAGE_CHARS * 5);
    expect(messageText(msg("in", huge)).length).toBeLessThan(MAX_MESSAGE_CHARS + 20);
    const [user] = buildModelMessages([msg("in", huge)], new Map());
    const parts = user.content as { type: string; text: string }[];
    expect(parts[0].text.length).toBeLessThan(MAX_MESSAGE_CHARS + 20);
    expect(parts[0].text.endsWith("[recortado]")).toBe(true);
  });

  it("lee TODA la conversación mientras quepa; si no, se queda con lo más reciente sin fallar", () => {
    const rows = Array.from({ length: 50 }, (_, i) => msg(i % 2 ? "out" : "in", `mensaje ${i} ${"x".repeat(80)}`));
    expect(fitHistory(rows)).toHaveLength(50);
    const recent = fitHistory(rows, 1_000);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(50);
    expect(recent.at(-1)).toBe(rows.at(-1));
  });

  it("el texto limpio del anuncio sustituye al cuerpo con la metadata", () => {
    const ad = msg("in", "Hola\nbody: Compuertas antiinundación\nctwaClid: abc");
    const [user] = buildModelMessages([ad], new Map(), { cleanText: new Map([[ad.id, "Hola"]]) });
    expect(user.content).toEqual([{ type: "text", text: "Hola" }]);
  });
});
