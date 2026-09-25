// SOLO LECTURA. Uso (con las variables del entorno, sin imprimir la llave):
//   railway run -e <entorno> -s crm-diluvium -- npm run ads:probe -- --account <accountId> [--conversation <id>]
//
// Revisa lo que usa el respaldo de anuncios (lib/ads/attribution.ts): el
// listado de conversaciones de Zernio por cuenta y su `metadata.ctwa_*`. NO
// imprime datos de clientes: solo conteos, nombres de llaves y si el clic de la
// conversación indicada se puede leer. Checklist del día del número real:
// docs/anuncios.md.
import { messagingProvider } from "@/lib/messaging";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const account = arg("account");
  if (!account) throw new Error("Falta --account <accountId>");
  const base = (process.env.ZERNIO_BASE_URL || "https://zernio.com/api").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/inbox/conversations?accountId=${encodeURIComponent(account)}&limit=100`, {
    headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}` },
  });
  const json = (await res.json()) as { data?: { metadata?: Record<string, unknown> }[]; meta?: Record<string, unknown> };
  const data = json.data ?? [];
  const withMeta = data.filter((c) => c.metadata && Object.keys(c.metadata).length > 0);
  const keys = [...new Set(withMeta.flatMap((c) => Object.keys(c.metadata ?? {})))].sort();
  console.log(`HTTP ${res.status} · conversaciones listadas (página 1): ${data.length} · con metadata de anuncio: ${withMeta.length}`);
  console.log(`llaves vistas: ${keys.length ? keys.join(", ") : "(ninguna)"}`);
  console.log(`cuentas consultadas por Zernio: ${String(json.meta?.accountsQueried ?? "?")} (el sandbox NO aparece en este listado)`);
  const conversation = arg("conversation");
  if (conversation) {
    const provider = messagingProvider();
    const click = await provider.conversationAdClick?.(account, conversation);
    console.log(
      click
        ? `conversación ${conversation.slice(0, 6)}…: clic legible · llaves ${Object.keys(click.referral).join(", ")} · capturado ${click.capturedAt?.toISOString() ?? "sin fecha"}`
        : `conversación ${conversation.slice(0, 6)}…: sin clic guardado (no llegó por anuncio, o no está en las primeras 3 páginas)`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[ads:probe]", error instanceof Error ? error.message : error);
    process.exit(1);
  });
