// Texturas dibujadas en lienzo para la tormenta: la tela de la compuerta, sus dos etiquetas de atrás
// y el cuadro de la sala.
import { canvasTex } from "./kit";

// Tela de la compuerta: sarga fina (relieve) como en la foto del producto.
export function fabricBump() {
  return canvasTex(
    256,
    256,
    (x, w, h) => {
      x.fillStyle = "#808080";
      x.fillRect(0, 0, w, h);
      for (let i = -h; i < w; i += 3) {
        x.strokeStyle = i % 6 === 0 ? "#9a9a9a" : "#666";
        x.lineWidth = 1.2;
        x.beginPath();
        x.moveTo(i, 0);
        x.lineTo(i + h, h);
        x.stroke();
      }
      const img = x.getImageData(0, 0, w, h);
      for (let p = 0; p < img.data.length; p += 4) {
        const n = (Math.random() - 0.5) * 34;
        img.data[p] += n;
        img.data[p + 1] += n;
        img.data[p + 2] += n;
      }
      x.putImageData(img, 0, 0);
    },
    { color: false, repeat: [5, 3] },
  );
}

export function warnLabel() {
  return canvasTex(256, 160, (x, w, h) => {
    x.fillStyle = "#f6c31b";
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#111";
    x.fillRect(0, 0, w, 34);
    x.fillStyle = "#f6c31b";
    x.font = "bold 22px Helvetica, Arial";
    x.fillText("⚠ ADVERTENCIA", 16, 25);
    x.fillStyle = "#3a3a3a";
    for (let i = 0; i < 6; i++) x.fillRect(16, 48 + i * 17, i % 2 ? 120 : 150, 7);
    x.strokeStyle = "#111";
    x.lineWidth = 4;
    x.strokeRect(186, 56, 54, 54);
    x.beginPath();
    x.moveTo(213, 64);
    x.lineTo(234, 102);
    x.lineTo(192, 102);
    x.closePath();
    x.stroke();
  });
}

export function qrLabel() {
  return canvasTex(200, 280, (x, w, h) => {
    x.fillStyle = "#fff";
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#2a63c4";
    x.fillRect(0, 0, w, 36);
    x.fillRect(0, h - 30, w, 30);
    x.fillStyle = "#fff";
    x.font = "bold 18px Helvetica, Arial";
    x.fillText("ADVERTENCIA", 26, 25);
    const n = 21;
    const s = 6;
    const ox = (w - n * s) / 2;
    const oy = 58;
    x.fillStyle = "#111";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (Math.random() < 0.45) x.fillRect(ox + c * s, oy + r * s, s, s);
    const finder = (fx: number, fy: number) => {
      x.fillStyle = "#111";
      x.fillRect(fx, fy, 7 * s, 7 * s);
      x.fillStyle = "#fff";
      x.fillRect(fx + s, fy + s, 5 * s, 5 * s);
      x.fillStyle = "#111";
      x.fillRect(fx + 2 * s, fy + 2 * s, 3 * s, 3 * s);
    };
    finder(ox, oy);
    finder(ox + 14 * s, oy);
    finder(ox, oy + 14 * s);
    x.fillStyle = "#555";
    x.fillRect(30, 200, 140, 8);
    x.fillRect(46, 216, 108, 8);
  });
}

// El cuadro de la sala: un paisaje sencillo.
export function paintingTex() {
  return canvasTex(256, 180, (x, w, h) => {
    const sky = x.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, "#9cc7ea");
    sky.addColorStop(1, "#e8f1f7");
    x.fillStyle = sky;
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#2f6db0";
    x.fillRect(0, h * 0.62, w, h * 0.38);
    x.fillStyle = "#f2c94c";
    x.beginPath();
    x.arc(w * 0.75, h * 0.25, 18, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#3b7d4f";
    x.beginPath();
    x.moveTo(0, h * 0.62);
    x.lineTo(w * 0.35, h * 0.3);
    x.lineTo(w * 0.62, h * 0.62);
    x.fill();
  });
}
