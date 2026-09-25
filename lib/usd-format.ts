// Dólares para la UI con el formato que usa el dueño: "US$14.20" (Intl con
// currency USD en es-MX da "USD 14.20"). PURO y seguro para el cliente.
const amount = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatUsd(usd: number): string {
  const sign = usd < 0 ? "−" : "";
  return `${sign}US$${amount.format(Math.abs(usd))}`;
}
