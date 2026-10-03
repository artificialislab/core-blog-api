# Publicação após merge sem depender do Mac

Estado desta proposta: preparada, não ativada nem validada na VPS.

Um push na main (incluindo merge de PR) dispara este workflow. A execução automática só prossegue quando AMBAS as variáveis do repositório estão definidas: `AUTO_DEPLOY_ENABLED=true` e `DEPLOY_TRANSPORT=actions`. Ausência de qualquer variável mantém build/publicação automática desligados. O acionamento manual continua disponível, apenas publica a partir da main. Abrir uma PR não autoriza publicação.

Não foi encontrado webhook cadastrado neste repositório.

## Pré-requisitos para ativar

1. Corrigir o bloqueio de cobrança/limite do GitHub Actions. Não há nova validação de pagamento nesta proposta.
2. Conferir os nomes dos secrets de todos os jobs e o ambiente production, sem imprimir valores. Secrets de organização/ambiente também podem ser utilizados; a ausência na lista do repositório não prova ausência em todos os escopos.
3. Aprovar o diff de infraestrutura e a publicação na VPS correspondente.
4. Escolher um único transporte de deploy, desativar o outro e testar primeiro pelo workflow manual da main. Testar build, publicação, saúde e recuperação antes de habilitar o automático.
5. Habilitar as duas variáveis só depois de um deploy manual verificado. Essa mudança não inicia deploy retroativo; o próximo push na main dispara.

## Falha e pausa

Jobs de publicação dependem do job de validação; um build falho não publica. Execuções de produção são serializadas e não são canceladas no meio por um push posterior. Para pausar novos deploys automáticos, remover `AUTO_DEPLOY_ENABLED` ou definir false. Uma execução já iniciada exige acompanhamento. Não há promessa de rollback automático de banco ou n8n; usar a recuperação específica do projeto.

## GitHub pela nuvem

O ChatGPT Work já consultou repositórios privados e dispõe de ferramentas de branch, PR e merge. O merge é uma decisão separada do deploy. A publicação por Actions, quando ativada e saudável, usa runners e credenciais do GitHub, sem Mac ligado e sem exigir acesso SSH do agente na nuvem.

## Conferência de configuração (02/10/2026)

Secrets referenciados pelo workflow (apenas nomes): `VPS_SSH_KEY`.

Não encontrados nos secrets do repositório: `VPS_SSH_KEY`. O ambiente production existente não tem secrets cadastrados; no Bittale ele não existe. Conferir eventuais secrets compartilhados antes de ativar. Nenhum valor foi lido.

As duas variáveis de ativação estavam ausentes nos seis repositórios. Os webhooks da plataforma e Carolina responderam 200 recentemente; Aline, Ana Paula e Bittale estão cadastrados, mas sem entregas recentes. Blog não tinha webhook cadastrado.
