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

// true si el header (case-insensitive, trim) estaba presente en el CSV.
export interface GhlCsvColumnsPresent {
  lastName: boolean;
  phone: boolean;
  email: boolean;
  tags: boolean; // sourceChannel se deriva de esta columna
}

export interface CsvStructuralError {
  rowNumber: number; // error.row + 1; usa 0 si Papa.parse no da row.
  code: string;
  message: string;
}

export type ParseGhlContactsCsvResult =
  | {
      ok: true;
      rows: ParsedGhlContactRow[];
      skipped: SkippedGhlContactRow[];
      totalRows: number;
      columnsPresent: GhlCsvColumnsPresent;
    }
  | {
      ok: false;
      errors: CsvStructuralError[];
    };

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
  const { data, errors, meta } = Papa.parse<Record<string, string | undefined>>(csvText, {
    // Evita errores de autodetección en archivos vacíos o de una sola columna.
    delimiter: ",",
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  if (errors.length > 0) {
    return {
      ok: false,
      errors: errors.map((error) => ({
        rowNumber: error.row === undefined ? 0 : error.row + 1,
        code: error.code,
        message: error.message,
      })),
    };
  }

  const fields = new Set(meta.fields ?? []);
  const columnsPresent: GhlCsvColumnsPresent = {
    lastName: fields.has("last name"),
    phone: fields.has("phone"),
    email: fields.has("email"),
    tags: fields.has("tags"),
  };
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

  return { ok: true, rows, skipped, totalRows: data.length, columnsPresent };
}
