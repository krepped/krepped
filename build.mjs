// Builds the GitHub profile README for github.com/krepped: fills main.mustache and draws the two live
// panels in the krepped.nl style: live.svg ("Obscura / right now") and footer.svg (last refresh + weather).
// GitHub Actions runs this every 3 hours (.github/workflows/readme.yml), the same idea as
// github.com/thmsgbrt/thmsgbrt, but without dependencies: Node 18+ has fetch, Intl and Buffer.
// The other panels are static and live on krepped.nl/github/ (made by _claude/readme-panels.py in the
// krepped.nl site folder).
// Every SVG themes itself: dark by default, light under @media (prefers-color-scheme: light). Browsers
// evaluate that against the page showing the image, so it follows GitHub's theme. (A <picture> with
// dark/light files breaks on GitHub inside a link.)
// If a source can't be read, nothing is written and the old README stays up.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const TZ = "Europe/Amsterdam";
// The weather spot: Utrecht, roughly the middle of the Netherlands. Swap in your own town if you like.
const PLACE = { lat: 52.09, lon: 5.12 };
const UA = "krepped-readme (+https://github.com/krepped/krepped)";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const nf = new Intl.NumberFormat("en-GB");
const W = 1360;

// Open-Meteo weather codes, in a word or two (they follow "8°C," in the footer)
const WEATHER = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "showers", 81: "showers", 82: "heavy showers", 85: "snow showers", 86: "snow showers",
  95: "thunderstorms", 96: "thunder and hail", 99: "thunder and hail",
};

// same colours as the panels on krepped.nl/github/
const THEMES = {
  dark: { bg: "#050607", border: "rgba(201,208,210,0.12)", label: "#7b8588", strong: "#e8edef", line: "rgba(201,208,210,0.16)" },
  light: { bg: "#c9d0d2", border: "rgba(10,12,13,0.08)", label: "#4b5457", strong: "#000000", line: "rgba(10,12,13,0.18)" },
};
const colors = (t) =>
  `.bg { fill: ${t.bg}; } .bd { stroke: ${t.border}; } .ln { stroke: ${t.line}; } .m { fill: ${t.label}; } .h, .v, .b, .lg { fill: ${t.strong}; }`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function get(url, as = "json", ua = UA) {
  const res = await fetch(url, { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return as === "json" ? res.json() : as === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
}

async function weather() {
  const d = await get(
    `https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}` +
      `&current=temperature_2m,weather_code&timezone=${encodeURIComponent(TZ)}`
  );
  return {
    temperature: String(Math.round(d.current.temperature_2m)),
    weather: WEATHER[d.current.weather_code] ?? "outside",
  };
}

async function obscura() {
  const html = await get("https://obscuravm.com/", "text");
  const stat = {};
  for (const m of html.matchAll(/data-count="(\d+)"\s+data-stat="(\w+)"/g)) stat[m[2]] = Number(m[1]);
  const map = html.match(/<b>([\d,.]+)<\/b>\s*executions\s*(?:&middot;|·)\s*<b>(\d+)<\/b>\s*countries/);
  const uptime = html.match(/>([\d.]+%)<\/span>\s*uptime/);
  if (!stat.users || !stat.exec || !stat.keys || !map || !uptime) throw new Error("couldn't find the live counters on obscuravm.com");
  return {
    users: nf.format(stat.users),
    executions: nf.format(stat.exec),
    month: map[1],
    keys: nf.format(stat.keys),
    countries: map[2],
    uptime: uptime[1],
  };
}

// a font holding just these characters, as an @font-face src (Google Fonts' &text= parameter)
async function font(family, chars) {
  const text = [...new Set(chars + " ")].sort().join("");
  const css = await get(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`, "text", BROWSER_UA);
  const src = css.match(/src:\s*url\(([^)]+)\)\s*format\('(\w+)'\)/);
  if (!src) throw new Error("Google Fonts sent no font");
  return `url(data:font/${src[2]};base64,${(await get(src[1], "buffer", BROWSER_UA)).toString("base64")}) format("${src[2]}")`;
}
const face = (name, weight, src) => `@font-face { font-family: "${name}"; font-weight: ${weight}; src: ${src}; }`;

// a full-width panel: rounded card, dark or light with the viewer's theme
function card(H, faces, typography, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
  <style>
    ${faces.join("\n    ")}
    ${typography}
    ${colors(THEMES.dark)}
    @media (prefers-color-scheme: light) { ${colors(THEMES.light)} }
  </style>
  <clipPath id="card"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  <g clip-path="url(#card)">
    <rect class="bg" width="${W}" height="${H}"/>
    ${body.join("\n    ")}
  </g>
  <rect class="bd" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="17.5" fill="none"/>
</svg>
`;
}

// "Obscura / right now": six live numbers in two rows of three
async function livePanel(o, updated) {
  const top = ["OBSCURA / RIGHT NOW", `LIVE FROM OBSCURAVM.COM · ${updated}`];
  const cells = [
    [o.users, "USERS"], [o.executions, "SCRIPT RUNS"], [o.month, "RUNS, LAST 30 DAYS"],
    [o.keys, "KEYS"], [o.countries, "COUNTRIES, LAST 30 DAYS"], [o.uptime, "UPTIME"],
  ];
  const [head, mono] = await Promise.all([
    font("Stack+Sans+Headline:wght@300", cells.map((c) => c[0]).join("")),
    font("Fragment+Mono", top.join("") + cells.map((c) => c[1]).join("")),
  ]);
  const body = [
    `<text class="m" x="48" y="60">${top[0]}</text>`,
    `<text class="m" x="1312" y="60" text-anchor="end">${top[1]}</text>`,
  ];
  cells.forEach(([value, name], i) => {
    const x = 48 + (i % 3) * 434, y = 104 + Math.floor(i / 3) * 152;
    body.push(
      `<line class="ln" x1="${x}" y1="${y}" x2="${x + 396}" y2="${y}"/>`,
      `<text class="h" x="${x - 3}" y="${y + 80}">${esc(value)}</text>`,
      `<text class="m" x="${x}" y="${y + 116}">${name}</text>`
    );
  });
  const label = cells.map(([v, l]) => `${v} ${l.toLowerCase()}`).join(", ");
  const typography = `.m { font-family: "mono", ui-monospace, monospace; font-size: 16px; letter-spacing: 3.2px; }
    .h { font-family: "head", "Helvetica Neue", Arial, sans-serif; font-weight: 300; font-size: 66px; letter-spacing: -2.6px; }`;
  return { svg: card(420, [face("head", 300, head), face("mono", 400, mono)], typography, body, `Obscura right now: ${label}`), label };
}

// the footer, like the one on krepped.nl: logo and name, then label/value columns, the last one on the right
async function footerPanel(w, when) {
  const cols = [["LAST REFRESH", when], ["NETHERLANDS", `${w.temperature}°C, ${w.weather}`], ["REBUILT", "Every 3 hours"]];
  const [brand, text, mono] = await Promise.all([
    font("Stack+Sans+Headline:wght@500", "Krep"),
    font("Stack+Sans+Text:wght@400", cols.map((c) => c[1]).join("")),
    font("Fragment+Mono", cols.map((c) => c[0]).join("")),
  ]);
  const body = [
    // the krepped.nl logo (same path as the site's), 24 units scaled to about 54
    `<path class="lg" transform="translate(48 64) scale(2.25)" d="M7.5 3H22l-3.5 5H4zM9.5 9.5H24l-3.5 5H6zM7.5 16H22l-3.5 5H4z"/>`,
    `<text class="b" x="116" y="107">Krep</text>`,
  ];
  // columns on the site's 12-column grid: they start at columns 4 and 7, and the last ends at the right edge
  const xs = [[370, "start"], [692, "start"], [1312, "end"]];
  cols.forEach(([name, value], i) => {
    const [x, anchor] = xs[i];
    body.push(
      `<text class="m" x="${x}" y="76" text-anchor="${anchor}">${name}</text>`,
      `<text class="v" x="${x}" y="116" text-anchor="${anchor}">${esc(value)}</text>`
    );
  });
  const typography = `.m { font-family: "mono", ui-monospace, monospace; font-size: 16px; letter-spacing: 3.2px; }
    .b { font-family: "brand", "Helvetica Neue", Arial, sans-serif; font-weight: 500; font-size: 46px; letter-spacing: -1.4px; }
    .v { font-family: "text", "Helvetica Neue", Arial, sans-serif; font-size: 27px; }`;
  const label = `Krep. Last refresh: ${when}. Netherlands: ${cols[1][1]}. Rebuilt every 3 hours by a GitHub Action.`;
  return {
    svg: card(180, [face("brand", 500, brand), face("text", 400, text), face("mono", 400, mono)], typography, body, label),
    label,
  };
}

const now = new Date();
const refresh_date = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: TZ, timeZoneName: "short",
}).format(now);
const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ, timeZoneName: "short",
}).format(now); // "10 Nov at 14:29 CET"

// {{name}} placeholders, like Mustache; a missing value stops the run instead of printing "{{name}}"
const render = (tpl, data) =>
  tpl.replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    if (!(key in data)) throw new Error(`no value for {{${key}}}`);
    return data[key];
  });

try {
  const [w, o] = await Promise.all([weather(), obscura()]);
  const [live, footer] = await Promise.all([livePanel(o, when.toUpperCase()), footerPanel(w, when)]);
  const readme = render(await readFile("main.mustache", "utf8"), {
    refresh_date, live_label: live.label, footer_label: footer.label,
  });
  await writeFile("live.svg", live.svg);
  await writeFile("footer.svg", footer.svg);
  await writeFile("README.md", readme);
  console.log("README.md, live.svg and footer.svg updated:", refresh_date);
} catch (err) {
  console.error("Kept the old README.md:", err.message);
}

// In GitHub Actions, stage everything this script writes, so a new output file never needs a workflow change
// (the workflow commits whatever is staged).
if (process.env.GITHUB_ACTIONS) {
  try {
    execFileSync("git", ["add", "README.md", "live.svg", "footer.svg"], { stdio: "inherit" });
  } catch (err) {
    console.error("git add failed:", err.message);
  }
}
