// 日期格式和範本變數的測試：npm test
import assert from "node:assert/strict";
import moment from "moment";
import { diaryNotePath, fillTemplate, parseDiaryDate } from "../src/dates";

let passed = 0;
function test(name: string, fn: () => void) {
	fn();
	passed++;
	console.log("  ✓", name);
}

test("預設格式 YYYY-MM-DD", () => {
	assert.deepEqual(parseDiaryDate("Journal/2026/2026-09-24", "YYYY-MM-DD"), { key: "2026-09-24", year: 2026, month: 9, day: 24 });
	assert.equal(parseDiaryDate("Notes/會議記錄", "YYYY-MM-DD"), null);
	assert.equal(parseDiaryDate("2026-02-30", "YYYY-MM-DD"), null);
});

test("自訂格式", () => {
	assert.deepEqual(parseDiaryDate("Daily/2026.09.24", "YYYY.MM.DD"), { key: "2026-09-24", year: 2026, month: 9, day: 24 });
	assert.deepEqual(parseDiaryDate("Daily/2026-09-24 Thursday", "YYYY-MM-DD dddd"), { key: "2026-09-24", year: 2026, month: 9, day: 24 });
	assert.equal(parseDiaryDate("Daily/2026-09-24", "YYYY.MM.DD"), null);
});

test("格式含資料夾：比對路徑最後幾段", () => {
	assert.deepEqual(parseDiaryDate("Journal/2026/09/2026-09-24", "YYYY/MM/YYYY-MM-DD"), { key: "2026-09-24", year: 2026, month: 9, day: 24 });
	assert.equal(parseDiaryDate("Journal/2026/2026-09-24", "YYYY/MM/YYYY-MM-DD"), null);
});

test("新日記的路徑", () => {
	assert.equal(diaryNotePath("2026-09-24", "YYYY-MM-DD", "Journal", true), "Journal/2026/2026-09-24");
	assert.equal(diaryNotePath("2026-09-24", "YYYY-MM-DD", "", false), "2026-09-24");
	assert.equal(diaryNotePath("2026-09-24", "YYYY/MM/YYYY-MM-DD", "Journal/", true), "Journal/2026/09/2026-09-24");
});

test("範本變數", () => {
	const now = moment("2026-11-20 08:05", "YYYY-MM-DD HH:mm");
	const tpl = "# {{title}}\n建立於 {{date}} {{time}}\n週 {{date:ww}}，{{ date : MM/DD }}，{{time:HH}}";
	assert.equal(fillTemplate(tpl, "2026-09-24", "YYYY-MM-DD", now), "# 2026-09-24\n建立於 2026-09-24 08:05\n週 39，09/24，08");
	assert.equal(fillTemplate("{{title}}", "2026-09-24", "YYYY/MM/YYYY-MM-DD", now), "2026-09-24");
	assert.equal(fillTemplate("沒有變數", "2026-09-24", "YYYY-MM-DD", now), "沒有變數");
});

console.log(`${passed} passed`);
