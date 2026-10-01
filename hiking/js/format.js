// Small helpers for turning data into text.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const km = m => `${(m / 1000).toFixed(1)} km`;

export function duration(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

const TZ = 'Asia/Hong_Kong';
export const dateText = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
export const timeText = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

// AFCD writes closure dates as day/month/year, e.g. "15/10/2023".
export function afcdDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? '').trim());
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12)) : null;
}

// Some AFCD names are in capitals ("LANTAU NORTH COUNTRY PARK"); shown in title case.
export const titleCase = s => String(s ?? '').toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

// AFCD's overall difficulty rating, as shown with 1-5 stars on hiking.gov.hk (checked 2026-09-28).
export const DIFFICULTY = { 'Easy': 1, 'Moderate': 2, 'Demanding': 3, 'Difficult': 4, 'Very Difficult': 5 };
export const DIFFICULTY_ORDER = ['Easy', 'Moderate', 'Demanding', 'Difficult', 'Very Difficult'];

export function difficultyHTML(en, tc) {
  const n = DIFFICULTY[en];
  if (!n) return '<span>Not rated by AFCD</span>';
  const dots = '<b>●</b>'.repeat(n) + '<i>○</i>'.repeat(5 - n);   // filled and hollow, not just shade
  return `<span>${esc(en)} <span class="dots" aria-hidden="true">${dots}</span>`
    + `<span class="visually-hidden"> (${n} of 5)</span></span>`
    + (tc ? ` <span class="muted">${esc(tc)}</span>` : '');
}

// Which way a line end lies from the other end, for routes whose direction isn't verified.
export function compassEnds([lon1, lat1], [lon2, lat2]) {
  const dx = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180), dy = lat2 - lat1;
  const name = a => ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'][
    Math.round(((a * 180 / Math.PI) + 360) % 360 / 45) % 8];
  const a = Math.atan2(dy, dx);
  return [name(a + Math.PI), name(a)];   // [compass side of end 1, compass side of end 2]
}
