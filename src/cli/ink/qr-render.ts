import QRCode from "qrcode-terminal/vendor/QRCode/index.js";
import QRErrorCorrectLevel from "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js";

/**
 * QR para o terminal com cores EXPLÍCITAS — a lib `qrcode-terminal` desenha o "branco" com a cor de texto padrão do
 * terminal (só dá contraste certo em fundo escuro + texto claro) e o `chalk` cairia em cores de 16 tons, que mudam com o
 * tema. Leitores de QR (câmera do celular) são exigentes com polaridade e contraste. Aqui: preto e branco EXATOS do cubo
 * de 256 cores (16 = #000000, 231 = #ffffff — os índices 16-231 nenhum tema remapeia), com margem branca de 2 módulos.
 * Meio-bloco `▀` (2 módulos por linha): cor do texto = módulo de cima, cor de fundo = módulo de baixo.
 * Devolve UMA string com `\n` entre as linhas; cada linha reseta as cores no fim.
 */
const QUIET = 2;
const BLACK = 16;
const WHITE = 231;

export function qrModules(text: string): boolean[][] {
    const qr = new QRCode(-1, QRErrorCorrectLevel.L);
    qr.addData(text);
    qr.make();
    return qr.modules as boolean[][];
}

/** Linhas do terminal que o QR ocupa para uma matriz de `moduleCount` módulos. */
export function qrRowCount(moduleCount: number): number {
    return Math.ceil((moduleCount + 2 * QUIET) / 2);
}

export function renderQr(text: string): string {
    const modules = qrModules(text);
    const n = modules.length;
    const size = n + 2 * QUIET;
    const isDark = (row: number, col: number): boolean => row >= QUIET && row < QUIET + n && col >= QUIET && col < QUIET + n && modules[row - QUIET]![col - QUIET] === true;
    const lines: string[] = [];
    for (let row = 0; row < size; row += 2) {
        let line = "";
        let lastPair = "";
        for (let col = 0; col < size; col++) {
            const fg = isDark(row, col) ? BLACK : WHITE;
            const bg = row + 1 < size && isDark(row + 1, col) ? BLACK : WHITE;
            const pair = `${fg};${bg}`;
            if (pair !== lastPair) {
                line += `\x1b[38;5;${fg};48;5;${bg}m`; // só troca a cor quando muda (linha bem menor)
                lastPair = pair;
            }
            line += "▀";
        }
        lines.push(`${line}\x1b[0m`);
    }
    return lines.join("\n");
}
