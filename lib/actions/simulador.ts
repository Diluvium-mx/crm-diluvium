"use server";

// Cliente de prueba de staging (lib/messaging/simulador.ts): escribir como el cliente y empezar de nuevo, desde
// su chat. Solo donde el simulador está activo (producción nunca). La organización sale de la SESIÓN.
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { escribirComoCliente, reiniciarClienteDePrueba } from "@/lib/messaging/simulador-store";
import { simuladorActivo } from "@/lib/messaging/simulador";
import { logError } from "@/lib/log/safe-error";

export type SimuladorResult = { ok: true } | { ok: false; message: string };

const textoSchema = z.string().trim().min(1, "Escribe algo.").max(4000, "Máximo 4,000 caracteres.");

export async function escribirComoClienteDePrueba(text: unknown): Promise<SimuladorResult> {
  if (!simuladorActivo()) return { ok: false, message: "El cliente de prueba solo existe en staging." };
  const parsed = textoSchema.safeParse(text);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Texto no válido." };
  try {
    const { organizationId } = await requireActiveMembership();
    await escribirComoCliente(organizationId, parsed.data);
    return { ok: true };
  } catch (error) {
    logError("[simulador] no se pudo escribir como el cliente de prueba", error);
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo mandar; inténtalo de nuevo." };
  }
}

export async function empezarDeNuevoClienteDePrueba(): Promise<SimuladorResult> {
  if (!simuladorActivo()) return { ok: false, message: "El cliente de prueba solo existe en staging." };
  try {
    const { organizationId } = await requireActiveMembership();
    await reiniciarClienteDePrueba(organizationId);
    return { ok: true };
  } catch (error) {
    logError("[simulador] no se pudo reiniciar el cliente de prueba", error);
    return { ok: false, message: "No se pudo empezar de nuevo; inténtalo otra vez." };
  }
}
