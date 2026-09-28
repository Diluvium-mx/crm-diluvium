// Explicaciones en palabras del vendedor de por qué Meta no acepta (o frena) una
// plantilla, para el aviso grande de Plantillas (pop-up). Puro: la UI lo importa.
// Motivos de Meta: campo `rejected_reason` de la plantilla (Graph API:
// ABUSIVE_CONTENT, INVALID_FORMAT, NONE, PROMOTIONAL, TAG_CONTENT_MISMATCH, SCAM;
// INCORRECT_CATEGORY en cuentas nuevas). Verificado el 28-sep-2026.

export type MetaNotice = {
  /** Título grande del aviso. */
  title: string;
  /** Por qué pasó, en corto. */
  why: string;
  /** Qué hacer ahora. */
  whatToDo: string[];
};

/** Contexto que va en todo aviso de Meta: quién decide y cuánto tarda. */
export const META_CONTEXT =
  "Las plantillas las revisa Meta (la dueña de WhatsApp), no el CRM: decide en minutos o hasta 24 h y el CRM solo muestra lo que Meta contestó.";

const REASONS: Record<string, Omit<MetaNotice, "title">> = {
  INVALID_FORMAT: {
    why: "El formato no cumple las reglas de Meta: huecos {{1}} mal puestos (al inicio o al final, no seguidos, con símbolos como # $ %), demasiados huecos para lo corto del texto, o el texto es igual a otra plantilla.",
    whatToDo: [
      "Toca el lápiz y corrige el texto: agrega palabras antes y después de cada hueco.",
      "Si es igual a otra plantilla, cambia la redacción.",
    ],
  },
  PROMOTIONAL: {
    why: "Meta considera que el texto es de venta o promoción, y se mandó como Utilidad.",
    whatToDo: ["Bórrala y créala de nuevo como Marketing (con otro nombre: el de esta queda bloqueado 30 días)."],
  },
  TAG_CONTENT_MISMATCH: {
    why: "La categoría no corresponde al texto (por ejemplo, un saludo o un seguimiento marcado como Utilidad).",
    whatToDo: ["Bórrala y créala de nuevo con la categoría Marketing (con otro nombre)."],
  },
  INCORRECT_CATEGORY: {
    why: "La categoría elegida no corresponde al texto.",
    whatToDo: ["Bórrala y créala de nuevo con la categoría correcta (saludos y seguimientos = Marketing)."],
  },
  ABUSIVE_CONTENT: {
    why: "Meta cree que el texto puede ser ofensivo, amenazante o presionar de más al cliente.",
    whatToDo: ["Suaviza la redacción con el lápiz y vuelve a mandarla."],
  },
  SCAM: {
    why: "Meta cree que el texto puede parecer un engaño: por ejemplo, pide datos delicados (tarjeta, identificaciones) o promete algo difícil de creer.",
    whatToDo: ["Quita cualquier petición de datos delicados o promesa exagerada y vuelve a mandarla."],
  },
};

/** Aviso para una plantilla RECHAZADA por Meta, según el motivo que dio (o sin motivo). */
export function rejectionNotice(name: string, reason: string | null): MetaNotice {
  const known = reason ? REASONS[reason.toUpperCase()] : undefined;
  if (known) return { title: `Meta rechazó la plantilla "${name}"`, ...known };
  return {
    title: `Meta rechazó la plantilla "${name}"`,
    why: "Meta no dio un motivo concreto. Lo más común: huecos {{1}} al inicio o al final, texto repetido de otra plantilla, o una categoría que no corresponde (saludos y seguimientos van como Marketing).",
    whatToDo: [
      "Revisa el texto y corrígelo con el lápiz, o bórrala y créala de nuevo como Marketing.",
      "Si crees que Meta se equivocó, se puede apelar en WhatsApp Manager (Meta Business).",
    ],
  };
}

/** Aviso para una plantilla que Meta frenó después de aprobarla (pausada o desactivada). */
export function statusNotice(name: string, status: string): MetaNotice | null {
  const s = status.toUpperCase();
  if (s === "PAUSED") {
    return {
      title: `Meta pausó la plantilla "${name}"`,
      why: "Varios clientes la bloquearon, la reportaron o no la leen: Meta la pausa unas horas (3 h, luego 6 h) para cuidar la calidad del número.",
      whatToDo: [
        "Mientras esté pausada no se puede mandar; Meta la reactiva sola.",
        "Si se repite, cambia el texto con el lápiz: a la tercera Meta la desactiva.",
      ],
    };
  }
  if (s === "DISABLED") {
    return {
      title: `Meta desactivó la plantilla "${name}"`,
      why: "Meta la pausó varias veces por baja calidad (bloqueos o reportes de clientes) y ya no deja mandarla.",
      whatToDo: ["Bórrala y crea otra con una redacción distinta (con otro nombre)."],
    };
  }
  return null;
}

/** Aviso cuando Meta (vía Zernio) rechaza en el momento crear, editar o borrar. */
export function submitNotice(action: "crear" | "editar" | "borrar" | "sincronizar" | "enviar", providerMessage: string): MetaNotice {
  const verb = { crear: "crear", editar: "editar", borrar: "borrar", sincronizar: "sincronizar", enviar: "mandar" }[action];
  const lower = providerMessage.toLowerCase();
  const whatToDo: string[] = [];
  if (lower.includes("already exists") || lower.includes("duplicate") || lower.includes("ya existe")) {
    whatToDo.push("Ya existe una plantilla con ese nombre (o se borró hace menos de 30 días): usa otro nombre.");
  } else if (lower.includes("limit")) {
    whatToDo.push("Meta limita cuántas veces se edita una plantilla aprobada (1 al día, 10 al mes): espera o crea otra.");
  } else if (lower.includes("pending")) {
    whatToDo.push("Está en revisión: espera a que Meta termine (minutos a 24 h) y vuelve a intentarlo.");
  } else if (lower.includes("template") && (lower.includes("not found") || lower.includes("does not exist") || lower.includes("approved"))) {
    whatToDo.push("La plantilla no está aprobada, ya no existe en Meta o no existe en ese idioma: pulsa Sincronizar en Mensajes rápidos → Plantillas y elige otra.");
  } else {
    whatToDo.push("Revisa el texto (huecos, categoría) y vuelve a intentarlo.");
  }
  whatToDo.push("Si se repite, mándale este aviso a Code tal cual.");
  return {
    title: `WhatsApp (Meta) no dejó ${verb}`,
    why: `Lo que contestó: «${providerMessage}».`,
    whatToDo,
  };
}
