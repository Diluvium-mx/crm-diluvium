"use server";

// Las acciones autentican, autorizan y validan. Toda la lógica de persistencia
// vive en lib/contacts/qualification.ts para que también la use el agente IA.
import { z } from "zod";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { roleAllows, statement } from "@/lib/auth/permissions";
import {
  addComment as addCommentData,
  deleteComment as deleteCommentData,
  getContactQualification as getContactQualificationData,
  listSizeRanges as listSizeRangesData,
  replaceSizeRanges as replaceSizeRangesData,
  setNumEntradas as setNumEntradasData,
  updateComment as updateCommentData,
  updateContactQualification as updateContactQualificationData,
  updateEntrada as updateEntradaData,
} from "@/lib/contacts/qualification";
import { db } from "@/lib/db";
import { contactInundacionesEnum } from "@/lib/db/schema/contacts";
import { lineaCompuertaEnum } from "@/lib/db/schema/qualification";

function requirePermission(
  role: string,
  resource: keyof typeof statement,
  action: string,
): void {
  if (!roleAllows(role, resource, action)) {
    throw new Error("No tienes permiso para realizar esta acción.");
  }
}

const contactIdSchema = z.string().trim().min(1, "contactId es obligatorio.");
const commentIdSchema = z.string().trim().min(1, "commentId es obligatorio.");
const nullableInteger = (min: number, max: number, message: string) =>
  z.number().int(message).min(min, message).max(max, message).nullable();
const moneySchema = z
  .number()
  .min(0, "El monto no puede ser negativo.")
  .max(9_999_999_999.99, "El monto excede el máximo permitido.")
  .multipleOf(0.01, "El monto admite como máximo dos decimales.")
  .nullable();

const qualificationPatchSchema = z
  .object({
    tieneInundaciones: z.enum(contactInundacionesEnum.enumValues).nullable().optional(),
    nivelAguaCm: nullableInteger(
      0,
      1000,
      "El nivel de agua debe ser un entero entre 0 y 1000.",
    ).optional(),
    nivelAguaTexto: z.string().nullable().optional(),
    montoCotizacion: moneySchema.optional(),
    porcentajeConvencimiento: nullableInteger(
      0,
      100,
      "El porcentaje debe ser un entero entre 0 y 100.",
    )
      .refine((value) => value === null || value % 10 === 0, {
        message: "El porcentaje debe ser múltiplo de 10.",
      })
      .optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Indica al menos un campo para actualizar.",
  });

const entradaPositionSchema = z
  .number()
  .int("La posición debe ser un entero.")
  .min(1, "La posición debe ser mayor que 0.")
  .max(50, "La posición no puede ser mayor que 50.");
const entradaPatchSchema = z
  .object({
    anchoCm: nullableInteger(
      1,
      1000,
      "El ancho debe ser un entero entre 1 y 1000.",
    ).optional(),
    linea: z.enum(lineaCompuertaEnum.enumValues).optional(),
    tamanoManual: z.string().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Indica al menos un campo de la entrada para actualizar.",
  });
const sizeRangesSchema = z.array(
  z.object({
    linea: z.enum(lineaCompuertaEnum.enumValues),
    talla: z.string(),
    minCm: z.number().int("El mínimo debe ser un entero."),
    maxCm: z.number().int("El máximo debe ser un entero."),
    posicion: z
      .number()
      .int("La posición debe ser un entero.")
      .min(1, "La posición debe ser mayor que 0.")
      .max(32767, "La posición excede el máximo permitido."),
  }),
);
const commentBodySchema = z
  .string()
  .trim()
  .min(1, "El comentario no puede estar vacío.")
  .max(5000, "El comentario no puede pasar de 5000 caracteres.");

export async function getContactQualification(contactId: string) {
  const membership = await requireActiveMembership();
  requirePermission(membership.role, "contact", "read");
  const parsedContactId = contactIdSchema.parse(contactId);
  return getContactQualificationData(db, membership.organizationId, parsedContactId);
}

export async function updateContactQualification(
  contactId: string,
  patch: z.input<typeof qualificationPatchSchema>,
) {
  const membership = await requireActiveMembership();
  requirePermission(membership.role, "contact", "update");
  const parsedContactId = contactIdSchema.parse(contactId);
  const parsedPatch = qualificationPatchSchema.parse(patch);
  return updateContactQualificationData(
    db,
    membership.organizationId,
    parsedContactId,
    parsedPatch,
  );
}

export async function setNumEntradas(contactId: string, n: number | null) {
  const membership = await requireActiveMembership();
  requirePermission(membership.role, "contact", "update");
  const parsedContactId = contactIdSchema.parse(contactId);
  const parsedN = nullableInteger(
    0,
    50,
    "El número de entradas debe ser un entero entre 0 y 50.",
  ).parse(n);
  return setNumEntradasData(db, membership.organizationId, parsedContactId, parsedN);
}

export async function updateEntrada(
  contactId: string,
  posicion: number,
  patch: z.input<typeof entradaPatchSchema>,
) {
  const membership = await requireActiveMembership();
  requirePermission(membership.role, "contact", "update");
  const parsedContactId = contactIdSchema.parse(contactId);
  const parsedPosition = entradaPositionSchema.parse(posicion);
  const parsedPatch = entradaPatchSchema.parse(patch);
  return updateEntradaData(
    db,
    membership.organizationId,
    parsedContactId,
    parsedPosition,
    parsedPatch,
  );
}

export async function listSizeRanges() {
  const membership = await requireActiveMembership();
  requirePermission(membership.role, "sizeRange", "read");
  return listSizeRangesData(db, membership.organizationId);
}

export async function replaceSizeRanges(ranges: z.input<typeof sizeRangesSchema>) {
  const membership = await requireActiveMembership();
  requirePermission(membership.role, "sizeRange", "update");
  const parsed = sizeRangesSchema.parse(ranges);
  return replaceSizeRangesData(db, membership.organizationId, parsed);
}

export async function addComment(contactId: string, body: string) {
  const membership = await requireActiveMembership();
  requirePermission(membership.role, "contact", "update");
  const parsedContactId = contactIdSchema.parse(contactId);
  const parsedBody = commentBodySchema.parse(body);
  return addCommentData(
    db,
    membership.organizationId,
    parsedContactId,
    membership.userId,
    parsedBody,
  );
}

export async function updateComment(commentId: string, body: string) {
  const membership = await requireActiveMembership();
  requirePermission(membership.role, "contact", "update");
  const parsedCommentId = commentIdSchema.parse(commentId);
  const parsedBody = commentBodySchema.parse(body);
  return updateCommentData(
    db,
    membership.organizationId,
    parsedCommentId,
    { userId: membership.userId, role: membership.role },
    parsedBody,
  );
}

export async function deleteComment(commentId: string) {
  const membership = await requireActiveMembership();
  requirePermission(membership.role, "contact", "update");
  const parsedCommentId = commentIdSchema.parse(commentId);
  return deleteCommentData(db, membership.organizationId, parsedCommentId, {
    userId: membership.userId,
    role: membership.role,
  });
}
