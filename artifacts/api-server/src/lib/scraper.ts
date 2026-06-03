import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { logger } from "./logger";

export interface ScrapedResult {
  pasaran: string;
  tanggal: string;
  periode: string;
  result4d: string;
  as: string;
  kop: string;
  kepala: string;
  ekor: string;
}

export interface GroupedDay {
  tanggal: string;
  hari: string;
  slots: {
    "00:01": string | null;
    "13:00": string | null;
    "16:00": string | null;
    "19:00": string | null;
    "22:00": string | null;
    "23:00": string | null;
  };
}

export interface PasaranInfo {
  id: number;
  nama: string;
  kode: string;
  jadwal: string;
}

const PASARAN_LIST: PasaranInfo[] = [
  { id: 1, nama: "Toto Macau", kode: "macau", jadwal: "00:01, 13:00, 16:00, 19:00, 22:00, 23:00" },
];

export function getPasaranList(): PasaranInfo[] {
  return PASARAN_LIST;
}

const TIME_SLOTS = ["00:01", "13:00", "16:00", "19:00", "22:00", "23:00"] as const;

async function fetchWithTimeout(url: string, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal as any,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseMasterliveHtml(html: string, pasaran: string): GroupedDay[] {
  const $ = cheerio.load(html);
  const days: GroupedDay[] = [];

  $("table.Tahunan-Tab-Macau th").each((_i, el) => {
    const thHtml = $(el).html() || "";
    const parts = thHtml.split(/<br\s*\/?>/i);
    if (parts.length < 2) return;

    const hari = parts[0].trim();
    const tanggal = parts[1].replace(/<[^>]+>/g, "").trim();

    if (!hari || !tanggal) return;

    const tds: string[] = [];
    let next = $(el)[0].next;
    while (next && tds.length < 6) {
      if (next.type === "tag" && next.name === "td") {
        const txt = $(next).text().trim();
        tds.push(txt === "-" || txt === "" ? "" : txt);
      }
      next = next.next;
    }

    while (tds.length < 6) tds.push("");

    days.push({
      hari,
      tanggal,
      slots: {
        "00:01": tds[0] && /^\d{4}$/.test(tds[0]) ? tds[0] : null,
        "13:00": tds[1] && /^\d{4}$/.test(tds[1]) ? tds[1] : null,
        "16:00": tds[2] && /^\d{4}$/.test(tds[2]) ? tds[2] : null,
        "19:00": tds[3] && /^\d{4}$/.test(tds[3]) ? tds[3] : null,
        "22:00": tds[4] && /^\d{4}$/.test(tds[4]) ? tds[4] : null,
        "23:00": tds[5] && /^\d{4}$/.test(tds[5]) ? tds[5] : null,
      },
    });
  });

  return days;
}

function buildPeriode(tanggal: string, slot: string): string {
  const dateParts = tanggal.split(" ");
  const ddStr = dateParts[0]?.padStart(2, "0") ?? "00";
  const monthMap: Record<string, string> = {
    Januari: "01", Februari: "02", Maret: "03", April: "04",
    Mei: "05", Juni: "06", Juli: "07", Agustus: "08",
    September: "09", Oktober: "10", November: "11", Desember: "12",
  };
  const mmStr = monthMap[dateParts[1] ?? ""] ?? "00";
  const yyyyStr = dateParts[2] ?? "2026";
  const slotCode = slot.replace(":", "");
  return `${yyyyStr}${mmStr}${ddStr}-${slotCode}`;
}

function flattenGrouped(days: GroupedDay[], pasaran: string): ScrapedResult[] {
  const results: ScrapedResult[] = [];

  for (const day of days) {
    for (const slot of TIME_SLOTS) {
      const num = day.slots[slot];
      if (!num) continue;

      const periode = buildPeriode(day.tanggal, slot);

      results.push({
        pasaran,
        tanggal: `${day.hari} ${day.tanggal} ${slot}`,
        periode,
        result4d: num,
        as: num[0] ?? "0",
        kop: num[1] ?? "0",
        kepala: num[2] ?? "0",
        ekor: num[3] ?? "0",
      });
    }
  }

  return results;
}

// Try multiple URLs / years so the DB stays fresh when the site rolls over to a new year.
const MASTERLIVE_URLS = [
  "https://masterlive.net/data-totomacau-lengkap-2026.php",
  "https://masterlive.net/data-totomacau-lengkap-2025.php",
];

async function scrapeMacauHistorical(pasaran: string): Promise<{ days: GroupedDay[]; flat: ScrapedResult[] }> {
  let allDays: GroupedDay[] = [];
  let allFlat: ScrapedResult[] = [];

  for (const url of MASTERLIVE_URLS) {
    logger.info({ url, pasaran }, "Scraping full historical data from masterlive.net");
    try {
      const html = await fetchWithTimeout(url);
      const days = parseMasterliveHtml(html, pasaran);
      logger.info({ count: days.length, url, pasaran }, "Parsed historical days from masterlive.net");
      const flat = flattenGrouped(days, pasaran);
      allDays = [...allDays, ...days];
      allFlat = [...allFlat, ...flat];
    } catch (err) {
      logger.warn({ err, url }, "Failed to scrape masterlive.net URL");
    }
  }

  return { days: allDays, flat: allFlat };
}

function isValidScraped(s: ScrapedResult): boolean {
  if (!/^\d{4}$/.test(s.result4d)) return false;
  if (s.as !== s.result4d[0] || s.kop !== s.result4d[1] ||
      s.kepala !== s.result4d[2] || s.ekor !== s.result4d[3]) return false;
  if (!s.periode || s.periode.trim() === "") return false;
  if (!s.tanggal || s.tanggal.trim() === "") return false;

  const parsed = parseScrapedDate(s.tanggal);
  if (!parsed) return false;
  const tomorrow = Date.now() + 86400000;
  if (parsed.getTime() > tomorrow) return false;

  return true;
}

function parseScrapedDate(tanggal: string): Date | null {
  const monthMap: Record<string, number> = {
    Januari: 0, Februari: 1, Maret: 2, April: 3, Mei: 4, Juni: 5,
    Juli: 6, Agustus: 7, September: 8, Oktober: 9, November: 10, Desember: 11,
  };
  const parts = tanggal.split(" ");
  const dd = parseInt(parts[1] ?? "", 10);
  const month = monthMap[parts[2] ?? ""];
  const yyyy = parseInt(parts[3] ?? "", 10);
  if (Number.isNaN(dd) || month === undefined || Number.isNaN(yyyy)) return null;
  if (dd < 1 || dd > 31) return null;
  return new Date(Date.UTC(yyyy, month, dd));
}

function sanitizeScraped(results: ScrapedResult[]): ScrapedResult[] {
  const seen = new Set<string>();
  const out: ScrapedResult[] = [];
  let dropped = 0;
  for (const s of results) {
    if (!isValidScraped(s)) { dropped++; continue; }
    if (seen.has(s.periode)) { dropped++; continue; }
    seen.add(s.periode);
    out.push(s);
  }
  if (dropped > 0) {
    logger.warn({ dropped, kept: out.length }, "Scraper: dropped invalid/duplicate rows");
  }
  return out;
}

function buildDaysFromFlat(flat: ScrapedResult[]): GroupedDay[] {
  const byKey = new Map<string, GroupedDay>();
  const order: string[] = [];
  const validSlots = new Set<string>(TIME_SLOTS);
  for (const s of flat) {
    const parts = s.tanggal.split(" ");
    if (parts.length < 5) continue;
    const hari = parts[0]!;
    const tanggalKey = `${parts[1]} ${parts[2]} ${parts[3]}`;
    const slot = parts[4]!;
    if (!validSlots.has(slot)) continue;
    let day = byKey.get(tanggalKey);
    if (!day) {
      day = {
        hari, tanggal: tanggalKey,
        slots: { "00:01": null, "13:00": null, "16:00": null, "19:00": null, "22:00": null, "23:00": null },
      };
      byKey.set(tanggalKey, day);
      order.push(tanggalKey);
    }
    day.slots[slot as keyof GroupedDay["slots"]] = s.result4d;
  }
  return order.map(k => byKey.get(k)!);
}

export async function scrapeAllHistorical(pasaran: string): Promise<{ days: GroupedDay[]; flat: ScrapedResult[] }> {
  if (pasaran !== "macau") {
    logger.warn({ pasaran }, "Scraper: only macau is supported");
    return { days: [], flat: [] };
  }
  const raw = await scrapeMacauHistorical(pasaran);
  const flat = sanitizeScraped(raw.flat);
  return { days: buildDaysFromFlat(flat), flat };
}

export async function scrapeResults(pasaran: string, limit = 50): Promise<ScrapedResult[]> {
  const { flat } = await scrapeAllHistorical(pasaran);
  return flat.slice(0, limit);
}

export async function scrapeGrouped(pasaran: string, limit = 60): Promise<GroupedDay[]> {
  const { days } = await scrapeAllHistorical(pasaran);
  return days.slice(0, limit);
}
