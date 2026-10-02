"use server";

// Lectura de la cinta del clima desde el navegador (cada 10 min, para que entre a las 9:00, salga a las
// 19:00 y traiga la hora nueva sin recargar). Solo para quien tiene sesión y membresía activa.
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { itemsCinta, type ItemCinta } from "./cinta";
import { leerFotoClima } from "./store";

export async function leerCintaClima(): Promise<ItemCinta[]> {
  try {
    await requireActiveMembership();
  } catch {
    return [];
  }
  return itemsCinta(await leerFotoClima(), new Date());
}
