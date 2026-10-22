import { requireActiveMembership } from "@/lib/auth/active-organization";
import { loadBotBanner } from "@/lib/monitoring/bot-silence";
import { recentSendFailures, sendFailureBannerLines } from "@/lib/monitoring/send-failures";
import { BotBanner } from "./_components/bot-banner";
import { InboxBoard } from "./_components/inbox-board";
import { SendFailuresBanner } from "./_components/send-failures-banner";

// La Bandeja es totalmente en tiempo real (SSE) e interactiva, así que el
// board carga sus datos en el cliente vía las server actions de lib/inbox.
// ?contacto=<id> abre el chat de ese contacto al entrar (aviso de cambio de etapa).
// Arriba, la franja de envíos que fallan en serie (P4) y la del bot (horario o canal Apagado),
// con datos del CRM. Si la de envíos no se puede leer, la Bandeja abre igual sin ella.
export default async function BandejaPage({ searchParams }: PageProps<"/dashboard">) {
  const { organizationId } = await requireActiveMembership();
  const [{ contacto }, banner, sendFailures] = await Promise.all([
    searchParams,
    loadBotBanner(organizationId),
    recentSendFailures({ organizationId })
      .then(sendFailureBannerLines)
      .catch(() => []),
  ]);
  return (
    // Alto FIJO (pantalla − encabezado de 4rem): la franja toma lo suyo y el board el resto.
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 shrink-0 flex-col overflow-hidden">
      <SendFailuresBanner initial={sendFailures} />
      {banner && <BotBanner data={banner} renderedAt={new Date().toISOString()} />}
      <InboxBoard openContactId={typeof contacto === "string" ? contacto : null} />
    </div>
  );
}
