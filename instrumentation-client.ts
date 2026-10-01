// Corre en el NAVEGADOR antes que el código de cualquier página (Next.js).
//
// Zod 4 prueba `new Function("")` al crear su primer z.object() para decidir si
// "compila" sus validadores (JIT), y los compila con `new Function` al validar.
// La CSP no permite 'unsafe-eval' (S2, CN-004): salía un aviso en cada carga de
// Bandeja, Embudo, Automatización y Agente IA, y otro al validar una FAQ
// (1-oct-2026). jitless: sin prueba ni compilación; mismas validaciones y mismos
// mensajes. El servidor y el worker no cargan este archivo: siguen con JIT.
import { config } from "zod/v4/core";
import { vigilarFallas } from "@/lib/version/client";

config({ jitless: true });

// Aviso «Hay una nueva actualización del CRM» (1-oct-2026): vigila desde el arranque las
// fallas que pueden venir de una pestaña vieja (lib/version/client.ts).
vigilarFallas();
