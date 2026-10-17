// WCAG 2.2 contrast check for the colours in src/styles.css (AK-5.6). Run: node scripts/contrast.mjs
const lum = (hex) => { const c = hex.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const themes = {
  hell: { bg: '#ffffff', alt: '#f4f6f8', text: '#1a1d21', muted: '#4b5563', running: '#0b5cad', completed: '#17663a', partial: '#8a4b00', failed: '#b42318', focus: '#0b5cad', border: '#8a94a3', primaryBg: '#0b5cad', primaryFg: '#ffffff', lockedBg: '#5b6472', highlight: '#fff4c2' },
  dunkel: { bg: '#121417', alt: '#1b1f24', text: '#e8eaed', muted: '#a9b1bb', running: '#7cb8ff', completed: '#5fd38d', partial: '#f0b45a', failed: '#ff8a80', focus: '#7cb8ff', border: '#6b7480', primaryBg: '#7cb8ff', primaryFg: '#0b1220', lockedBg: '#a9b1bb', highlight: '#3a3420' },
};
for (const [name, t] of Object.entries(themes)) {
  const rows = [
    ['Text / Hintergrund', t.text, t.bg, 4.5], ['Text / Zeile (alt)', t.text, t.alt, 4.5], ['Text / Hervorhebung', t.text, t.highlight, 4.5],
    ['Gedämpft / Hintergrund', t.muted, t.bg, 4.5], ['Gedämpft / Zeile (alt)', t.muted, t.alt, 4.5],
    ...['running', 'completed', 'partial', 'failed'].flatMap((s) => [[`Status ${s} / Hintergrund`, t[s], t.bg, 4.5], [`Status ${s} / Zeile (alt)`, t[s], t.alt, 4.5], [`Status ${s} / Hervorhebung`, t[s], t.highlight, 4.5]]),
    ['Knopf Text / Knopf', t.primaryFg, t.primaryBg, 4.5], ['Knopf gesperrt Text / Knopf', t.primaryFg === '#ffffff' ? '#ffffff' : t.primaryFg, t.lockedBg, 4.5],
    ['Fokusrahmen / Hintergrund', t.focus, t.bg, 3], ['Rahmen / Hintergrund', t.border, t.bg, 3],
  ];
  console.log(`\n${name}`);
  for (const [label, fg, bg, min] of rows) { const r = ratio(fg, bg); console.log(`${r >= min ? 'OK ' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1 (min ${min}) ${label}  ${fg} on ${bg}`); }
}
