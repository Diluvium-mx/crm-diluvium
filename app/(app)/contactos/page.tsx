import { redirect } from "next/navigation";

// Ruta vieja del tablero. La sección ahora se llama "Embudo" y vive en
// /embudo; esto conserva los enlaces guardados.
export default function ContactosRedirect() {
  redirect("/embudo");
}
