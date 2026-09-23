import React from "react";
import { COMMANDS, type Command } from "./commands.ts";
import { ListModal } from "./list-modal.ts";
import type { SectionedItem } from "./settings-model.ts";

const h = React.createElement;

export interface PaletteItem extends SectionedItem {
    command: Command;
}

/**
 * Reagrupa `COMMANDS` por seção sem depender da ordem do array (essa ordem é a do "/" no composer e do /help,
 * fixada por `commands.test.ts` — não mexer nela só por causa daqui): junta cada seção num bloco contíguo, na
 * ordem em que aparece pela 1ª vez, preservando a ordem relativa dentro dela. Sem isso `buildRows` (que só abre um
 * cabeçalho novo quando a seção MUDA em relação ao item anterior) repetiria o cabeçalho de uma mesma seção toda
 * vez que ela reaparecesse intercalada com outra.
 */
export function buildPaletteItems(): PaletteItem[] {
    const buckets = new Map<string, Command[]>();
    for (const command of COMMANDS) {
        const bucket = buckets.get(command.section);
        if (bucket) bucket.push(command);
        else buckets.set(command.section, [command]);
    }
    return [...buckets.values()].flat().map((command) => ({ id: command.name, section: command.section, label: `/${command.name}`, description: command.description, command }));
}

export interface CommandPaletteModalProps {
    columns: number;
    usableRows: number;
    /** Comando escolhido (Enter ou clique) — quem monta decide o que roda e fecha a paleta. */
    onRun: (command: Command) => void;
    onClose: () => void;
}

/**
 * Paleta de comandos (Ctrl+P, ver app.ts) — instância do `ListModal` genérico (ver list-modal.ts): sem toggle nem
 * cabeçalho customizado, todo item aqui é "rodar o comando e fechar".
 */
export function CommandPaletteModal(props: CommandPaletteModalProps): React.ReactElement {
    const { columns, usableRows, onRun, onClose } = props;
    const items = React.useMemo(() => buildPaletteItems(), []);

    return h(ListModal<PaletteItem>, {
        title: "Comandos",
        columns,
        usableRows,
        items,
        onActivate: (item) => onRun(item.command),
        onClose,
        emptyMessage: "Nenhum comando encontrado.",
        footerHint: "↑↓ ou mouse · Enter/clique roda · roda rola · Esc fecha",
    });
}
