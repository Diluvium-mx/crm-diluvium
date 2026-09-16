import Papa from "papaparse";
import { normalizePhone } from "@/lib/phone";

export type SourceChannel = "whatsapp" | "fb" | "instagram";

export interface ParsedGhlContactRow {
  ghlContactId: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string | null;
  phoneInvalid: boolean;
  email: string | null;
  sourceChannel: SourceChannel | null;
}

export interface SkippedGhlContactRow {
  rowNumber: number; // 1-based; cuenta solo filas de datos.
  reason: string;
}

export interface ParseGhlContactsCsvResult {
  rows: ParsedGhlContactRow[];
  skipped: SkippedGhlContactRow[];
  totalRows: number;
}

function sourceChannelFromTags(value: string): SourceChannel | null {
  const tags = value.split(",").map((tag) => tag.trim().toLowerCase());

  // La prioridad se aplica a toda la fila, independientemente del orden de tags.
  if (tags.some((tag) => /^wa:/i.test(tag) || tag.includes("whatsapp"))) {
    return "whatsapp";
  }
  if (tags.some((tag) => tag.includes("instagram") || /^ig[:-]/i.test(tag))) {
    return "instagram";
  }
  if (
    tags.some(
      (tag) =>
        tag.includes("facebook") || /^fb[:-]/i.test(tag) || tag.includes("fb-ad"),
    )
  ) {
    return "fb";
  }
  return null;
}

export function parseGhlContactsCsv(csvText: string): ParseGhlContactsCsvResult {
  const { data } = Papa.parse<Record<string, string | undefined>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  const rows: ParsedGhlContactRow[] = [];
  const skipped: SkippedGhlContactRow[] = [];

  data.forEach((row, index) => {
    const ghlContactId = row["contact id"]?.trim() ?? "";
    const firstName = row["first name"]?.trim() ?? "";
    if (!ghlContactId || !firstName) {
      skipped.push({
        rowNumber: index + 1,
        reason: !ghlContactId ? "Falta Contact Id" : "Falta First Name",
      });
      return;
    }

    const phone = row.phone?.trim() ?? "";
    let phoneE164: string | null = null;
    let phoneInvalid = false;
    if (phone) {
      try {
        phoneE164 = normalizePhone(phone);
      } catch {
        phoneInvalid = true;
      }
    }

    rows.push({
      ghlContactId,
      firstName,
      lastName: row["last name"]?.trim() || null,
      phoneE164,
      phoneInvalid,
      email: row.email?.trim() || null,
      sourceChannel: sourceChannelFromTags(row.tags ?? ""),
    });
  });

  return { rows, skipped, totalRows: data.length };
}
