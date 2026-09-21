import { listSnippets } from "@/lib/actions/snippets";
import { listTemplates } from "@/lib/actions/templates";
import { FragmentosPlantillas } from "./_components/fragmentos-plantillas";

// Sección conjunta Fragmentos (texto libre, dentro de 24 h) + Plantillas
// (aprobadas por Meta, fuera de 24 h). Los datos iniciales se cargan en el
// servidor (acotados a la organización de la sesión); la UI gestiona el resto.
export default async function FragmentosPlantillasPage() {
  const [snippets, templates] = await Promise.all([listSnippets(), listTemplates()]);
  return <FragmentosPlantillas initialSnippets={snippets} initialTemplates={templates} />;
}
