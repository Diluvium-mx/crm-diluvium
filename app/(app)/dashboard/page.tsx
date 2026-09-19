import { InboxBoard } from "./_components/inbox-board";

// La Bandeja es totalmente en tiempo real (SSE) e interactiva, así que el
// board carga sus datos en el cliente vía las server actions de lib/inbox.
export default function BandejaPage() {
  return <InboxBoard />;
}
