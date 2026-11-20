// 不開 Obsidian 也能看介面：用假資料跑 DiaryUI。
// 執行 `npm run preview` 後，用瀏覽器打開 preview/index.html。
import { setLocale } from "../src/i18n";
import PHOTO_IDS from "./photo-ids.json";
import { bodySummary } from "../src/summary";
import { DiaryEntry, DiaryUI, toDateKey } from "../src/ui";

// Obsidian 的全域函式（createEl、activeDocument、instanceOf）在 index.html 裡補上簡易版本

// 網址加 ?lang=en 或 ?lang=zh-CN 看英文、簡體介面（英文時範例日記也用英文，給 README 截圖用）
const lang = new URLSearchParams(location.search).get("lang");
if (lang === "en" || lang === "zh-CN") setLocale(lang);
const EN = lang === "en";

const LINES_ZH = [
	"和朋友下午去運動公園，晚上去夜市，開心地吃了好多東西，回家的路上還下了一點雨",
	"晚上和實驗室學弟妹們去吃烤肉",
	"整天在改論文，終於把第三章寫完",
	"下雨，窩在宿舍看了一部電影",
	"跟媽媽視訊，聊了很久",
	"實驗結果不太好，明天再試一次",
	"去河堤騎腳踏車，夕陽很漂亮",
	"meeting 被老師稱讚了",
	"",
	"早起去買了早餐店的蛋餅",
	"讀書會報告結束，放鬆",
];
// 跟中文一樣多句，隨機抽到的日子才會一樣
const LINES_EN = [
	"Park with friends in the afternoon, night market in the evening, ate way too much, and it drizzled on the way home",
	"Barbecue with the lab juniors",
	"Spent all day on the thesis and finally finished chapter three",
	"Rainy day, watched a movie in the dorm",
	"Long video call with Mom",
	"Experiment didn't go well, trying again tomorrow",
	"Biked along the river, beautiful sunset",
	"My advisor liked my meeting update",
	"",
	"Got up early for breakfast at the corner shop",
	"Reading group presentation done, time to relax",
];
const LINES = EN ? LINES_EN : LINES_ZH;
const BODY_ONLY = EN
	? "## Focus\n- **Main task:** check the article's sources\n- **Meeting:** talk at 15:00\n\n## Notes\n- none"
	: "## 今日焦點\n- **核心任務：** 驗證文章引用來源\n- **重要會議：** 15:00 聽演講\n\n## 筆記\n- 無";
const BODY_TEXT = EN ? "Tried the new coffee shop near campus. Great latte." : "今天去了學校附近新開的咖啡店，拿鐵很好喝。";
const BODY_HTML = EN
	? "<p>Tried the new coffee shop near campus. Great latte.</p><ul><li>Finished chapter three</li><li>Replied to my advisor</li></ul>"
	: "<p>今天去了學校附近新開的咖啡店，拿鐵很好喝。</p><ul><li>改完第三章</li><li>回信給老師</li></ul>";
const MOODS = [4, 4, 5, 3, 2, 1, undefined] as const;

// ?photos=1：用真的照片（先執行 node preview/fetch-photos.mjs 下載），README 截圖用
const REAL_PHOTOS = new URLSearchParams(location.search).get("photos") === "1";
const cover = (hue: number) =>
	REAL_PHOTOS
		? `photos/${PHOTO_IDS[hue % PHOTO_IDS.length]}.jpg`
		: gradient(hue);
const gradient = (hue: number) =>
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,70%)"/><stop offset="1" stop-color="hsl(${hue + 40},60%,40%)"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="300" cy="80" r="40" fill="rgba(255,255,255,.7)"/></svg>`
	);

const NOW = new Date(2026, 8, 24);
const entries: DiaryEntry[] = [];
let seed = 7;
const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
for (let t = new Date(2025, 0, 1); t <= NOW; t.setDate(t.getDate() + 1)) {
	if (rand() < 0.55) continue;
	const y = t.getFullYear(), m = t.getMonth() + 1, d = t.getDate();
	const date = toDateKey(y, m, d);
	entries.push({
		date, year: y, month: m, day: d,
		...(() => {
			// 空字串的那幾篇模擬「沒填一句話、只寫內文」，卡片上用內文第一段
			const line = date === "2026-09-24" ? LINES[0] : LINES[Math.floor(rand() * LINES.length)];
			return line ? { oneLiner: line } : { oneLiner: bodySummary(BODY_ONLY), oneLinerFromBody: true };
		})(),
		mood: MOODS[Math.floor(rand() * MOODS.length)],
		...(() => {
			const url = rand() < (y === 2026 && m === 9 ? 0.6 : 0.06) ? cover(Math.floor(rand() * 360)) : undefined;
			const n = url ? 1 + Math.floor(rand() * 4) : 0;
			const photos = Array.from({ length: n }, (_, i) => ({ path: `${date}-${i + 1}.jpg`, url: i === 0 ? url! : cover(Math.floor(rand() * 360)) }));
			return { cover: url, photos };
		})(),
		path: `Journal/${y}/${date}.md`,
	});
}

// 截圖的主角（9/24「去公園、逛夜市」）配一張綠地的照片，跟內容比較搭
if (REAL_PHOTOS) {
	const hero = entries.find((e) => e.date === "2026-09-24");
	if (hero?.photos.length) {
		hero.photos[0] = { ...hero.photos[0], url: "photos/287.jpg" };
		hero.cover = hero.photos[0].url;
	}
}

let monthCovers = new Map<string, { path: string; url: string }>();
const root = activeDocument.getElementById("app")!;
const ui = new DiaryUI(
	root,
	{
		loadDraft: async (date) => {
			const e = entries.find((x) => x.date === date);
			return {
				date,
				exists: !!e,
				oneLiner: e?.oneLiner ?? "",
				mood: e?.mood,
				body: e && e.day % 4 === 0 ? BODY_TEXT : "",
				photos: e?.photos ?? [],
				// ?cover=external：模擬 cover 指到內文以外的圖
				coverPath: new URLSearchParams(location.search).get("cover") === "external" ? "封面-不在內文.jpg" : e?.photos[0]?.path,
				hasCover: !!e?.photos.length || new URLSearchParams(location.search).get("cover") === "external",
				preserved: [],
			};
		},
		saveEntry: async (input) => {
			(window as unknown as { lastSave: unknown }).lastSave = { ...input, photos: input.photos.map((p) => (p.kind === "new" ? { kind: "new", ext: p.ext, bytes: p.data.byteLength } : { kind: "existing", path: p.photo.path })) };
			const [y, m, d] = input.date.split("-").map(Number);
			const urls = input.photos.map((p) => (p.kind === "new" ? { path: `${input.date}-new.${p.ext}`, url: p.url } : p.photo));
			if (urls.length && input.coverIndex !== null) urls.unshift(...urls.splice(input.coverIndex, 1));
			const rest = entries.filter((x) => x.date !== input.date);
			rest.push({ date: input.date, year: y, month: m, day: d, oneLiner: input.oneLiner, mood: input.mood, cover: urls[0]?.url, photos: urls, path: "" });
			entries.splice(0, entries.length, ...rest);
			window.setTimeout(() => ui.setEntries(entries), 200); // 模擬 Obsidian 讀檔的延遲
		},
		search: async (q) => {
			const hits = new Map<string, string>();
			for (const e of entries) if (e.day % 4 === 0 && BODY_TEXT.toLowerCase().includes(q.toLowerCase())) hits.set(e.date, "…" + BODY_TEXT);
			return hits;
		},
		openInObsidian: async (date) => {
			(window as unknown as { lastOpen: string }).lastOpen = date; // 預覽頁沒有 Obsidian，記下來給自動測試看
		},
		setMonthCover: (ym, path) => {
			const covers = new Map(monthCovers);
			const photo = entries.flatMap((e) => e.photos).find((p) => p.path === path);
			if (photo) covers.set(ym, photo);
			else covers.delete(ym);
			monthCovers = covers;
			ui.setMonthCovers(covers);
		},
		renderBody: async (e, el) => {
			if (e.day % 4 === 0) {
				// 範例內文是寫死的 HTML；用 DOMParser 轉成元素，不直接塞 innerHTML
				el.append(...Array.from(new DOMParser().parseFromString(BODY_HTML, "text/html").body.childNodes));
			}
		},
	},
	() => NOW
);
const params = new URLSearchParams(location.search);
if (params.get("week") === "monday") ui.setWeekStart(1); // 星期一開頭的月曆
ui.setPalette(params.get("palette") ?? "warm"); // ?palette=classic|soft|mono
if (params.get("today") === "empty") entries.splice(entries.findIndex((e) => e.date === "2026-09-24"), 1);
ui.setEntries(entries);
if (params.get("screen") === "year") ui.go({ kind: "year", year: 2026 });
else ui.go({ kind: "month", year: 2026, month: 9 }); // 跟外掛預設一樣，打開先看這個月
if (params.get("screen") === "month") ui.go({ kind: "month", year: 2026, month: 9 });
if (params.get("screen") === "entry") ui.go({ kind: "entry", date: params.get("date") ?? "2026-09-24" });
if (params.get("screen") === "all") ui.go({ kind: "all" });
if (params.get("screen") === "edit") ui.openEditor(params.get("date") ?? "2026-09-24");
(window as unknown as { ui: DiaryUI }).ui = ui; // 給自動測試用
