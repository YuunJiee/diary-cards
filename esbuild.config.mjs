import esbuild from "esbuild";

const mode = process.argv[2];

if (mode === "preview") {
  // 不需要 Obsidian 就能在瀏覽器裡看介面的預覽頁
  await esbuild.build({
    entryPoints: ["preview/preview.ts"],
    bundle: true,
    format: "iife",
    target: "es2020",
    outfile: "preview/dist/preview.js",
  });
} else if (mode === "test") {
  await esbuild.build({
    entryPoints: ["test/summary.test.ts", "test/dates.test.ts", "test/photos.test.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2020",
    outdir: "test/dist",
    // obsidian 套件只有型別，測試時換成 node_modules 裡的 moment
    alias: { obsidian: "./test/obsidian-stub.ts" },
  });
} else {
  const prod = mode === "production";
  const ctx = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
    format: "cjs",
    target: "es2020",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
    logLevel: "info",
  });
  if (prod) {
    await ctx.rebuild();
    await ctx.dispose();
  } else {
    await ctx.watch();
  }
}
