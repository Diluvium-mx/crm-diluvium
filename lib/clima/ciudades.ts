// Ciudades de la cinta del clima (decisión del dueño, 2-oct-2026). PURO.
//
// Cómo se eligieron: de los 64 aeropuertos de México que reportan METAR, las ciudades donde más llueve
// en horario de trabajo (lun–sáb 9–19 Mazatlán; ≥ 1.5 % de las horas con lluvia, oct-2024 → sep-2026,
// archivo METAR del Iowa Environmental Mesonet) y que además tienen observatorio del SMN-Conagua en la
// misma ciudad (sin lluvia medida en mm, la ciudad no va). Ranking completo en
// ~/Documents/Diluvium CRM/reportes/clima-barra/. Tulancingo salió: su código MMTL hoy es el aeropuerto
// de Tulum (los catálogos traen el nombre viejo).
//
// `orden` = lugar en ese ranking (más lluvia primero). Las coordenadas son las del OBSERVATORIO (catálogo
// de estaciones de la NOAA, nsd_bbsss): con ellas se comprueba en cada consulta que el aeropuerto esté
// en la misma ciudad (lib/clima/armar.ts).

export type Ciudad = {
  nombre: string;
  /** Aeropuerto (METAR): icono y grados. */
  icao: string;
  /** Observatorio del SMN-Conagua (SYNOP): lluvia de las últimas 24 h. */
  wmo: string;
  lat: number;
  lon: number;
};

export const CIUDADES: readonly Ciudad[] = [
  { nombre: "Ciudad de México", icao: "MMMX", wmo: "76680", lat: 19.4, lon: -99.2 },
  { nombre: "Toluca", icao: "MMTO", wmo: "76675", lat: 19.3, lon: -99.667 },
  { nombre: "Colima", icao: "MMIA", wmo: "76658", lat: 19.267, lon: -103.583 },
  { nombre: "Mérida", icao: "MMMD", wmo: "76644", lat: 20.933, lon: -89.65 },
  { nombre: "Puebla", icao: "MMPB", wmo: "76685", lat: 19.05, lon: -98.167 },
  { nombre: "Tapachula", icao: "MMTP", wmo: "76903", lat: 14.917, lon: -92.267 },
  { nombre: "Villahermosa", icao: "MMVA", wmo: "76743", lat: 17.983, lon: -92.917 },
  { nombre: "Chetumal", icao: "MMCM", wmo: "76750", lat: 18.483, lon: -88.3 },
  { nombre: "Campeche", icao: "MMCP", wmo: "76695", lat: 19.85, lon: -90.55 },
  { nombre: "Tuxtla Gutiérrez", icao: "MMTG", wmo: "76843", lat: 16.75, lon: -93.117 },
  { nombre: "Tepic", icao: "MMEP", wmo: "76556", lat: 21.517, lon: -104.9 },
  { nombre: "Oaxaca", icao: "MMOX", wmo: "76775", lat: 17.067, lon: -96.717 },
  { nombre: "Morelia", icao: "MMMM", wmo: "76665", lat: 19.7, lon: -101.183 },
  { nombre: "Durango", icao: "MMDO", wmo: "76423", lat: 24.033, lon: -104.667 },
  { nombre: "Monterrey", icao: "MMMY", wmo: "76393", lat: 25.867, lon: -100.2 },
  { nombre: "Ciudad Victoria", icao: "MMCV", wmo: "76491", lat: 23.75, lon: -99.133 },
  { nombre: "Saltillo", icao: "MMIO", wmo: "76390", lat: 25.45, lon: -100.983 },
  { nombre: "Zacatecas", icao: "MMZC", wmo: "76525", lat: 22.783, lon: -102.567 },
  { nombre: "Tampico", icao: "MMTM", wmo: "76548", lat: 22.217, lon: -97.85 },
  { nombre: "Guadalajara", icao: "MMGL", wmo: "76612", lat: 20.667, lon: -103.383 },
  { nombre: "Acapulco", icao: "MMAA", wmo: "76805", lat: 16.833, lon: -99.933 },
  { nombre: "Veracruz", icao: "MMVR", wmo: "76692", lat: 19.15, lon: -96.117 },
  { nombre: "Aguascalientes", icao: "MMAS", wmo: "76571", lat: 21.883, lon: -102.3 },
  { nombre: "San Luis Potosí", icao: "MMSP", wmo: "76539", lat: 22.15, lon: -100.983 },
];
