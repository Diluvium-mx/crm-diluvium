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
  // Configuración del Agente IA (modelo de filtro y modelo de cerebro). Es
  // config del CRM: solo owner/admin la ven (`read`) y editan (`update`); el
  // agente (vendedor) no tiene acceso a esta pestaña.
  aiConfig: ["read", "update"],
  // Rangos editables de tallas: todos los vendedores los consultan para las
  // sugerencias; solo owner/admin cambian la configuración compartida.
  sizeRange: ["read", "update"],
  // Tarjeta "Gasto de IA" del Dashboard (A2): solo owner/admin la ven (`read`) y
  // registran las recargas de crédito de los proveedores (`update`).
  aiSpend: ["read", "update"],
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
});

export const agent = ac.newRole({
  contact: ["create", "read", "update"],
  tag: ["create", "read", "update"],
  // Los agentes (los vendedores) gestionan los Fragmentos: son su herramienta
  // de trabajo diaria. En plantillas solo leen y ENVÍAN (crear/sincronizar,
  // que tocan Meta y la WABA, quedan en owner/admin).
  snippet: ["create", "read", "update", "delete"],
  template: ["read"],
  sizeRange: ["read"],
  // El agente NO gestiona la config del Agente IA: `aiConfig` se omite a
  // propósito (roleAllows falla cerrado → sin acceso a la pestaña ni a editar).
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
