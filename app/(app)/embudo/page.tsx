import { loadEmbudo } from "@/lib/actions/contacts";
// Los componentes siguen en contactos/_components (no se movieron carpetas para
// no chocar con ramas en paralelo); /contactos redirige aquí.
import { ContactsBoard } from "../contactos/_components/contacts-board";

// "Embudo": el tablero kanban de contactos por etapa. Las señales de cada tarjeta
// (no vistos, por contestar, urgente) llegan aparte y el SSE las mantiene al día.
// La columna de entrada (Inbox) llega por partes (lib/contacts/board-load.ts).
// ?contacto=<id> abre ese contacto al entrar (la Bandeja manda aquí uno sin chat).
export default async function EmbudoPage({ searchParams }: PageProps<"/embudo">) {
  // Antes de leer: el tablero se pone al día desde aquí al conectarse el SSE.
  const loadedAt = new Date().toISOString();
  const params = await searchParams;
  const contacto = typeof params.contacto === "string" ? params.contacto : null;
  const { contacts, signals, entrada } = await loadEmbudo({ abrir: contacto, loadedAt });

  return (
    <ContactsBoard
      initialContacts={contacts}
      initialSignals={signals}
      initialEntrada={entrada}
      loadedAt={loadedAt}
      openContactId={contacto}
    />
  );
}
