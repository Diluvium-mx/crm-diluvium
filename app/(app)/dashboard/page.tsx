import { requireActiveMembership } from "@/lib/auth/active-organization";
import { loadBotBanner } from "@/lib/monitoring/bot-silence";
import { BotBanner } from "./_components/bot-banner";
import { InboxBoard } from "./_components/inbox-board";

// La Bandeja es totalmente en tiempo real (SSE) e interactiva, así que el
// board carga sus datos en el cliente vía las server actions de lib/inbox.
// ?contacto=<id> abre el chat de ese contacto al entrar (aviso de cambio de etapa).
// Arriba, la franja del bot (horario o canal Apagado) con datos del CRM.
export default async function BandejaPage({ searchParams }: PageProps<"/dashboard">) {
  const { organizationId } = await requireActiveMembership();
  const [{ contacto }, banner] = await Promise.all([searchParams, loadBotBanner(organizationId)]);
  return (
    // Alto FIJO (pantalla − encabezado de 4rem): la franja toma lo suyo y el board el resto.
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 shrink-0 flex-col overflow-hidden">
      {banner && <BotBanner data={banner} renderedAt={new Date().toISOString()} />}
      <InboxBoard openContactId={typeof contacto === "string" ? contacto : null} />
    </div>
  );
}
