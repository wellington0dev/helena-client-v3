// Instala o client/ como um serviço REAL do Windows (via node-windows —
// equivalente ao systemd --user do Linux: sobrevive a logout, reinicia
// sozinho em falha). Precisa rodar num terminal Administrador — criar
// serviço do Windows sempre exige isso, não é limitação nossa. Chamado
// por install.ps1; roda `npm install node-windows --no-save` antes disso
// (não é dependência normal do package.json — só existe no Windows, e só
// é baixada quando alguém de fato pede o serviço, não em todo `npm
// install` do pacote).
import { Service } from "node-windows";
import { SERVICE_CONFIG } from "./windows-service-config.js";

const svc = new Service(SERVICE_CONFIG);

svc.on("alreadyinstalled", () => {
    console.log(`[helena] serviço "${SERVICE_CONFIG.name}" já estava instalado — reiniciando.`);
    svc.restart();
});

svc.on("install", () => {
    console.log(`[helena] serviço "${SERVICE_CONFIG.name}" instalado — iniciando.`);
    svc.start();
});

svc.on("start", () => {
    console.log(`[helena] serviço "${SERVICE_CONFIG.name}" rodando. Veja/gerencie em services.msc.`);
});

svc.on("error", (err) => {
    console.error("[helena] erro instalando o serviço:", err);
    process.exitCode = 1;
});

svc.install();
