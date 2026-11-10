// Fills main.mustache with live data and writes README.md.
// GitHub Actions runs this every 3 hours (.github/workflows/readme.yml), the same idea as
// github.com/thmsgbrt/thmsgbrt, but without dependencies: Node 18+ has fetch and Intl built in.
// If a source can't be read, README.md is left exactly as it was and the run still passes.
import { readFile, writeFile } from "node:fs/promises";

const TZ = "Europe/Amsterdam";
// The spot for "over here": Utrecht, roughly the middle of the Netherlands. Swap in your own town if you like.
const PLACE = { lat: 52.09, lon: 5.12 };
const UA = "krepped-readme (+https://github.com/krepped/krepped)";
const nf = new Intl.NumberFormat("en-GB");

// Open-Meteo weather codes, written to follow "it's 9°C"
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

async function get(url, as = "json") {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return as === "json" ? res.json() : res.text();
}

async function weather() {
  const d = await get(
    `https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}` +
      `&current=temperature_2m,weather_code&daily=sunrise,sunset&forecast_days=2&timezone=${encodeURIComponent(TZ)}`
  );
  const now = d.current.time; // local time, "YYYY-MM-DDTHH:MM"
  const [riseToday, riseTomorrow] = d.daily.sunrise;
  const [setToday] = d.daily.sunset;
  const hm = (iso) => iso.slice(11, 16);
  const sun =
    now < riseToday ? `The sun comes up at ${hm(riseToday)}`
    : now < setToday ? `The sun sets at ${hm(setToday)}`
    : `The sun comes up at ${hm(riseTomorrow)}`;
  return {
    temperature: String(Math.round(d.current.temperature_2m)),
    weather: WEATHER[d.current.weather_code] ?? "outside",
    sun,
  };
}

async function obscura() {
  const html = await get("https://obscuravm.com/", "text");
  const stat = {};
  for (const m of html.matchAll(/data-count="(\d+)"\s+data-stat="(\w+)"/g)) stat[m[2]] = Number(m[1]);
  const map = html.match(/<b>([\d,.]+)<\/b>\s*executions\s*(?:&middot;|·)\s*<b>(\d+)<\/b>\s*countries/);
  if (!stat.users || !stat.exec || !stat.keys || !map) throw new Error("couldn't find the live counters on obscuravm.com");
  return {
    users: nf.format(stat.users),
    executions: nf.format(stat.exec),
    keys: nf.format(stat.keys),
    countries: map[2],
  };
}

const refresh_date = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  timeZone: TZ, timeZoneName: "short",
}).format(new Date());

// {{name}} placeholders, like Mustache; a missing value stops the run instead of printing "{{name}}"
const render = (tpl, data) =>
  tpl.replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    if (!(key in data)) throw new Error(`no value for {{${key}}}`);
    return data[key];
  });

try {
  const [w, o] = await Promise.all([weather(), obscura()]);
  const readme = render(await readFile("main.mustache", "utf8"), { ...w, ...o, refresh_date });
  await writeFile("README.md", readme);
  console.log("README.md updated:", refresh_date);
} catch (err) {
  console.error("Kept the old README.md:", err.message);
}
