# Modelo inicial de dados

Estado: revisão de 29/10/2026. **Etapa 1** indica entidades do primeiro fluxo funcional; **incremento financeiro** indica o módulo antecipado; **futuro** indica a extensão prevista. O esquema físico e as migrações do código são a fonte da verdade dos nomes e tipos implementados. Campos sugeridos aqui não devem ser confundidos com funcionalidade já entregue.

## Decisões de modelagem

- Banco inicial: SQLite persistente via `node:sqlite` do Node.js 24, com migrações versionadas e chaves estrangeiras habilitadas. O arquivo de dados fica fora do controle de versão. SQLite serve à primeira implantação e aos testes; uma migração para PostgreSQL pode ser feita quando concorrência, volume ou hospedagem exigirem. Não misturar sintaxe específica de SQLite nas regras de domínio.
- Chaves primárias: identificadores opacos; códigos visíveis do evento são gerados na criação, únicos e imutáveis na Etapa 1. Eles não funcionam como segredo nem substituem autorização.
- Datas/horas de compromissos: instante UTC mais identificador de fuso IANA. Datas sem hora, como aniversário ou vencimento, preservam a data civil. `America/Sao_Paulo` é apenas o padrão configurável.
- Valores: centavos inteiros, com moeda `BRL`, ou decimal exato onde houver frações de unidade; nunca ponto flutuante para total financeiro. Operações de soma e arredondamento são centralizadas no domínio.
- Exclusões de registros com histórico financeiro, aprovações ou auditoria devem ser lógicas, quando necessário. Eventos cancelados permanecem consultáveis conforme permissão.
- Conteúdo compartilhado usa política explícita: interno, clientes do evento ou lista específica de participantes. O valor padrão de anexo, comentário interno e custo é **interno**.

## Núcleo da Etapa 1

| Entidade | Dados centrais | Relacionamentos e restrições |
| --- | --- | --- |
| Configuração pública da empresa | `BRAND_NAME`, `CONTACT_EMAIL`, `CONTACT_PHONE`, `DEFAULT_TIMEZONE` | Uma empresa por implantação inicial; variáveis do ambiente do servidor, lidas por `GET /api/config`. Não existe tabela nem tela de edição na Etapa 1. Os contatos são opcionais e o fuso padrão inicial é `America/Sao_Paulo`. |
| `users` | id, nome, e-mail normalizado único, função (`job_title`), hash de senha, papel (`owner`, `team`, `client`), cliente associado, ativo, criação | Não guardar senha em texto; clientes vinculados a eventos por relação explícita. |
| `team_permissions` | usuário da equipe, módulo, `can_view`, `can_edit` | Chave única `(user_id, module)`; permissões são individuais, não herdadas de `job_title`. Proprietário tem acesso completo via regra do servidor. |
| `sessions` | usuário, hash do token de sessão, expiração, revogação, criação | Cookie seguro e HTTP-only; sessão expirada ou revogada não autoriza requisições. |
| `auth_attempts` | chave de tentativa, contagem de falhas, expiração | Limite temporário de tentativas de login; não substituir controles de segurança da infraestrutura de produção. |
| `password_resets` | usuário, hash de token, validade, consumo | Link de uso único e prazo curto, gerado pelo proprietário para compartilhamento manual; não há envio externo na Etapa 1. Não expor token em logs. |
| `clients` | nome, e-mail/telefone, `created_by`, criação/atualização | Cadastro, consulta e atualização precedem a conta de portal. E-mail único sem diferenciar maiúsculas/minúsculas; conta ativada impede alteração de e-mail por esse fluxo. `created_by` permite à equipe encontrar cadastros que criou antes de vinculá-los a um evento. |
| `events` | código gerado, nome, tipo, situação, data/hora, fuso, convidados estimados/confirmados, locais e endereços de cerimônia e recepção, links de mapa, notas internas, responsável, criação/atualização | Código único e imutável; `owner` acessa todos, `team` precisa de permissão e registro em `event_team`, cliente acessa somente via `event_clients`. Local próprio de cada parte pode ser registrado quando diferirem. |
| `event_clients` | evento, cliente, criação | Chave única por evento e cliente; permite os dois integrantes do casal e outros contratantes. `users.client_id` liga a conta ao cadastro. |
| `event_team` | evento, usuário da equipe | Chave única `(event_id, user_id)`. É a fronteira de acesso aos dados do evento para `team`, combinada com `team_permissions`; responsável e criador não concedem acesso sem esse vínculo. |
| `invitations` | evento, cliente, hash de token, expiração, aceite | Vínculo validado na aceitação. Convite expirado não cria sessão nem acesso. |
| `team_invitations` | usuário da equipe, hash de token, expiração, aceite | Ativação manual da conta da equipe por link compartilhado pelo proprietário; convite vencido não ativa a conta. |
| `audit_log` | ator, ação, tipo/id da entidade, instante, `details_json` | Na Etapa 1 registra ações e, em atualizações, nomes dos campos enviados; não armazena diferenças completas antes/depois. Nunca guardar senhas/tokens. Consulta do histórico pela interface fica para etapa futura. |

Relações principais:

```text
users ── sessions / team_permissions / team_invitations
users ── clients (opcional)
events ── event_clients ── clients
events ── event_team ── users
events ── invitations / audit_log
```

### Invariantes da Etapa 1

1. Toda leitura ou escrita administrativa requer sessão válida. O `owner` pode acessar todos os eventos. Para `team`, uma ação sobre evento requer simultaneamente permissão de módulo/ação e linha em `event_team` para aquele evento. O ID enviado pelo navegador nunca é prova de autorização.
2. Toda leitura do portal filtra por `event_client` do usuário autenticado e por visibilidade. Um cliente não consegue enumerar eventos de outros pelo código ou pelo ID.
3. Alterar clientes vinculados exige permissão administrativa e, para `team`, acesso ao próprio evento. Gerenciar `event_team` e trocar o responsável interno é ação do proprietário na Etapa 1. Remover uma linha de `event_clients` ou `event_team` revoga imediatamente o respectivo acesso ao evento, inclusive a referências futuras em URLs.
4. Listas, buscas, calendário, painel e agregados da equipe são calculados somente sobre `event_team`, antes de aplicar os demais filtros. O detalhe, a edição, os convites e os futuros arquivos herdam a mesma restrição. Ao criar um evento como `team`, vincular o criador na mesma transação para que o registro não fique inacessível.
   A listagem de clientes da equipe, quando o módulo `clients` está autorizado, inclui apenas clientes de seus eventos e clientes que ela própria criou. Essa consulta não amplia o conjunto de eventos acessíveis.
   A atualização de cliente por `PATCH /api/clients/:id` aplica a mesma regra de acesso; a busca não permite encontrar clientes de outros integrantes. O calendário pode fornecer uma projeção resumida sem link de detalhe para equipe com `calendar.read` e sem `events.read`.
5. E-mail é normalizado antes da comparação. Tokens de sessão, convite e recuperação têm expiração; hashes e segredos permanecem no servidor.
6. Campos de data/hora são interpretados com o fuso armazenado no evento, não com o fuso do host. Data inválida e fuso IANA inválido são rejeitados.

## Extensões previstas — Etapa 2

| Grupo | Entidades e campos essenciais | Regra importante |
| --- | --- | --- |
| Briefing | `briefing_field` (chave, tipo, ordem, visibilidade, editável pelo cliente), `briefing_answer` (evento, campo, valor, autor, instante), `briefing_change` | O cliente edita apenas campos liberados; mudanças ficam auditadas. |
| Comercial | `quote`, `quote_version`, `quote_item`, `negotiation_entry` | Versão enviada não é editada; item guarda categoria, unidade, quantidade, preço em centavos, desconto e observação. |
| Aprovações | `approval_request`, `approval_response` | Alvo tipado com ID e versão/revisão imutável. Resposta se aplica somente à revisão apresentada. |
| Contratos | `contract`, `addendum`, `signature_status` | Assinatura manual e documento protegido; integração futura guarda ID externo e eventos do provedor sem simular validade. |
| Arquivos protegidos | `file_asset`, `file_access` | Metadados, evento, tipo/tamanho, armazenamento privado, checksum, visibilidade e participantes autorizados; necessário já para contrato e anexos da Etapa 2. |
| Cronograma | `timeline_template`, `stage_template`, `event_stage`, `task` | Prazo relativo à data do evento, data efetiva, indicador de ajuste manual, responsável, status, anexos e histórico de replanejamento. |
| Reuniões | `meeting`, `meeting_participant`, `attendance_response` | Resposta individual; reunião tem fuso, local/link, orientação, revisão de agendamento e estado. |
| Notificações | `notification`, `reminder_job`, `delivery_attempt`, `push_subscription`, `contact_consent` | Chave única por reunião/revisão/participante/deslocamento/canal; estados persistentes; tentativas e confirmação de provedor separadas da entrega. |

### Invariantes de aprovação e lembretes

- A aprovação aponta para `quote_version.id`, `design_revision.id` ou `addendum.id`, nunca apenas para a entidade mutável pai.
- Reagendar uma reunião incrementa sua revisão, cancela jobs pendentes da revisão anterior e cria apenas os lembretes futuros aplicáveis. Cancelar a reunião cancela os pendentes.
- A transição para `enviado` requer confirmação do serviço de envio ou criação interna efetiva. `entregue` só existe quando o canal informa entrega. Tentativas repetidas não criam duas notificações para a mesma chave idempotente.
- A resposta de presença é vinculada ao participante autenticado e à reunião; cliente não responde por outro participante.

## Extensões previstas — Etapa 3

| Grupo | Entidades e campos essenciais | Regra importante |
| --- | --- | --- |
| Catálogo floral | `flower`, `material`, `catalog_photo`, `flower_supplier` | Nome/variedade, cores, unidade de compra e uso, fornecedor, custo de referência, disponibilidade/sazonalidade. Custos internos. |
| Projeto visual | `event_environment`, `design_revision`, `design_item`, `design_reference`, `substitution_request` | Ambiente guarda conceito, paleta, dimensões, montagem e custo. Separar desejado, aprovado e comprado/usado. Substituição material exige nova aprovação. |
| Compras | `requirement_line`, `purchase_order`, `material_usage` | Lista consolidada soma necessidades por unidade compatível; registra compra e uso efetivos. |
| Acervo e fornecedores | `inventory_item`, `supplier`, `supplier_service`, `inventory_reservation` | Itens próprios/alugados, fotos, medidas, quantidades, custo, preço, contatos. Reserva cobre retirada até devolução. |
| Escolhas do cliente | `choice_category`, `client_choice`, `choice_access` | Vestido e outras categorias; fotos e documentos podem ser limitados a participantes específicos. |
| Operação | `checklist_template`, `checklist`, `checklist_item`, `checklist_observation` | Quantidades previstas/separadas/carregadas/devolvidas, danos, faltas, responsável, horário e fotos. |
| Fotos e referências | Uso de `file_asset` e `file_access` | Reutilizar a proteção da Etapa 2 para catálogo, ambientes, vestido e checklist. |

Reserva conflitante: para um item, somar quantidades de reservas ativas cujos intervalos `[início da retirada, fim da devolução)` se sobrepõem. Rejeitar ou destacar quando essa soma ultrapassa a quantidade disponível. Uma consulta comercial não reserva automaticamente.

## Incremento financeiro antecipado

As migrações `003_finance.sql` e `004_finance_payment_idempotency.sql` acrescentam `finance` às permissões individuais da equipe, criam as tabelas abaixo e uma chave opcional de idempotência em pagamentos. Cada consulta financeira do administrativo exige permissão de módulo e aplica `event_team` às contas vinculadas a evento. O proprietário pode consultar todos os registros. A projeção do portal usa somente contas a receber de eventos aos quais o cliente está vinculado e que foram marcadas explicitamente para compartilhamento.

| Entidade | Dados centrais | Regra importante |
| --- | --- | --- |
| `financial_accounts` | direção receber/pagar, título, evento/cliente opcionais, categoria, fornecedor textual, valor em centavos, visibilidade, notas internas | Valor positivo; somente conta a receber ligada a evento pode ser compartilhada com cliente. O campo de fornecedor ainda não é um cadastro estruturado. |
| `financial_installments` | conta, sequência, data civil de vencimento, valor em centavos | Parcelas de uma conta devem somar exatamente o valor contratado/previsto. Datas não dependem do fuso do processo. |
| `financial_payments` | conta, data civil, valor, forma de pagamento textual, referência, notas, autor, estorno lógico | Não apagar pagamento registrado; estorno guarda data e motivo. A soma dos pagamentos ativos não ultrapassa o valor da conta. |
| `financial_payment_allocations` | pagamento, parcela, valor alocado | Um pagamento parcial pode cobrir vencimentos em ordem; a soma das alocações equivale ao pagamento. |

O administrativo calcula contratado, recebido, a receber, custo previsto, custo realizado, a pagar, resultado estimado e vencidos a partir de contas, parcelas e pagamentos não estornados. O portal usa uma projeção separada, sem custo, margem, contas a pagar ou notas internas. Não há transferência de dinheiro nem cobrança bancária no servidor.

## Extensões restantes — Etapa 4

| Entidade | Dados centrais | Regra importante |
| --- | --- | --- |
| `payment_template` e `payment_template_line` | percentual ou valor, vencimento absoluto/relativo, ordem | A soma deve fechar o total contratado; parcelas após o evento são válidas. |
| `financial_category` | nome, tipo, ativo | Substituir a categoria textual por cadastro configurável preservando o histórico. |
| `payment_method` | nome, ativo, regras de exibição | Substituir a forma textual por catálogo configurável. |
| `financial_renegotiation` | conta, revisão, parcelas antigas/novas, justificativa, data e autor | Alterar o acordo por revisão, sem apagar vencimentos e valores anteriores. |
| `financial_document` | arquivo protegido, conta/pagamento, visibilidade e participantes | Comprovante só pode ser baixado após autorização no servidor. |

Modelos de pagamento por percentual ou valor, vencimentos relativos à data do evento, conciliação, relatórios mais completos e categorias estruturadas permanecem futuros. A exportação CSV implementada respeita os filtros e permissões da tela.

## Extensões previstas — Etapa 5

`calendar_entry` pode consolidar compromissos que não pertencem diretamente a reunião, tarefa ou evento, incluindo visitas, prova, montagem e devolução. `post_event_case`, `damage_loss`, `client_review` e `archive_record` cobrem fechamento. `integration_account`, `outbound_message` e `provider_webhook` permitem provedores externos; credenciais ficam em secret store/ambiente, nunca em linhas expostas ao cliente.

## Migrações, backup e privacidade

- A migração `001_base.sql` cria o núcleo da Etapa 1. A migração `002_client_creator.sql` adiciona `clients.created_by` e o índice para restringir a lista de clientes da equipe sem impedir a preparação de novos eventos.
- As migrações `003_finance.sql` e `004_finance_payment_idempotency.sql` introduzem permissões financeiras, contas, parcelas, pagamentos e alocações com valores em centavos inteiros e chave para evitar pagamento duplicado em nova tentativa.
- Cada mudança de esquema tem migração versionada e revisável. Aplicar em ordem, com backup antes de migração em produção e procedimento de retorno documentado.
- Backup inclui banco SQLite e arquivos privados em conjunto consistente. Restaurar em ambiente de teste periodicamente e verificar acesso, anexos e registros de auditoria. Em PostgreSQL, adaptar para `pg_dump`/backup gerenciado sem alterar regras de domínio.
- Não inserir dados de demonstração no banco real. Seeds usam pessoas e contatos fictícios e uma flag/ambiente específico.
- Minimizar dados pessoais, definir prazo de retenção e responder a solicitações legítimas de acesso/correção/eliminação observando obrigações contratuais e legais. Logs devem guardar identificadores e mudança necessária, não cópias irrestritas de documentos.
- Arquivos são armazenados fora de diretório público. Cada acesso consulta o banco para validar papel, vínculo do evento e visibilidade do arquivo; links temporários, quando usados, expiram.
