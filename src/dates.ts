// 日記檔名和日期的轉換、範本變數。只用到 moment，可以單獨測試（test/dates.test.ts）。
import { moment } from "obsidian";

/**
 * 這裡用到的 moment 功能。自己宣告型別，不依賴 moment 套件的型別定義：
 * 社群目錄的自動審查讀不到那份定義，moment 會被當成 any，跳出一堆警告。
 */
interface DayTime {
	isValid(): boolean;
	format(format: string): string;
	year(): number;
	month(): number;
	date(): number;
	hour(): number;
	minute(): number;
	second(): number;
	set(values: { hour: number; minute: number; second: number }): DayTime;
}
const momentOf = moment as unknown as (input?: string, format?: string, strict?: boolean) => DayTime;

/** 外掛內部用的日期格式，也是預設的檔名格式 */
export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DiaryDate {
	key: string; // YYYY-MM-DD
	year: number;
	month: number; // 1-12
	day: number;
}

/**
 * 從筆記路徑（不含 .md）看出是哪一天；不是日記就回傳 null。
 * 日期格式可以含資料夾（YYYY/MM/YYYY-MM-DD），這時比對路徑的最後幾段。
 */
export function parseDiaryDate(pathNoExt: string, format: string): DiaryDate | null {
	const segments = pathNoExt.split("/");
	if (format === DEFAULT_DATE_FORMAT) {
		// 最常見的格式不用經過 moment，整個 vault 掃起來比較快
		const m = DATE_RE.exec(segments[segments.length - 1]);
		if (!m) return null;
		const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
		// 2026-02-30 之類不存在的日期不算
		if (!momentOf(m[0], DEFAULT_DATE_FORMAT, true).isValid()) return null;
		return { key: m[0], year, month, day };
	}
	const name = segments.slice(-format.split("/").length).join("/");
	const d = momentOf(name, format, true);
	if (!d.isValid()) return null;
	return { key: d.format(DEFAULT_DATE_FORMAT), year: d.year(), month: d.month() + 1, day: d.date() };
}

/** 某一天的筆記路徑（不含 .md），例如 Journal/2026/2026-09-24 */
export function diaryNotePath(date: string, format: string, folder: string, yearSubfolder: boolean): string {
	const name = momentOf(date, DEFAULT_DATE_FORMAT).format(format);
	// 日期格式已經有資料夾時，就不再多加年份資料夾
	const year = yearSubfolder && !format.includes("/") ? date.slice(0, 4) : "";
	return [folder.trim().replace(/^\/+|\/+$/g, ""), year, name].filter(Boolean).join("/");
}

/**
 * 範本裡的變數，跟內建「日記」外掛一樣：{{title}}、{{date}}、{{time}}，
 * 以及指定格式的 {{date:YYYY-MM-DD}}、{{time:HH:mm}}。日期用日記那天，時間用現在。
 */
export function fillTemplate(text: string, date: string, format: string, now: DayTime = momentOf()): string {
	const at = momentOf(date, DEFAULT_DATE_FORMAT).set({ hour: now.hour(), minute: now.minute(), second: now.second() });
	const title = at.format(format).split("/").pop() ?? date;
	return text
		.replace(/{{\s*title\s*}}/gi, title)
		.replace(/{{\s*(date|time)\s*(?::(.*?))?\s*}}/gi, (_, kind: string, fmt?: string) =>
			at.format(fmt?.trim() || (kind.toLowerCase() === "date" ? format : "HH:mm"))
		);
}
