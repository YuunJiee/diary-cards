// 快速記錄畫面的照片：從內文拿出單獨一行的圖片，存檔時再放回原本的位置。
// 不依賴 Obsidian，可以直接測試（test/photos.test.ts）。

// 單獨一行的圖片嵌入：![[a.jpg]] 或 ![](a.jpg)
export const EMBED_LINE_RE = /^\s*(?:!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(\s*<?([^)>]+?)>?(?:\s+"[^"]*")?\s*\))\s*$/;
// 筆記裡 <!-- card-diary:ID --> 這種標記（從其他 App 匯入時留下的），編輯時不顯示但要保留
export const PRESERVED_LINE_RE = /^<!-- card-diary:[^>]*-->$/;

/** 照片在內文裡的位置：接在哪一行文字後面 */
export interface PhotoAnchor {
	/** 前面最近的一行文字；null 代表在內文最前面 */
	text: string | null;
	/** 同樣內容的行裡是第幾次出現（從 1 開始） */
	occurrence: number;
	/** 前面有幾行文字；找不到那行文字時，用這個位置 */
	index: number;
	/** 照片前後原本有沒有空行 */
	gapBefore: boolean;
	gapAfter: boolean;
}

export interface SplitBody {
	/** 拿掉圖片和保留標記後的內文 */
	body: string;
	/** 單獨一行的圖片（依出現順序，不重複）和它的位置 */
	photos: { path: string; anchor: PhotoAnchor }[];
	preserved: string[];
}

/**
 * 把內文（不含 frontmatter）裡單獨一行的圖片拿出來。
 * resolve 把連結轉成 vault 裡的路徑，不是圖片就回傳 null（這種行會留在內文裡）。
 */
export function splitPhotos(text: string, resolve: (link: string) => string | null): SplitBody {
	const raw = text.split(/\r?\n/);
	const lines: string[] = [];
	const photos: SplitBody["photos"] = [];
	const preserved: string[] = [];
	const seen = new Map<string, number>();
	let lastText: string | null = null;
	let textCount = 0;
	for (const [i, line] of raw.entries()) {
		if (PRESERVED_LINE_RE.test(line.trim())) {
			preserved.push(line.trim());
			continue;
		}
		const m = EMBED_LINE_RE.exec(line);
		const path = m ? resolve(m[1] ?? m[2]) : null;
		if (path) {
			if (!photos.some((p) => p.path === path)) {
				photos.push({
					path,
					anchor: {
						text: lastText,
						occurrence: lastText === null ? 0 : (seen.get(lastText) ?? 0),
						index: textCount,
						gapBefore: i === 0 || !raw[i - 1].trim(),
						gapAfter: i === raw.length - 1 || !raw[i + 1].trim(),
					},
				});
			}
			continue;
		}
		lines.push(line);
		if (line.trim()) {
			lastText = line.trim();
			seen.set(lastText, (seen.get(lastText) ?? 0) + 1);
			textCount++;
		}
	}
	return { body: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), photos, preserved };
}

/**
 * 把照片放回內文：有位置的放回原本那行文字後面，沒有位置的（新照片）接在最後。
 * 照片的先後順序不變。那行文字被改掉了，就放在同樣行數的地方。
 */
export function placePhotos(body: string, photos: { link: string; anchor?: PhotoAnchor }[]): string {
	const lines = body.trim() ? body.trim().split("\n") : [];
	// 第 n 行文字在 lines 裡的位置
	const textAt: number[] = [];
	lines.forEach((l, i) => {
		if (l.trim()) textAt.push(i);
	});
	// slot k：接在第 k 行文字後面（0 是最前面）
	const slots = new Map<number, { link: string; anchor?: PhotoAnchor }[]>();
	const tail: string[] = [];
	let last = 0;
	for (const p of photos) {
		if (!p.anchor) {
			tail.push(p.link);
			continue;
		}
		let k = findSlot(lines, textAt, p.anchor);
		k = Math.max(k, last);
		last = k;
		slots.set(k, [...(slots.get(k) ?? []), p]);
	}

	const out: string[] = [];
	const emit = (group: { link: string; anchor?: PhotoAnchor }[] | undefined) => {
		for (const p of group ?? []) {
			if (p.anchor?.gapBefore) out.push("");
			out.push(p.link);
			if (p.anchor?.gapAfter) out.push("");
		}
	};
	emit(slots.get(0));
	let k = 0;
	for (const line of lines) {
		out.push(line);
		if (line.trim()) emit(slots.get(++k));
	}
	const placed = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
	return [placed, tail.join("\n\n")].filter(Boolean).join("\n\n");
}

function findSlot(lines: string[], textAt: number[], anchor: PhotoAnchor): number {
	if (anchor.text === null) return 0;
	let n = 0;
	for (let k = 0; k < textAt.length; k++) {
		if (lines[textAt[k]].trim() === anchor.text && ++n === anchor.occurrence) return k + 1;
	}
	return Math.min(anchor.index, textAt.length);
}
