import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export const statement = {
  ...defaultStatements,
  contact: ["create", "read", "update", "delete", "import", "export"],
  tag: ["create", "read", "update", "delete"],
  snippet: ["create", "read", "update", "delete"],
  // Plantillas de WhatsApp (aprobadas por Meta). `read` = ver/listar (para
  // enviarlas desde el chat, todos). `create` = darlas de alta en Meta. `sync` =
  // sincronizar el listado a la BD (puede marcar como eliminadas). Gestionarlas
  // afecta a la cuenta de WhatsApp y la revisión de Meta: solo owner/admin.
  template: ["read", "create", "sync"],
  // Pestaña "Agente IA" completa (nombre, modelos por etapa, Goal, FAQs,
  // versiones, canales, APIs). Desde el 25-sep-2026 TODOS los roles la ven
  // (`read`) y editan (`update`), incluido el vendedor.
  aiConfig: ["read", "update"],
  // Rangos editables de tallas: todos los vendedores los consultan para las
  // sugerencias; solo owner/admin cambian la configuración compartida.
  sizeRange: ["read", "update"],
  // Tarjeta "Gasto de IA" del Dashboard (A2): todos la ven (`read`, el vendedor
  // también, para prever recargas); registrar recargas (`update`) es owner/admin.
  aiSpend: ["read", "update"],
  // Automatización (Fase D): workflows y su biblioteca de media. Todos los roles
  // los leen, ejecutan (`run`: comandos tipo /tabla) y editan.
  workflow: ["read", "run", "create", "update", "delete"],
  mediaAsset: ["read", "create", "delete"],
  // Sección "Configuración" (Vendedores, Tallas y lo que se agregue): solo
  // owner/admin la ven y editan. "Mi cuenta" NO vive aquí (menú del usuario).
  settings: ["read"],
} as const;

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  ...ownerAc.statements,
  contact: ["create", "read", "update", "delete", "import", "export"],
  tag: ["create", "read", "update", "delete"],
  snippet: ["create", "read", "update", "delete"],
  template: ["read", "create", "sync"],
  aiConfig: ["read", "update"],
  sizeRange: ["read", "update"],
  aiSpend: ["read", "update"],
  workflow: ["read", "run", "create", "update", "delete"],
  mediaAsset: ["read", "create", "delete"],
  settings: ["read"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  contact: ["create", "read", "update", "delete", "import", "export"],
  tag: ["create", "read", "update", "delete"],
  snippet: ["create", "read", "update", "delete"],
  template: ["read", "create", "sync"],
  aiConfig: ["read", "update"],
  sizeRange: ["read", "update"],
  aiSpend: ["read", "update"],
  workflow: ["read", "run", "create", "update", "delete"],
  mediaAsset: ["read", "create", "delete"],
  settings: ["read"],
});

// Vendedor: TODO el CRM menos Configuración (decisión del dueño, 25-sep-2026).
// Se quedan en owner/admin: crear/sincronizar plantillas de Meta, importar y
// borrar contactos en masa, registrar recargas de IA, Vendedores y Tallas.
export const agent = ac.newRole({
  contact: ["create", "read", "update"],
  tag: ["create", "read", "update"],
  // Los agentes (los vendedores) gestionan los Fragmentos: son su herramienta
  // de trabajo diaria. En plantillas solo leen y ENVÍAN (crear/sincronizar,
  // que tocan Meta y la WABA, quedan en owner/admin).
  snippet: ["create", "read", "update", "delete"],
  template: ["read"],
  sizeRange: ["read"],
  aiConfig: ["read", "update"],
  aiSpend: ["read"],
  workflow: ["read", "run", "create", "update", "delete"],
  mediaAsset: ["read", "create", "delete"],
  // Sin `settings`: roleAllows falla cerrado → sin la sección Configuración.
});

const roles = { owner, admin, agent } as const;

/**
 * ¿El rol (owner|admin|agent) permite `action` sobre `resource`, según el ACL de
 * arriba? Fuente única: lee los grants de los roles, sin duplicar la política.
 * Un rol desconocido no permite nada (falla cerrado).
 */
export function roleAllows(role: string, resource: keyof typeof statement, action: string): boolean {
  const roleAc = roles[role as keyof typeof roles] as
    | { statements: Record<string, readonly string[] | undefined> }
    | undefined;
  return roleAc?.statements[resource]?.includes(action) ?? false;
}
