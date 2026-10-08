"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Star } from "lucide-react";
import { enviarOpinion } from "@/lib/opiniones/enviar";
import {
  CIUDAD_MAX,
  LLUVIA,
  NOMBRE_MAX,
  PERMISO,
  respuestaSchema,
  TEXTO_MAX,
  type Lluvia,
  type Permiso,
} from "@/lib/opiniones/respuestas";
import { Gracias, type GraciasProps } from "./gracias";

type Campo = "estrellas" | "texto" | "lluvia" | "permiso" | "nombre" | "ciudad" | "envio";

// Las 4 preguntas del formulario público de opinión (docs/opiniones.md). Valida con el
// mismo esquema que la ruta /api/opinion antes de enviar.
export function OpinionForm({
  token,
  titulo,
  descripcion,
  gracias,
}: {
  token: string;
  titulo: string;
  descripcion: string;
  gracias: GraciasProps;
}) {
  const [estrellas, setEstrellas] = useState<number | undefined>(undefined);
  const [texto, setTexto] = useState("");
  const [lluvia, setLluvia] = useState<Lluvia | undefined>(undefined);
  const [permiso, setPermiso] = useState<Permiso | undefined>(undefined);
  const [nombre, setNombre] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [errores, setErrores] = useState<Partial<Record<Campo, string>>>({});
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<"no" | "nuevo" | "ya_estaba">("no");
  // Cada envío con avisos lleva la pantalla al primero (en el celular el botón queda abajo).
  const [intento, setIntento] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  useEffect(() => {
    if (intento === 0) return;
    formRef.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [intento]);

  if (listo !== "no") return <Gracias {...gracias} yaEstaba={listo === "ya_estaba"} />;

  const limpiar = (campo: Campo) => setErrores((e) => ({ ...e, [campo]: undefined, envio: undefined }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const respuesta = { token, estrellas, texto, lluvia, permiso, nombre, ciudad };
    const parsed = respuestaSchema.safeParse(respuesta);
    if (!parsed.success) {
      const nuevos: Partial<Record<Campo, string>> = {};
      for (const issue of parsed.error.issues) {
        const campo = (issue.path[0] as Campo | undefined) ?? "envio";
        nuevos[campo] ??= issue.message;
      }
      setErrores(nuevos);
      setIntento((n) => n + 1);
      return;
    }
    setEnviando(true);
    const resultado = await enviarOpinion(parsed.data);
    setEnviando(false);
    if (resultado.ok) setListo("nuevo");
    else if (resultado.yaContestada) setListo("ya_estaba");
    else {
      setErrores({ envio: resultado.message });
      setIntento((n) => n + 1);
    }
  }

  return (
    <form ref={formRef} onSubmit={enviar} noValidate className="flex flex-col gap-5 rounded-xl bg-white p-5 shadow-sm">
      <div>
        <h1 className="text-lg font-bold text-brand-navy">{titulo}</h1>
        <p className="mt-1 text-sm text-neutral-600">{descripcion}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={PREGUNTA}>¿Cómo le quedó su compuerta?</legend>
        <div role="radiogroup" aria-label="Estrellas" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => {
            const llena = estrellas !== undefined && n <= estrellas;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={estrellas === n}
                aria-label={n === 1 ? "1 estrella" : `${n} estrellas`}
                onClick={() => {
                  setEstrellas(n);
                  limpiar("estrellas");
                }}
                className="flex size-11 items-center justify-center rounded-lg hover:bg-neutral-100"
              >
                <Star
                  aria-hidden="true"
                  className={`size-8 ${llena ? "fill-brand-orange text-brand-orange" : "text-neutral-300"}`}
                />
              </button>
            );
          })}
        </div>
        <Error texto={errores.estrellas} />
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-texto`} className={PREGUNTA}>
          ¿Qué le diría a alguien que está pensando comprarla? <span className="font-normal text-neutral-500">(opcional)</span>
        </label>
        <textarea
          id={`${id}-texto`}
          value={texto}
          maxLength={TEXTO_MAX}
          rows={3}
          onChange={(e) => {
            setTexto(e.target.value);
            limpiar("texto");
          }}
          className={CAJA}
        />
        <Error texto={errores.texto} />
      </div>

      <Opciones
        pregunta="¿Ya le tocó una lluvia con ella?"
        nombre="lluvia"
        opciones={LLUVIA}
        valor={lluvia}
        error={errores.lluvia}
        onChange={(v) => {
          setLluvia(v);
          limpiar("lluvia");
        }}
      />

      <Opciones
        pregunta="¿Podemos compartir su opinión?"
        nota="Solo la compartimos si usted lo autoriza."
        nombre="permiso"
        opciones={PERMISO}
        valor={permiso}
        error={errores.permiso}
        onChange={(v) => {
          setPermiso(v);
          limpiar("permiso");
        }}
      />

      {permiso === "con_nombre" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-nombre`} className={PREGUNTA}>
              Su nombre
            </label>
            <input
              id={`${id}-nombre`}
              value={nombre}
              maxLength={NOMBRE_MAX}
              autoComplete="name"
              onChange={(e) => {
                setNombre(e.target.value);
                limpiar("nombre");
              }}
              className={`${CAJA} h-11`}
            />
            <Error texto={errores.nombre} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-ciudad`} className={PREGUNTA}>
              Su ciudad <span className="font-normal text-neutral-500">(opcional)</span>
            </label>
            <input
              id={`${id}-ciudad`}
              value={ciudad}
              maxLength={CIUDAD_MAX}
              autoComplete="address-level2"
              onChange={(e) => {
                setCiudad(e.target.value);
                limpiar("ciudad");
              }}
              className={`${CAJA} h-11`}
            />
            <Error texto={errores.ciudad} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={enviando}
          className="flex h-12 items-center justify-center rounded-lg bg-brand-orange text-base font-medium text-white hover:bg-brand-orange-light disabled:opacity-60"
        >
          {enviando ? "Enviando…" : "Enviar"}
        </button>
        <Error texto={errores.envio} />
      </div>
    </form>
  );
}

function Opciones<T extends string>({
  pregunta,
  nota,
  nombre,
  opciones,
  valor,
  error,
  onChange,
}: {
  pregunta: string;
  nota?: string;
  nombre: string;
  opciones: readonly { id: T; label: string }[];
  valor: T | undefined;
  error?: string;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={PREGUNTA}>{pregunta}</legend>
      {nota && <p className="-mt-1 text-xs text-neutral-500">{nota}</p>}
      {opciones.map((o) => (
        <label
          key={o.id}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-neutral-300 px-3 text-sm has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/5"
        >
          <input
            type="radio"
            name={nombre}
            value={o.id}
            checked={valor === o.id}
            onChange={() => onChange(o.id)}
            className="size-4 accent-brand-navy"
          />
          {o.label}
        </label>
      ))}
      <Error texto={error} />
    </fieldset>
  );
}

function Error({ texto }: { texto?: string }) {
  if (!texto) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {texto}
    </p>
  );
}

const PREGUNTA = "text-sm font-medium text-neutral-900";
const CAJA =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20";
