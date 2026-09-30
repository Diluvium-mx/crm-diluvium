"use client";

// Video del chat (Bandeja y pop-up del Embudo): el reproductor de siempre más el
// ícono de pantalla completa en la esquina de arriba a la derecha, para no ir a
// ⋮ › Pantalla completa (en un video vertical Chrome esconde ahí su botón). Se ve
// en pausa o al terminar y se oculta mientras el video corre; al picarle, el
// video llena la pantalla y empieza a reproducirse.
import { Maximize } from "lucide-react";
import { useRef, useState } from "react";

// iPhone no tiene requestFullscreen en el video: usa su propio reproductor.
type VideoConIphone = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

export function VideoAttachment({ src }: { src: string }) {
  const videoRef = useRef<VideoConIphone>(null);
  const [playing, setPlaying] = useState(false);

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

  return (
    <div className="relative w-fit max-w-full">
      <video
        ref={videoRef}
        controls
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="block max-h-64 max-w-full rounded-md"
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
