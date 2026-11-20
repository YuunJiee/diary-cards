// 沒有填「一句話」的日記，從內文抓第一段當卡片上的文字。不依賴 Obsidian，可以直接測試。

const MAX_LENGTH = 120;

/** 一行裡的 Markdown 語法拿掉，只留看得到的字 */
function plainText(line: string): string {
	return line
		.replace(/!\[\[[^\]]*\]\]/g, "") // ![[圖片]]
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "") // ![](圖片)
		.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2") // [[頁面|顯示文字]]
		.replace(/\[\[([^\]]*)\]\]/g, (_, link: string) => link.split("/").pop()!.replace(/\.md$/, "")) // [[頁面]]
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [文字](網址)
		.replace(/<[^>]+>/g, "")
		.replace(/\(?\bhttps?:\/\/[^\s)]+\)?/g, "") // 直接貼上的網址
		.replace(/^\s*>\s?/, "") // 引用
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s*)?/, "") // 清單、待辦
		.replace(/(\*\*|__|~~|==|`)/g, "")
		.replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$)/g, "$1$2") // *斜體*
		.replace(/\s+/g, " ")
		.trim();
}

/** 這一行不算內容：標題、分隔線、表格、程式碼框、註解、只有圖片 */
function isSkippable(line: string): boolean {
	const s = line.trim();
	return (
		/^#{1,6}\s/.test(s) ||
		/^(-{3,}|\*{3,}|_{3,})$/.test(s) ||
		s.startsWith("|") ||
		s.startsWith("```") ||
		/^<!--.*-->$/.test(s) ||
		plainText(s) === ""
	);
}

/**
 * 內文的第一段：跳過標題、圖片等，從第一行有字的地方開始，到空行或下一個標題為止。
 * 清單的每一項用「·」隔開，同一段文字的換行接起來，太長就截斷。
 */
export function bodySummary(body: string): string {
	const lines = body.split("\n");
	let i = lines.findIndex((l) => !isSkippable(l));
	if (i < 0) return "";
	let text = "";
	// 上一個第一層項目是空的標籤（「首要目標：」）時，改用它底下的子項目
	let underLabel = false;
	for (; i < lines.length; i++) {
		const l = lines[i];
		if (!l.trim() || /^#{1,6}\s/.test(l.trim()) || /^(-{3,}|\*{3,}|_{3,})$/.test(l.trim())) break;
		if (isSkippable(l)) continue;
		const isChild = /^(\t| {2,})\s*(?:[-*+]|\d+[.)])\s/.test(l);
		const plain = plainText(l);
		// 範本裡沒填的欄位（「學習目標：」後面沒有字）不算內容
		const isLabel = /[:：]$/.test(plain);
		if (!isChild) underLabel = isLabel;
		// 縮排的子項目平常跳過，只留第一層
		if (isLabel || (isChild && !underLabel)) continue;
		// 清單的每一項用「·」隔開；同一段文字換行就接起來
		const isItem = /^\s*(?:[-*+]|\d+[.)])\s/.test(l);
		text += text ? (isItem ? " · " : " ") + plain : plain;
	}
	// 這一段全是沒填的欄位：往下找下一段
	if (!text && i < lines.length) return bodySummary(lines.slice(i + 1).join("\n"));
	return text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH).trimEnd() + "…" : text;
}

// 開頭的 frontmatter；空的（---\n---）要另外處理，不然會一路吃到內文裡的分隔線 ---
export const FRONTMATTER_RE = /^---\r?\n(?:---|[\s\S]*?\r?\n---)(?:\r?\n|$)/;

export function stripFrontmatter(text: string): string {
	return text.replace(FRONTMATTER_RE, "");
}
