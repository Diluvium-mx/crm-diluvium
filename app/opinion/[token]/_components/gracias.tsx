import { MessageCircle, Share2, Star } from "lucide-react";

export type GraciasProps = {
  fotoUrl: string | null;
  compartirUrl: string | null;
  googleUrl: string | null;
  codigo: string;
  /** Ya había contestado antes (abrió el enlace otra vez). */
  yaEstaba: boolean;
};

// Pantalla final del formulario de opinión (docs/opiniones.md): la misma para todos,
// sin importar las estrellas (Google prohíbe pedir reseña solo a los contentos).
export function Gracias({ fotoUrl, compartirUrl, googleUrl, codigo, yaEstaba }: GraciasProps) {
  return (
    <section className="flex flex-col gap-5 rounded-xl bg-white p-5 shadow-sm">
      <div>
        <h1 className="text-lg font-bold text-brand-navy">
          {yaEstaba ? "Ya recibimos su opinión. Gracias." : "Gracias, ya quedó."}
        </h1>
        {fotoUrl && <p className="mt-1 text-sm text-neutral-600">¿Nos regala una foto o video de cómo le quedó?</p>}
      </div>
      {fotoUrl && (
        <a href={fotoUrl} target="_blank" rel="noopener noreferrer" className={SECUNDARIO}>
          <MessageCircle aria-hidden="true" className="size-4" />
          Mandarla por WhatsApp
        </a>
      )}
      {compartirUrl && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-600">¿A algún vecino o conocido también se le mete el agua?</p>
          <a href={compartirUrl} target="_blank" rel="noopener noreferrer" className={PRIMARIO}>
            <Share2 aria-hidden="true" className="size-4" />
            Compartir con un vecino
          </a>
          <p className="text-center text-xs text-neutral-500">
            Su código: <span className="font-medium tracking-wide text-neutral-700">{codigo}</span>
          </p>
        </div>
      )}
      {googleUrl && (
        <a href={googleUrl} target="_blank" rel="noopener noreferrer" className={SECUNDARIO}>
          <Star aria-hidden="true" className="size-4" />
          Dejar reseña en Google
        </a>
      )}
    </section>
  );
}

const BOTON = "flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium";
const PRIMARIO = `${BOTON} bg-brand-orange text-white hover:bg-brand-orange-light`;
const SECUNDARIO = `${BOTON} border border-neutral-300 text-neutral-800 hover:bg-neutral-50`;
