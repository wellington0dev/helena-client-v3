# Identidade e dispositivos pareados

## Pareamento

No Helena Client instalado, com sessão válida, execute `helena device pair-request`. A CLI gera uma identidade UUID local e envia ao backend o deviceId e nome apresentado. O backend devolve um código temporário de 10 minutos. Neste estado não há credencial gerada nem verificador no backend. A CLI exibe o código.

Em um contexto autenticado do proprietário, confira `helena devices requests` e aprove com `helena devices approve <deviceId> <codigo>`. A aprovação não é feita pela conexão WebSocket solicitante. Para recusar, use `helena devices reject <deviceId>`. Após aprovação, no Client solicitante execute `helena device pair-complete`: só então ele gera e guarda a credencial aleatória e a envia em HTTPS ao backend, que salva somente o hash. Depois reinicie o daemon: o próximo handshake usa exclusivamente a credencial de device no header Authorization. Se ela for inválida ou revogada, o Client não tenta fallback ao JWT da conta. Sem credencial ativada, permanece o fluxo JWT legado, sem capabilities sensíveis.

Comandos de proprietário:

```text
helena device pair-request
helena device pair-complete
helena devices list
helena devices requests
helena devices approve <deviceId> <codigo>
helena devices reject <deviceId>
helena devices revoke <deviceId>
```

Esses comandos usam a sessão já gravada pelo CLI e não imprimem access/refresh token nem credencial de device. A sessão usada precisa pertencer ao proprietário do pedido. O código temporário é um segredo: não compartilhe fora do contexto de aprovação.

## Armazenamento e plataformas

O arquivo `device-identity.json` fica no diretório de configuração existente (`~/.config/helena` em Linux/macOS; `%APPDATA%\Helena` via `configDir()` no Windows). Em POSIX, diretório é restringido a `0700` e arquivo a `0600`; gravação é atômica por temporário + rename. No Windows, Node não configura ACL explícita aqui: a proteção efetiva depende da ACL da pasta `%APPDATA%` do usuário e não foi validada nativamente nesta etapa. Processos sob a mesma conta do SO podem ler o segredo.

A identidade inclui a origem do backend e só é enviada a essa mesma origem, evitando vazamento para um backend diferente. O arquivo inicial guarda apenas deviceId/origem; o campo de credencial só é adicionado no pair-complete, após aprovação. O Client não apaga o segredo local depois da revogação; a credencial fica inutilizável no servidor até o usuário remover o arquivo ou refazer a instalação. Não há comando de remoção/rotação local nesta entrega.

## WebSocket e compatibilidade

O Client usa `Authorization: Bearer hdev1_…` em `/ws/agent` quando tem credencial ativada. O backend valida credencial e status e deriva proprietário/device do registro, não do nome informado. Sem credencial, o daemon preserva JWT legado via query string. Credencial presente porém inválida nunca faz fallback. Uma única conexão ativa por device; reconnect substitui a sessão anterior e resultados atrasados são descartados. Clientes legados seguem compatíveis, mas não ganham capabilities sensíveis por anúncio.

## Testes e limites

Testes locais cobrem geração e persistência POSIX. A plataforma Windows/macOS não foi executada nativamente. Não há teste E2E com backend ou device real nesta entrega. `skills_v1` continua desativada: esta identidade é infraestrutura para uma etapa futura, não autoriza ainda integração de skills ao agente.
# Proof of possession (5D.1C)

`pair-request` returns a one-time approval code and a separate random 256-bit possession secret. The Client stores the possession secret in `device-identity.json` under the existing private directory/file permissions; it is not the permanent device credential. `pair-complete` sends both the locally generated credential and possession secret. The backend must have approved the request and consumes the possession verifier once. If the secret is missing (for example, local identity predates this flow), request pairing again on this installation; do not copy a secret from another device.

The secret is transmitted only in the authenticated HTTPS request/response body, not in a URL. Do not paste it into logs or support tickets. `skills_v1` remains disabled; device pairing alone does not enable local skills.
