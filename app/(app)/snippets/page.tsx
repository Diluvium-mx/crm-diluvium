import { redirect } from "next/navigation";

// Ruta vieja de "Fragmentos y plantillas". La sección ahora se llama "Mensajes
// rápidos" y vive en /mensajes-rapidos; esto conserva los enlaces guardados.
export default function SnippetsRedirect() {
  redirect("/mensajes-rapidos");
}
