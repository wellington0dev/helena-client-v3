// Remove o serviço do Windows instalado por install-windows-service.js.
// Também precisa de terminal Administrador.
import { Service } from "node-windows";
import { SERVICE_CONFIG } from "./windows-service-config.js";

const svc = new Service(SERVICE_CONFIG);

svc.on("uninstall", () => {
    console.log(`[helena] serviço "${SERVICE_CONFIG.name}" removido.`);
});

svc.on("alreadyuninstalled", () => {
    console.log(`[helena] serviço "${SERVICE_CONFIG.name}" já não existia.`);
});

svc.on("error", (err) => {
    console.error("[helena] erro removendo o serviço:", err);
    process.exitCode = 1;
});

svc.uninstall();
