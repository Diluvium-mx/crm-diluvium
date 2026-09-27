// Los 22 mensajes rápidos de Diluvium (lista final del dueño, 27-sep-2026), que
// carga `npm run mensajes-rapidos:cargar`. Textos EXACTOS: no se corrigen aquí;
// si el dueño cambia uno, se edita en la sección Mensajes rápidos o aquí y se
// vuelve a correr el script (actualiza por nombre). Sin variables: "Daniel" va
// escrito tal cual.
import type { DesiredSnippet } from "./carga";

export const MENSAJES_RAPIDOS_DILUVIUM: DesiredSnippet[] = [
  {
    name: "A través de",
    body: "A través de WhatsApp (por aquí), de nuestra página web, de Amazon o de Mercado Libre 🛒",
  },
  {
    name: "Buenas tardes 🌅",
    body: "Hola, buenas tardes. Aquí Daniel, de Diluvium 🌅",
    // Ya existe en producción con el nombre sin emoji: se actualiza (nombre y
    // texto), no se duplica.
    previousNames: ["Buenas tardes"],
  },
  {
    name: "Buenos días",
    body: "Hola, muy buenos días. Aquí Daniel, de Diluvium ☀️",
  },
  {
    name: "Cuánta agua entra",
    body: "Aproximadamente, ¿cuánta agua entra a su domicilio cuando llueve fuerte? ¿Unos 5 cm, 20 cm o 40 cm?",
  },
  {
    name: "Datos de envío",
    body: [
      "También necesitaremos los datos de envío:",
      "Nombre de quien recibe",
      "Dirección",
      "Código postal",
      "Teléfono",
      "Correo electrónico",
    ].join("\n"),
  },
  {
    name: "Disculpa",
    body: "Una disculpa por la demora.",
  },
  {
    name: "Entradas",
    body: "¿Cuántas entradas necesitaría proteger?",
  },
  {
    name: "Entrega en Mochis",
    body: "También entregamos en Los Mochis: cualquier tamaño en $5,500, con envío incluido.",
  },
  {
    name: "Está hecha de",
    body:
      "Está hecha de acero y tiene un gato mecánico en el centro que hace que se expanda. Está cubierta con una " +
      "funda impermeable de neopreno y cuenta con unas láminas de PVC que le dan soporte.",
  },
  {
    name: "Foto Entrada 📸",
    body:
      "También nos serviría que nos enviara una foto de su entrada, donde se vean los marcos y el piso, para " +
      "verificar que tenga espacio suficiente para colocarla 📸",
  },
  {
    name: "Habría",
    body: "Habría que medir el ancho de su entrada para ver qué tamaño de compuerta le serviría ☝🏽",
  },
  {
    name: "Info",
    body:
      "Es una barrera que se coloca en la entrada de una casa o negocio en 10 minutos; se expande hasta sellar " +
      "el contorno y bloquea el paso del agua para evitar inundaciones. Está hecha de acero y cubierta con una " +
      "funda impermeable.",
  },
  {
    name: "ME",
    body:
      "Las tenemos en $7,000 con envío gratis. Pedimos el 50 % para empezar a fabricarlas ($3,500) y el resto " +
      "cuando estén listas; tardamos aproximadamente 3 semanas.",
  },
  {
    name: "MSI - TDC 💳",
    body: "Contamos con hasta 6 meses sin intereses pagando con cualquier tarjeta de crédito 💳",
  },
  {
    name: "Pagos",
    body: [
      "Tenemos dos métodos de pago:",
      "1. Depósito o transferencia (le mandaríamos los datos bancarios).",
      "2. Tarjeta de crédito o débito a través de Mercado Pago (la plataforma de pagos de Mercado Libre).",
    ].join("\n"),
  },
  {
    name: "Por nada días",
    body: "¡Por nada! Quedamos al pendiente para cualquier cosa. ¡Bonito día! 🌞",
  },
  {
    name: "Por nada tardes",
    body: "¡Por nada! Quedamos al pendiente para cualquier cosa. ¡Bonita tarde! 🌅",
  },
  {
    name: "Precio",
    body: "Ahorita tenemos cualquier tamaño en $5,500 con envío gratis.",
  },
  {
    name: "Prevención",
    body:
      "Normalmente nos las piden personas que ya tienen problemas de inundaciones, porque las compuertas son " +
      "altas, pero le servirían mucho en caso de un huracán o de lluvias muy prolongadas.",
  },
  {
    name: "Tenemos",
    body:
      "Tenemos varios tamaños de compuertas, según qué tan ancha sea la entrada. Las estándar miden 60 cm de " +
      "alto y las mini, 30 cm.",
  },
  {
    name: "Ubicación",
    body: "Nos ubicamos en Los Mochis, Sinaloa. Aquí se fabrican, y más del 95 % se envía a otras ciudades del país.",
  },
  {
    name: "Usted",
    body: "¿Usted tiene problemas de inundaciones?",
  },
];
