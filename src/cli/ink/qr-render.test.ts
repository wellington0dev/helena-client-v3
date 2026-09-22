import assert from "node:assert/strict";
import test from "node:test";
import stringWidth from "string-width";
import { qrModules, qrRowCount, renderQr } from "./qr-render.ts";

const SAMPLE = "2@AbCdEfGhIjKlMnOpQrStUvWxYz0123456789,ZmFrZS1xci1kYXRh,c29tZS1rZXk=,YW5vdGhlci1rZXk=";

test("renderQr: N módulos + margem de 2 de cada lado; 2 módulos por linha de terminal; toda linha tem a mesma largura", () => {
    const n = qrModules(SAMPLE).length;
    const lines = renderQr(SAMPLE).split("\n");
    assert.equal(lines.length, qrRowCount(n));
    for (const line of lines) assert.equal(stringWidth(line), n + 4);
});

test("renderQr: quadrado com a mesma quantidade de módulos por lado (matriz válida) e determinístico", () => {
    const modules = qrModules(SAMPLE);
    assert.ok(modules.every((row) => row.length === modules.length));
    assert.equal(renderQr(SAMPLE), renderQr(SAMPLE));
    assert.notDeepEqual(qrModules(SAMPLE), qrModules(`${SAMPLE}x`));
});

test("renderQr: só preto e branco EXATOS (256 cores: 16 e 231); margens de topo/base são branco sobre branco; termina resetando a cor", () => {
    const lines = renderQr(SAMPLE).split("\n");
    const strip = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, "");
    for (const line of lines) {
        assert.ok(line.endsWith("\x1b[0m"), "cada linha reseta as cores no fim (não vaza cor pro resto da tela)");
        for (const match of line.matchAll(/\x1b\[38;5;(\d+);48;5;(\d+)m/g)) assert.ok([16, 231].includes(Number(match[1])) && [16, 231].includes(Number(match[2])), `cor fora do preto/branco: ${match[0]}`);
        assert.ok(!/\x1b\[(?!38;5;|0m)/.test(line.replace(/\x1b\[38;5;\d+;48;5;\d+m/g, "")), "nenhum outro código de cor (nada depende do tema do terminal)");
    }
    for (const edge of [lines[0]!, lines[lines.length - 1]!]) {
        assert.equal([...edge.matchAll(/\x1b\[38;5;(\d+);48;5;(\d+)m/g)].length, 1, "margem: uma só troca de cor (tudo igual)");
        assert.match(edge, /\x1b\[38;5;231;48;5;231m/);
    }
    assert.ok(lines.some((line) => line.includes("38;5;16")), "há módulos escuros");
    assert.ok(strip(lines[0]!).split("").every((ch) => ch === "▀"));
});

test("padrão de localização: os 3 cantos (canto sup. esq., sup. dir., inf. esq.) têm o quadrado escuro 7x7 do QR, o inf. dir. não", () => {
    const m = qrModules(SAMPLE);
    const n = m.length;
    const ring = (r0: number, c0: number): boolean => {
        for (let i = 0; i < 7; i++) if (!m[r0]![c0 + i] || !m[r0 + 6]![c0 + i] || !m[r0 + i]![c0] || !m[r0 + i]![c0 + 6]) return false;
        return true;
    };
    assert.ok(ring(0, 0) && ring(0, n - 7) && ring(n - 7, 0));
    assert.ok(!ring(n - 7, n - 7));
});
