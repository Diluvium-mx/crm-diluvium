import type { BillingDays } from "@/lib/db/schema/ai-billing";
import type { FetchLike } from "./http";

// Proveedores que dan su cobro por API (Google no: su saldo sigue siendo estimado).
export type BillingProvider = "anthropic" | "openai" | "xai" | "openrouter";

export type ReadOptions = {
  now: Date;
  // Primer día UTC que hace falta: el inicio del mes o la primera recarga, lo que sea anterior.
  fromDay: string;
  // Ya hay una lectura buena guardada: basta con volver a leer los días recientes.
  hasHistory: boolean;
  fetchImpl?: FetchLike;
};

// Una lectura del proveedor. Los días desde `replaceFrom` sustituyen a los guardados.
export type BillingReading = {
  days: BillingDays;
  replaceFrom: string;
  // Saldo y total comprado directos del proveedor (xAI, OpenRouter); null en los demás.
  balanceUsd: number | null;
  loadedUsd: number | null;
  // Avisos para el log (nunca datos de clientes ni llaves).
  warnings: string[];
};
