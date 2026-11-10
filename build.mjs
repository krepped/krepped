// Builds the profile README: fills main.mustache and draws the live "Obscura, right now" panel
// (live.svg) in the krepped.nl style.
// GitHub Actions runs this every 3 hours (.github/workflows/readme.yml), the same idea as
// github.com/thmsgbrt/thmsgbrt, but without dependencies: Node 18+ has fetch, Intl and Buffer.
// The other panels are static and live on krepped.nl/github/.
// If a source can't be read, nothing is written and the old README stays up.
import { readFile, writeFile } from "node:fs/promises";

const TZ = "Europe/Amsterdam";
// The spot for "over here": Utrecht, roughly the middle of the Netherlands. Swap in your own town if you like.
const PLACE = { lat: 52.09, lon: 5.12 };
const UA = "krepped-readme (+https://github.com/krepped/krepped)";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const nf = new Intl.NumberFormat("en-GB");

// Open-Meteo weather codes, written to follow "it was 9°C"
const WEATHER = {
  0: "and clear", 1: "and mostly clear", 2: "and partly cloudy", 3: "and grey",
  45: "and foggy", 48: "and foggy",
  51: "with a bit of drizzle", 53: "with drizzle", 55: "with heavy drizzle",
  56: "with freezing drizzle", 57: "with freezing drizzle",
  61: "with light rain", 63: "with rain", 65: "with heavy rain",
  66: "with freezing rain", 67: "with freezing rain",
  71: "with light snow", 73: "with snow", 75: "with heavy snow", 77: "with snow grains",
  80: "with a few showers", 81: "with showers", 82: "with heavy showers",
  85: "with snow showers", 86: "with heavy snow showers",
  95: "with thunderstorms", 96: "with thunderstorms and hail", 99: "with thunderstorms and hail",
};

// same colours as the panels on krepped.nl/github/
const THEMES = {
  dark: { bg: "#050607", border: "rgba(201,208,210,0.12)", label: "#7b8588", strong: "#e8edef", line: "rgba(201,208,210,0.16)" },
  light: { bg: "#c9d0d2", border: "rgba(10,12,13,0.08)", label: "#4b5457", strong: "#000000", line: "rgba(10,12,13,0.18)" },
};

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

// a font holding just these characters, as a data URI (Google Fonts' &text= parameter)
async function font(family, chars) {
  const text = [...new Set(chars + " ")].sort().join("");
  const css = await get(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`, "text", BROWSER_UA);
  const src = css.match(/src:\s*url\(([^)]+)\)\s*format\('(\w+)'\)/);
  if (!src) throw new Error("Google Fonts sent no font");
  return `url(data:font/${src[2]};base64,${(await get(src[1], "buffer", BROWSER_UA)).toString("base64")}) format("${src[2]}")`;
}

const colors = (t) =>
  `.bg { fill: ${t.bg}; } .bd { stroke: ${t.border}; } .ln { stroke: ${t.line}; } .m { fill: ${t.label}; } .h { fill: ${t.strong}; }`;

// the "Obscura, right now" panel: six live numbers in two rows of three.
// One SVG that themes itself: browsers evaluate prefers-color-scheme against the page showing the image,
// so it follows GitHub's theme. (A <picture> with dark/light files breaks on GitHub inside a link.)
async function livePanel(o, updated) {
  const W = 1360, H = 420;
  const top = ["OBSCURA / RIGHT NOW", `LIVE FROM OBSCURAVM.COM · ${updated}`];
  const cells = [
    [o.users, "USERS"], [o.executions, "SCRIPT RUNS"], [o.month, "RUNS, LAST 30 DAYS"],
    [o.keys, "KEYS"], [o.countries, "COUNTRIES, LAST 30 DAYS"], [o.uptime, "UPTIME"],
  ];
  const [head, mono] = await Promise.all([
    font("Stack+Sans+Headline:wght@300", cells.map((c) => c[0]).join("")),
    font("Fragment+Mono", top.join("") + cells.map((c) => c[1]).join("")),
  ]);
  const label = cells.map(([v, l]) => `${v} ${l.toLowerCase()}`).join(", ");
  const body = [
    `<text class="m" x="48" y="60">${top[0]}</text>`,
    `<text class="m" x="1312" y="60" text-anchor="end">${top[1]}</text>`,
  ];
  cells.forEach(([value, name], i) => {
    const x = 48 + (i % 3) * 434, y = 104 + Math.floor(i / 3) * 152;
    body.push(
      `<line class="ln" x1="${x}" y1="${y}" x2="${x + 396}" y2="${y}"/>`,
      `<text class="h" x="${x - 3}" y="${y + 80}">${value}</text>`,
      `<text class="m" x="${x}" y="${y + 116}">${name}</text>`
    );
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Obscura right now: ${label}">
  <style>
    @font-face { font-family: "head"; font-weight: 300; src: ${head}; }
    @font-face { font-family: "mono"; src: ${mono}; }
    .m { font-family: "mono", ui-monospace, monospace; font-size: 16px; letter-spacing: 3.2px; }
    .h { font-family: "head", "Helvetica Neue", Arial, sans-serif; font-weight: 300; font-size: 66px; letter-spacing: -2.6px; }
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
  return { svg, label };
}

const now = new Date();
const refresh_date = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: TZ, timeZoneName: "short",
}).format(now);
const updated = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ, timeZoneName: "short",
}).format(now).toUpperCase();

// {{name}} placeholders, like Mustache; a missing value stops the run instead of printing "{{name}}"
const render = (tpl, data) =>
  tpl.replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    if (!(key in data)) throw new Error(`no value for {{${key}}}`);
    return data[key];
  });

try {
  const [w, o] = await Promise.all([weather(), obscura()]);
  const live = await livePanel(o, updated);
  const readme = render(await readFile("main.mustache", "utf8"), { ...w, ...o, refresh_date, live_label: live.label });
  await writeFile("live.svg", live.svg);
  await writeFile("README.md", readme);
  console.log("README.md and live.svg updated:", refresh_date);
} catch (err) {
  console.error("Kept the old README.md:", err.message);
}
