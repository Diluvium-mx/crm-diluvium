import { InboxBoard } from "./_components/inbox-board";

// La Bandeja es totalmente en tiempo real (SSE) e interactiva, así que el
// board carga sus datos en el cliente vía las server actions de lib/inbox.
// ?contacto=<id> abre el chat de ese contacto al entrar (aviso de cambio de etapa).
export default async function BandejaPage({ searchParams }: PageProps<"/dashboard">) {
  const { contacto } = await searchParams;
  return <InboxBoard openContactId={typeof contacto === "string" ? contacto : null} />;
}
