import {
	App,
	CachedMetadata,
	Component,
	debounce,
	ItemView,
	FrontMatterCache,
	getLanguage,
	MarkdownRenderer,
	moment,
	normalizePath,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_DATE_FORMAT, diaryNotePath, DiaryDate, fillTemplate, parseDiaryDate } from "./dates";
import { Locale, localeFromLanguage, setLocale, t } from "./i18n";
import { EMBED_LINE_RE, placePhotos, PRESERVED_LINE_RE, splitPhotos } from "./photos";
import { bodySummary, FRONTMATTER_RE, stripFrontmatter } from "./summary";
import { DiaryEntry, DiaryUI, Draft, parseMood, Photo, SaveInput, Screen } from "./ui";

const VIEW_TYPE = "diary-cards-view";
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic)$/i;

interface DiaryCardsSettings {
	/** 日記所在的資料夾，空白代表整個 vault */
	folder: string;
	/** 檔名的日期格式（Moment.js），可以含資料夾，例如 YYYY/MM/YYYY-MM-DD */
	dateFormat: string;
	/** 當作「一句話」的 frontmatter 欄位 */
	oneLinerKey: string;
	/** 當作心情的 frontmatter 欄位 */
	moodKey: string;
	/** 新日記是否放進年份子資料夾，例如 Journal/2026/ */
	yearSubfolder: boolean;
	/** 新日記使用的範本檔，空白就用內建的 */
	templatePath: string;
	/** 手動選的每月封面：YYYY-MM → 圖片在 vault 裡的路徑 */
	monthCovers: Record<string, string>;
	/** 打開時顯示的畫面 */
	startScreen: "month" | "year" | "last";
	/** 一週從哪天開始；auto 是跟著 Obsidian 的語言 */
	weekStart: "auto" | "sunday" | "monday";
	/** 心情的配色 */
	moodPalette: "warm" | "classic" | "soft" | "mono";
}

/** Obsidian 的介面語言 */
function obsidianLocale(): Locale {
	return localeFromLanguage(getLanguage());
}

/** frontmatter 裡某個欄位的值（Obsidian 給的型別是 any，這裡當成 unknown 處理） */
function fmValue(fm: FrontMatterCache | undefined, key: string): unknown {
	const value: unknown = fm?.[key];
	return value;
}

/** 把 frontmatter 的值轉成字串；物件、陣列之類的不算 */
function fmText(v: unknown): string {
	return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v).trim() : "";
}

/** 預設值；欄位名稱跟著介面語言（中文的 vault 用中文欄位） */
function defaultSettings(): DiaryCardsSettings {
	const keys = { "zh-TW": ["一句話", "心情"], "zh-CN": ["一句话", "心情"], en: ["summary", "mood"] }[obsidianLocale()];
	return {
		folder: "",
		dateFormat: DEFAULT_DATE_FORMAT,
		oneLinerKey: keys[0],
		moodKey: keys[1],
		yearSubfolder: false,
		templatePath: "",
		monthCovers: {},
		startScreen: "month",
		weekStart: "auto",
		moodPalette: "warm",
	};
}

export default class DiaryCardsPlugin extends Plugin {
	settings!: DiaryCardsSettings;

	/** 一週的第一天：0 星期日、1 星期一 */
	weekStart(): 0 | 1 {
		const ws = this.settings.weekStart;
		if (ws === "sunday") return 0;
		if (ws === "monday") return 1;
		// Obsidian 會把 moment 的語言設成介面語言：繁中、英文是星期日，簡中、英式英文是星期一
		return moment.localeData().firstDayOfWeek() === 1 ? 1 : 0;
	}
	/** 沒填一句話的日記：路徑 → 內文第一段（檔案改過就重讀） */
	private summaries = new Map<string, { mtime: number; text: string }>();

	async onload() {
		setLocale(obsidianLocale());
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new DiaryCardsView(leaf, this));
		this.addRibbonIcon("book-heart", t.viewTitle, () => this.activateView());
		this.addCommand({ id: "open", name: t.cmdOpen, callback: () => this.activateView() });
		this.addCommand({
			id: "write-today",
			name: t.writeToday,
			callback: async () => {
				const view = await this.activateView();
				view?.openEditor(todayKey());
			},
		});
		this.addSettingTab(new DiaryCardsSettingTab(this.app, this));
		// 筆記裡的連結可以直接打開：obsidian://diary-cards，加上 ?write=today 直接寫今天
		this.registerObsidianProtocolHandler("diary-cards", async (params) => {
			const view = await this.activateView();
			if (params.write === "today") view?.openEditor(todayKey());
		});

		const refresh = debounce(() => this.refreshViews(), 300, true);
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.metadataCache.on("changed", refresh));
			this.registerEvent(this.app.vault.on("delete", refresh));
			this.registerEvent(this.app.vault.on("rename", refresh));
			this.registerEvent(this.app.metadataCache.on("resolved", refresh));
			this.refreshViews();
		});
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<DiaryCardsSettings> | null;
		// 第一次安裝：沿用 Obsidian 內建「日記」外掛的資料夾、日期格式和範本
		const base = saved ? defaultSettings() : { ...defaultSettings(), ...(await this.dailyNotesSettings()) };
		this.settings = Object.assign(base, saved);
	}

	/** 內建「日記」外掛的設定（.obsidian/daily-notes.json），讀不到就回傳空的 */
	private async dailyNotesSettings(): Promise<Partial<DiaryCardsSettings>> {
		try {
			const path = normalizePath(`${this.app.vault.configDir}/daily-notes.json`);
			const raw = JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, unknown>;
			const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
			const out: Partial<DiaryCardsSettings> = {};
			if (str(raw.folder)) out.folder = str(raw.folder);
			if (str(raw.format)) out.dateFormat = str(raw.format);
			// 範本設定可以省略 .md
			if (str(raw.template)) out.templatePath = str(raw.template).replace(/(\.md)?$/, ".md");
			return out;
		} catch {
			return {};
		}
	}

	// data.json 被 Syncthing 從手機同步過來時，重新讀取
	async onExternalSettingsChange() {
		await this.loadSettings();
		this.refreshViews();
	}

	/** 打開日記卡片時要顯示的畫面；saved 是上次關掉時停留的畫面 */
	startScreen(saved: Screen | null): Screen {
		const now = new Date();
		const thisMonth: Screen = { kind: "month", year: now.getFullYear(), month: now.getMonth() + 1 };
		if (this.settings.startScreen === "year") return { kind: "year", year: now.getFullYear() };
		if (this.settings.startScreen === "last" && saved) {
			// 不還原到編輯畫面，改成顯示那篇日記
			return saved.kind === "edit" ? { kind: "entry", date: saved.date } : saved;
		}
		return thisMonth;
	}

	async setMonthCover(ym: string, path: string | null) {
		const covers = { ...this.settings.monthCovers };
		if (path) covers[ym] = path;
		else delete covers[ym];
		this.settings.monthCovers = covers;
		await this.saveSettings();
	}

	monthCoverPhotos(): Map<string, Photo> {
		const out = new Map<string, Photo>();
		for (const [ym, path] of Object.entries(this.settings.monthCovers ?? {})) {
			const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
			if (file instanceof TFile) out.set(ym, { path: file.path, url: this.app.vault.getResourcePath(file) });
		}
		return out;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.refreshViews();
	}

	async activateView(): Promise<DiaryCardsView | null> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof DiaryCardsView ? leaf.view : null;
	}

	refreshViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DiaryCardsView) view.refresh();
		}
	}

	private folderPrefix(): string {
		const folder = normalizePath(this.settings.folder.trim() || "/");
		return folder === "/" ? "" : folder + "/";
	}

	collectEntries(): DiaryEntry[] {
		const prefix = this.folderPrefix();
		const seen = new Set<string>();
		const entries: DiaryEntry[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (prefix && !file.path.startsWith(prefix)) continue;
			const date = this.dateOf(file);
			if (!date || seen.has(date.key)) continue;
			seen.add(date.key);

			const cache = this.app.metadataCache.getFileCache(file);
			const oneLiner = fmText(fmValue(cache?.frontmatter, this.settings.oneLinerKey));
			const hasOneLiner = oneLiner !== "";
			const mood = fmValue(cache?.frontmatter, this.settings.moodKey);
			entries.push({
				date: date.key,
				year: date.year,
				month: date.month,
				day: date.day,
				// 沒填一句話就用內文第一段（先用快取，沒有的話 fillSummaries 會補上）
				oneLiner: hasOneLiner ? oneLiner : this.cachedSummary(file),
				oneLinerFromBody: !hasOneLiner,
				mood: parseMood(mood),
				...this.findPhotos(file, cache),
				path: file.path,
				mtime: file.stat.mtime,
			});
		}
		return entries;
	}

	private dateFormat(): string {
		return this.settings.dateFormat.trim() || DEFAULT_DATE_FORMAT;
	}

	/** 從檔名（日期格式含資料夾時是路徑）看出是哪一天；不是日記就回傳 null */
	private dateOf(file: TFile): DiaryDate | null {
		return parseDiaryDate(file.path.slice(0, -file.extension.length - 1), this.dateFormat());
	}

	private cachedSummary(file: TFile): string {
		const hit = this.summaries.get(file.path);
		return hit && hit.mtime === file.stat.mtime ? hit.text : "";
	}

	/**
	 * 讀出沒填一句話的日記的內文第一段，存進快取。
	 * 只讀還沒讀過或有改過的檔案；有新的摘要就回傳 true，讓畫面重畫一次。
	 */
	async fillSummaries(entries: DiaryEntry[]): Promise<boolean> {
		let changed = false;
		for (const e of entries) {
			const file = this.fileFor(e);
			if (!file) continue;
			const raw = fmValue(this.app.metadataCache.getFileCache(file)?.frontmatter, this.settings.oneLinerKey);
			if (fmText(raw)) continue;
			const hit = this.summaries.get(file.path);
			if (hit && hit.mtime === file.stat.mtime) continue;
			const text = bodySummary(stripFrontmatter(await this.app.vault.cachedRead(file)));
			this.summaries.set(file.path, { mtime: file.stat.mtime, text });
			if (text !== (hit?.text ?? "")) changed = true;
		}
		return changed;
	}

	/** 內文裡的所有圖片；封面是 frontmatter 的 cover 欄位，沒有就用第一張圖 */
	private findPhotos(file: TFile, cache: CachedMetadata | null): { cover?: string; photos: Photo[] } {
		const photos: Photo[] = [];
		for (const embed of cache?.embeds ?? []) {
			const photo = this.resolveImage(embed.link, file);
			if (photo && !photos.some((p) => p.path === photo.path)) photos.push(photo);
		}
		// frontmatter 指定的封面排到第一張
		const fmCover = fmValue(cache?.frontmatter, "cover");
		if (typeof fmCover === "string" && fmCover.trim()) {
			const photo = this.resolveImage(fmCover.trim().replace(/^!?\[\[|\]\]$/g, ""), file);
			if (photo) {
				const i = photos.findIndex((p) => p.path === photo.path);
				if (i >= 0) photos.splice(i, 1);
				photos.unshift(photo);
			}
		}
		return { cover: photos[0]?.url, photos };
	}

	resolveImage(link: string, file: TFile): Photo | null {
		if (/^https?:\/\//.test(link)) {
			return IMAGE_RE.test(link.split("?")[0]) ? { path: link, url: link } : null;
		}
		let path = link.split("|")[0].split("#")[0];
		try {
			path = decodeURIComponent(path);
		} catch {
			// 保留原本的字串
		}
		if (!IMAGE_RE.test(path)) return null;
		let dest = this.app.metadataCache.getFirstLinkpathDest(path, file.path);
		if (!dest) {
			// 相對路徑的 Markdown 連結，例如 ../../_attachments/a.jpg
			const joined = resolveRelative(file.parent?.path ?? "", path);
			const found = this.app.vault.getAbstractFileByPath(joined);
			if (found instanceof TFile) dest = found;
		}
		return dest ? { path: dest.path, url: this.app.vault.getResourcePath(dest) } : null;
	}

	fileFor(entry: DiaryEntry): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(entry.path);
		return file instanceof TFile ? file : null;
	}

	async openFile(file: TFile) {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file, { state: { mode: "source" } });
	}

	fileForDate(date: string): TFile | null {
		const entry = this.collectEntries().find((e) => e.date === date);
		return entry ? this.fileFor(entry) : null;
	}

	/** 用 Obsidian 本身的編輯器打開某一天，不存在就先建立 */
	async openInObsidian(date: string) {
		try {
			const file = this.fileForDate(date) ?? (await this.createNoteFile(date));
			await this.openFile(file);
		} catch (err) {
			console.error("[diary-cards] 建立日記失敗", err);
			new Notice(t.createFailed(err instanceof Error ? err.message : String(err)));
		}
	}

	/** 新日記的路徑，例如 Journal/2026/2026-09-24.md */
	notePath(date: string, yearSubfolder = this.settings.yearSubfolder): string {
		return normalizePath(diaryNotePath(date, this.dateFormat(), this.settings.folder, yearSubfolder) + ".md");
	}

	private async createNoteFile(date: string): Promise<TFile> {
		const path = this.notePath(date);
		const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		if (dir) await this.ensureFolder(dir);
		return this.app.vault.create(path, await this.templateContent(date));
	}

	async loadDraft(date: string): Promise<Draft> {
		const file = this.fileForDate(date);
		if (!file) return { date, exists: false, oneLiner: "", body: "", photos: [], hasCover: false, preserved: [] };

		const text = await this.app.vault.read(file);
		const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
		const split = this.splitPhotos(text, file);
		const photos = split.photos.map(({ path }) => {
			const f = this.app.vault.getAbstractFileByPath(path);
			return { path, url: f instanceof TFile ? this.app.vault.getResourcePath(f) : path };
		});
		const cover = typeof fm.cover === "string" ? this.resolveImage(fm.cover.replace(/^!?\[\[|\]\]$/g, ""), file) : null;
		const str = fmText;
		return {
			date,
			exists: true,
			oneLiner: str(fm[this.settings.oneLinerKey]),
			mood: parseMood(fm[this.settings.moodKey]),
			body: split.body,
			photos,
			coverPath: cover?.path,
			hasCover: typeof fm.cover === "string" && fm.cover.trim() !== "",
			preserved: split.preserved,
		};
	}

	/** 內文裡單獨一行的圖片和它們的位置（路徑是 vault 裡的路徑） */
	private splitPhotos(text: string, file: TFile) {
		return splitPhotos(stripFrontmatter(text), (link) => this.resolveImage(link, file)?.path ?? null);
	}

	async search(query: string): Promise<Map<string, string>> {
		const q = query.toLowerCase();
		const hits = new Map<string, string>();
		for (const e of this.collectEntries()) {
			const file = this.fileFor(e);
			if (!file) continue;
			// 圖片連結和保留的標記不算內文
			const body = stripFrontmatter(await this.app.vault.cachedRead(file))
				.split("\n")
				.filter((l) => !EMBED_LINE_RE.test(l) && !PRESERVED_LINE_RE.test(l.trim()))
				.join(" ")
				.replace(/\s+/g, " ");
			const i = body.toLowerCase().indexOf(q);
			if (i < 0) continue;
			const start = Math.max(0, i - 16);
			const end = Math.min(body.length, i + q.length + 24);
			hits.set(e.date, (start > 0 ? "…" : "") + body.slice(start, end).trim() + (end < body.length ? "…" : ""));
		}
		return hits;
	}

	async saveEntry(input: SaveInput) {
		const existing = this.fileForDate(input.date);
		const file = existing ?? (await this.createNoteFile(input.date));

		// 新照片存進附件資料夾（照 Obsidian「附件存放位置」的設定）
		const paths: string[] = [];
		for (const [i, p] of input.photos.entries()) {
			if (p.kind === "existing") {
				paths.push(p.photo.path);
				continue;
			}
			const target = await this.app.fileManager.getAvailablePathForAttachment(`${input.date}.${p.ext}`, file.path);
			const created = await this.app.vault.createBinary(target, p.data);
			paths.push(created.path);
			// 換成「已經存好的照片」：後面的步驟失敗、再按一次儲存時，不會把同一張照片又存一份
			input.photos[i] = { kind: "existing", photo: { path: created.path, url: this.app.vault.getResourcePath(created) } };
		}
		const existingPaths = new Set(input.photos.flatMap((p) => (p.kind === "existing" ? [p.photo.path] : [])));
		const links = paths.map((path) => {
			const f = this.app.vault.getAbstractFileByPath(path);
			// 連結格式也照 Obsidian 的設定（你的 vault 是相對路徑的 Markdown 連結）
			return f instanceof TFile ? "!" + this.app.fileManager.generateMarkdownLink(f, file.path) : `![](${path})`;
		});

		await this.app.vault.process(file, (text) => {
			const match = FRONTMATTER_RE.exec(text)?.[0];
			const fm = match ?? "---\n---\n";
			// 剛從範本建立的新日記：保留範本的內文，寫的內容接在後面
			const template = existing ? "" : text.slice(match?.length ?? 0).trim();
			// 原本就在內文裡的照片放回原來的位置，新照片接在最後
			const anchors = new Map(this.splitPhotos(text, file).photos.map((p) => [p.path, p.anchor]));
			const withPhotos = placePhotos(
				input.body,
				paths.map((path, i) => ({ link: links[i], anchor: existingPaths.has(path) ? anchors.get(path) : undefined }))
			);
			const body = [template, input.preserved.join("\n"), withPhotos].filter(Boolean).join("\n\n");
			return (fm.endsWith("\n") ? fm : fm + "\n") + body + "\n";
		});

		// frontmatter 交給 Obsidian 寫，含冒號之類的特殊字元會自動加引號
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[this.settings.oneLinerKey] = input.oneLiner || null;
			// 取消選擇時清空；不是 1～5 的值（例如手打的字）不動，免得被洗掉
			if (input.mood) fm[this.settings.moodKey] = input.mood;
			else if (parseMood(fm[this.settings.moodKey]) !== undefined) fm[this.settings.moodKey] = null;
			// coverIndex 是 null：封面不是內文裡的照片（手動填的），不要動
			if (input.coverIndex !== null) {
				if (paths.length) fm.cover = paths[Math.min(input.coverIndex, paths.length - 1)];
				else delete fm.cover;
			}
		});
	}

	private async ensureFolder(dir: string) {
		let current = "";
		for (const seg of dir.split("/")) {
			current = current ? `${current}/${seg}` : seg;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	private async templateContent(date: string): Promise<string> {
		const tplPath = this.settings.templatePath.trim();
		if (tplPath) {
			const tpl = this.app.vault.getAbstractFileByPath(normalizePath(tplPath));
			if (tpl instanceof TFile) return fillTemplate(await this.app.vault.read(tpl), date, this.dateFormat());
		}
		return `---\n${this.settings.oneLinerKey}:\n${this.settings.moodKey}:\n---\n`;
	}
}

function todayKey(): string {
	const t = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

class DiaryCardsView extends ItemView {
	private ui: DiaryUI | null = null;
	private bodyComponent: Component | null = null;
	private pendingScreen: Screen | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: DiaryCardsPlugin) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return t.viewTitle;
	}

	getIcon() {
		return "book-heart";
	}

	async onOpen() {
		this.contentEl.addClass("cd-view");
		this.ui = new DiaryUI(this.contentEl, {
			loadDraft: (date) => this.plugin.loadDraft(date),
			saveEntry: (input) => this.plugin.saveEntry(input),
			openInObsidian: (date) => this.plugin.openInObsidian(date),
			search: (query) => this.plugin.search(query),
			renderBody: (entry, el) => this.renderBody(entry, el),
			setMonthCover: (ym, path) => void this.plugin.setMonthCover(ym, path),
			onNavigate: () => this.app.workspace.requestSaveLayout(),
		});
		this.registerEvent(this.app.workspace.on("layout-change", () => this.ui?.measureBottomInset()));
		this.refresh();
		this.ui.go(this.pendingScreen ?? this.plugin.startScreen(null));
		this.pendingScreen = null;
	}

	async onClose() {
		this.ui?.destroy();
		this.ui = null;
	}

	openEditor(date: string) {
		if (this.ui) this.ui.openEditor(date);
		else this.pendingScreen = { kind: "edit", date };
	}

	refresh() {
		if (!this.ui) return;
		this.ui.setPalette(this.plugin.settings.moodPalette);
		this.ui.setWeekStart(this.plugin.weekStart());
		// 封面和日記一起更新，只重畫一次
		this.ui.setMonthCovers(this.plugin.monthCoverPhotos(), false);
		const entries = this.plugin.collectEntries();
		this.ui.setEntries(entries);
		// 沒填一句話的日記要讀內文才知道第一段，讀完有新東西再畫一次
		void this.plugin.fillSummaries(entries).then((changed) => {
			if (changed && this.ui) this.ui.setEntries(this.plugin.collectEntries());
		});
	}

	// 記住上次停在哪個畫面，重新打開 Obsidian 時回到同一頁
	getState(): Record<string, unknown> {
		return { screen: this.ui?.getScreen() ?? null };
	}

	async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]) {
		// Obsidian 重新打開時會帶著上次的畫面來，照設定決定要不要還原。
		// 在 Obsidian 裡切換分頁不會呼叫這裡，畫面會維持原樣。
		const saved = (state as { screen?: Screen } | null)?.screen;
		if (saved) {
			const screen = this.plugin.startScreen(saved);
			if (this.ui) this.ui.go(screen);
			else this.pendingScreen = screen;
		}
		await super.setState(state, result);
	}

	private async renderBody(entry: DiaryEntry, el: HTMLElement) {
		const file = this.plugin.fileFor(entry);
		if (!file) return;
		const text = await this.app.vault.cachedRead(file);
		// 照片已經在上方的輪播裡了，內文就不再重複
		const body = this.removeImageEmbeds(stripFrontmatter(text), file).trim();
		if (!body) return;

		if (this.bodyComponent) this.removeChild(this.bodyComponent);
		this.bodyComponent = this.addChild(new Component());
		await MarkdownRenderer.render(this.app, body, el, file.path, this.bodyComponent);
	}

	/** 拿掉內文裡的圖片嵌入（![[a.jpg]]、![](a.jpg)），影片和其他嵌入保留 */
	private removeImageEmbeds(text: string, file: TFile): string {
		const isImage = (link: string) => this.plugin.resolveImage(link, file) !== null;
		return text
			.replace(/!\[\[([^\]]+)\]\]/g, (m, link: string) => (isImage(link) ? "" : m))
			.replace(/!\[[^\]]*\]\(\s*<?([^)>]+?)>?(?:\s+"[^"]*")?\s*\)/g, (m, link: string) => (isImage(link) ? "" : m))
			.replace(/\n{3,}/g, "\n\n");
	}
}

function resolveRelative(dir: string, rel: string): string {
	const parts = dir && dir !== "/" ? dir.split("/") : [];
	for (const seg of rel.split("/")) {
		if (seg === "..") parts.pop();
		else if (seg && seg !== ".") parts.push(seg);
	}
	return normalizePath(parts.join("/"));
}


class DiaryCardsSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: DiaryCardsPlugin) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const defaults = defaultSettings();

		new Setting(containerEl)
			.setName(t.setFolder)
			.setDesc(t.setFolderDesc)
			.addText((x) =>
				x.setPlaceholder("Journal").setValue(s.folder).onChange(async (v) => {
					s.folder = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t.setDateFormat)
			.setDesc(t.setDateFormatDesc)
			.addText((x) =>
				x.setPlaceholder(DEFAULT_DATE_FORMAT).setValue(s.dateFormat).onChange(async (v) => {
					s.dateFormat = v.trim() || DEFAULT_DATE_FORMAT;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t.setOneLiner)
			.setDesc(t.setOneLinerDesc)
			.addText((x) =>
				x.setPlaceholder(defaults.oneLinerKey).setValue(s.oneLinerKey).onChange(async (v) => {
					s.oneLinerKey = v.trim() || defaults.oneLinerKey;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t.setMood)
			.setDesc(t.setMoodDesc)
			.addText((x) =>
				x.setPlaceholder(defaults.moodKey).setValue(s.moodKey).onChange(async (v) => {
					s.moodKey = v.trim() || defaults.moodKey;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t.setStart)
			.setDesc(t.setStartDesc)
			.addDropdown((d) =>
				d
					.addOptions({ month: t.setStartMonth, year: t.setStartYear, last: t.setStartLast })
					.setValue(s.startScreen)
					.onChange(async (v) => {
						s.startScreen = v as DiaryCardsSettings["startScreen"];
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t.setPalette)
			.setDesc(t.setPaletteDesc)
			.addDropdown((d) =>
				d
					.addOptions({ warm: t.paletteWarm, classic: t.paletteClassic, soft: t.paletteSoft, mono: t.paletteMono })
					.setValue(s.moodPalette)
					.onChange(async (v) => {
						s.moodPalette = v as DiaryCardsSettings["moodPalette"];
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t.setWeekStart)
			.addDropdown((d) =>
				d
					.addOptions({ auto: t.setWeekStartAuto, sunday: t.weekday(0), monday: t.weekday(1) })
					.setValue(s.weekStart)
					.onChange(async (v) => {
						s.weekStart = v as DiaryCardsSettings["weekStart"];
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t.setYearFolder)
			.setDesc(t.setYearFolderDesc(this.plugin.notePath(todayKey(), true)))
			.addToggle((x) =>
				x.setValue(s.yearSubfolder).onChange(async (v) => {
					s.yearSubfolder = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t.setTemplate)
			.setDesc(t.setTemplateDesc)
			.addText((x) =>
				x.setPlaceholder("Templates/Daily.md").setValue(s.templatePath).onChange(async (v) => {
					s.templatePath = v;
					await this.plugin.saveSettings();
				})
			);
	}
}
