"use client";

// Video del chat (Bandeja y pop-up del Embudo): el reproductor de siempre más el
// ícono de pantalla completa en la esquina de arriba a la derecha, para no ir a
// ⋮ › Pantalla completa (en un video vertical Chrome esconde ahí su botón). Se ve
// en pausa o al terminar y se oculta mientras el video corre; al picarle (o con
// doble clic sobre la imagen), el video llena la pantalla y empieza a reproducirse.
// Para no repetirla, «Pantalla completa» sale del menú ⋮ y de la barra de Chrome
// (controlsList="nofullscreen"); ya en pantalla completa vuelve su botón para
// salir, y Esc también sale. «Silenciar» tampoco se ofrece (decisión del dueño): el
// video mide al menos 208 px de ancho, con franjas negras si es angosto, porque así
// Chrome lo deja en la barra (y no en ⋮), donde app/globals.css lo esconde. Con menos
// ancho Chrome lo manda a ⋮, y entre 176 y 192 px además vuelve a poner ahí
// «Pantalla completa» aunque tenga nofullscreen (probado en Chrome 154).
import { Maximize } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

// iPhone no tiene requestFullscreen en el video: usa su propio reproductor.
type VideoConIphone = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

// Alto de la barra de controles de Chrome (▶, tiempo, ⋮ y la línea de avance): un
// doble clic ahí no abre la pantalla completa.
const CONTROLES_PX = 72;

export function VideoAttachment({ src }: { src: string }) {
  const videoRef = useRef<VideoConIphone>(null);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === videoRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function openFullscreen() {
    const video = videoRef.current;
    if (!video) return;
    if (typeof video.requestFullscreen === "function") {
      video.requestFullscreen().catch(() => {
        // Sin permiso del navegador para pantalla completa: se queda en el chat.
      });
    } else {
      try {
        video.webkitEnterFullscreen?.();
      } catch {
        // iPhone sin datos del video todavía: play() de abajo ya lo abre en su reproductor.
      }
    }
    video.play().catch(() => {
      // Reproducción bloqueada por el navegador: queda en pausa con sus controles.
    });
  }

  // Con nofullscreen Chrome ya no abre la pantalla completa con doble clic: se hace
  // aquí, solo con mouse (en el celular el doble toque sigue siendo de Chrome). Ya en
  // pantalla completa, el doble clic es de Chrome otra vez (sale).
  function onDoubleClick(event: MouseEvent<HTMLVideoElement>) {
    if (fullscreen || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (event.clientY > event.currentTarget.getBoundingClientRect().bottom - CONTROLES_PX) return;
    openFullscreen();
  }

  return (
    <div className="relative w-fit max-w-full">
      <video
        ref={videoRef}
        controls
        controlsList={fullscreen ? undefined : "nofullscreen"}
        // Esconden en la barra el botón en gris que deja nofullscreen y el de silenciar (app/globals.css).
        data-sin-pantalla-completa={fullscreen ? undefined : ""}
        data-video-chat=""
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onDoubleClick={onDoubleClick}
        className="block max-h-64 max-w-full min-w-52 rounded-md bg-black"
      />
      {!playing && (
        <button
          type="button"
          onClick={openFullscreen}
          aria-label="Pantalla completa"
          title="Pantalla completa"
          className="absolute top-1 right-1 rounded p-1.5 text-white focus-visible:outline-2 focus-visible:outline-white"
        >
          {/* Solo el ícono blanco (decisión del dueño); la sombra lo deja ver sobre un cuadro claro. */}
          <Maximize className="size-5 drop-shadow-[0_1px_2px_rgb(0_0_0/0.7)]" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
