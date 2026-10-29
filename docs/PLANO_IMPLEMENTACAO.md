# Plano de implementação por etapas

Estado: revisão de 29/10/2026. A Etapa 1 foi seguida de um incremento financeiro antecipado e uma reformulação responsiva, solicitados pelo proprietário. Cada marco só é concluído após validar seus fluxos e persistência. Os requisitos completos e as dúvidas configuráveis estão em [REQUISITOS.md](REQUISITOS.md); o desenho lógico está em [MODELO_DADOS.md](MODELO_DADOS.md). A avaliação de dispositivos está em [PWA_E_NOTIFICACOES.md](PWA_E_NOTIFICACOES.md).

## Inspeção e arquitetura adotada

O repositório remoto tinha apenas um README; portanto, a aplicação é nova. O ambiente de desenvolvimento não tinha acesso utilizável ao registro npm nem pacotes Next.js/Prisma em cache. Para produzir um fluxo real e validável agora, a base da Etapa 1 usa **Node.js 24**, servidor HTTP nativo, **SQLite persistente com `node:sqlite`**, migrações SQL e frontend HTML/CSS/JavaScript responsivo. A PWA usa manifesto e service worker próprios. Não há credenciais no código.

Marca, e-mail/telefone de contato e fuso padrão são configurados no ambiente do servidor por `BRAND_NAME`, `CONTACT_EMAIL`, `CONTACT_PHONE` e `DEFAULT_TIMEZONE`. A rota pública `GET /api/config` entrega somente esses valores de apresentação. A Etapa 1 não oferece tela para editá-los.

A API é a fronteira de segurança: autentica sessão, verifica papel/permissão e vínculo do evento antes de retornar ou alterar dados. O proprietário vê todos os eventos; a equipe precisa da permissão do módulo **e** de vínculo em `event_team` para cada evento. Painel, calendário, listas, detalhes e alterações respeitam o mesmo recorte. As páginas administrativas e do cliente compartilham os mesmos registros, mas recebem projeções diferentes. O banco inicial é adequado para uma implantação pequena com baixo volume simultâneo. Na Etapa 1, rotas, regras e SQL convivem no módulo da API; antes de migrar para PostgreSQL ou múltiplas instâncias, será necessário extrair/adaptar o acesso a dados e validar os fluxos. Essa migração será uma etapa técnica explícita, com teste de dados e restauração, não uma troca de URL.

Fluxo de requisição:

```text
Navegador/PWA → rotas HTTP → sessão e autorização → regras e consultas SQL → SQLite
                                               ↘ auditoria e projeções do portal
```

## Regra para avançar de etapa

Cada etapa deve entregar ao menos um fluxo ponta a ponta. As ações principais precisam responder com erro útil, persistir e aplicar permissão no servidor. Testes automatizados cobrem regras de alto risco; a verificação manual percorre administrativo e portal no navegador, inclusive largura de celular. Uma demonstração fictícia é carregada somente em ambiente de demonstração. Ao concluir, registrar: o que foi implementado, como acessar/testar, o que foi validado, integrações que dependem de configuração e requisitos pendentes.

## Etapa 1 — Base e primeiro fluxo entre áreas

**Objetivo:** proprietário/equipe cadastra clientes e evento, vincula mais de um cliente, convida um cliente, e ele acessa seu evento no portal. Painel e calendário refletem os dados persistidos.

**Sequência de entrega:**

1. Estrutura do projeto, migração inicial, configuração segura, seed fictício separado e instruções de execução.
2. Login, sessão HTTP-only, logout, recuperação por link de uso único **gerado pelo proprietário e compartilhado manualmente**, convites manuais com expiração, papéis, cargo descritivo, permissões individuais por módulo/ação e escopo `event_team` no servidor. Modelos de permissão herdados por cargo ficam para evolução. Não há envio automático nesta etapa.
3. Cadastro, listagem e atualização de clientes; cadastro, listagem e atualização de eventos, sem exclusão. O código do evento é gerado automaticamente e não pode ser alterado. Inclui vínculo de clientes, responsável/equipe, locais, data e fuso, com buscas e filtros correspondentes aos campos disponíveis. O proprietário gerencia a equipe do evento e seu responsável; integrante da equipe que cria evento é vinculado automaticamente. A migração `002_client_creator.sql` registra quem criou cada cliente para limitar a lista da equipe a cadastros próprios ou vinculados a seus eventos.
4. Painel com indicadores de eventos e calendário básico alimentado pelos registros reais. Links de detalhe aparecem apenas a quem tem `events.read`; com somente `calendar.read`, o compromisso é apresentado sem link.
5. Portal com listagem e resumo dos próprios eventos, data/contagem regressiva, horários, local/mapa e marca/contato da empresa quando configurados no ambiente; PWA instalável e responsiva.
6. Testes de autorização entre clientes e entre integrantes da equipe (inclusive pessoa com permissão de módulo mas sem vínculo com o evento), isolamento do diretório de clientes, convite vencido, sessão inválida e persistência; revisão no navegador em desktop e celular.

**Critério de saída:** fluxo completo com duas contas de cliente distintas, ao menos um evento compartilhado entre dois clientes e outro evento privado, sem vazamento por API ou interface. Uma pessoa da equipe vinculada vê o evento em lista, painel, calendário e detalhe quando tem as permissões correspondentes; outra, com a mesma permissão de módulo mas sem vínculo, não o vê nem o altera por requisição direta. Remover o vínculo revoga o acesso. Se a equipe criar evento, o criador é vinculado na mesma transação. Recarga e reinício mantêm os dados. As entradas do calendário sem permissão de detalhe não são links quebrados. Todas as ações visíveis no primeiro fluxo funcionam. Recursos futuros devem estar identificados como pendentes, sem botões que fingem sucesso.

**Pendências ao fim da Etapa 1:** orçamento, contrato, briefing, reuniões, notificações, flores, acervo, financeiro e checklist. O financeiro essencial foi antecipado no incremento seguinte; o painel e calendário só mostram indicadores/compromissos cujas entidades já existem.

## Incremento antecipado — financeiro essencial e experiência responsiva

**Objetivo:** melhorar o uso no computador e no celular e disponibilizar ao proprietário uma operação financeira inicial, com acesso controlado por perfil e evento. Este incremento não conclui a Etapa 4.

1. Refinar cores, tipografia, hierarquia visual e navegação administrativa e do portal, preservando contraste, foco visível e formulários confortáveis no toque. Conferir páginas principais em larguras de celular e desktop.
2. Migrar o banco para contas financeiras, parcelas, pagamentos e alocações em centavos inteiros. Acrescentar o módulo `finance` às permissões de equipe, sem concedê-lo automaticamente.
3. Cadastrar contas a receber e a pagar, vinculadas a evento quando aplicável, com parcelas explícitas cujo valor total fecha a conta; permitir registrar pagamento parcial e estorná-lo com motivo, sem apagar o histórico.
4. Oferecer resumo e visão por evento no administrativo, com vencimentos e saldos calculados a partir dos registros. Permissões e vínculo do evento valem para listas, detalhes, resumos e exportação.
5. Mostrar no portal somente contas a receber explicitamente compartilhadas de eventos vinculados ao cliente. Contas a pagar, custos e observações internas permanecem inacessíveis.
6. Validar persistência, cálculos em centavos, pagamento parcial/estorno, isolamento entre clientes e escopo financeiro da equipe. Conferir o fluxo em navegador em largura de celular e desktop.

**Critério de saída:** proprietário cadastra conta com parcelas e registra pagamento parcial; resumo e saldo se atualizam após recarga. Cliente vinculado vê somente a cobrança compartilhada do seu evento. Integrante da equipe sem permissão financeira ou sem vínculo ao evento não acessa os valores por chamada direta. Não há cobrança bancária nem upload de comprovante neste marco.

## Etapa 2 — Comercial, planejamento e compromissos

**Objetivo:** registrar o acordo comercial e coordenar o planejamento até a reunião, com confirmação e lembretes persistentes.

1. Briefing editável e campos liberados ao cliente, com histórico e pendências.
2. Orçamentos versionados, itens e descontos, negociação, aprovação vinculada à versão e conversão para contratado.
3. Contratos/aditivos com upload protegido, assinatura manual acompanhada por status e futura estrutura de provedor.
4. Modelos de cronograma por tipo, prazos relativos e ajustes manuais; prévia de impacto antes de reagendar por mudança da data do evento.
5. Reuniões, participantes e confirmação individual. Agendador persistente com lembretes de uma semana, um dia e cinco horas, cancelamento/reagendamento, tentativas idempotentes, erros e reprocessamento.
6. Central interna de notificações e infraestrutura Web Push, habilitada apenas com chaves, HTTPS e permissões válidas. E-mail/WhatsApp automáticos aguardam provedores reais.

**Critério de saída:** um orçamento enviado é aprovado pelo cliente na versão correta; o evento passa a contratado; contrato assinado pode ser anexado manualmente sem alegação de assinatura eletrônica; reunião agendada gera jobs futuros, cada participante responde, reagendamento cancela os antigos e cria novos sem duplicatas. Testes cobrem versões, agenda, presença e falha de envio.

## Etapa 3 — Flores, decoração e operação

**Objetivo:** planejar o diferencial floral e controlar itens físicos do evento até o retorno.

1. Catálogo de flores, folhagens, materiais, fotos e fornecedores, com custos internos.
2. Ambientes com conceito, paleta, referências, flores, arranjos, vasos, medidas, custos e revisões; aprovação do cliente e substituição com nova aprovação.
3. Lista consolidada de necessidades para compra e montagem, distinguindo opção desejada, aprovada e material usado.
4. Acervo e mobiliário próprios/alugados, fornecedores, reservas com períodos completos e alerta de falta/conflito.
5. Escolhas do cliente, incluindo vestido, e controle de foto sensível por participante.
6. Checklists reutilizáveis de carregamento, montagem, desmontagem e devolução, com quantidade, responsável, horário, foto e divergência. Interface móvel informa claramente quando uma ação não foi sincronizada.

**Critério de saída:** o cliente aprova uma revisão de ambiente, uma substituição relevante exige nova decisão; necessidades refletem a revisão válida; reserva conflitante ou acima do estoque é detectada; checklist persiste e registra faltas/danos. Testes cobrem visibilidade de arquivos e conflitos de reserva.

## Etapa 4 — Complementação financeira

**Objetivo:** acompanhar contrato, recebimentos, despesas e resultado sem expor custos ao cliente.

1. Modelos configuráveis de pagamento por percentual ou valor, com vencimentos relativos à data do evento, inclusive após ele.
2. Categorias e formas de pagamento configuráveis, fornecedor estruturado, comprovantes privados e controle de acesso no download.
3. Renegociação formal com versões do acordo, fluxo de caixa previsto/realizado por período e conciliação conforme a operação da empresa.
4. Ampliar relatórios, CSV e projeção financeira do portal para o acordo comercial versionado quando orçamento e contrato estiverem disponíveis.

**Critério de saída:** modelos geram parcelas que fecham exatamente o contratado e aceitam ajustes negociados; renegociação preserva o acordo anterior; relatórios reconciliam valores previstos e realizados; comprovantes são acessados apenas por pessoas autorizadas. Testes cobrem cálculos, versões e acesso aos arquivos.

## Etapa 5 — Integrações, pós-evento e revisão final

**Objetivo:** ativar somente integrações contratadas e validar o ciclo de vida completo.

1. Configurar e testar provedores reais para e-mail, Web Push e WhatsApp oficial conforme consentimento e modelos exigidos; conciliar tentativas e confirmações de entrega disponíveis.
2. Integrar assinatura eletrônica apenas se houver conta/contrato do provedor e validação jurídica do fluxo; manter upload manual como caminho explícito.
3. Pós-evento: devolução, danos/perdas, acerto final, pendências, fotos, avaliação, arquivamento.
4. Calendário completo com visões mensal, semanal, diária e lista; conflitos de horário/equipe/recursos e reserva comercial provisória com expiração.
5. Rever acessibilidade, desempenho, PWA, monitoramento, backup/restauração e segurança; executar o roteiro integrado inteiro.

**Critério de saída:** cada canal externo só informa sucesso após resposta real do provedor; falhas são visíveis e reprocessáveis; arquivos, finanças e escolhas sensíveis continuam isolados; recuperação de backup foi ensaiada. Instalação da PWA e Web Push são testados separadamente nos dispositivos suportados.

## Roteiro de demonstração evolutiva

Usar um **casamento fictício** com dois contratantes e uma pessoa de equipe. Na Etapa 1, criar o evento, vincular ambos, acessar por contas separadas e observar painel/calendário/portal. No incremento financeiro, registrar conta compartilhada, parcelas, recebimento parcial e despesa interna, conferindo as visões separadas do administrativo e do portal. Na Etapa 2, registrar briefing, orçamento e sua aprovação, contrato, cronograma e reunião com respostas. Na Etapa 3, planejar flores e mobiliário, registrar aprovação, reserva e checklist. Na Etapa 4, aplicar modelos, renegociar parcelas e conferir comprovantes protegidos. Na Etapa 5, concluir devoluções e acerto. Seeds nunca usam dados reais nem habilitam integrações externas automaticamente.

## Riscos e decisões abertas

- **Hospedagem e concorrência:** SQLite é a decisão de início para o ambiente atual. Antes de múltiplas instâncias ou volume elevado, definir hospedagem, testar carga e planejar PostgreSQL ou outro banco gerenciado.
- **Comunicação automática:** canal externo depende de contrato, credenciais, consentimento e configuração. Lembrete salvo no banco e notificação interna não implicam entrega no celular com o portal fechado.
- **Assinatura:** aprovação de orçamento e upload de contrato assinado são registros comerciais diferentes de assinatura eletrônica válida.
- **Prazos e pagamentos:** referências das anotações são parâmetros editáveis; percentuais, marcos e política de lembretes precisam de validação da empresa.
- **Identidade e dados reais:** nome, marca, fotos, retenção, provedores e regras específicas de acesso a vestido/documentos serão configurados com o proprietário antes do uso em produção.
