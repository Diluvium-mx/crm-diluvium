// Cambia un tramo del texto de una <textarea> como si el vendedor lo hubiera escrito:
// dispara el mismo `input` que React escucha (el onChange de cada caja sigue igual) y
// Cmd+Z lo deshace.
export function replaceTextareaRange(ta: HTMLTextAreaElement, start: number, end: number, text: string): void {
  ta.focus();
  ta.setSelectionRange(start, end);
  if (document.execCommand("insertText", false, text)) return;
  // Navegadores sin insertText: se pone el valor y se avisa a React a mano.
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setValue?.call(ta, ta.value.slice(0, start) + text + ta.value.slice(end));
  ta.setSelectionRange(start + text.length, start + text.length);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
