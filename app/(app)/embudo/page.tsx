import { listContacts } from "@/lib/actions/contacts";
// Los componentes siguen en contactos/_components (no se movieron carpetas para
// no chocar con ramas en paralelo); /contactos redirige aquí.
import { ContactsBoard } from "../contactos/_components/contacts-board";

// "Embudo": el tablero kanban de contactos por etapa.
export default async function EmbudoPage() {
  const contacts = await listContacts();

  return <ContactsBoard initialContacts={contacts} />;
}
