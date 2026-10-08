"use server";

// Acciones de Seguimientos › Opinión (docs/opiniones.md): crear y borrar enlaces de
// prueba y cambiar el enlace de reseñas de Google. La organización sale de la sesión.
import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { requireActiveMembership, type ActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows } from "@/lib/auth/permissions";
import type { AgentActionResult } from "@/lib/agente-ia/types";
import { enlaceOpinion } from "@/lib/opiniones/enlaces";
import { borrarOpinionPrueba, crearOpinion, guardarGoogleResenaUrl } from "@/lib/opiniones/store";

const RUTA = "/seguimientos";

export type CrearEnlaceResult = { ok: true; enlace: string } | { ok: false; message: string };

async function conPermiso(accion: "create" | "update" | "delete"): Promise<ActiveMembership | null> {
  const m = await requireActiveMembership();
  return roleAllows(m.role, "opinion", accion) ? m : null;
}

export async function crearEnlacePrueba(): Promise<CrearEnlaceResult> {
  try {
    const m = await conPermiso("create");
    if (!m) return { ok: false, message: "No tienes permiso para crear enlaces." };
    const appUrl = process.env.APP_URL;
    if (!appUrl) return { ok: false, message: "Falta la dirección del CRM (APP_URL)." };
    const { token } = await crearOpinion({ organizationId: m.organizationId, prueba: true, userId: m.userId });
    revalidatePath(RUTA);
    return { ok: true, enlace: enlaceOpinion(appUrl, token) };
  } catch (error) {
    console.error("[opiniones] no se pudo crear el enlace de prueba", error);
    return { ok: false, message: "No se pudo crear el enlace. Intenta de nuevo." };
  }
}

const borrarSchema = z.object({ id: z.string().min(1).max(64) });

export async function borrarEnlacePrueba(input: { id: string }): Promise<AgentActionResult> {
  try {
    const { id } = borrarSchema.parse(input);
    const m = await conPermiso("delete");
    if (!m) return { ok: false, message: "No tienes permiso para borrar enlaces." };
    if (!(await borrarOpinionPrueba(m.organizationId, id))) {
      return { ok: false, message: "Ese enlace ya no existe o no es de prueba." };
    }
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Enlace no válido." };
    console.error("[opiniones] no se pudo borrar el enlace de prueba", error);
    return { ok: false, message: "No se pudo borrar. Intenta de nuevo." };
  }
}

const googleSchema = z.object({
  url: z
    .string()
    .trim()
    .max(500, "El enlace es demasiado largo.")
    .refine((v) => v === "" || esHttps(v), "El enlace debe empezar con https://"),
});

function esHttps(v: string): boolean {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

export async function guardarEnlaceGoogle(input: { url: string }): Promise<AgentActionResult> {
  try {
    const { url } = googleSchema.parse(input);
    const m = await conPermiso("update");
    if (!m) return { ok: false, message: "No tienes permiso para cambiar el enlace." };
    await guardarGoogleResenaUrl(m.organizationId, url || null, m.userId);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? "Enlace no válido." };
    console.error("[opiniones] no se pudo guardar el enlace de Google", error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}
