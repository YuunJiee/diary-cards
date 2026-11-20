// 內文摘要的測試：npm test
import assert from "node:assert/strict";
import { bodySummary, stripFrontmatter } from "../src/summary";

let passed = 0;
function test(name: string, fn: () => void) {
	fn();
	passed++;
	console.log("  ✓", name);
}

test("一般段落", () => {
	assert.equal(bodySummary("今天去了海邊。\n風很大。\n\n第二段"), "今天去了海邊。 風很大。");
	assert.equal(bodySummary("\n\n只有一行"), "只有一行");
});

test("跳過標題、圖片、註解", () => {
	assert.equal(bodySummary("<!-- card-diary:abc -->\n![[a.jpg]]\n## 早上\n吃了蛋餅"), "吃了蛋餅");
	assert.equal(bodySummary("### **☀️ 今日計畫**\n\n- [>] 整理文件7來源\n---\n### 筆記\n- 別的"), "整理文件7來源");
});

test("清單：第一層用 · 串起來，子項目跳過", () => {
	const body = "## 今日焦點\n- **核心任務：** 驗證來源\n\t- 細節\n- **學習目標：** 無\n\n## 其他";
	assert.equal(bodySummary(body), "核心任務： 驗證來源 · 學習目標： 無");
});

test("連結和格式拿掉", () => {
	assert.equal(bodySummary("和 [[小明|他]] 去 [[../../地點/公園.md]] 看[展覽](https://x)，**超好看**"), "和 他 去 公園 看展覽，超好看");
	assert.equal(bodySummary("> 引用的話 `code` ~~刪掉~~"), "引用的話 code 刪掉");
});

test("沒填的欄位和網址拿掉", () => {
	assert.equal(bodySummary("- **核心任務：** 驗證來源\n- **學習目標：**\n- **重要會議：**"), "核心任務： 驗證來源");
	assert.equal(bodySummary("- 🎯 首要目標:\n- 💡 隨手筆記:\n\n今天很累"), "今天很累");
	// 空標籤底下的子項目要算
	assert.equal(bodySummary("- **🎯 首要目標:**\n    - [>] 文件四\n    - [x] 文件五\n- **💡 隨手筆記:**\n\t- 好累"), "文件四 · 文件五 · 好累");
	assert.equal(bodySummary("- 聆聽podcast筆記(https://drive.google.com/x/y) · 好聽"), "聆聽podcast筆記 · 好聽");
	assert.equal(bodySummary("看這篇 https://example.com/a?b=1 很有趣"), "看這篇 很有趣");
});

test("表格、空內文", () => {
	assert.equal(bodySummary("| a | b |\n|---|---|"), "");
	assert.equal(bodySummary(""), "");
	assert.equal(bodySummary("## 只有標題\n\n## 還是標題"), "");
});

test("太長就截斷", () => {
	const s = bodySummary("字".repeat(200));
	assert.equal(s.length, 121);
	assert.ok(s.endsWith("…"));
});

test("拿掉 frontmatter", () => {
	assert.equal(stripFrontmatter("---\na: 1\n---\n內文\n\n---\n更多"), "內文\n\n---\n更多");
	// 空的 frontmatter 不能吃到內文裡的分隔線
	assert.equal(stripFrontmatter("---\n---\n第一段\n\n---\n\n第二段"), "第一段\n\n---\n\n第二段");
	assert.equal(stripFrontmatter("---\r\na: 1\r\n---\r\n內文"), "內文");
	assert.equal(stripFrontmatter("沒有 frontmatter\n---\nx"), "沒有 frontmatter\n---\nx");
});

console.log(`${passed} passed`);
