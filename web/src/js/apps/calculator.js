// packages/apps/Calculator (Lollipop) - port of Calculator.java, CalculatorExpressionBuilder,
// CalculatorExpressionTokenizer and CalculatorExpressionEvaluator. The arity library
// (org.javia.arity) is replaced by a small recursive-descent evaluator.
import { h, drag, clamp } from '../core/dom.js';
import { App, registerApp } from '../core/system.js';
import { click } from '../core/sound.js';

const MAX_DIGITS = 12, ROUNDING_DIGITS = 2;
const LOCAL = [['/', '÷'], ['*', '×'], ['-', '−'], ['Infinity', '∞']];
const normalize = s => LOCAL.reduce((a, [n, l]) => a.split(l).join(n), s);
const localize = s => LOCAL.reduce((a, [n, l]) => a.split(n).join(l), s);

// --- org.javia.arity.Symbols.eval replacement
class SyntaxError_ extends Error {}
function evaluate(expr) {
  let i = 0;
  const s = expr.replace(/\s+/g, '');
  const peek = () => s[i];
  const eat = c => { if (s.startsWith(c, i)) { i += c.length; return true; } return false; };
  const fact = n => { if (n < 0 || n !== Math.floor(n)) return gamma(n + 1); let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; };
  const gamma = z => { // Lanczos
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1; const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    let x = c[0]; for (let k = 1; k < g + 2; k++) x += c[k] / (z + k); const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  };
  const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10, '√': Math.sqrt, sqrt: Math.sqrt };
  function primary() {
    if (eat('(')) { const v = sum(); eat(')'); return v; } // unbalanced closing parens are allowed, like arity
    if (eat('π') || eat('pi')) return Math.PI;
    for (const f of Object.keys(FN)) if (s.startsWith(f, i)) { i += f.length; const v = f === '√' && peek() !== '(' ? unary() : (eat('(') ? (() => { const r = sum(); eat(')'); return r; })() : unary()); return FN[f](v); }
    if (peek() === 'e' && !/[0-9]/.test(s[i + 1] || '')) { i++; return Math.E; }
    const m = /^(\d+\.?\d*|\.\d+)(E[-+]?\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return parseFloat(m[0]); }
    if (s.startsWith('Infinity', i)) { i += 8; return Infinity; }
    throw new SyntaxError_();
  }
  function postfix() {
    let v = primary();
    for (;;) {
      if (eat('!')) v = fact(v);
      else if (eat('%')) v = v / 100;
      else break;
    }
    return v;
  }
  function power() {
    const b = postfix();
    if (eat('^')) return Math.pow(b, unary());
    return b;
  }
  function unary() { if (eat('-')) return -unary(); if (eat('+')) return unary(); return power(); }
  function product() {
    let v = unary();
    for (;;) {
      if (eat('*')) v *= unary();
      else if (eat('/')) v /= unary();
      else if (i < s.length && /[0-9.(πe√slct]/.test(peek()) && !s.startsWith('E', i)) v *= unary(); // implicit multiplication
      else return v;
    }
  }
  function sum() {
    let v = product();
    for (;;) { if (eat('+')) v += product(); else if (eat('-')) v -= product(); else return v; }
  }
  const v = sum();
  while (eat(')'));
  if (i !== s.length) throw new SyntaxError_();
  return v;
}

// --- org.javia.arity.Util.doubleToString(v, maxLen, rounding)
function doubleToString(v, maxLen = MAX_DIGITS, rounding = ROUNDING_DIGITS) {
  if (!isFinite(v)) return v > 0 ? 'Infinity' : v < 0 ? '-Infinity' : 'NaN';
  if (v === 0) return '0';
  const rounded = parseFloat(v.toPrecision(17 - rounding - 2));
  let str = String(parseFloat(rounded.toPrecision(Math.max(1, maxLen))));
  if (str.includes('e')) {
    let [mant, exp] = rounded.toExponential(Math.max(0, maxLen - 6)).split('e');
    mant = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant;
    str = mant + 'E' + exp.replace('+', '');
  }
  if (str.replace('-', '').replace('.', '').length > maxLen && !str.includes('E')) {
    const intLen = Math.abs(Math.trunc(rounded)).toString().length;
    if (intLen > maxLen) { const [mant, exp] = rounded.toExponential(maxLen - 5).split('e'); str = mant.replace(/\.?0+$/, '') + 'E' + exp.replace('+', ''); }
    else str = String(parseFloat(rounded.toFixed(Math.max(0, maxLen - intLen - (rounded < 0 ? 1 : 0)))));
  }
  return str;
}

class Calculator extends App {
  onCreate(root) {
    this.state = 'INPUT';
    this.isEdited = false;
    this.formula = h('div.calc-formula');
    this.result = h('div.calc-result');
    this.display = h('div.calc-display', null, this.formula, this.result);
    const btn = (label, cls, fn) => {
      const b = h('button.calc-btn.rip' + (cls ? '.' + cls : ''), { onclick: () => { click(); fn ? fn(b) : this.append(label); } }, label);
      return b;
    };
    const num = h('div.pad-numeric', null, ...['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0'].map(d => btn(d)),
      btn('=', 'eq', b => this.onEquals(b)));
    this.delBtn = btn('DEL', 'small', () => this.onDelete());
    this.clrBtn = btn('CLR', 'small', b => this.onClear(b));
    this.clrBtn.hidden = true;
    let lp; this.delBtn.addEventListener('pointerdown', () => { lp = setTimeout(() => this.onClear(this.delBtn), 600); });
    this.delBtn.addEventListener('pointerup', () => clearTimeout(lp));
    const ops = h('div.pad-operator', null, this.delBtn, this.clrBtn, btn('÷', null, () => this.append('÷')), btn('×', null, () => this.append('×')), btn('−', null, () => this.append('−')), btn('+'));
    const fn = (l, ins) => btn(l, 'adv', () => this.append(ins || l));
    this.adv = h('div.pad-advanced', null, fn('sin', 'sin('), fn('cos', 'cos('), fn('tan', 'tan('), fn('ln', 'ln('), fn('log', 'log('), fn('!'), fn('π'), fn('e'), fn('^'), fn('('), fn(')'), fn('√'));
    this.pads = h('div.calc-pads', null, num, ops, this.adv);
    root.append(h('div.calculator', null, this.display, this.pads));
    // ViewPager-like swipe for the advanced pad
    let open = false, w0 = 0;
    const setAdv = (v, anim = true) => { open = v; this.adv.style.transition = anim ? 'transform 250ms cubic-bezier(0,0,.2,1)' : 'none'; this.adv.style.transform = v ? 'translateX(0)' : ''; this.pads.classList.toggle('adv-open', v); };
    this.setAdv = setAdv;
    drag(this.pads, { axis: 'x', start: () => { w0 = this.adv.offsetWidth; }, move: dx => { const base = open ? 0 : w0 - 24; this.adv.style.transition = 'none'; this.adv.style.transform = `translateX(${clamp(base + dx, 0, w0 - 24)}px)`; },
      end: (dx, dy, vx) => setAdv(open ? !(dx > w0 / 3 || vx > 0.4) : (dx < -w0 / 3 || vx < -0.4)) });
    this.adv.addEventListener('click', e => { if (!open && e.target === this.adv) setAdv(true); });
    this.keyHandler = e => {
      if (this.sys.current !== this.task || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
      const map = { '*': '×', '/': '÷', '-': '−' };
      if (/^[0-9.+\-*/^()!%]$/.test(e.key)) { this.append(map[e.key] || e.key); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === '=') { this.onEquals(this.pads.querySelector('.eq')); e.preventDefault(); }
      else if (e.key === 'Backspace') { this.onDelete(); e.preventDefault(); }
      else if (e.key === 'Delete') this.onClear(this.delBtn);
    };
    window.addEventListener('keydown', this.keyHandler);
    this.setState('INPUT', true);
    this.render();
  }
  onDestroy() { window.removeEventListener('keydown', this.keyHandler); }
  onBack() { if (this.pads.classList.contains('adv-open')) { this.setAdv(false); return true; } return false; }

  setState(s, force) {
    if (this.state === s && !force) return;
    this.state = s;
    const done = s === 'RESULT' || s === 'ERROR';
    this.delBtn.hidden = done; this.clrBtn.hidden = !done;
    this.display.classList.toggle('error', s === 'ERROR');
    this.setStatusBarColor(s === 'ERROR' ? '#F40056' : '#00BCD4');
  }
  get text() { return this.formula.textContent; }
  set text(v) { this.formula.textContent = v; this.fitText(); }
  fitText() { const len = this.text.length; this.formula.style.fontSize = (len > 14 ? Math.max(28, 64 * 14 / len) : 64) + 'px'; }

  // CalculatorExpressionBuilder.replace() for appends
  append(input) {
    if (this.state !== 'INPUT') { this.setState('INPUT'); this.result.textContent = ''; }
    let expr = normalize(this.text), add = normalize(input), start = expr.length;
    if (add.length === 1) {
      switch (add) {
        case '.': { const idx = expr.lastIndexOf('.'); if (idx !== -1 && /^\d*$/.test(expr.slice(idx + 1))) add = ''; break; }
        case '+': case '*': case '/':
          if (start === 0) { add = ''; break; }
          while (start > 0 && '+-*/'.includes(expr[start - 1])) --start;
        // fall through
        case '-':
          if (start > 0 && '+-'.includes(expr[start - 1])) --start;
          this.isEdited = true;
          break;
      }
    }
    if (!this.isEdited && add.length > 0) { start = 0; this.isEdited = true; }
    this.text = localize(expr.slice(0, start) + add);
    this.render();
  }
  onDelete() { if (this.state !== 'INPUT') this.setState('INPUT'); this.text = this.text.slice(0, -1); this.isEdited = true; this.render(); }

  eval(exprIn) {
    let expr = normalize(exprIn);
    while (expr.length && '+-/*'.includes(expr[expr.length - 1])) expr = expr.slice(0, -1);
    if (!expr.length || /^-?\d*\.?\d+$/.test(expr)) return { result: null };
    try {
      const v = evaluate(expr);
      if (Number.isNaN(v)) return { error: 'Not a number' };
      return { result: localize(doubleToString(v)) };
    } catch { return { error: 'Error' }; }
  }
  render() {
    if (this.state !== 'INPUT') return;
    const r = this.eval(this.text);
    this.result.textContent = r.result || '';
  }
  onEquals(btn) {
    if (this.state !== 'INPUT') return;
    this.setState('EVALUATE');
    const r = this.eval(this.text);
    if (r.error) this.reveal(btn, '#F40056', () => { this.setState('ERROR'); this.result.textContent = r.error; });
    else if (r.result) this.onResult(r.result);
    else this.setState('INPUT');
  }
  onResult(result) {
    // animate the result up into the formula's place (Calculator.onResult)
    const fr = this.formula.getBoundingClientRect(), rr = this.result.getBoundingClientRect();
    const k = this.display.getBoundingClientRect().width / this.display.offsetWidth || 1;
    const dy = (fr.bottom - rr.bottom) / k;
    const scale = 64 / parseFloat(getComputedStyle(this.result).fontSize);
    const a = this.result.animate([{ transform: 'none' }, { transform: `translateY(${dy}px) scale(${scale})`, color: 'rgba(0,0,0,0.54)' }], { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)', transformOrigin: 'right bottom' });
    this.result.style.transformOrigin = 'right bottom';
    this.formula.animate([{ transform: 'none' }, { transform: `translateY(${-fr.bottom / k}px)` }], { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)' });
    a.finished.then(() => { this.text = result; this.result.textContent = ''; this.isEdited = false; this.setState('RESULT'); });
  }
  onClear(btn) {
    if (!this.text) return;
    this.reveal(btn, '#00BCD4', () => { this.text = ''; this.result.textContent = ''; this.isEdited = false; this.setState('INPUT'); });
  }
  reveal(source, color, done) {
    const d = this.display.getBoundingClientRect(), s = source.getBoundingClientRect();
    const k = d.width / this.display.offsetWidth || 1;
    const cx = (s.left + s.width / 2 - d.left) / k, cy = (s.top + s.height / 2 - d.top) / k;
    const W = this.display.offsetWidth, H = this.display.offsetHeight;
    const R = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, cy - H), Math.hypot(W - cx, cy - H));
    const v = h('div.calc-reveal', { style: { background: color } });
    this.display.append(v);
    v.animate([{ clipPath: `circle(0 at ${cx}px ${cy}px)` }, { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }], { duration: 400, easing: 'cubic-bezier(.4,0,.2,1)' }).finished.then(() => {
      done();
      v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250 }).finished.then(() => v.remove());
    });
  }
}

registerApp({ id: 'calculator', label: 'Calculator', icon: 'calculator', color: '#00BCD4', colorDark: '#00BCD4', accent: '#00BCD4', pkg: 'com.android.calculator2' }, Calculator);
export { evaluate, doubleToString };
