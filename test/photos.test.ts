// 快速記錄畫面照片位置的測試：npm test
import assert from "node:assert/strict";
import { placePhotos, splitPhotos } from "../src/photos";

let passed = 0;
function test(name: string, fn: () => void) {
	fn();
	passed++;
	console.log("  ✓", name);
}

const resolve = (link: string) => (/\.(jpe?g|png)$/i.test(link) ? link : null);
/** 讀進來、照樣存回去 */
function roundTrip(text: string, body?: (b: string) => string, newLinks: string[] = []): string {
	const s = splitPhotos(text, resolve);
	const photos = [
		...s.photos.map((p) => ({ link: `![[${p.path}]]`, anchor: p.anchor })),
		...newLinks.map((link) => ({ link })),
	];
	return placePhotos(body ? body(s.body) : s.body, photos);
}

test("沒改的話照片留在原位", () => {
	const text = "早上去海邊。\n\n![[a.jpg]]\n\n下午吃冰。\n![[b.jpg]]\n![[c.jpg]]\n\n晚上回家。";
	assert.equal(roundTrip(text), text);
	assert.equal(roundTrip("![[a.jpg]]\n\n開頭是照片"), "![[a.jpg]]\n\n開頭是照片");
});

test("拿出來的內文沒有照片", () => {
	const s = splitPhotos("早上\n\n![[a.jpg]]\n\n![[movie.mp4]]\n<!-- card-diary:x -->\n下午", resolve);
	assert.equal(s.body, "早上\n\n![[movie.mp4]]\n下午");
	assert.deepEqual(s.photos.map((p) => p.path), ["a.jpg"]);
	assert.deepEqual(s.preserved, ["<!-- card-diary:x -->"]);
});

test("內文前後加字，照片跟著原本那行", () => {
	const text = "早上去海邊。\n\n![[a.jpg]]\n\n下午吃冰。";
	assert.equal(roundTrip(text, (b) => "補一句。\n\n" + b + "\n\n再補一句。"), "補一句。\n\n早上去海邊。\n\n![[a.jpg]]\n\n下午吃冰。\n\n再補一句。");
});

test("那行被改掉，放在同樣行數的地方", () => {
	const text = "第一行\n\n![[a.jpg]]\n\n第二行";
	assert.equal(roundTrip(text, (b) => b.replace("第一行", "改過的第一行")), "改過的第一行\n\n![[a.jpg]]\n\n第二行");
});

test("重複的行用第幾次出現來找", () => {
	const text = "好累\n\n好累\n\n![[a.jpg]]\n\n睡覺";
	assert.equal(roundTrip(text), text);
});

test("照片順序不變", () => {
	// 第一張的那行被刪掉、退回到前面，第二張不能跑到它前面
	const text = "一\n\n二\n\n三\n\n![[a.jpg]]\n\n![[b.jpg]]";
	const out = roundTrip(text, (b) => b.replace("\n\n三", ""));
	assert.ok(out.indexOf("a.jpg") < out.indexOf("b.jpg"));
});

test("新照片接在最後", () => {
	const text = "早上\n\n![[a.jpg]]\n\n下午";
	assert.equal(roundTrip(text, undefined, ["![[new.jpg]]"]), "早上\n\n![[a.jpg]]\n\n下午\n\n![[new.jpg]]");
	assert.equal(placePhotos("", [{ link: "![[new.jpg]]" }]), "![[new.jpg]]");
});

test("刪掉的照片不會留空行", () => {
	const s = splitPhotos("早上\n\n![[a.jpg]]\n\n![[b.jpg]]\n\n下午", resolve);
	const out = placePhotos(s.body, [{ link: "![[b.jpg]]", anchor: s.photos[1].anchor }]);
	assert.equal(out, "早上\n\n![[b.jpg]]\n\n下午");
});

console.log(`${passed} passed`);
