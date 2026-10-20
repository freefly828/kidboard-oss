/**
 * 日期工具 — docs/03 §7: 屏幕的“今天”以 child timezone 计算。
 */

/** 给定 IANA timezone，返回当地今天的 YYYY-MM-DD */
export function todayFor(timezone: string): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now); // en-CA → YYYY-MM-DD
}

/** 校验 YYYY-MM-DD */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime());
}

/** 某日期（YYYY-MM-DD）所在周的周一 */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const isoWeekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (isoWeekday - 1));
  return d.toISOString().slice(0, 10);
}

/** 日期加减天数（YYYY-MM-DD） */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * D-015：某时区在给定时刻相对 UTC 的偏移（分钟，含夏令时），如 Asia/Shanghai → 480。
 * 设备时钟用它把 serverTime 换算成本地时间。
 */
export function utcOffsetMinutes(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((localAsUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}
