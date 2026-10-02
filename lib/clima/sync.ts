// Actualización del clima en el worker (decisión del dueño, 2-oct-2026): una vez por hora, solo en
// horario de trabajo. El worker llama cada 5 min; aquí se decide si toca. Empieza a las 8:50 para que a
// las 9:00 la cinta ya tenga datos frescos. Si una consulta falla, la foto anterior se queda (la cinta la
// esconde sola a las 2 h) y se reintenta en 15 min, no en cada vuelta. Una respuesta vacía también es falla.
import { isBusinessHours } from "@/lib/monitoring/business-hours";
import { CIUDADES } from "./ciudades";
import { armarFoto } from "./armar";
import { bajarMetar, bajarSynop } from "./fuentes";
import { guardarFotoClima, leerFotoClima } from "./store";

const CADA_MS = 55 * 60_000;
const REINTENTO_MS = 15 * 60_000;
const ANTICIPO_MS = 10 * 60_000;

let ultimoFallo = 0;

/** true si trajo y guardó una foto nueva. */
export async function actualizarClima(ahora = new Date()): Promise<boolean> {
  if (!isBusinessHours(new Date(ahora.getTime() + ANTICIPO_MS))) return false;
  if (ahora.getTime() - ultimoFallo < REINTENTO_MS) return false;
  const anterior = await leerFotoClima();
  if (anterior && ahora.getTime() - Date.parse(anterior.generado) < CADA_MS) return false;
  try {
    const [metar, synop] = await Promise.all([bajarMetar(CIUDADES), bajarSynop(ahora)]);
    // Una respuesta sin reportes (aviso de límite, página de error con 200) es una falla: no se pisa la
    // foto buena anterior con una vacía y se reintenta en 15 min.
    if (!metar.length) throw new Error("aviationweather.gov no devolvió reportes");
    if (!synop.size) throw new Error("OGIMET no devolvió reportes de los observatorios");
    const foto = armarFoto({ ciudades: CIUDADES, metar, synop, ahora });
    if (!foto.ciudades.length) {
      throw new Error(`ninguna ciudad pasó las revisiones (${foto.fuera.map((f) => `${f.nombre}: ${f.motivo}`).join("; ")})`);
    }
    await guardarFotoClima(foto);
    console.info(`[clima] ${foto.ciudades.length} ciudad(es) en la cinta`);
    for (const f of foto.fuera) console.warn(`[clima] fuera esta hora: ${f.nombre} (${f.motivo})`);
    return true;
  } catch (error) {
    ultimoFallo = ahora.getTime();
    throw error;
  }
}
