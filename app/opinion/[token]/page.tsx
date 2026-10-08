import type { Metadata } from "next";
import Image from "next/image";
import { TOKEN_RE } from "@/lib/opiniones/codigo";
import { enlaceCompartir, enlaceFoto } from "@/lib/opiniones/enlaces";
import { opinionPorToken } from "@/lib/opiniones/queries";
import { whatsappPhoneLink } from "@/lib/contacts/whatsapp-link";
import { OpinionForm } from "./_components/opinion-form";
import { Gracias, type GraciasProps } from "./_components/gracias";

// Formulario público de opinión después de la compra (7-oct-2026, docs/opiniones.md).
// Fuera de (app): sin sesión, sin menú y sin datos del cliente; solo el logo y las
// 4 preguntas. Siempre se lee al momento (una respuesta cambia lo que se ve).
export const dynamic = "force-dynamic";

const TITULO = "¿Cómo le quedó su compuerta?";
const DESCRIPCION = "Es un minuto. Nos ayuda mucho saber cómo le fue.";

async function cargar(token: string) {
  return TOKEN_RE.test(token) ? opinionPorToken(token) : null;
}

export async function generateMetadata({ params }: PageProps<"/opinion/[token]">): Promise<Metadata> {
  const opinion = await cargar((await params).token);
  const titulo = opinion ? `${opinion.organizacion} · ${TITULO}` : TITULO;
  const base = process.env.APP_URL?.replace(/\/+$/, "");
  return {
    title: titulo,
    description: DESCRIPCION,
    robots: { index: false, follow: false },
    // Vista previa del enlace en WhatsApp: logo, título y descripción.
    openGraph: { title: titulo, description: DESCRIPCION, images: base ? [`${base}/logo-diluvium.png`] : undefined },
  };
}

export default async function OpinionPage({ params }: PageProps<"/opinion/[token]">) {
  const { token } = await params;
  const opinion = await cargar(token);
  const telefono = opinion?.telefonoEmpresa ?? null;
  const gracias: GraciasProps | null = opinion && {
    fotoUrl: telefono ? enlaceFoto(telefono) : null,
    compartirUrl: telefono ? enlaceCompartir(telefono, opinion.organizacion, opinion.codigo) : null,
    googleUrl: opinion.googleResenaUrl,
    codigo: opinion.codigo,
    yaEstaba: false,
  };

  return (
    <main className="min-h-dvh bg-[#f4f6f9] font-brand text-neutral-900">
      <header className="bg-brand-navy px-4 py-3">
        <div className="mx-auto flex max-w-md items-center">
          <span className="rounded-md bg-white px-2.5 py-1.5">
            <Image src="/logo-diluvium.png" alt={opinion?.organizacion ?? "Diluvium"} width={115} height={28} priority />
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-md px-4 py-6">
        {!opinion || !gracias ? (
          <Aviso titulo="Este enlace no existe" texto="Revise que lo haya abierto completo desde el mensaje que le mandamos." />
        ) : opinion.estado === "vencida" ? (
          <Aviso
            titulo="Este enlace ya venció"
            texto="Si quiere contarnos cómo le fue, escríbanos por WhatsApp."
            enlace={telefono ? whatsappPhoneLink(telefono) : null}
          />
        ) : opinion.estado === "contestada" ? (
          <Gracias {...gracias} yaEstaba />
        ) : (
          <OpinionForm token={token} titulo="Cuéntenos cómo le fue" descripcion="Son 4 preguntas y nos ayuda mucho." gracias={gracias} />
        )}
      </div>
    </main>
  );
}

function Aviso({ titulo, texto, enlace = null }: { titulo: string; texto: string; enlace?: string | null }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <h1 className="text-lg font-bold text-brand-navy">{titulo}</h1>
      <p className="mt-1 text-sm text-neutral-600">{texto}</p>
      {enlace && (
        <a
          href={enlace}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex h-11 items-center justify-center rounded-lg border border-neutral-300 text-sm font-medium"
        >
          Escribir por WhatsApp
        </a>
      )}
    </section>
  );
}
