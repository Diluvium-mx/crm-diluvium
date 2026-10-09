> Parte del [Mapa del CRM](../mapa-crm.md) (índice con todas las secciones). Las capturas están en esta misma carpeta.

## 4. Cómo pedir un cambio

### La plantilla de una línea

> **Pestaña › sección › número › qué quiero**

Si el número está en una tabla con subsecciones (Bandeja › Chat, Bandeja › Detalle…), nombra la subsección. Con eso
Code sabe exactamente qué pieza tocar; no hace falta explicar nada más.

### 5 ejemplos reales

1. "Bandeja › (10) chip de etapa › que diga «Cerca de compra» y no «cerca_compra»."
2. "Agente IA › Historial › (73) tipo › agregar «Tallas y medidas»."
3. "Embudo › (2) columna de etapa › mostrar el total en pesos cotizado de esa columna."
4. "Bandeja › Detalle del contacto › (24) menú de pausa › agregar «Pausar 2 horas»."
5. "Dashboard › (3) tarjeta del proveedor › avisarme en naranja cuando el saldo baje de US$5."

### Qué NO tocar sin pensarlo

| Qué | Por qué |
|---|---|
| **Cambiar el modelo** (Agente IA › 5–11) | Cambia cuánto cuesta cada respuesta y cómo contesta Ángela. Pruébalo primero con el número de prueba. |
| **Apagar el canal** (Agente IA › 50) | El agente deja de contestar a **todos** en ese número. Para un solo cliente usa **Pausar agente** en el Detalle. |
| **Editar o borrar el Goal o las FAQs** (Agente IA › 13–27) | Es lo único que sigue el agente. Si algo sale mal, **Restaurar** (20) regresa una versión anterior. |
| **Pausar al Agente IA cuando un vendedor contesta = No** (Agente IA › 30) | El agente seguiría contestando aunque un vendedor ya tomó el chat. |
| **Tallas y medidas** (Agente IA › 40–46) | Cambia el tamaño sugerido en todos los contactos y lo que cotiza el agente. |
| **Apagar o borrar un workflow o su archivo** (Automatización › 5, 38) | El agente deja de mandar ese material (tabla, datos bancarios, videos). |
| **▷ Probar un workflow** (Automatización › 14) | Manda mensajes de verdad a la conversación elegida. |
| **Crear o editar plantillas** (Mensajes rápidos › 19, 25) | Van a revisión de Meta y, mientras tanto, no se pueden mandar; la categoría cambia lo que cobra Meta. |
| **Borrar una plantilla** (Mensajes rápidos › 27) | Se borra en Meta; el nombre no se puede volver a usar en 30 días. |
| **Borrar una recarga** (Dashboard › 9) | Cambia el saldo de Anthropic, OpenAI o Google (xAI y OpenRouter dan su saldo directo). |
| **Desactivar o cambiar el rol de alguien** (Configuración › 4, 7) | Le cambia lo que puede ver o hacer de inmediato. |

---

<sub>Mantenimiento (regla en CLAUDE.md): cada cambio que toque la interfaz actualiza esta guía y su captura en el
mismo commit, conservando los números existentes; lo nuevo toma el siguiente número de su sección. Capturas con
datos de ejemplo en una base local, sin datos de clientes.</sub>
