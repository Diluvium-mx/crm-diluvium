// Cómo se ve cada opinión en Seguimientos › Opinión (docs/opiniones.md): título,
// fecha en hora de Mazatlán y etiquetas. Puro; el servidor lo arma y el panel solo pinta.
import { formatMazatlan } from "@/lib/historial/labels";
import { enlaceOpinion } from "./enlaces";
import type { OpinionFila } from "./queries";
import { etiquetaPermiso } from "./respuestas";

export type TonoEtiqueta = "bien" | "alerta" | "marca" | "neutro";

export type OpinionVista = {
  id: string;
  titulo: string;
  fecha: string;
  estado: OpinionFila["estado"];
  prueba: boolean;
  estrellas: number | null;
  texto: string | null;
  etiquetas: { texto: string; tono: TonoEtiqueta }[];
  /** Enlace al formulario mientras siga sin contestar y vigente (para copiarlo otra vez). */
  enlace: string | null;
};

const LLUVIA_CORTA: Record<string, { texto: string; tono: TonoEtiqueta }> = {
  resistio: { texto: "Resistió", tono: "bien" },
  se_metio: { texto: "Se metió agua", tono: "alerta" },
  todavia_no: { texto: "Todavía sin lluvia", tono: "neutro" },
};

function soloFecha(at: Date): string {
  return formatMazatlan(at).split(" ")[0];
}

export function opinionVista(f: OpinionFila, appUrl: string): OpinionVista {
  const quien = (f.permiso === "con_nombre" && f.nombre) || f.contacto || (f.prueba ? "Prueba" : "Cliente");
  const titulo = f.permiso === "con_nombre" && f.ciudad ? `${quien} · ${f.ciudad}` : quien;

  const fecha =
    f.estado === "contestada" && f.answeredAt
      ? `Contestó el ${formatMazatlan(f.answeredAt)}`
      : f.estado === "vencida"
        ? `Venció sin respuesta el ${soloFecha(f.expiresAt)}`
        : `Esperando respuesta · vence el ${soloFecha(f.expiresAt)}`;

  const etiquetas: OpinionVista["etiquetas"] = [];
  const lluvia = f.lluvia ? LLUVIA_CORTA[f.lluvia] : undefined;
  if (lluvia) etiquetas.push(lluvia);
  const permiso = etiquetaPermiso(f.permiso);
  if (permiso) etiquetas.push({ texto: permiso, tono: f.permiso === "no" ? "neutro" : "marca" });
  etiquetas.push({ texto: `Código ${f.codigo}`, tono: "neutro" });

  return {
    id: f.id,
    titulo,
    fecha,
    estado: f.estado,
    prueba: f.prueba,
    estrellas: f.estrellas,
    texto: f.texto,
    etiquetas,
    enlace: f.estado === "pendiente" && appUrl ? enlaceOpinion(appUrl, f.token) : null,
  };
}
