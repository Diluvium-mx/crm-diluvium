import { describe, expect, it } from "vitest";
import { extensionColor, fileExtension, formatBytes } from "./format";

describe("tarjeta de documento", () => {
  it("tamaño legible", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(71_796)).toBe("70 KB");
    expect(formatBytes(2_516_582)).toBe("2.4 MB");
    expect(formatBytes(null)).toBe("");
  });

  it("extensión por nombre o por tipo MIME", () => {
    expect(fileExtension("Factura F-1.PDF", null)).toBe("pdf");
    expect(fileExtension(null, "application/xml")).toBe("xml");
    expect(fileExtension(null, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
    expect(fileExtension(null, null)).toBe("archivo");
    expect(extensionColor("pdf")).toContain("red");
  });
});
