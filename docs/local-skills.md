# Skills locais (gerenciamento e integração)

`src/local-skills.ts` mantém a descoberta/leitura validada; `src/local-skills-management.ts` acrescenta operações de gerenciamento. O daemon injeta esse manager em `main.ts` e anuncia `skills_v1` somente junto com os handlers completos. O backend disponibiliza operações de gerenciamento ao painel autenticado e uma tool somente de list/load ao `chatAgent` do proprietário. **A capability funciona em integração, mas GO operacional permanece bloqueado** por gates de observabilidade, E2E de pareamento completo e validação da migração MySQL; confira `helena-bk-v3/docs/agent-skills/client-integration/README.md`.

## Localização e formato

A raiz é `<configDir>/skills/`, derivada de `configDir()`:

- Linux/macOS: `~/.config/helena/skills/`
- Windows: `%APPDATA%\Helena\skills\`
- `HELENA_CONFIG_DIR` é respeitado pelo mecanismo existente.

Cada skill fica em um diretório imediato cujo nome é um slug minúsculo (`a-z`, `0-9` e hífens), contendo `SKILL.md`. O frontmatter YAML simples delimitado por `---` exige `name` igual ao slug e `description` não vazia. São aceitos campos escalares `license`, `compatibility` e `allowed-tools`, além de `metadata` com escalares. Tags, listas e estruturas YAML aninhadas não são aceitas. Campos desconhecidos/duplicados e valores incompatíveis são rejeitados. O corpo Markdown deve conter instruções não vazias. Nenhuma instrução ou script é interpretado ou executado.

## Descoberta, revisão e leitura

`list()` enumera somente diretórios imediatos, valida cada `SKILL.md` independentemente, ignora entradas inválidas com avisos genéricos sem nomes, caminhos ou conteúdo, ordena por ID e devolve somente metadados. Raiz inexistente resulta em lista vazia e não cria diretórios. Limites: 100 skills, 2.048 entradas imediatas e os limites de bytes do protocolo.

A revisão `sha256:` cobre os bytes integrais validados do arquivo, sem depender de timestamps. `load(id, revision)` aceita apenas ID e revisão validados pelo protocolo, revalida o arquivo, compara a revisão e devolve somente o corpo Markdown, limitado a 32 KiB. Não há cache persistente nem cache de conteúdo em memória.

Symlinks são rejeitados para raiz, diretórios de skill e `SKILL.md`, inclusive links internos à raiz. Arquivos devem ser regulares e sem hard links; o arquivo aberto é comparado ao lstat e verificado novamente após leitura. A leitura usa no máximo 32 KiB + 1 byte, `O_NOFOLLOW` quando disponível e verificações de identidade/caminho para detectar substituições. Em plataformas sem `O_NOFOLLOW`, não há alegação de garantia atômica equivalente a `openat`.

## Contrato e limitações

O protocolo versionado v1 suporta `list`, `load`, `inspect`, `create`, `edit`, `preview_file`, `install_file`, `preview_git`, `install_git`, `enable`, `disable` e `delete`. Operações têm schemas estritos, IDs/revisões SHA-256, limites de payload e timeout por tipo. A resposta de catálogo não contém corpo; só `inspect`/`load` e prévia retornam instruções temporariamente. Timeout encerra a espera, mas não cancela cooperativamente uma operação já iniciada; IDs de correlação e descarte após desconexão pertencem a `/ws/agent`.

## Gerenciamento e CLI

O catálogo está em `<configDir>/skills/<skill-id>/SKILL.md`; o sidecar `.helena-state.json` guarda somente `enabled` e `source`. Os corpos, revisões e estado operacional não são sincronizados para armazenamento durável do backend.

```bash
helena skills list
helena skills inspect proofreading
helena skills create revisar-typescript "Revisa TypeScript" "Procure erros de tipo e explique correções mínimas."
helena skills install ./SKILL.md
helena skills install https://github.com/owner/repo
helena skills edit revisar-typescript "Revisa TypeScript" "Revise tipos, testes e segurança."
helena skills enable revisar-typescript
helena skills disable revisar-typescript
helena skills remove revisar-typescript --yes
```

Para instalar, o Client mostra a prévia e exige repetição com `HELENA_CONFIRM_INSTALL=1`. A importação remota aceita HTTPS somente em `github.com` e `raw.githubusercontent.com`, incluindo URLs `.git`, `tree`, `blob/SKILL.md` e raw. Usa a API GitHub para resolver branch (inclusive nomes com `/`) ou commit, sem `git clone`; redirects são recusados. A raiz é pesquisada recursivamente com limites de 250 skills, 32 KiB por `SKILL.md`, 1 MiB de descrições de descoberta e limites de resposta/tempo. A URL de pasta limita a descoberta àquela pasta.

O catálogo mostra incompatibilidades segundo o mesmo parser usado para skills locais. Somente as skills selecionadas são pré-visualizadas e instaladas. O importador inventaria arquivos dentro do diretório da skill; scripts, hooks, dependências e recursos auxiliares não são executados nem copiados. Se houver arquivos auxiliares, a interface informa os nomes e exige confirmação explícita para instalar somente `SKILL.md`. Instalação revalida conteúdo e revisão antes de gravar. Repositórios privados ou inacessíveis não são autenticados.

A CLI também aceita `helena skills install <URL> <diretório-da-skill>` para seleção explícita; para diretório com recursos auxiliares, exige adicionalmente `HELENA_ALLOW_UNSUPPORTED_SKILL_FILES=1`. Remoção recusa pastas com arquivos adicionais e requer `--yes`.

O painel Angular/Ionic em `/skills` permite selecionar dispositivo pareado, consultar oficiais e locais, criar, inspecionar/editar, instalar de URL Git ou arquivo `SKILL.md`, habilitar/desabilitar e remover. Os corpos do formulário ficam em memória no navegador e trafegam apenas durante a requisição autenticada.

## Integração Genkit

`device_skills` é read-only, presente somente no `chatAgent` autenticado do dono. Lista skills habilitadas com identidade do dispositivo, ID e revisão; load envia exatamente essa identidade pelo Gateway. A resposta usa `dataClass: "ephemeral_skill"` e a redação de snapshot remove instruções antes da persistência. A interface e a API, não o modelo, realizam escrita. Skills não criam permissões ou tools. O texto enviado ao provedor de modelo ainda pode ser processado ou reproduzido por ele.

## Validação observada

`npm run typecheck`, testes direcionados do importer/manager/protocolo e os testes Angular passaram. A página `/skills` também foi exercitada em Chromium com API interceptada para simular catálogo, seleção, prévia, instalação e confirmação explícita de recursos auxiliares. O GitHub público `ever-just/agentskills` foi lido em modo somente leitura: foram descobertas 175 skills; a URL da pasta `skills/system-design-architecture` limitou o catálogo a uma. Essa skill possui 17 arquivos auxiliares e requer confirmação para importar somente `SKILL.md`.

Não foi executado E2E live Angular → backend → Client com dispositivo pareado; o teste Chromium usa API mockada, e o teste de escrita local do Client usa filesystem temporário. Nenhum conteúdo privado foi usado, scripts externos não foram executados e nenhuma skill do repositório remoto foi instalada durante a verificação. Isso não substitui os gates de pareamento/produção listados no README de integração do backend.
