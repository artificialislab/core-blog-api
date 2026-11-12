# Regras Do Projeto Para Claude

Siga o mesmo fluxo operacional usado pelo Codex.

```text
alterar local -> testar -> commit -> push GitHub -> deploy VPS
```

Producao e VPS: so pelo caminho de publicacao da equipe (o agente Integrador integra na `main`, o agente Publicador publica), como descrito em `AGENTS.md` e em `lab-ops/runbooks/publicacao-integrador-publicador.md`. Credenciais e acao destrutiva: so com ok do Andre.

Nunca ler, imprimir, copiar ou versionar secrets.
