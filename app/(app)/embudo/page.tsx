import { getFunnelSignals, listContacts } from "@/lib/actions/contacts";
// Los componentes siguen en contactos/_components (no se movieron carpetas para
// no chocar con ramas en paralelo); /contactos redirige aquí.
import { ContactsBoard } from "../contactos/_components/contacts-board";

// "Embudo": el tablero kanban de contactos por etapa. Las señales de cada tarjeta
// (no vistos, por contestar, urgente) llegan aparte y el SSE las mantiene al día.
export default async function EmbudoPage() {
  const [contacts, signals] = await Promise.all([listContacts(), getFunnelSignals()]);

  return <ContactsBoard initialContacts={contacts} initialSignals={signals} />;
}
