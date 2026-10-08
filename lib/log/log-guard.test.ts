// Prueba GUARDIANA de los logs sin datos de clientes (punto 9, 7-oct-2026; antes
// S3 / CN-011). Los logs de Railway los lee cualquiera con acceso al proyecto y se
// guardan días: no deben llevar teléfonos, nombres ni lo que escribió nadie.
//
// Falla si una llamada a console.* (o el tag de logError) lleva:
//  1) un ERROR CRUDO: la variable del error (`error`, `err`, `…Error`, o la de un
//     `catch (e)`), su `.message`/`.stack`, `String(error)`, o una variable del mismo
//     archivo armada con eso. Un DrizzleQueryError trae en el mensaje los PARÁMETROS
//     de la consulta (teléfonos, nombres, textos). Va por safeErrorMessage(error) o
//     logError(tag, error) de lib/log/safe-error.ts. `error.name` y `error.code` sí.
//  2) TEXTO de mensajes (del cliente, del vendedor o del Agente IA): variables o
//     campos `text`, `body`, `caption`, … o cualquier valor citado entre «…». En su
//     lugar, el id y el largo (`text.length`).
//
// Es una revisión por SINTAXIS (TypeScript), no por tipos. Ante un falso positivo,
// cambia el nombre o agrégalo a ALLOW con su porqué.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
// scripts/ también: check-migrations corre al arrancar el web (sale en los logs de
// Railway) y varios se corren con `railway run` contra producción.
const SCAN = ["app", "lib", "worker", "components", "scripts"];
const SKIP_PREFIXES = ["lib/log/"]; // los propios ayudantes
const CONSOLE_METHODS = new Set(["error", "warn", "info", "log", "debug", "trace"]);
// Nombres de variables de error. Con minúscula: `SendFailedError` es la clase, no el valor.
const ERROR_NAME = /^(err|error|exception|cause|[a-z]\w*Error)$/;
const TEXT_NAMES = new Set([
  "text",
  "texts",
  "body",
  "caption",
  "content",
  "transcript",
  "transcription",
  "questions",
  "repeated",
  "unanswered",
  "preview",
  "snippet",
]);
// Campos que no traen datos del cliente aunque cuelguen de un error o de un mensaje.
const SAFE_PROPS = new Set(["length", "name", "code", "status", "statusCode", "id", "kind", "size", "byteLength", "attemptsMade", "slug", "label"]);
const SAFE_CALLS = new Set(["safeErrorMessage"]);

/** Excepciones justificadas: archivo + un trozo único de la llamada + por qué. */
const ALLOW: { file: string; includes: string; why: string }[] = [
  {
    file: "scripts/ai-dry-run.ts",
    includes: "result.text.trim()",
    why: "prueba a mano de un modelo: imprime su respuesta a «Di 'ok'» en la terminal; no hay datos de clientes",
  },
  {
    file: "scripts/cargar-mensajes-rapidos.ts",
    includes: "preview(",
    why: "muestra los Mensajes rápidos de la empresa (textos fijos del dueño) antes de cargarlos; no son mensajes de clientes",
  },
];

type Leak = string | null;

/** Lo que se sabe del archivo: variables de error (`catch (e)`) y variables armadas con un error. */
type FileScope = { errorVars: Set<string>; tainted: Set<string> };

function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

function isConsoleCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "console" &&
    CONSOLE_METHODS.has(callee.name.text)
  );
}

function isErrorVar(name: string, scope: FileScope): boolean {
  return ERROR_NAME.test(name) || scope.errorVars.has(name);
}

/**
 * Por qué `node` filtraría datos a un log (o null). `errorsOnly`: solo errores crudos
 * (para decidir si una variable quedó "sucia"; el texto se revisa donde se imprime).
 */
function leak(node: ts.Node, scope: FileScope, errorsOnly = false): Leak {
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    if (name && SAFE_CALLS.has(name)) return null;
    // Un console.* o logError anidado (p. ej. en un .catch) se revisa aparte: no es un valor.
    if (isConsoleCall(node) || name === "logError") return null;
  }
  // `x instanceof Error`, `typeof x`: no imprimen el valor.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) return null;
  if (ts.isTypeOfExpression(node)) return null;
  // Tipos, parámetros de funciones y nombres de campos de objetos: no son valores.
  if (ts.isTypeNode(node) || ts.isParameter(node)) return null;
  if (ts.isPropertyAssignment(node)) return leak(node.initializer, scope, errorsOnly);
  if (ts.isShorthandPropertyAssignment(node)) return leak(node.name, scope, errorsOnly);
  if (ts.isIdentifier(node)) {
    if (isErrorVar(node.text, scope)) return `error crudo (${node.text})`;
    if (!errorsOnly && TEXT_NAMES.has(node.text)) return `texto de mensaje (${node.text})`;
    if (scope.tainted.has(node.text)) return `variable armada con un error crudo (${node.text})`;
    return null;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const prop = node.name.text;
    if (SAFE_PROPS.has(prop)) return null;
    if (!errorsOnly && TEXT_NAMES.has(prop)) return `texto de mensaje (.${prop})`;
    return leak(node.expression, scope, errorsOnly);
  }
  if (ts.isTemplateExpression(node)) {
    let before = node.head.text;
    for (const span of node.templateSpans) {
      // Lo citado entre «…» es lo que escribió alguien (salvo un nombre interno).
      if (!errorsOnly && before.endsWith("«") && !isSafeName(span.expression)) return "texto citado entre «…»";
      const found = leak(span.expression, scope, errorsOnly);
      if (found) return found;
      before = span.literal.text;
    }
    return null;
  }
  let found: Leak = null;
  ts.forEachChild(node, (child) => {
    found ??= leak(child, scope, errorsOnly);
  });
  return found;
}

function isSafeName(expr: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expr) && SAFE_PROPS.has(expr.name.text);
}

function scopeOf(source: ts.SourceFile): FileScope {
  const scope: FileScope = { errorVars: new Set(), tainted: new Set() };
  // Variables de error: la de cada `catch (x)` y el parámetro de cada `.catch((x) => …)`.
  const findErrorVars = (node: ts.Node) => {
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
      scope.errorVars.add(node.variableDeclaration.name.text);
    }
    if (ts.isCallExpression(node) && calleeName(node.expression) === "catch") {
      const handler = node.arguments[0];
      if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
        const first = handler.parameters[0];
        if (first && ts.isIdentifier(first.name)) scope.errorVars.add(first.name.text);
      }
    }
    ts.forEachChild(node, findErrorVars);
  };
  findErrorVars(source);
  // Variables armadas con un error crudo (`const reason = error.message`), hasta que no crezca.
  let grew = true;
  while (grew) {
    grew = false;
    const visit = (node: ts.Node) => {
      let name: string | null = null;
      let value: ts.Node | undefined;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        name = node.name.text;
        value = node.initializer;
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
        name = node.left.text;
        value = node.right;
      }
      // Funciones: lo que lleven dentro no hace "sucia" a la variable que las guarda.
      if (name && value && !ts.isArrowFunction(value) && !ts.isFunctionExpression(value) && !scope.tainted.has(name) && leak(value, scope, true)) {
        scope.tainted.add(name);
        grew = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return scope;
}

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) yield full;
  }
}

function offendersIn(rel: string, src: string): string[] {
  const source = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const scope = scopeOf(source);
  const lines = src.split("\n");
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      // console.*: todos los argumentos. logError(tag, error): solo el tag (el error lo limpia él).
      const args = isConsoleCall(node) ? node.arguments : calleeName(node.expression) === "logError" ? node.arguments.slice(0, -1) : [];
      for (const arg of args) {
        const why = leak(arg, scope);
        if (!why) continue;
        const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
        const end = source.getLineAndCharacterOfPosition(node.getEnd()).line;
        const call = lines.slice(start, end + 1).join("\n");
        if (!ALLOW.some((a) => a.file === rel && call.includes(a.includes))) found.push(`${rel}:${start + 1} ${why}`);
        break;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("regla: logs sin datos de clientes (lib/log/safe-error.ts)", () => {
  it("ningún console.* lleva un error crudo ni el texto de un mensaje", () => {
    const offenders: string[] = [];
    for (const dir of SCAN) {
      for (const file of files(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
        offenders.push(...offendersIn(rel, readFileSync(file, "utf8")));
      }
    }
    expect(offenders, "usa safeErrorMessage(error) / logError(tag, error) y deja id y largo en vez del texto").toEqual([]);
  });

  it("la revisión detecta los casos que debe detectar (y deja pasar los seguros)", () => {
    const bad = [
      'console.error("[x] falló", error);',
      "console.warn(`[x] falló: ${err.message}`);",
      "console.error(`[x] ${String(error)}`);",
      "try {} catch (e) { console.error(e); }",
      "p.catch((e) => console.error(`[x] ${e.message}`));",
      "try {} catch (error) { const reason = error instanceof Error ? error.message : String(error); console.error(`[x] ${reason}`); }",
      "const outcome = await run().catch((error) => ({ reason: error.message })); console.info(`[x] ${outcome.reason}`);",
      "console.info(`[x] ${m.id}: «${text.slice(0, 120)}»`);",
      "console.warn(`[x] sale: «${out.texto}»`);",
      "console.info(`[x] ${m.body}`);",
      "logError(`[x] ${m.text}`, error);",
    ];
    const good = [
      'console.error("[x] falló", safeErrorMessage(error));',
      'logError("[x] falló", error);',
      "console.warn(`[x] ${m.id}: ${text.length} caracteres (${error.name})`);",
      "console.info(`[x] «${captionRun.slug}» no salió`);",
      "console.error(`[x] falló ${job?.data.messageId} (intento ${job?.attemptsMade}): ${safeErrorMessage(error)}`);",
      "for (const e of entries) console.info(`[x] ${e.contactId}`);",
      "const tick = async () => { try {} catch (error) { console.error('[x]', safeErrorMessage(error)); } }; console.info(`[x] ${tick}`);",
    ];
    for (const src of bad) expect(offendersIn("x.ts", src), src).toHaveLength(1);
    for (const src of good) expect(offendersIn("x.ts", src), src).toEqual([]);
  });
});
