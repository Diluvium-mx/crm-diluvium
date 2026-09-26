import { getFunnelSignals, listContacts } from "@/lib/actions/contacts";
// Los componentes siguen en contactos/_components (no se movieron carpetas para
// no chocar con ramas en paralelo); /contactos redirige aquí.
import { ContactsBoard } from "../contactos/_components/contacts-board";

// "Embudo": el tablero kanban de contactos por etapa. Las señales de cada tarjeta
// (no vistos, por contestar, urgente) llegan aparte y el SSE las mantiene al día.
// ?contacto=<id> abre ese contacto al entrar (la Bandeja manda aquí uno sin chat).
export default async function EmbudoPage({ searchParams }: PageProps<"/embudo">) {
  // Antes de leer: el tablero se pone al día desde aquí al conectarse el SSE.
  const loadedAt = new Date().toISOString();
  const [contacts, signals, params] = await Promise.all([listContacts(), getFunnelSignals(), searchParams]);
  const contacto = typeof params.contacto === "string" ? params.contacto : null;

  return <ContactsBoard initialContacts={contacts} initialSignals={signals} loadedAt={loadedAt} openContactId={contacto} />;
}
