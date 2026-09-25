// Ciudad por lada para las ladas donde Google (lib/phone-lada-data.ts) NO trae la
// ciudad: solo el estado (667/668/669 → "Sinaloa") o nada (664, 597). Mantenido a
// mano; lo usa lib/phone-lada.ts.
//
// Regla: una lada entra aquí SOLO si estas dos listas públicas le dan la MISMA
// ciudad; si no coinciden o una no la trae, se queda lo de Google (estado o nada).
//   1. Expansión, "¿De dónde es la LADA que me llama? Catálogo de claves de todo
//      México" (3-sep-2024):
//      https://expansion.mx/finanzas-personales/2024/09/03/de-donde-es-la-lada-catalogo-de-claves
//   2. ADN40, "De dónde es la LADA: La lista completa para identificar las llamadas
//      en México" (29-abr-2024, actualizada 3-nov-2025):
//      https://www.adn40.mx/mexico/la-lista-completa-todas-las-lada-mexico/
// Consultadas el 25-sep-2026: las dos traen las mismas 173 ladas con la misma
// ciudad (parecen salir de la misma fuente, así que coincidir no es prueba
// independiente). De esas 173, aquí solo van las 84 que llenan un hueco de Google;
// donde Google ya da la ciudad, manda Google.
//
// - El ESTADO no viene de las listas: lo pone lib/phone-lada.ts a partir de Google
//   ("Sinaloa" → "Los Mochis, Sin."). Si Google no trae la lada (664, 597) o da dos
//   estados (427, 867), se muestra solo la ciudad.
// - Fuera: 891. Las dos listas dicen "Santa Rosalía" (la de Baja California Sur,
//   cuya lada es la 615), pero Google pone la 891 en Tamaulipas: se queda Tamaulipas.
// - Solo se corrigió la ortografía de las listas (acentos y mayúsculas: Guamúchil,
//   Puruándiro, Zinapécuaro, Zitácuaro, Valle de Bravo, Parras de la Fuente, Nuevo
//   Casas Grandes); ninguna ciudad cambió.
export const LADA_CITIES: Readonly<Record<string, string>> = {
  "222": "Puebla",
  "243": "Izúcar de Matamoros",
  "244": "Atlixco",
  "246": "Tlaxcala",
  "271": "Córdoba",
  "287": "Tuxtepec",
  "294": "San Andrés Tuxtla",
  "311": "Tepic",
  "313": "Tecomán",
  "322": "Puerto Vallarta",
  "323": "Santiago Ixcuintla",
  "324": "Estancia de los López",
  "353": "Sahuayo",
  "354": "Los Reyes",
  "374": "Tequila",
  "378": "Tepatitlán de Morelos",
  "389": "Tecuala",
  "393": "La Barca",
  "427": "San Juan del Río",
  "438": "Puruándiro",
  "442": "Querétaro",
  "451": "Zinapécuaro",
  "461": "Celaya",
  "466": "Salvatierra",
  "487": "Río Verde",
  "488": "Matehuala",
  "492": "Zacatecas",
  "591": "Zumpango",
  "595": "Texcoco",
  "597": "Amecameca",
  "613": "Ciudad Constitución",
  "614": "Chihuahua",
  "615": "Guerrero Negro",
  "624": "Cabo San Lucas",
  "625": "Ciudad Cuauhtémoc",
  "633": "Agua Prieta",
  "634": "Nacozari",
  "636": "Nuevo Casas Grandes",
  "639": "Ciudad Delicias",
  "644": "Ciudad Obregón",
  "646": "Ensenada",
  "647": "Huatabampo",
  "656": "Ciudad Juárez",
  "662": "Hermosillo",
  "664": "Tijuana",
  "667": "Culiacán",
  "668": "Los Mochis",
  "669": "Mazatlán",
  "673": "Guamúchil",
  "676": "Guadalupe Victoria",
  "686": "Mexicali",
  "687": "Guasave",
  "714": "Tenancingo",
  "715": "Zitácuaro",
  "722": "Toluca",
  "726": "Valle de Bravo",
  "727": "Huitzuco",
  "732": "Arcelia",
  "734": "Jojutla",
  "736": "Teloloapan",
  "747": "Chilpancingo",
  "754": "Mochitlán",
  "767": "Ciudad Altamirano",
  "773": "Tula",
  "777": "Cuernavaca",
  "826": "Montemorelos",
  "841": "San Fernando",
  "842": "Parras de la Fuente",
  "862": "Allende",
  "867": "Nuevo Laredo",
  "868": "Matamoros",
  "871": "Torreón",
  "899": "Reynosa",
  "917": "Huimanguillo",
  "922": "Minatitlán",
  "951": "Oaxaca",
  "958": "Bahía de Huatulco",
  "961": "Tuxtla Gutiérrez",
  "962": "Tapachula",
  "965": "Villaflores",
  "971": "Juchitán",
  "983": "Chetumal",
  "993": "Villahermosa",
  "998": "Cancún",
};
