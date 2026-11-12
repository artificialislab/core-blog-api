# Regras Do Projeto Para Agentes

Antes de trabalhar neste repositorio, siga tambem as regras operacionais do repo `lab-ops`.

## Fluxo obrigatorio

```text
alterar local -> testar -> commit -> push GitHub -> deploy VPS
```

## Proibido

- Editar codigo diretamente na VPS.
- Ler ou imprimir `.env`.
- Commitar secrets.
- Fazer deploy sem o codigo estar no GitHub.

## Permitido

- Alterar codigo localmente.
- Criar testes.
- Atualizar `.env.example`.
- Atualizar documentacao.

## VPS e publicacao

Decisao do Andre em 12/11/2026: so o agente Integrador integra PR na `main` e so
o agente Publicador escreve na VPS, sem frase de autorizacao e sem segundo ok
dele, no que ele pediu e passou por teste e revisao. Os demais agentes fazem,
testam, abrem a PR, pedem a revisao do projeto e pedem a publicacao ao
Integrador. Regras: `lab-ops/runbooks/publicacao-integrador-publicador.md`.

Neste repositorio a publicacao e manual, pelo Publicador
(`lab-ops/scripts/deploy-api-image.sh`), e afeta os tres sites das clientes.
Migracao so aditiva; migracao que apaga ou altera dado: ok do Andre.

Continuam so com ok do Andre: gasto, envio a pessoa real, acao destrutiva ou sem
volta, DNS, firewall, SSH e segredos. Fora da equipe do OpenBot (sessao avulsa de
Codex ou Claude), merge que publica sozinho, deploy e escrita na VPS continuam so
com ok do Andre para a tarefa.
