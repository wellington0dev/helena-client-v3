// Gera o binário único da TUI (bun build --compile). Os pacotes nativos das OUTRAS plataformas ficam como
// `--external` (senão o build falha tentando resolver `@opentui/core-<plataforma>` que o npm não instalou aqui).
// Uso: bun run build [--target=bun-windows-x64]   (o pacote nativo do alvo precisa estar instalado: npm i --no-save --force --os=win32 --cpu=x64 @opentui/core-win32-x64)
const native = ["linux-x64", "linux-x64-musl", "linux-arm64", "linux-arm64-musl", "darwin-x64", "darwin-arm64", "win32-x64", "win32-arm64"];
const target = process.argv.find((a) => a.startsWith("--target="))?.slice("--target=".length);
const own = target?.includes("windows") ? "win32-x64" : target?.includes("darwin") ? (target.includes("arm64") ? "darwin-arm64" : "darwin-x64") : `${process.platform === "win32" ? "win32" : process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
const externals = native.filter((p) => p !== own).flatMap((p) => ["--external", `@opentui/core-${p}`]);
const out = `dist/helena-tui${target?.includes("windows") ? ".exe" : ""}`;
const proc = Bun.spawnSync(["bun", "build", "--compile", ...(target ? [`--target=${target}`] : []), ...externals, "src/main.tsx", "--outfile", out], { stdout: "inherit", stderr: "inherit" });
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
console.log(`ok: ${out}`);
