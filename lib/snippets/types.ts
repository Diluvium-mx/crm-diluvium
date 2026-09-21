// Contrato Fragmentos backend → UI. Solo tipos: la UI (Client Components) lo
// importa sin arrastrar el servidor.

export type SnippetView = {
  id: string;
  name: string;
  body: string;
  /** Nombres de las variables {{…}} detectadas en el cuerpo, en orden. */
  variables: string[];
};
