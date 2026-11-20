// 日記卡片（Diary Cards）的介面。這裡不依賴 Obsidian，所以也能在 preview/ 裡直接用瀏覽器預覽。

import { locale, t } from "./i18n";

export interface DiaryEntry {
	date: string; // YYYY-MM-DD
	year: number;
	month: number; // 1-12
	day: number;
	oneLiner: string;
	/** 沒填一句話，oneLiner 是從內文第一段抓的 */
	oneLinerFromBody?: boolean;
	mood?: Mood;
	cover?: string; // 可以直接放進 <img src> 的網址
	photos: Photo[]; // 內文裡所有的圖片，依出現順序
	path: string;
	/** 檔案最後修改時間；用來判斷正在看的這篇有沒有變 */
	mtime?: number;
}

export interface Photo {
	path: string; // vault 裡的路徑
	url: string; // 可以直接放進 <img src> 的網址
}

/** 快速記錄畫面讀進來的內容 */
export interface Draft {
	date: string;
	exists: boolean;
	oneLiner: string;
	mood?: Mood;
	body: string; // 不含 frontmatter，也不含單獨一行的圖片
	photos: Photo[]; // 單獨一行的圖片，依出現順序
	coverPath?: string;
	/** frontmatter 有填 cover（不管是不是內文裡的照片） */
	hasCover: boolean;
	preserved: string[]; // 不顯示但要保留的行，例如 <!-- card-diary:ID --> 標記
}

export type DraftPhoto =
	| { kind: "existing"; photo: Photo }
	| { kind: "new"; data: ArrayBuffer; ext: string; url: string };

export interface SaveInput {
	date: string;
	oneLiner: string;
	mood?: Mood;
	body: string;
	photos: DraftPhoto[];
	/** 封面是第幾張照片；null 代表封面不是內文裡的照片，frontmatter 的 cover 不要動 */
	coverIndex: number | null;
	preserved: string[];
}

export interface DiaryHost {
	/** 讀取某一天的日記給快速記錄畫面（不存在就回傳空白的） */
	loadDraft(date: string): Promise<Draft>;
	/** 儲存快速記錄畫面的內容（不存在就建立） */
	saveEntry(input: SaveInput): Promise<void>;
	/** 全文搜尋：回傳 日期 → 命中的那一小段內文 */
	search(query: string): Promise<Map<string, string>>;
	/** 用 Obsidian 本身的編輯器打開（不存在就先建立） */
	openInObsidian(date: string): Promise<void>;
	/** 把日記內文（不含 frontmatter）渲染進 el */
	renderBody(entry: DiaryEntry, el: HTMLElement): Promise<void>;
	/** 設定某個月（YYYY-MM）的封面；path 為 null 代表改回自動 */
	setMonthCover(ym: string, path: string | null): void;
	/** 畫面切換時通知，用來記住目前的位置 */
	onNavigate?(screen: Screen): void;
}

export type Screen =
	| { kind: "year"; year: number }
	| { kind: "month"; year: number; month: number }
	| { kind: "entry"; date: string }
	| { kind: "edit"; date: string }
	| { kind: "all" };

/** 心情分五級，寫進 frontmatter 的是數字：5 最好、1 最差 */
export type Mood = 1 | 2 | 3 | 4 | 5;
/** 畫面上由好到壞的順序 */
export const MOODS: Mood[] = [5, 4, 3, 2, 1];

/** frontmatter 的心情：1～5 的整數（數字或字串都可以），其他的當作沒填 */
export function parseMood(v: unknown): Mood | undefined {
	const n = typeof v === "number" ? v : typeof v === "string" && /^\s*[1-5]\s*$/.test(v) ? Number(v) : NaN;
	return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as Mood) : undefined;
}

// 五個表情：同一個圓臉，只有眼睛和嘴巴不同。自己畫的線條圖示。
const FACE = (eyes: string, mouth: string) =>
	`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/>${eyes}<path d="${mouth}"/></svg>`;
const DOT_EYES = `<circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none"/>`;
const MOOD_ICONS: Record<Mood, string> = {
	5: FACE(`<path d="M7.6 10.4c.6-1.2 2.2-1.2 2.8 0M13.6 10.4c.6-1.2 2.2-1.2 2.8 0"/>`, "M7.8 13.8c1.6 3.4 6.8 3.4 8.4 0"),
	4: FACE(DOT_EYES, "M8.6 14.4c1.7 1.9 5.1 1.9 6.8 0"),
	3: FACE(DOT_EYES, "M9 15.2h6"),
	2: FACE(DOT_EYES, "M8.8 16.4c1.7-1.6 4.7-1.6 6.4 0"),
	1: FACE(`<path d="M7.8 9.2l2.6 1.2M16.2 9.2l-2.6 1.2"/>`, "M8.4 16.8c1.9-2.4 5.3-2.4 7.2 0"),
};

/**
 * 把圖示放進元素裡（取代原本的內容）。圖示都是上面寫死的 SVG 字串，
 * 用 DOMParser 轉成元素而不是 innerHTML，同一個圖示只解析一次。
 */
const svgCache = new Map<string, Element>();
function setSvg(el: HTMLElement, svg: string) {
	let node = svgCache.get(svg);
	if (!node) {
		// 用 HTML 解析器：字串裡沒有 xmlns，當成 XML 解析會變成不會顯示的一般元素
		const parsed = new DOMParser().parseFromString(svg, "text/html").body.firstElementChild;
		if (!parsed) return;
		node = parsed;
		svgCache.set(svg, node);
	}
	el.replaceChildren(document.importNode(node, true));
}

function moodIcon(parent: HTMLElement, cls: string, mood: Mood): HTMLSpanElement {
	const el = h("span", `cd-mood-icon cd-mood-${mood} ${cls}`, parent);
	setSvg(el, MOOD_ICONS[mood]);
	el.setAttribute("aria-label", t.moods[mood]);
	el.title = t.moods[mood];
	return el;
}

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const ICON_LEFT = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
const ICON_RIGHT = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`;
const ICON_PLUS = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
const ICON_EDIT = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_IMAGE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const ICON_SEARCH = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

export function pad2(n: number): string {
	return n < 10 ? "0" + n : String(n);
}

export function toDateKey(y: number, m: number, d: number): string {
	return `${y}-${pad2(m)}-${pad2(d)}`;
}

function daysInMonth(y: number, m: number): number {
	return new Date(y, m, 0).getDate();
}

function weekdayOf(y: number, m: number, d: number): number {
	return new Date(y, m - 1, d).getDay();
}

function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls?: string,
	parent?: HTMLElement,
	text?: string
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (cls) el.className = cls;
	if (text !== undefined) el.textContent = text;
	if (parent) parent.appendChild(el);
	return el;
}

function iconButton(parent: HTMLElement, cls: string, svg: string, label: string, onClick: () => void) {
	const btn = h("button", "cd-icon-btn " + cls, parent);
	setSvg(btn, svg);
	btn.setAttribute("aria-label", label);
	btn.addEventListener("click", onClick);
	return btn;
}

/**
 * 可以點的區塊。大卡片不用 <button>，因為 Obsidian 對 button 有
 * 「不換行、置中」的預設樣式，長句子會超出卡片。
 */
function tappable(parent: HTMLElement, cls: string, onClick: () => void): HTMLDivElement {
	const el = h("div", cls, parent);
	el.setAttribute("role", "button");
	el.tabIndex = 0;
	el.addEventListener("click", onClick);
	el.addEventListener("keydown", (ev) => {
		if (ev.key === "Enter" || ev.key === " ") {
			ev.preventDefault();
			onClick();
		}
	});
	return el;
}


/** 系統開了「減少動態效果」時不要平滑捲動 */
function smoothOrAuto(): ScrollBehavior {
	return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function centerCard(carousel: HTMLElement, card: HTMLElement, smooth: boolean) {
	const left = card.offsetLeft - (carousel.clientWidth - card.clientWidth) / 2;
	carousel.scrollTo({ left, behavior: smooth ? smoothOrAuto() : "auto" });
}

function isCentered(carousel: HTMLElement, card: HTMLElement): boolean {
	const c = carousel.getBoundingClientRect();
	const r = card.getBoundingClientRect();
	return Math.abs(r.left + r.width / 2 - (c.left + c.width / 2)) < r.width / 3;
}

/** 輪播往前或往後移一張卡片 */
function stepCarousel(carousel: HTMLElement, dir: 1 | -1) {
	const cards = Array.from(carousel.children) as HTMLElement[];
	const mid = carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
	let current = 0;
	let best = Infinity;
	cards.forEach((card, i) => {
		const r = card.getBoundingClientRect();
		const d = Math.abs(r.left + r.width / 2 - mid);
		if (d < best) {
			best = d;
			current = i;
		}
	});
	const target = cards[Math.min(cards.length - 1, Math.max(0, current + dir))];
	if (target) centerCard(carousel, target, true);
}

/** 這些日記裡最常出現的心情，由多到少 */
export function topMoods(list: DiaryEntry[], limit: number): Mood[] {
	const counts = new Map<Mood, number>();
	for (const e of list) if (e.mood) counts.set(e.mood, (counts.get(e.mood) ?? 0) + 1);
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([mood]) => mood);
}

interface EditState {
	date: string;
	exists: boolean;
	oneLiner: string;
	mood?: Mood;
	body: string;
	photos: DraftPhoto[];
	coverIndex: number | null;
	preserved: string[];
	dirty: boolean;
	saving: boolean;
	/** 還在縮圖的照片：選了 total 張，處理完 done 張 */
	processing: { total: number; done: number; failed: number } | null;
}

/** 手機照片縮到長邊 2048px、重新存成 JPEG（順便拿掉 GPS 等 EXIF） */
async function prepareImage(file: File, max = 2048): Promise<DraftPhoto> {
	const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
	const keepOriginal = async (): Promise<DraftPhoto> => ({
		kind: "new",
		data: await file.arrayBuffer(),
		ext,
		url: URL.createObjectURL(file),
	});
	if (file.type === "image/gif" || file.type === "image/svg+xml") return keepOriginal();
	try {
		const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
		const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(bmp.width * scale);
		canvas.height = Math.round(bmp.height * scale);
		canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
		bmp.close();
		const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
		if (!blob) return keepOriginal();
		return { kind: "new", data: await blob.arrayBuffer(), ext: "jpg", url: URL.createObjectURL(blob) };
	} catch {
		// 例如 HEIC 解不開，就存原檔
		return keepOriginal();
	}
}

export class DiaryUI {
	private entries: DiaryEntry[] = [];
	private edit: EditState | null = null;
	private leaveArmed = false;
	private pendingDate: string | null = null;
	// 「所有日記」頁的搜尋、篩選和捲動位置，回來時還原
	private allQuery = "";
	private allFilter: { photos: boolean; mood?: Mood } = { photos: false };
	private allScroll = 0;
	private allHits = new Map<string, string>();
	private searchSeq = 0;
	private entryFromAll = false;
	private byDate = new Map<string, DiaryEntry>();
	private monthCovers = new Map<string, Photo>();
	private screen: Screen;
	private scrollEl: HTMLElement | null = null;

	private resizeObserver: ResizeObserver | null = null;
	private onWindowResize = () => this.measureBottomInset();

	constructor(
		private root: HTMLElement,
		private host: DiaryHost,
		private now: () => Date = () => new Date(),
		/** 會疊在畫面底部的元素（Obsidian 手機版的浮動工具列） */
		private bottomOverlaySelector = ".mobile-navbar"
	) {
		this.screen = { kind: "year", year: this.now().getFullYear() };
		root.classList.add("cd-root", `cd-locale-${locale}`);
		this.resizeObserver = new ResizeObserver(this.onWindowResize);
		this.resizeObserver.observe(root);
		window.addEventListener("resize", this.onWindowResize);
	}

	destroy() {
		this.resizeObserver?.disconnect();
		window.removeEventListener("resize", this.onWindowResize);
	}

	/**
	 * 量底部工具列蓋住畫面多少，存成 --cd-safe-bottom，
	 * 讓滑軌、＋ 按鈕和底部面板往上讓開。電腦版量到 0。
	 */
	measureBottomInset() {
		let inset = 0;
		const bar = document.querySelector<HTMLElement>(this.bottomOverlaySelector);
		if (bar && getComputedStyle(bar).display !== "none") {
			const barRect = bar.getBoundingClientRect();
			const overlap = this.root.getBoundingClientRect().bottom - barRect.top;
			if (barRect.height > 0 && overlap > 0) inset = Math.round(overlap) + 6;
		}
		this.root.style.setProperty("--cd-safe-bottom", `${inset}px`);
	}

	getScreen(): Screen {
		return this.screen;
	}

	/** 手動選的每月封面，key 是 YYYY-MM */
	/** 一週從星期幾開始：0 星期日、1 星期一 */
	private weekStart: 0 | 1 = 0;

	/** 心情配色：換掉根元素上的 cd-palette-* class，CSS 會套用對應的顏色 */
	setPalette(name: string) {
		for (const c of Array.from(this.root.classList)) if (c.startsWith("cd-palette-")) this.root.classList.remove(c);
		this.root.classList.add(`cd-palette-${name}`);
	}

	setWeekStart(day: 0 | 1) {
		if (day === this.weekStart) return;
		this.weekStart = day;
		this.render(true);
	}

	/** 這個月 1 號前面要空幾格 */
	private leadDays(year: number, month: number): number {
		return (weekdayOf(year, month, 1) - this.weekStart + 7) % 7;
	}

	/** render 是 false 時只更新資料，等等的 setEntries 再一起重畫 */
	setMonthCovers(covers: Map<string, Photo>, render = true) {
		this.monthCovers = covers;
		if (render) this.render(true);
	}

	setEntries(entries: DiaryEntry[]) {
		this.entries = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
		this.byDate = new Map(this.entries.map((e) => [e.date, e]));
		if (this.pendingDate && this.byDate.has(this.pendingDate)) {
			const date = this.pendingDate;
			this.pendingDate = null;
			this.go({ kind: "entry", date });
			return;
		}
		// 資料變動時保留捲動位置，不要把使用者彈回開頭
		this.render(true);
	}

	go(screen: Screen) {
		if (screen.kind === "entry" && !this.byDate.has(screen.date)) {
			screen = { kind: "year", year: this.now().getFullYear() };
		}
		if (this.screen.kind === "all") this.allScroll = this.scrollEl?.scrollTop ?? 0;
		this.entryFromAll = screen.kind === "entry" && (this.screen.kind === "all" || (this.screen.kind === "entry" && this.entryFromAll));
		this.screen = screen;
		this.host.onNavigate?.(screen);
		this.render(false);
	}

	/** 打開某一天的快速記錄畫面 */
	openEditor(date: string) {
		// 正在寫另一天、還沒存：不要直接丟掉，先提醒
		if (this.screen.kind === "edit" && this.screen.date !== date && this.edit?.dirty) {
			const warn = this.root.querySelector<HTMLElement>(".cd-edit-warn");
			if (warn) {
				warn.hidden = false;
				warn.textContent = t.unsavedOtherDay;
			}
			return;
		}
		this.go({ kind: "edit", date });
	}

	render(keepScroll: boolean) {
		// 正在編輯時，背景資料更新不要重畫，免得把還沒存的字洗掉
		if (keepScroll && this.screen.kind === "edit") return;
		// 正在看的這篇（和前後篇）都沒變：不要重畫，照片輪播和捲動位置才不會跳掉
		if (keepScroll && this.screen.kind === "entry" && this.entrySignature(this.screen.date) === this.shownEntry) return;
		const prevScroll = keepScroll ? this.captureScroll() : null;
		this.pendingScroll = this.screen.kind === "entry" ? prevScroll : null;
		// 正在搜尋框打字時被背景更新重畫：重畫後把焦點和游標放回去，手機鍵盤才不會收起來
		const active = document.activeElement;
		const typing =
			keepScroll && active instanceof HTMLInputElement && active.classList.contains("cd-search-input") && this.root.contains(active)
				? { start: active.selectionStart, end: active.selectionEnd }
				: null;
		this.shownEntry = null;
		this.root.replaceChildren();
		switch (this.screen.kind) {
			case "year":
				this.renderYear(this.screen.year);
				break;
			case "month":
				this.renderMonth(this.screen.year, this.screen.month);
				break;
			case "entry":
				// 正在看的這篇被刪掉或改名了（例如 Syncthing 同步過來），改回那個月
				if (!this.byDate.has(this.screen.date)) {
					const [y, m] = this.screen.date.split("-").map(Number);
					this.screen = { kind: "month", year: y, month: m };
					this.renderMonth(y, m);
				} else this.renderEntry(this.screen.date);
				break;
			case "edit":
				this.renderEdit(this.screen.date);
				break;
			case "all":
				this.renderAll(!keepScroll);
				break;
		}
		if (prevScroll) this.restoreScroll(prevScroll);
		if (typing) {
			const input = this.root.querySelector<HTMLInputElement>(".cd-search-input");
			input?.focus({ preventScroll: true });
			input?.setSelectionRange(typing.start, typing.end);
		}
		requestAnimationFrame(() => this.measureBottomInset());
	}

	/** 單篇頁畫出來的樣子取決於這篇和前後篇；用來判斷要不要重畫 */
	private shownEntry: string | null = null;
	/** 單篇頁重畫前的捲動位置：內文是非同步畫的，畫完再還原一次 */
	private pendingScroll: { top: number; left: number | null } | null = null;

	private entrySignature(date: string): string | null {
		const e = this.byDate.get(date);
		if (!e) return null;
		const i = this.entries.indexOf(e);
		const near = [this.entries[i - 1], this.entries[i + 1]].map((x) => x && [x.date, x.oneLiner]);
		return JSON.stringify([e, near, this.entryFromAll]);
	}

	private captureScroll() {
		const carousel = this.root.querySelector<HTMLElement>(".cd-carousel");
		return { top: this.scrollEl?.scrollTop ?? 0, left: carousel?.scrollLeft ?? null };
	}

	private restoreScroll(s: { top: number; left: number | null }) {
		if (this.scrollEl) this.scrollEl.scrollTop = s.top;
		const carousel = this.root.querySelector<HTMLElement>(".cd-carousel");
		if (carousel && s.left !== null) {
			carousel.dataset.restored = "1";
			carousel.scrollLeft = s.left;
		}
	}

	private entriesIn(year: number, month?: number): DiaryEntry[] {
		return this.entries.filter((e) => e.year === year && (month === undefined || e.month === month));
	}

	/** 連續寫了幾天：從今天往回數；今天還沒寫就從昨天開始算，不算斷掉 */
	private streak(): number {
		const day = new Date(this.now().getTime()); // 複製一份，不要改到原本的
		day.setHours(12, 0, 0, 0);
		const key = () => toDateKey(day.getFullYear(), day.getMonth() + 1, day.getDate());
		if (!this.byDate.has(key())) day.setDate(day.getDate() - 1);
		let n = 0;
		while (this.byDate.has(key())) {
			n++;
			day.setDate(day.getDate() - 1);
		}
		return n;
	}

	private todayKey(): string {
		const now = this.now();
		return toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
	}

	private isFuture(date: string): boolean {
		return date > this.todayKey();
	}

	private shell(): HTMLElement {
		const scroll = h("div", "cd-scroll", this.root);
		this.scrollEl = scroll;
		return scroll;
	}

	/** 「今天」按鈕：直接跳到這個月的月視圖 */
	private todayButton(parent: HTMLElement) {
		const now = this.now();
		const btn = h("button", "cd-today-btn", parent, t.today);
		btn.setAttribute("aria-label", t.backToThisMonth);
		btn.addEventListener("click", () => this.go({ kind: "month", year: now.getFullYear(), month: now.getMonth() + 1 }));
		return btn;
	}

	private fab(label: string, onClick: () => void, extraClass = "") {
		const btn = h("button", ("cd-fab " + extraClass).trim(), this.root);
		setSvg(btn, ICON_PLUS);
		btn.setAttribute("aria-label", label);
		btn.addEventListener("click", onClick);
	}

	// ── 年份：12 張月份卡片 ────────────────────────────────

	private renderYear(year: number) {
		const scroll = this.shell();
		const now = this.now();

		const top = h("header", "cd-top", scroll);
		// 左上：連續寫了幾天，下面是今天的日期
		const streak = h("div", "cd-streak", top);
		const days = this.streak();
		const line = h("div", "cd-streak-line", streak);
		if (days > 0) {
			h("span", "cd-streak-num", line, String(days));
			h("span", "cd-streak-unit", line, t.streakUnit(days));
		} else {
			h("span", "cd-streak-unit is-start", line, t.streakStart);
		}
		h("div", "cd-streak-sub", streak, t.todayShort(now.getMonth() + 1, now.getDate(), now.getDay()));

		const yearEntries = this.entriesIn(year);
		const topRight = h("div", "cd-top-right", top);
		const stats = tappable(topRight, "cd-stats", () => this.go({ kind: "all" }));
		stats.setAttribute("aria-label", t.allEntries);
		h("span", "cd-stats-num", stats, String(yearEntries.length));
		h("span", "cd-stats-label", stats, t.statsUnit);
		this.todayButton(topRight);

		const nav = h("div", "cd-yearnav", scroll);
		iconButton(nav, "", ICON_LEFT, t.prevYear, () => this.go({ kind: "year", year: year - 1 }));
		h("span", "cd-yearnav-label", nav, String(year));
		iconButton(nav, "", ICON_RIGHT, t.nextYear, () => this.go({ kind: "year", year: year + 1 }));

		const wrap = h("div", "cd-carousel-wrap", scroll);
		const carousel = h("div", "cd-carousel", wrap);
		carousel.tabIndex = 0;
		// 電腦上沒辦法用手指滑，所以兩側加箭頭，也可以用鍵盤左右鍵
		iconButton(wrap, "cd-carousel-arrow is-prev", ICON_LEFT, t.prevMonthCard, () => stepCarousel(carousel, -1));
		iconButton(wrap, "cd-carousel-arrow is-next", ICON_RIGHT, t.nextMonthCard, () => stepCarousel(carousel, 1));
		carousel.addEventListener("keydown", (ev) => {
			if (ev.key === "ArrowLeft") stepCarousel(carousel, -1);
			else if (ev.key === "ArrowRight") stepCarousel(carousel, 1);
			else return;
			ev.preventDefault();
		});
		let focusCard: HTMLElement | null = null;
		for (let m = 1; m <= 12; m++) {
			const card = this.monthCard(carousel, year, m);
			if (year === now.getFullYear() && m === now.getMonth() + 1) focusCard = card;
		}

		// 打開時把這個月的卡片捲到中間
		requestAnimationFrame(() => {
			if (carousel.dataset.restored) return;
			const target = focusCard ?? (carousel.children[0] as HTMLElement | undefined);
			if (!target) return;
			centerCard(carousel, target, false);
		});

		h("p", "cd-hint", scroll, t.yearHint);
		this.yearGrid(scroll, year, yearEntries);
		this.fab(t.writeToday, () => this.openEditor(this.todayKey()));
	}

	/**
	 * 一年的每一天：12 列（月）× 31 格（日）。有心情的日子塗心情的顏色，
	 * 有寫但沒填心情的用淡色，沒寫的是空格。底下是各種心情的天數。
	 */
	private yearGrid(parent: HTMLElement, year: number, list: DiaryEntry[]) {
		if (!list.length) return;
		const box = h("section", "cd-year-grid", parent);
		const head = h("div", "cd-yg-head", box);
		h("span", "cd-yg-title", head, t.yearDays(year));
		h("span", "cd-yg-sub", head, t.daysRecorded(list.length));

		const grid = h("div", "cd-yg-grid", box);
		const today = this.todayKey();
		for (let m = 1; m <= 12; m++) {
			h("span", "cd-yg-month", grid, String(m));
			const days = daysInMonth(year, m);
			for (let d = 1; d <= 31; d++) {
				const cell = h("span", "cd-yg-day", grid);
				if (d > days) {
					cell.classList.add("is-none");
					continue;
				}
				const key = toDateKey(year, m, d);
				const e = this.byDate.get(key);
				if (key === today) cell.classList.add("is-today");
				if (!e) {
					cell.classList.add(key > today ? "is-future" : "is-empty");
					continue;
				}
				cell.dataset.date = key;
				cell.classList.add("is-written");
				if (e.mood) cell.classList.add(`cd-mood-${e.mood}`, "has-mood");
				cell.title = `${t.dayTitle(m, d)}${e.mood ? ` · ${t.moods[e.mood]}` : ""}`;
			}
		}
		// 點有寫的那一格就打開那篇
		grid.addEventListener("click", (ev) => {
			const date = (ev.target as HTMLElement).closest<HTMLElement>("[data-date]")?.dataset.date;
			if (date) this.go({ kind: "entry", date });
		});

		// 圖例：各種心情的天數（一個都沒有就不顯示）
		const counts = MOODS.map((m) => list.filter((e) => e.mood === m).length);
		if (counts.some(Boolean)) {
			const legend = h("div", "cd-yg-legend", box);
			MOODS.forEach((mood, i) => {
				const item = h("span", "cd-yg-legend-item", legend);
				moodIcon(item, "", mood);
				h("span", "cd-yg-legend-count", item, String(counts[i]));
			});
		}
	}

	private monthCard(parent: HTMLElement, year: number, month: number): HTMLElement {
		const list = this.entriesIn(year, month);
		const card = tappable(parent, `cd-month-card cd-m${month}`, () => {
			// 點旁邊露出一半的卡片時，先把它捲到中間
			if (!isCentered(parent, card)) centerCard(parent, card, true);
			else this.go({ kind: "month", year, month });
		});
		const monthStart = toDateKey(year, month, 1);
		if (this.isFuture(monthStart)) card.classList.add("is-future");

		const cover = this.monthCover(year, month)?.url;
		if (cover) {
			card.classList.add("has-cover");
			card.style.backgroundImage = `url("${cover}")`;
		}

		const head = h("div", "cd-mc-head", card);
		h("span", "cd-mc-abbr", head, MONTH_ABBR[month - 1]);
		// 右上角：這個月有幾張照片
		const photoCount = list.reduce((n, e) => n + e.photos.length, 0);
		if (photoCount) h("span", "cd-mc-sub", head, t.photoCount(photoCount));

		// 小月曆：有寫日記的日子會亮起來
		const grid = h("div", "cd-mc-grid", card);
		const lead = this.leadDays(year, month);
		for (let i = 0; i < lead; i++) h("span", "cd-dot is-blank", grid);
		const today = this.todayKey();
		for (let d = 1; d <= daysInMonth(year, month); d++) {
			const key = toDateKey(year, month, d);
			const dot = h("span", "cd-dot", grid);
			if (this.byDate.has(key)) dot.classList.add("is-on");
			if (key === today) dot.classList.add("is-today");
		}

		const latest = list[0];
		const quote = h("div", "cd-mc-quote", card);
		if (latest?.oneLiner) {
			h("span", "cd-mc-quote-text", quote, latest.oneLiner);
			h("span", "cd-mc-quote-date", quote, `${latest.month}/${latest.day}`);
		}

		const foot = h("div", "cd-mc-foot", card, list.length ? t.entryCount(list.length) : t.noEntriesYet);
		const moods = topMoods(list, 3);
		if (moods.length) {
			const box = h("span", "cd-mc-moods", foot);
			for (const m of moods) moodIcon(box, "", m);
		}
		return card;
	}

	/** 月封面：手動選的優先，沒有就用這個月最新一篇有圖的日記 */
	private monthCover(year: number, month: number): Photo | undefined {
		const chosen = this.monthCovers.get(`${year}-${pad2(month)}`);
		if (chosen) return chosen;
		const e = this.entriesIn(year, month).find((x) => x.cover);
		return e?.cover ? { path: "", url: e.cover } : undefined;
	}

	// ── 月份：月曆 + 每天的卡片 ────────────────────────────

	private renderMonth(year: number, month: number) {
		const scroll = this.shell();

		const prev = () => this.shiftMonth(year, month, -1);
		const next = () => this.shiftMonth(year, month, 1);

		// 標題列：← ‹ 2026 · 9 月 › 今天
		const bar = h("header", "cd-bar cd-bar-month", scroll);
		iconButton(bar, "", ICON_BACK, t.backToYear, () => this.go({ kind: "year", year }));
		const switcher = h("div", "cd-month-switch", bar);
		iconButton(switcher, "", ICON_LEFT, t.prevMonth, prev);
		const title = h("div", "cd-bar-title", switcher);
		h("span", "cd-bar-sub", title, String(year));
		h("span", "cd-bar-main", title, t.monthTitle(month));
		iconButton(switcher, "", ICON_RIGHT, t.nextMonth, next);
		const actions = h("div", "cd-bar-actions", bar);
		const now = this.now();
		if (year !== now.getFullYear() || month !== now.getMonth() + 1) this.todayButton(actions);

		this.scrollEl?.classList.add("has-rail");
		this.monthBanner(scroll, year, month);

		// 月曆
		const cal = h("div", `cd-cal cd-m${month}`, scroll);
		for (let i = 0; i < 7; i++) {
			const wd = (i + this.weekStart) % 7;
			h("span", "cd-cal-wd" + (wd === 0 ? " is-sun" : wd === 6 ? " is-sat" : ""), cal, t.weekdayShort[wd]);
		}
		const lead = this.leadDays(year, month);
		for (let i = 0; i < lead; i++) h("span", "cd-cal-day is-blank", cal);
		const today = this.todayKey();
		for (let d = 1; d <= daysInMonth(year, month); d++) {
			const key = toDateKey(year, month, d);
			const wd = weekdayOf(year, month, d);
			const cell = h("button", "cd-cal-day", cal, String(d));
			if (wd === 0) cell.classList.add("is-sun");
			if (wd === 6) cell.classList.add("is-sat");
			if (key === today) cell.classList.add("is-today");
			const entry = this.byDate.get(key);
			if (entry) {
				cell.classList.add("is-on");
				if (entry.cover) {
					cell.classList.add("has-cover");
					cell.style.backgroundImage = `linear-gradient(rgba(0,0,0,.2), rgba(0,0,0,.2)), url("${entry.cover}")`;
				}
				cell.addEventListener("click", () => this.go({ kind: "entry", date: key }));
			} else if (this.isFuture(key)) {
				cell.disabled = true;
			} else {
				cell.title = t.fillInDay;
				cell.addEventListener("click", () => this.openEditor(key));
			}
		}
		this.onSwipe(cal, prev, next);
		h("p", "cd-hint", scroll, t.monthHint);

		// 日記卡片
		const list = this.entriesIn(year, month);
		const wrap = h("div", "cd-list", scroll);
		const isThisMonth = year === now.getFullYear() && month === now.getMonth() + 1;
		const todayEntry = this.byDate.get(today);
		// 今天還沒寫（或只有空白範本）：放一張提示卡在最上面
		if (isThisMonth && (!todayEntry || (!todayEntry.oneLiner && !todayEntry.photos.length))) {
			const prompt = tappable(wrap, "cd-today-prompt", () => this.openEditor(today));
			const plus = h("span", "cd-today-prompt-icon", prompt);
			setSvg(plus, ICON_PLUS);
			const text = h("div", "cd-today-prompt-text", prompt);
			h("span", "cd-today-prompt-title", text, t.todayNotWritten);
			h("span", "cd-today-prompt-sub", text, t.todayPrompt(month, now.getDate(), now.getDay()));
		} else if (!list.length) {
			h("div", "cd-empty", wrap, t.noEntriesThisMonth);
		}
		for (const e of list) this.dayCard(wrap, e);

		this.monthRail(year, month);
		this.fab(t.writeToday, () => this.openEditor(this.todayKey()), "is-raised");
	}

	private shiftMonth(year: number, month: number, delta: number) {
		const d = new Date(year, month - 1 + delta, 1);
		this.go({ kind: "month", year: d.getFullYear(), month: d.getMonth() + 1 });
	}

	/** 左右滑動手勢 */
	private onSwipe(el: HTMLElement, onRight: () => void, onLeft: () => void) {
		let x0 = 0;
		let y0 = 0;
		el.addEventListener("touchstart", (e) => {
			x0 = e.touches[0].clientX;
			y0 = e.touches[0].clientY;
		}, { passive: true });
		el.addEventListener("touchend", (e) => {
			const dx = e.changedTouches[0].clientX - x0;
			const dy = e.changedTouches[0].clientY - y0;
			if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
			if (dx > 0) onRight();
			else onLeft();
		});
	}

	/** 底部的月份滑軌：前一年 ‹ 1月 … 12月 › 下一年 */
	private monthRail(year: number, month: number) {
		const rail = h("nav", "cd-rail", this.root);
		const track = h("div", "cd-rail-track", rail);
		const yearChip = (y: number, label: string) => {
			const chip = h("button", "cd-rail-chip is-year", track, label);
			chip.addEventListener("click", () => this.go({ kind: "month", year: y, month: y < year ? 12 : 1 }));
		};
		yearChip(year - 1, `‹ ${year - 1}`);
		let active: HTMLElement | null = null;
		for (let m = 1; m <= 12; m++) {
			const chip = h("button", `cd-rail-chip cd-m${m}`, track);
			h("span", "", chip, t.monthShort(m));
			if (this.entriesIn(year, m).length) h("span", "cd-rail-dot", chip);
			if (m === month) {
				chip.classList.add("is-active");
				active = chip;
			}
			chip.addEventListener("click", () => this.go({ kind: "month", year, month: m }));
		}
		yearChip(year + 1, `${year + 1} ›`);
		requestAnimationFrame(() => {
			if (active) track.scrollLeft = active.offsetLeft - (track.clientWidth - active.clientWidth) / 2;
		});
	}

	/** 單篇頁底部的日期滑軌：這個月有寫的每一天，兩端跳到上／下個月 */
	private dayRail(current: DiaryEntry) {
		const { year, month } = current;
		const rail = h("nav", "cd-rail cd-day-rail", this.root);
		const track = h("div", "cd-rail-track", rail);

		// entries 是新到舊，所以「上個月最後一篇」是比這個月第一天舊的第一篇
		const monthStart = toDateKey(year, month, 1);
		const monthEnd = toDateKey(year, month, 31);
		const prevEntry = this.entries.find((x) => x.date < monthStart);
		const nextEntry = [...this.entries].reverse().find((x) => x.date > monthEnd);
		const jumpChip = (target: DiaryEntry | undefined, label: string) => {
			if (!target) return;
			const chip = h("button", "cd-rail-chip is-year", track, label);
			chip.addEventListener("click", () => this.go({ kind: "entry", date: target.date }));
		};
		jumpChip(prevEntry, `‹ ${prevEntry ? t.monthShort(prevEntry.month) : ""}`);

		let active: HTMLElement | null = null;
		for (const x of [...this.entriesIn(year, month)].reverse()) {
			const wd = weekdayOf(x.year, x.month, x.day);
			const chip = h("button", `cd-rail-chip cd-rail-day cd-m${month}`, track);
			if (x.cover) {
				chip.classList.add("has-cover");
				chip.style.backgroundImage = `linear-gradient(rgba(0,0,0,.3), rgba(0,0,0,.3)), url("${x.cover}")`;
			}
			if (wd === 0) chip.classList.add("is-sun");
			if (wd === 6) chip.classList.add("is-sat");
			h("span", "cd-rail-day-num", chip, String(x.day));
			h("span", "cd-rail-day-wd", chip, t.weekdayShort[wd]);
			chip.setAttribute("aria-label", t.dayTitle(x.month, x.day));
			if (x.date === current.date) {
				chip.classList.add("is-active");
				active = chip;
			}
			chip.addEventListener("click", () => this.go({ kind: "entry", date: x.date }));
		}

		jumpChip(nextEntry, `${nextEntry ? t.monthShort(nextEntry.month) : ""} ›`);
		requestAnimationFrame(() => {
			if (active) track.scrollLeft = active.offsetLeft - (track.clientWidth - active.clientWidth) / 2;
		});
	}

	private monthBanner(parent: HTMLElement, year: number, month: number) {
		const cover = this.monthCover(year, month);
		const photos = this.monthPhotos(year, month);
		const banner = h("div", `cd-banner cd-m${month}`, parent);
		if (cover) banner.style.backgroundImage = `url("${cover.url}")`;
		else banner.classList.add("is-empty");
		h("span", "cd-banner-label", banner, MONTH_ABBR[month - 1]);

		const isManual = this.monthCovers.has(`${year}-${pad2(month)}`);
		if (!photos.length && !isManual) return;
		const btn = h("button", "cd-banner-btn", banner);
		setSvg(btn, ICON_IMAGE);
		h("span", "", btn, t.changeCover);
		btn.addEventListener("click", () => this.openCoverPicker(year, month));
	}

	/** 這個月所有日記裡的照片（不重複） */
	private monthPhotos(year: number, month: number): Photo[] {
		const seen = new Set<string>();
		const out: Photo[] = [];
		for (const e of [...this.entriesIn(year, month)].reverse()) {
			for (const p of e.photos) {
				if (seen.has(p.path)) continue;
				seen.add(p.path);
				out.push(p);
			}
		}
		return out;
	}

	private openCoverPicker(year: number, month: number) {
		const ym = `${year}-${pad2(month)}`;
		const current = this.monthCovers.get(ym);
		const photos = this.monthPhotos(year, month);
		if (current && !photos.some((p) => p.path === current.path)) photos.unshift(current);

		const overlay = h("div", "cd-sheet-overlay", this.root);
		const sheet = h("div", "cd-sheet", overlay);
		const close = () => overlay.remove();
		overlay.addEventListener("click", (ev) => {
			if (ev.target === overlay) close();
		});

		const head = h("div", "cd-sheet-head", sheet);
		h("span", "cd-sheet-title", head, t.chooseCover(month));
		const cancel = h("button", "cd-sheet-cancel", head, t.cancel);
		cancel.addEventListener("click", close);

		const grid = h("div", "cd-sheet-grid", sheet);
		for (const p of photos) {
			const cell = tappable(grid, "cd-sheet-photo", () => {
				close();
				this.host.setMonthCover(ym, p.path);
			});
			if (current?.path === p.path) cell.classList.add("is-selected");
			const img = h("img", "", cell);
			img.src = p.url;
			img.alt = "";
			img.loading = "lazy";
		}

		const auto = h("button", "cd-sheet-auto", sheet, t.autoCover);
		if (!current) auto.classList.add("is-selected");
		auto.addEventListener("click", () => {
			close();
			this.host.setMonthCover(ym, null);
		});
	}

	private dayCard(parent: HTMLElement, e: DiaryEntry, snippet?: string) {
		const wd = weekdayOf(e.year, e.month, e.day);
		const card = tappable(parent, "cd-day-card", () => this.go({ kind: "entry", date: e.date }));

		const body = h("div", "cd-dc-body", card);
		// 上方一行小標：日期、星期，心情放右邊
		const meta = h("div", "cd-dc-meta", body);
		h("span", "cd-dc-num", meta, String(e.day));
		const wdEl = h("span", "cd-dc-wd", meta, t.weekdayAbbr[wd]);
		if (wd === 0) wdEl.classList.add("is-sun");
		if (wd === 6) wdEl.classList.add("is-sat");
		if (e.mood) moodIcon(meta, "cd-dc-mood", e.mood);
		if (e.oneLiner) h("p", "cd-dc-text", body, e.oneLiner);
		else h("p", "cd-dc-text is-empty", body, t.noOneLiner);
		if (snippet) h("p", "cd-dc-snippet", body, snippet);

		if (e.cover) {
			const img = h("img", "cd-dc-cover", card);
			img.src = e.cover;
			img.alt = "";
			img.loading = "lazy";
		}
	}

	// ── 單篇日記 ────────────────────────────────────────

	private renderEntry(date: string) {
		const e = this.byDate.get(date)!;
		this.shownEntry = this.entrySignature(date);
		const scroll = this.shell();
		const wd = weekdayOf(e.year, e.month, e.day);

		const bar = h("header", "cd-bar", scroll);
		if (this.entryFromAll) iconButton(bar, "", ICON_BACK, t.backToAll, () => this.go({ kind: "all" }));
		else iconButton(bar, "", ICON_BACK, t.backToMonth, () => this.go({ kind: "month", year: e.year, month: e.month }));
		const title = h("div", "cd-bar-title", bar);
		h("span", "cd-bar-sub", title, `${e.year} · ${t.weekday(wd)}`);
		h("span", "cd-bar-main", title, t.dayTitle(e.month, e.day));
		const actions = h("div", "cd-bar-actions", bar);
		this.todayButton(actions);
		iconButton(actions, "", ICON_EDIT, t.edit, () => this.openEditor(e.date));

		// 由上到下：照片輪播（第一張是封面）→ 心情 → 一句話 → 內文
		const reader = h("article", `cd-reader cd-m${e.month}`, scroll);
		const photos = e.photos.length ? e.photos : e.cover ? [{ path: "", url: e.cover }] : [];
		if (photos.length) {
			reader.classList.add("has-cover");
			this.gallery(reader, photos);
		}
		const inner = h("div", "cd-reader-inner", reader);
		if (e.mood) {
			const row = h("div", "cd-reader-mood", inner);
			moodIcon(row, "", e.mood);
			h("span", "cd-reader-mood-label", row, t.moods[e.mood]);
		}
		// 一句話是從內文抓的話，下面的內文就看得到，不要重複
		if (!e.oneLinerFromBody) {
			const quote = h("blockquote", "cd-reader-quote", inner);
			if (e.oneLiner) quote.textContent = e.oneLiner;
			else {
				quote.classList.add("is-empty");
				quote.textContent = t.noOneLinerThatDay;
			}
		}

		const body = h("div", "cd-reader-body markdown-rendered", inner);
		this.host
			.renderBody(e, body)
			.catch((err) => console.error("[diary-cards] 內文顯示失敗", err))
			.then(() => {
				if (!body.isConnected) return; // 已經換到別的畫面了
				if (!body.childElementCount && !body.textContent?.trim()) body.remove();
				// 內文畫好、頁面變長了，才能捲回原本的位置
				if (this.pendingScroll) this.restoreScroll(this.pendingScroll);
				this.pendingScroll = null;
			});

		// 前一篇 / 後一篇（entries 是新到舊排序）
		const idx = this.entries.indexOf(e);
		const newer = this.entries[idx - 1];
		const older = this.entries[idx + 1];
		const pager = h("nav", "cd-pager", scroll);
		this.pagerLink(pager, older, t.older, "is-older");
		this.pagerLink(pager, newer, t.newer, "is-newer");

		this.scrollEl?.classList.add("has-rail");
		this.dayRail(e);
	}

	// ── 所有日記：時間軸 + 搜尋 + 篩選 ─────────────────────────

	/** restoreSaved：從別頁切過來時，回到上次離開時的捲動位置 */
	private renderAll(restoreSaved: boolean) {
		const scroll = this.shell();
		const now = this.now();

		const bar = h("header", "cd-bar", scroll);
		iconButton(bar, "", ICON_BACK, t.backToYear, () => this.go({ kind: "year", year: now.getFullYear() }));
		const title = h("div", "cd-bar-title", bar);
		h("span", "cd-bar-sub", title, t.totalEntries(this.entries.length));
		h("span", "cd-bar-main", title, t.allEntries);
		const actions = h("div", "cd-bar-actions", bar);
		this.todayButton(actions);

		// 搜尋框和篩選固定在上方
		const tools = h("div", "cd-all-tools", scroll);
		const box = h("label", "cd-search", tools);
		const icon = h("span", "cd-search-icon", box);
		setSvg(icon, ICON_SEARCH);
		const input = h("input", "cd-search-input", box);
		input.type = "search";
		input.placeholder = t.searchPlaceholder;
		input.value = this.allQuery;

		const chips = h("div", "cd-filter-row", tools);
		const list = h("div", "cd-all-list", scroll);
		const count = h("p", "cd-hint", tools);

		const chip = (label: string, isOn: () => boolean, toggle: () => void, mood?: Mood) => {
			const b = h("button", "cd-filter-chip", chips);
			if (mood) moodIcon(b, "", mood);
			h("span", "", b, label);
			b.classList.toggle("is-on", isOn());
			b.addEventListener("click", () => {
				toggle();
				chips.querySelectorAll<HTMLButtonElement>(".cd-filter-chip").forEach((x) => x.classList.remove("is-on"));
				draw();
				redrawChips();
			});
			return { b, isOn };
		};
		const chipRefs: { b: HTMLButtonElement; isOn: () => boolean }[] = [];
		const redrawChips = () => chipRefs.forEach((c) => c.b.classList.toggle("is-on", c.isOn()));
		chipRefs.push(chip(t.filterAll, () => !this.allFilter.photos && !this.allFilter.mood, () => (this.allFilter = { photos: false })));
		chipRefs.push(chip(t.filterPhotos, () => this.allFilter.photos, () => (this.allFilter.photos = !this.allFilter.photos)));
		// 照五級的順序，只列出有出現過的
		const used = new Set(this.entries.map((e) => e.mood));
		for (const mood of MOODS.filter((m) => used.has(m))) {
			chipRefs.push(chip(t.moods[mood], () => this.allFilter.mood === mood, () => (this.allFilter.mood = this.allFilter.mood === mood ? undefined : mood), mood));
		}

		const draw = () => {
			const q = this.allQuery.trim().toLowerCase();
			const shown = this.entries.filter((e) => {
				if (this.allFilter.photos && !e.cover) return false;
				if (this.allFilter.mood && e.mood !== this.allFilter.mood) return false;
				if (q && !e.oneLiner.toLowerCase().includes(q) && !this.allHits.has(e.date)) return false;
				return true;
			});
			count.textContent = q || this.allFilter.photos || this.allFilter.mood ? t.found(shown.length) : "";
			list.replaceChildren();
			if (!shown.length) {
				h("div", "cd-empty", list, t.noMatches);
				return;
			}
			let group: HTMLElement | null = null;
			let key = "";
			for (const e of shown) {
				const k = `${e.year}-${e.month}`;
				if (k !== key) {
					key = k;
					const n = shown.filter((x) => x.year === e.year && x.month === e.month).length;
					const head = h("div", `cd-all-month cd-m${e.month}`, list);
					h("span", "cd-all-month-title", head, t.yearMonth(e.year, e.month));
					h("span", "cd-all-month-count", head, t.monthCount(n));
					group = h("div", "cd-list", list);
				}
				const snippet = q && !e.oneLiner.toLowerCase().includes(q) ? this.allHits.get(e.date) : undefined;
				this.dayCard(group!, e, snippet);
			}
		};

		// 一句話的比對馬上做；內文要讀檔，稍等一下再搜
		let timer = 0;
		const runSearch = () => {
			const q = this.allQuery.trim();
			const seq = ++this.searchSeq;
			if (!q) {
				this.allHits = new Map();
				draw();
				return;
			}
			this.host.search(q).then((hits) => {
				if (seq !== this.searchSeq) return;
				this.allHits = hits;
				draw();
			});
		};
		input.addEventListener("input", () => {
			this.allQuery = input.value;
			draw();
			window.clearTimeout(timer);
			timer = window.setTimeout(runSearch, 250);
		});

		draw();
		if (this.allQuery && !this.allHits.size) runSearch();
		// 背景重畫時 render 已經保留了目前位置，不要再跳回上次離開時的位置
		if (restoreSaved) {
			requestAnimationFrame(() => {
				if (this.scrollEl) this.scrollEl.scrollTop = this.allScroll;
			});
		}
		this.fab(t.writeToday, () => this.openEditor(this.todayKey()));
	}

	// ── 快速記錄：一句話、心情、照片、內文 ────────────────────

	private renderEdit(date: string) {
		const [y, m, d] = date.split("-").map(Number);
		const wd = weekdayOf(y, m, d);
		const scroll = this.shell();
		scroll.classList.add("cd-edit");

		const bar = h("header", "cd-bar", scroll);
		iconButton(bar, "", ICON_CLOSE, t.leave, () => this.leaveEdit(date));
		const title = h("div", "cd-bar-title", bar);
		h("span", "cd-bar-sub", title, `${y} · ${t.weekday(wd)}`);
		h("span", "cd-bar-main", title, t.dayTitle(m, d));
		const actions = h("div", "cd-bar-actions", bar);
		const saveBtn = h("button", "cd-save-btn", actions, t.save);

		const warn = h("div", "cd-edit-warn", scroll);
		warn.hidden = true;

		if (!this.edit || this.edit.date !== date) {
			this.edit = null;
			saveBtn.disabled = true;
			h("div", "cd-empty", scroll, t.loading);
			this.host.loadDraft(date).then((dr) => {
				if (this.screen.kind !== "edit" || this.screen.date !== date) return;
				// 封面是內文裡的哪一張；cover 指到內文以外的圖（或讀不到）時記成 null，存檔時不去動它
				const found = dr.photos.findIndex((p) => p.path === dr.coverPath);
				const coverIndex = found >= 0 ? found : dr.hasCover ? null : 0;
				this.edit = {
					date,
					exists: dr.exists,
					oneLiner: dr.oneLiner,
					mood: dr.mood,
					body: dr.body,
					photos: dr.photos.map((photo) => ({ kind: "existing", photo })),
					coverIndex,
					preserved: dr.preserved,
					dirty: false,
					saving: false,
					processing: null,
				};
				this.render(false);
			})
				.catch((err) => {
					// 例如檔案剛被同步刪掉：不要一直卡在「載入中」
					if (this.screen.kind !== "edit" || this.screen.date !== date) return;
					console.error("[diary-cards] 讀取日記失敗", err);
					scroll.querySelector(".cd-empty")?.remove();
					warn.hidden = false;
					warn.textContent = t.loadFailed(err instanceof Error ? err.message : String(err));
				});
			return;
		}
		const st = this.edit;
		const touch = () => {
			st.dirty = true;
			this.leaveArmed = false;
			warn.hidden = true;
		};
		saveBtn.addEventListener("click", () => this.saveEdit(saveBtn, warn));
		// 照片還在處理時不能存，不然只會存到已經處理好的那幾張
		const paintSave = () => {
			const p = st.processing;
			saveBtn.disabled = !!p || st.saving;
			saveBtn.textContent = p ? t.processingPhotosSave(p.done, p.total) : t.save;
		};
		paintSave();

		const form = h("div", `cd-form cd-m${m}`, scroll);

		// 一句話
		h("label", "cd-field-label", form, t.fieldOneLiner);
		const one = h("textarea", "cd-one-input", form);
		one.rows = 1;
		one.placeholder = t.oneLinerPlaceholder;
		one.value = st.oneLiner;
		// 跟著內容長高，長句子不會被藏在框外
		const fit = () => {
			one.style.height = "auto";
			one.style.height = `${one.scrollHeight + 2}px`;
		};
		// 寬度變了（畫面剛排好、旋轉手機、拉側欄）就重算；輸入框離開畫面後停止觀察
		let lastWidth = 0;
		const ro = new ResizeObserver(() => {
			if (!one.isConnected) return ro.disconnect();
			if (one.clientWidth === lastWidth) return;
			lastWidth = one.clientWidth;
			fit();
		});
		ro.observe(one);
		one.addEventListener("input", () => {
			st.oneLiner = one.value.replace(/\n/g, " ");
			fit();
			touch();
		});

		// 心情
		h("label", "cd-field-label", form, t.fieldMood);
		const moods = h("div", "cd-mood-row", form);
		const moodBtns = MOODS.map((mood) => {
			const b = h("button", `cd-mood-btn cd-mood-${mood}`, moods);
			moodIcon(b, "", mood);
			h("span", "cd-mood-btn-label", b, t.moods[mood]);
			b.setAttribute("aria-pressed", String(mood === st.mood));
			if (mood === st.mood) b.classList.add("is-on");
			b.addEventListener("click", () => {
				st.mood = st.mood === mood ? undefined : mood;
				moodBtns.forEach(({ b: x, mood: m }) => {
					x.classList.toggle("is-on", m === st.mood);
					x.setAttribute("aria-pressed", String(m === st.mood));
				});
				touch();
			});
			return { b, mood };
		});

		// 照片
		const photoHead = h("div", "cd-field-head", form);
		h("label", "cd-field-label", photoHead, t.fieldPhotos);
		h("span", "cd-field-note", photoHead, t.tapToSetCover);
		const strip = h("div", "cd-photo-strip", form);
		const drawPhotos = () => {
			strip.replaceChildren();
			st.photos.forEach((p, i) => {
				const tile = tappable(strip, "cd-photo-tile", () => {
					st.coverIndex = i;
					touch();
					drawPhotos();
				});
				const img = h("img", "", tile);
				img.src = p.kind === "existing" ? p.photo.url : p.url;
				img.alt = "";
				if (i === st.coverIndex) {
					tile.classList.add("is-cover");
					h("span", "cd-photo-badge", tile, t.coverBadge);
				}
				const del = h("button", "cd-photo-del", tile);
				setSvg(del, ICON_CLOSE);
				del.setAttribute("aria-label", t.removePhoto);
				del.addEventListener("click", (ev) => {
					ev.stopPropagation();
					st.photos.splice(i, 1);
					// 刪到封面就改用第一張；刪到封面前面的，封面跟著往前一格
					if (st.coverIndex === i) st.coverIndex = 0;
					else if (st.coverIndex !== null && st.coverIndex > i) st.coverIndex--;
					touch();
					drawPhotos();
				});
			});
			const add = h("label", "cd-photo-add" + (st.processing ? " is-busy" : ""), strip);
			setSvg(add, ICON_PLUS);
			h("span", "", add, st.processing ? t.processingPhotos(st.processing.done, st.processing.total) : t.addPhoto);
			const input = h("input", "", add);
			input.type = "file";
			input.accept = "image/*";
			input.multiple = true;
			input.addEventListener("change", async () => {
				const files = Array.from(input.files ?? []);
				if (!files.length || st.processing) return;
				const progress = { total: files.length, done: 0, failed: 0 };
				st.processing = progress;
				touch();
				paintSave();
				drawPhotos();
				// 一張一張處理（手機記憶體有限），處理好一張就先顯示出來
				for (const f of files) {
					try {
						st.photos.push(await prepareImage(f));
					} catch (err) {
						// 例如 Google 相簿裡還沒下載到手機的照片讀不到；跳過這張，其他照常加入
						console.error("[diary-cards] 讀取照片失敗", f.name, err);
						progress.failed++;
					}
					progress.done++;
					paintSave();
					drawPhotos();
				}
				st.processing = null;
				paintSave();
				drawPhotos();
				if (progress.failed) {
					warn.hidden = false;
					warn.textContent = t.photosFailed(progress.failed);
				}
			});
		};
		drawPhotos();

		// 內文
		h("label", "cd-field-label", form, t.fieldBody);
		const body = h("textarea", "cd-body-input", form);
		body.rows = 8;
		body.placeholder = t.bodyPlaceholder;
		body.value = st.body;
		body.addEventListener("input", () => {
			st.body = body.value;
			touch();
		});

		const more = h("button", "cd-open-obsidian", scroll, t.openInObsidian);
		more.addEventListener("click", async () => {
			if (st.dirty && !(await this.saveEdit(saveBtn, warn, false))) return;
			this.edit = null;
			// 這個分頁離開編輯畫面，不然切回來時還是舊的表單，按儲存也沒反應
			this.showAfterEdit(date);
			await this.host.openInObsidian(date);
		});

		if (!st.exists && !st.oneLiner) requestAnimationFrame(() => one.focus());
	}

	/** 儲存；成功回傳 true。goToEntry 為 true 時存完跳到單篇頁 */
	private async saveEdit(btn: HTMLButtonElement, warn: HTMLElement, goToEntry = true): Promise<boolean> {
		const st = this.edit;
		if (!st || st.saving || st.processing) return false;
		st.saving = true;
		btn.disabled = true;
		btn.textContent = t.saving;
		try {
			await this.host.saveEntry({
				date: st.date,
				oneLiner: st.oneLiner.trim(),
				mood: st.mood,
				body: st.body,
				photos: st.photos,
				coverIndex: st.coverIndex,
				preserved: st.preserved,
			});
		} catch (err) {
			st.saving = false;
			btn.disabled = false;
			btn.textContent = t.save;
			warn.hidden = false;
			warn.textContent = t.saveFailed(err instanceof Error ? err.message : String(err));
			return false;
		}
		st.dirty = false;
		this.edit = null;
		if (goToEntry) {
			// 新日記要等 Obsidian 讀到檔案後才會出現在清單裡
			if (this.byDate.has(st.date)) this.go({ kind: "entry", date: st.date });
			else {
				this.pendingDate = st.date;
				setTimeout(() => {
					if (this.pendingDate !== st.date) return;
					this.pendingDate = null;
					const [y, m] = st.date.split("-").map(Number);
					this.go({ kind: "month", year: y, month: m });
				}, 3000);
			}
		}
		return true;
	}

	/** 離開快速記錄；有沒存的修改時要再按一次才會離開 */
	private leaveEdit(date: string) {
		if (this.edit?.dirty && !this.leaveArmed) {
			this.leaveArmed = true;
			const warn = this.root.querySelector<HTMLElement>(".cd-edit-warn");
			if (warn) {
				warn.hidden = false;
				warn.textContent = t.unsavedLeave;
			}
			return;
		}
		this.leaveArmed = false;
		this.edit = null;
		this.showAfterEdit(date);
	}

	/** 離開編輯畫面後：有這篇日記就看這篇，還沒有就回到那個月 */
	private showAfterEdit(date: string) {
		const [y, m] = date.split("-").map(Number);
		if (this.byDate.has(date)) this.go({ kind: "entry", date });
		else this.go({ kind: "month", year: y, month: m });
	}

	/** 單篇頁上方的照片輪播：左右滑或按 ‹ › 切換 */
	private gallery(parent: HTMLElement, photos: Photo[]) {
		const box = h("div", "cd-gallery", parent);
		const track = h("div", "cd-gallery-track", box);
		track.tabIndex = 0;
		photos.forEach((p, i) => {
			const slide = h("div", "cd-gallery-slide", track);
			// 模糊的同一張照片當背景，直的照片兩側才不會空白
			slide.style.setProperty("--cd-img", `url("${p.url}")`);
			const img = h("img", "", slide);
			img.src = p.url;
			img.alt = "";
			if (i > 0) img.loading = "lazy";
		});
		if (photos.length < 2) return;

		const counter = h("span", "cd-gallery-counter", box, `1 / ${photos.length}`);
		const dots = h("div", "cd-gallery-dots", box);
		const dotEls = photos.map((_, i) => h("span", i === 0 ? "cd-gallery-dot is-on" : "cd-gallery-dot", dots));

		const index = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
		const goTo = (i: number) => {
			const n = Math.min(photos.length - 1, Math.max(0, i));
			track.scrollTo({ left: n * track.clientWidth, behavior: smoothOrAuto() });
		};
		iconButton(box, "cd-gallery-arrow is-prev", ICON_LEFT, t.prevPhoto, () => goTo(index() - 1));
		iconButton(box, "cd-gallery-arrow is-next", ICON_RIGHT, t.nextPhoto, () => goTo(index() + 1));
		track.addEventListener("keydown", (ev) => {
			if (ev.key === "ArrowLeft") goTo(index() - 1);
			else if (ev.key === "ArrowRight") goTo(index() + 1);
			else return;
			ev.preventDefault();
		});

		let frame = 0;
		track.addEventListener("scroll", () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const i = index();
				counter.textContent = `${i + 1} / ${photos.length}`;
				dotEls.forEach((d, j) => d.classList.toggle("is-on", j === i));
				box.classList.toggle("at-start", i === 0);
				box.classList.toggle("at-end", i === photos.length - 1);
			});
		});
		box.classList.add("at-start");
	}

	private pagerLink(parent: HTMLElement, e: DiaryEntry | undefined, label: string, cls: string) {
		if (!e) {
			h("div", "cd-pager-btn is-placeholder " + cls, parent);
			return;
		}
		const btn = tappable(parent, "cd-pager-btn " + cls, () => this.go({ kind: "entry", date: e.date }));
		h("span", "cd-pager-label", btn, `${label} · ${e.month}/${e.day}`);
		h("span", "cd-pager-text", btn, e.oneLiner || t.pagerEmpty);
	}
}

