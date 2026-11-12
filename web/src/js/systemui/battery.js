// Port of SystemUI BatteryMeterView.draw() to <canvas>, fed by the Battery Status API.
const BOLT = [73, 0, 392, 0, 201, 259, 442, 259, 4, 703, 157, 334, 0, 334]; // res/values/arrays.xml batterymeter_bolt_points
const BOLT_LEVEL_THRESHOLD = 0.3, FULL = 96, CRITICAL = 4, BUTTON_FRACTION = 0.105;
const maxX = Math.max(...BOLT.filter((_, i) => i % 2 === 0)), maxY = Math.max(...BOLT.filter((_, i) => i % 2 === 1));
const BOLT_POINTS = BOLT.map((v, i) => v / (i % 2 === 0 ? maxX : maxY));

export const battery = { level: 100, plugged: true, known: false, listeners: [] };
(async () => {
  try {
    const b = await navigator.getBattery();
    const upd = () => { battery.level = Math.round(b.level * 100); battery.plugged = b.charging; battery.known = true; battery.listeners.forEach(f => f()); };
    b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd); upd();
  } catch { battery.level = 87; battery.plugged = false; }
})();

export function drawBattery(canvas, { level, plugged, frameColor = 'rgba(255,255,255,0.4)', color = '#fff', showPercent = false }) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 9.5, H = canvas.clientHeight || 15;
  canvas.width = W * dpr * 2; canvas.height = H * dpr * 2;
  const c = canvas.getContext('2d');
  c.setTransform(dpr * 2, 0, 0, dpr * 2, 0, 0);
  c.clearRect(0, 0, W, H);
  let drawFrac = level / 100;
  const buttonHeight = Math.floor(H * BUTTON_FRACTION);
  const button = { l: Math.round(W * 0.25), t: 0, r: W - Math.round(W * 0.25), b: buttonHeight };
  const frame = { l: 0, t: buttonHeight, r: W, b: H };
  if (level >= FULL) drawFrac = 1; else if (level <= CRITICAL) drawFrac = 0;
  const levelTop = drawFrac === 1 ? button.t : frame.t + (frame.b - frame.t) * (1 - drawFrac);
  const shape = new Path2D();
  shape.moveTo(button.l, button.t); shape.lineTo(button.r, button.t); shape.lineTo(button.r, frame.t); shape.lineTo(frame.r, frame.t);
  shape.lineTo(frame.r, frame.b); shape.lineTo(frame.l, frame.b); shape.lineTo(frame.l, frame.t); shape.lineTo(button.l, frame.t); shape.closePath();
  const levelColor = !plugged && level <= 15 ? '#ff7043' : color;
  c.fillStyle = frameColor; c.fill(shape);
  c.save(); c.beginPath(); c.rect(0, levelTop, W, H); c.clip(); c.fillStyle = levelColor; c.fill(shape); c.restore();
  if (plugged) {
    const fw = frame.r - frame.l, fh = frame.b - frame.t;
    const bl = frame.l + fw / 4.5, bt = frame.t + fh / 6, br = frame.r - fw / 7, bb = frame.b - fh / 10;
    const bolt = new Path2D();
    bolt.moveTo(bl + BOLT_POINTS[0] * (br - bl), bt + BOLT_POINTS[1] * (bb - bt));
    for (let i = 2; i < BOLT_POINTS.length; i += 2) bolt.lineTo(bl + BOLT_POINTS[i] * (br - bl), bt + BOLT_POINTS[i + 1] * (bb - bt));
    bolt.closePath();
    const boltPct = Math.min(Math.max((bb - levelTop) / (bb - bt), 0), 1);
    if (boltPct <= BOLT_LEVEL_THRESHOLD) { c.fillStyle = color; c.fill(bolt); }
    else { c.globalCompositeOperation = 'destination-out'; c.fill(bolt); c.globalCompositeOperation = 'source-over'; }
  } else if (showPercent && level > CRITICAL && level < 100) {
    c.font = `bold ${H * 0.5}px Roboto, sans-serif`; c.textAlign = 'center';
    c.globalCompositeOperation = 'destination-out';
    c.fillText(String(level), W / 2, (H + H * 0.5) * 0.47);
    c.globalCompositeOperation = 'source-over';
  }
}
