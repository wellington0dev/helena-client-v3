#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createLocalApi, defaultBaseUrl, readLocalToken } from "./api/client.ts";
import { App } from "./ui/App.tsx";

const token = readLocalToken();
if (!token) {
    console.error("Não achei o token local do daemon (~/.config/helena/local-token). Suba o daemon do client (npm start / systemctl --user start helena-client) e tente de novo.");
    process.exit(1);
}

const api = createLocalApi({ baseUrl: defaultBaseUrl(), token });
const renderer = await createCliRenderer({ exitOnCtrlC: false });
const exit = () => {
    renderer.destroy();
    process.exit(0);
};
createRoot(renderer).render(<App api={api} onExit={exit} />);
