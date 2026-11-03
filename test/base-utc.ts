// Las pruebas de integración se conectan a la base SIEMPRE en UTC (2-nov-2026).
//
// Las columnas de fecha del CRM son `timestamp` SIN zona y guardan la hora UTC, como la base de Railway
// (producción y staging). Una base local de Homebrew toma la zona de la Mac (America/Mazatlan): lo que fecha
// la base (`defaultNow()`, `now()`) queda 7 h antes de lo que fecha Node (`new Date()`), y el orden y las
// ventanas de tiempo salen mal. Así fallaron 24 pruebas que en Railway pasan, en una base creada sin
// `alter database … set timezone to 'UTC'`. postgres.js manda los parámetros desconocidos de la URL como
// parámetros de la sesión, así que basta `TimeZone=UTC` en TEST_DATABASE_URL (también lo heredan los
// scripts que las pruebas corren con tsx). El CRM no cambia: solo la conexión de las pruebas.
const url = process.env.TEST_DATABASE_URL;
if (url && !/[?&]timezone=/i.test(url)) {
  process.env.TEST_DATABASE_URL = `${url}${url.includes("?") ? "&" : "?"}TimeZone=UTC`;
}
