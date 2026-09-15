import { listContacts } from "@/lib/actions/contacts";
import { ContactsBoard } from "./_components/contacts-board";

export default async function ContactosPage() {
  const contacts = await listContacts();

  return <ContactsBoard initialContacts={contacts} />;
}
