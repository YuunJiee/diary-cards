// 下載 README 截圖用的照片到 preview/photos/（不進 git）：node preview/fetch-photos.mjs
// 照片來自 Unsplash（透過 Lorem Picsum），依 Unsplash License 可免費使用。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";

const ids = JSON.parse(readFileSync(new URL("./photo-ids.json", import.meta.url), "utf8"));
const dir = new URL("./photos/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const id of ids) {
	const file = new URL(`${id}.jpg`, dir);
	if (existsSync(file)) continue;
	const res = await fetch(`https://picsum.photos/id/${id}/800/600`);
	if (!res.ok) throw new Error(`photo ${id}: HTTP ${res.status}`);
	writeFileSync(file, Buffer.from(await res.arrayBuffer()));
	console.log("downloaded", id);
}
