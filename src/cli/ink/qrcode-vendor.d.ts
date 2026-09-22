// A `qrcode-terminal` só tipa a função `generate`; o gerador da matriz de módulos (que precisamos pra desenhar o QR com cores
// explícitas, ver qr-render.ts) fica em arquivos internos sem tipos.
declare module "qrcode-terminal/vendor/QRCode/index.js" {
    export default class QRCode {
        constructor(typeNumber: number, errorCorrectLevel: number);
        addData(data: string): void;
        make(): void;
        getModuleCount(): number;
        modules: boolean[][];
    }
}
declare module "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js" {
    const level: { L: number; M: number; Q: number; H: number };
    export default level;
}
