# Requisitos do sistema de eventos

Estado: revisão de 29/10/2026. Este documento descreve o produto completo. A **Etapa 1** foi seguida por um incremento de interface responsiva e financeiro essencial, antecipado a pedido do proprietário. As partes ainda não implementadas estão em [PLANO_IMPLEMENTACAO.md](PLANO_IMPLEMENTACAO.md).

## Visão do produto

Uma aplicação web responsiva e instalável como PWA atende uma empresa de organização e decoração de eventos, com foco em casamentos e flores. A área administrativa e o portal do cliente usam a mesma base de dados, mas têm consultas, ações e regras de acesso distintas. A interface usa português do Brasil, `pt-BR`, reais (`BRL`) e datas brasileiras. O fuso padrão da empresa é configurado por `DEFAULT_TIMEZONE` no servidor (inicialmente `America/Sao_Paulo`), e cada evento pode ter seu próprio fuso.

Como o repositório começou apenas com um README e o registro de pacotes não estava disponível no ambiente de desenvolvimento, a Etapa 1 usa **Node.js 24, servidor HTTP nativo, `node:sqlite` e HTML/CSS/JavaScript** sem dependências externas. Interface e servidor são separados; as consultas SQL e as regras ainda convivem no módulo da API. Uma migração futura para PostgreSQL exigirá extrair/adaptar o acesso a dados, além de migrar o conteúdo, caso volume, concorrência e hospedagem justifiquem essa mudança.

O cadastro de um evento deve funcionar do início ao fim: a equipe cria o evento, vincula e convida um ou mais clientes, e cada cliente autenticado o visualiza no portal. Nenhuma funcionalidade é considerada entregue apenas por existir uma tela; deve persistir, aplicar autorização no servidor e sobreviver ao recarregamento.

## Perfis e fronteiras de acesso

| Perfil | Acesso esperado |
| --- | --- |
| Proprietário/administrador | Acesso completo aos registros e gerenciamento de usuários e funções. Na Etapa 1, marca, contato e fuso padrão são configurados no ambiente do servidor, sem tela de edição. |
| Equipe | Na Etapa 1, cargo descritivo e permissões configuradas individualmente por módulo/ação **e**, para dados de evento, somente nos eventos aos quais o usuário está vinculado em `event_team`. Modelos de permissões herdados por função ficam para evolução. Sem acesso implícito a módulos financeiros ou administração de usuários. |
| Cliente | Somente eventos aos quais está vinculado e conteúdo marcado como compartilhável com ele. Um evento aceita vários clientes. |

As regras são verificadas em ações e consultas do servidor. A interface pode ocultar ações sem permissão para facilitar o uso, mas isso não substitui a autorização. O proprietário vê todos os eventos; a equipe precisa da permissão do módulo **e** do vínculo explícito em `event_team`. Essa interseção vale para listagens, detalhe, edição, convites, painel, calendário e recursos futuros do evento, inclusive arquivos, comentários, aprovações e notificações. Ser responsável ou criador do evento não substitui o vínculo; se uma pessoa da equipe criar um evento, a criação deve vinculá-la de forma atômica. Custos de fornecedores, margens, observações internas, documentos privados e histórico operacional interno nunca entram nas respostas do portal. Para conteúdo sensível, como vestido, a visibilidade pode ser restrita a participantes específicos do mesmo evento. Negar acesso significa devolver resposta de erro sem revelar se o registro existe.

O diretório de clientes também respeita permissão de módulo. Para a equipe, a listagem inclui clientes de eventos aos quais está vinculada e cadastros que ela própria criou, para permitir preparar um novo evento sem expor a base inteira. O proprietário vê todos os clientes. Essa regra de diretório não amplia o acesso a eventos de outros integrantes.

Na Etapa 1, o proprietário administra a composição de `event_team` e o responsável interno. A equipe pode criar evento com permissão de edição, sendo vinculada automaticamente; não pode conceder a si mesma acesso a outro evento nem alterar a equipe de um evento existente.

## Entrega funcional da Etapa 1

1. **Acesso e recuperação**: usuários identificados por e-mail; login com senha; sessão protegida no servidor; encerramento de sessão; recuperação de acesso por link temporário de uso único gerado pelo proprietário e compartilhado **manualmente**. Convites de cliente e equipe também são links com expiração para compartilhamento manual; não concedem acesso a eventos não vinculados. A Etapa 1 não envia e-mail, WhatsApp ou push.
2. **Permissões**: papéis de proprietário, equipe e cliente; cargo descritivo e permissões individuais da equipe por módulo e ação, mais vínculo obrigatório ao evento; vínculo de um ou mais clientes ao evento; filtragem no servidor e testes de isolamento entre clientes e entre integrantes da equipe. A atribuição automática de permissões por cargo ainda não existe.
3. **Clientes**: cadastro, listagem, busca e atualização de nome, e-mail e telefone, com validação de e-mail único. A edição exige permissão e, para a equipe, vínculo do cliente a seus eventos ou autoria do cadastro. O e-mail de uma conta cliente já ativada não pode ser alterado por esse formulário.
4. **Eventos**: código único gerado automaticamente e imutável; cadastro e atualização de nome, tipo, situação, data/horário/fuso, convidados, locais e endereços separados de cerimônia e festa, responsável, equipe, clientes e observações internas; listagem com busca e filtros básicos; página de detalhes. Não há exclusão de evento na Etapa 1. Dados ainda não modelados aparecem como módulos futuros, sem simular operação.
5. **Painel inicial**: indicadores de eventos por situação, listas de próximos e recentes e, após o incremento financeiro, saldos financeiros com links quando a pessoa tem a permissão correspondente. Pendências de aprovação e outros contadores complexos entram quando seus módulos persistentes existirem.
6. **Calendário básico**: datas de eventos cadastrados com navegação; o registro é um link para o detalhe somente para quem tem `events.read`. Quem tem apenas `calendar.read` vê uma entrada resumida, sem link para uma página negada. Reuniões, tarefas, reservas e outros tipos de compromisso entram nas etapas seguintes.
7. **Portal conectado**: cliente autenticado vê apenas seus eventos, resumo, contagem regressiva, locais, horários e mapas. Marca, e-mail e telefone da empresa vêm de `BRAND_NAME`, `CONTACT_EMAIL` e `CONTACT_PHONE`, expostos pela API pública `/api/config`; o portal mostra ações de contato somente quando os respectivos valores foram configurados. Vários clientes podem acompanhar o mesmo evento.
8. **PWA inicial**: manifesto com nome provisório Jardim, ícones e layout responsivo; instalação quando o navegador oferecer esse recurso. O nome exibido na interface é configurável no servidor, mas o manifesto ainda precisa ser ajustado na publicação de outra marca. Instalação não equivale a funcionamento offline nem garante entrega de notificações.
9. **Persistência e operação**: SQLite persistente via `node:sqlite`, com migrações; dados de demonstração fictícios identificados e separados de dados reais; configuração por variáveis de ambiente; instruções de inicialização, backup e recuperação.

### Critérios de aceite da Etapa 1

- O proprietário cria um cliente e um evento, vincula esse cliente, encerra a sessão e o cliente acessa o próprio evento com outra sessão.
- Um segundo cliente, não vinculado, não lê, altera ou obtém o evento por URL ou requisição direta; nem recebe seus dados em listagens.
- A equipe só vê e altera eventos quando tem permissão de módulo e vínculo em `event_team`; painel, calendário e busca seguem o mesmo recorte. Um cliente não chama ações administrativas diretamente.
- Retirar uma pessoa da equipe de `event_team` revoga imediatamente o acesso ao evento; o proprietário continua vendo todos.
- Inclusão e edição persistem após recarga, nova sessão e reinício da aplicação com o mesmo banco.
- Os links do painel e calendário, quando exibidos a quem tem acesso aos detalhes, levam aos registros corretos; a equipe com acesso apenas ao calendário vê entradas sem link. Telas administrativas e portal funcionam em largura de celular.
- Datas e horas são exibidas no fuso do evento e no padrão brasileiro, e valores monetários somente aparecem quando correspondem a dados implementados.

## Incremento antecipado — interface e financeiro essencial

Esta entrega amplia o administrativo e o portal sem concluir toda a Etapa 4. A navegação e os formulários são adaptados a desktop e celular, com hierarquia visual mais clara, controles maiores para toque e listas financeiras utilizáveis em telas estreitas. Os dados continuam online e persistentes; a PWA não passa a oferecer sincronização offline.

- **Acesso:** proprietário tem acesso financeiro completo. A equipe precisa da permissão `finance.read` ou `finance.write`; contas vinculadas a evento também exigem vínculo em `event_team`. O cliente só consulta contas a receber de seus eventos quando marcadas para compartilhamento. A API aplica o recorte antes de montar resumos, listas e exportações.
- **Registro:** contas a receber e a pagar podem ser associadas a evento ou registradas como despesas gerais. Cada conta tem valor em centavos inteiros, categoria, parcelas com valor e vencimento, e histórico de pagamentos parciais. O total das parcelas precisa ser igual ao valor da conta; pagamentos não podem superar o saldo e estornos preservam o registro original.
- **Acompanhamento:** o administrativo apresenta saldos, valores recebidos e pagos, vencidos e próximos vencimentos, além de visão por evento. Filtros por vencimento, caixa por data de pagamento e exportação CSV obedecem às mesmas permissões da API. A receita prevista soma contas lançadas manualmente, sem vínculo automático com contrato.
- **Portal:** somente contas a receber compartilhadas exibem valores informados pela equipe, parcelas e pagamentos reconhecidos. O compartilhamento pode ser para todos os clientes do evento ou restrito a um cliente. Custos previstos/realizados, contas a pagar, fornecedor e notas internas nunca entram na projeção do cliente.
- **Limites:** pagamento é lançado manualmente após ocorrer fora do sistema. Não há cobrança bancária, comprovante por upload, conciliação, geração automática de parcelas por modelo ou renegociação contratual formal nesta entrega. Percentuais de pagamento não são fixados.

## Visões consolidadas do produto completo

Estas visões crescem conforme os módulos de origem são entregues. Cada cartão ou indicador deve abrir os registros que compõem seu número; um dado sem entidade persistente correspondente não deve ser exibido como se estivesse calculado.

| Área | Conteúdo final esperado |
| --- | --- |
| Painel administrativo | Próximos eventos e reuniões; eventos em orçamento, negociação, contratados, em execução, concluídos e cancelados; tarefas atrasadas, próximos vencimentos, aprovações pendentes, reuniões sem confirmação; valores a receber e pagar, recebimentos e despesas do período, resumo financeiro por evento; pendências de flores, decoração, mobiliário e fornecedores. |
| Cadastro do evento | Identificação, tipo, clientes, contatos, data, horários e fuso, convidados, locais de cerimônia e festa com endereços e mapas, responsável e equipe, serviços, briefing, orçamento, contratos/aditivos, decoração/flores, mobiliário, fornecedores, reuniões, visitas, cronograma, tarefas, financeiro, arquivos, referências, aprovações e histórico. |
| Pesquisa administrativa | Filtros por data, cliente, local, responsável, etapa e situação financeira, além de busca por código/nome. Um filtro só aparece quando seus dados existem e a equipe tem permissão para vê-los. |
| Portal do cliente | Resumo e contagem regressiva, locais/horários/mapas, cronograma compartilhado, reuniões e confirmação, flores/decoração, mobiliário, vestido e escolhas autorizadas, briefing, documentos compartilhados, financeiro do cliente, referências, aprovações, notificações e contato com a empresa. O cliente pode enviar fotos, comentários e pedidos de alteração, sempre dentro de fluxo distinto de aprovação e aditivo. |

## Requisitos planejados para as próximas etapas

### Etapa 2 — Comercial, planejamento e reuniões

- Briefing editável por evento, com campos de contratantes, estilo, cores desejadas e evitadas, flores, referências, verba, convidados, locais, horários, decoração, mobiliário, serviços, restrições, acessibilidade, contatos e observações. Cada campo possui visibilidade e permissão de edição próprias; alterações e pendências ficam registradas.
- Orçamento com itens, unidades, quantidades, categorias, preços e descontos, versões imutáveis após envio, histórico de negociação e estados de rascunho, enviado, aprovado, recusado e vencido. A aprovação identifica a versão exata. A conversão para contratado usa versão aprovada e preserva a versão histórica.
- Contratos e aditivos com documentos protegidos, valor, estado de assinatura e aprovação. O primeiro fluxo de assinatura é acompanhamento manual e upload do contrato assinado. Aprovação do orçamento no portal não representa assinatura eletrônica. Integração DocuSign fica preparada, mas indisponível até configuração real.
- Modelos de cronograma por tipo de evento, com prazos relativos configuráveis. Fluxo inicial: orçamento, negociação, contrato, reunião de mobiliário, visita técnica, layout e aprovação, reunião final, execução e pós-evento. As referências de seis meses para mobiliário e cerca de vinte dias para layout são valores iniciais editáveis. Etapas têm responsável, prazo, estado, tarefas, observações e anexos.
- Datas podem ser ajustadas manualmente. Evento contratado com antecedência menor que o modelo recebe alerta de etapas a reagendar. Ao alterar a data do evento, o sistema mostra impacto em tarefas, reuniões e lembretes antes de aplicar, preservando ajustes manuais quando apropriado.
- Reuniões ordinárias e extraordinárias, presença individual com respostas **confirmo**, **não poderei comparecer** ou **solicito reagendamento**. Reagendamento e cancelamento atualizam presenças e lembretes.
- Para cada reunião, lembretes persistentes no servidor em uma semana, um dia e cinco horas antes, somente se o instante ainda estiver no futuro. Estado de cada envio: agendado, processando, enviado, falhou ou cancelado. Reprocessamento evita duplicidade com chave idempotente. Envio externo só aparece como enviado após confirmação do provedor; confirmação de entrega é registrada apenas quando o canal a fornece. Equipe pode configurar se participantes já confirmados continuam recebendo lembretes.
- Central interna de notificações e estrutura para Web Push. A PWA fechada só recebe aviso externo se o navegador, o sistema, a permissão, a inscrição e o serviço de push estiverem disponíveis. E-mail e WhatsApp automatizados exigem provedores configurados, consentimento e, quando aplicável, modelos de mensagem. Um link para abrir conversa no WhatsApp é rotulado **envio manual**.

### Etapa 3 — Decoração e operação

- Catálogo de flores e materiais com variedade, fotos, cores, unidades de compra e uso, fornecedor, custo de referência e sazonalidade.
- Ambientes de decoração configuráveis por evento, incluindo cerimônia, entrada, altar, corredor, recepção, mesas, mesa principal e mesa do bolo. Cada ambiente reúne conceito, paleta, imagens, flores, arranjos, quantidades, composição, vasos, medidas, montagem, custos previstos e realizados e aprovação.
- O modelo distingue **desejado pelo cliente**, **opção aprovada** e **efetivamente comprado/usado**. Substituição que altere o combinado cria nova solicitação de aprovação e preserva o histórico. Lista consolidada de necessidades reúne flores, folhagens, materiais e quantidades por evento.
- Acervo próprio e alugado de mobiliário, vasos, suportes, peças e cenografia; fornecedores, contatos, custos, valores cobrados, contratos e documentos internos. Reservas consideram retirada, transporte, montagem e devolução, com aviso de conflito e quantidade insuficiente.
- Escolhas do cliente, inclusive vestido, loja, fotos, provas, retirada, devolução, acessórios e pendências. Outras categorias são personalizáveis; visibilidade de imagens sensíveis é por participante.
- Referências enviadas por cliente, comentários e solicitações de alteração. Sugestão, aprovação e aditivo contratual têm estados e fluxos distintos; upload de foto não altera escopo.
- Checklists reutilizáveis de separação, carregamento, saída, entrega, montagem, conferência, desmontagem e retorno/devolução. Cada item registra quantidades previstas, separadas, carregadas e devolvidas, responsável, horário, observação e foto; faltas, danos e divergências são destacados. A interface móvel mostra claramente ações ainda não sincronizadas.

### Etapa 4 — Financeiro completo (parte antecipada no incremento)

- O incremento antecipado cobre o cadastro e a consulta de contas a receber/pagar, parcelas explícitas, pagamentos parciais, vencimentos, valores consolidados e visão limitada do cliente, conforme a seção anterior. A Etapa 4 continua necessária para os fluxos restantes.
- Completar categorias e formas de pagamento configuráveis, modelos de parcelas por percentual ou valor, comprovantes protegidos, vínculo estruturado de fornecedores e fluxo de caixa previsto. Despesas gerais e por evento, caixa realizado por período e exportação CSV já existem no incremento antecipado.
- Separar valor contratado, valor recebido, saldo a receber, custo previsto, custo realizado e resultado estimado. Valores são armazenados em centavos inteiros ou decimal exato, sem ponto flutuante para cálculo financeiro.
- Modelos de pagamento aceitam percentuais ou valores; validam soma; suportam vencimento relativo à data do evento, inclusive após o evento. Renegociações geram histórico em vez de sobrescrever o acordo anterior. Percentuais padrão não são presumidos.
- Portal exibe apenas valores contratados do cliente, parcelas, vencimentos, pagamentos reconhecidos e comprovantes explicitamente compartilhados. Não há cobrança bancária real sem integração configurada.

### Etapa 5 — Integrações e conclusão

- Canais externos habilitados somente com provedores reais e credenciais no servidor; assinatura eletrônica somente após contratação e integração efetiva.
- Pós-evento: devoluções, danos, perdas, acerto financeiro, pendências, fotos finais, avaliação, encerramento e arquivo.
- Calendário completo com visões mensal, semanal, diária e lista; eventos em orçamento e contratados, reuniões, visitas, provas, montagem, desmontagem, retiradas, devoluções e tarefas. Alertas de conflitos de equipe, horário e recursos. Consulta de orçamento não bloqueia data automaticamente; reserva provisória expira.
- Revisão ponta a ponta dos fluxos, acessibilidade, PWA, observabilidade, backup e recuperação.

## Requisitos transversais

- **Auditoria**: na Etapa 1, ações relevantes registram ator, instante, entidade, ação e, quando aplicável, nomes dos campos alterados. Diferenças antes/depois e origem detalhada são extensões futuras. Histórico não expõe conteúdo interno ao cliente.
- **Arquivos, quando implementados nas próximas etapas**: armazenamento privado; URL de acesso curta ou resposta autenticada; validação de tipo, tamanho e vínculo; metadados de visibilidade; proteção no servidor inclusive em download. Não usar URLs públicas para documentos e fotos sensíveis.
- **Privacidade**: coletar apenas dados necessários, limitar acesso por perfil e vínculo, oferecer correção e remoção conforme política aplicável, não armazenar senhas ou tokens em texto simples, registrar consentimento de canais externos.
- **Tempo**: gravar instantes em UTC e o identificador IANA do fuso do evento; datas de calendário sem hora são tratadas no fuso do evento. Mudança de data deve considerar horário de verão quando aplicável.
- **Operação**: segredos somente em variáveis de ambiente do servidor; migrações versionadas; backup regular do banco e dos arquivos privados; teste de restauração; logs sem dados sensíveis.
- **Usabilidade**: contraste e foco visível, navegação por teclado, estados de carregamento/erro/vazio, formulários com validação em português, controles confortáveis no celular.

## PWA e notificações por dispositivo

A instalação melhora o acesso, mas **não é uma garantia de notificação**. A Etapa 1 não implementa notificações. Para a implementação futura, Web Push requer contexto seguro (HTTPS em produção), service worker, permissão do usuário, inscrição válida, servidor de envio operacional e políticas do navegador/sistema que permitam a entrega. A central interna planejada poderá ser consultada ao abrir o portal; ela não substituirá lembretes externos enquanto o portal estiver fechado.

| Ambiente | Limitação prática para o produto |
| --- | --- |
| iPhone/iPad, Safari e navegadores compatíveis | Segundo o WebKit, Web Push é suportado para apps adicionados à Tela de Início a partir de iOS/iPadOS 16.4, com permissão solicitada após ação do usuário. Uma aba comum no navegador não deve ser tratada como canal garantido. O sistema pode silenciar avisos por Foco, permissões ou configuração do dispositivo. |
| Android, Chrome e navegadores compatíveis | O navegador precisa permitir notificações e manter uma inscrição Push válida. Instalação é um fluxo separado da autorização. O sistema operacional e ajustes de bateria podem interferir na entrega; a interface deve mostrar o estado real da inscrição e oferecer teste de recebimento quando implementado. |
| Windows/macOS/Linux, Chrome/Edge/Firefox/Safari compatíveis | Suporte e comportamento dependem de navegador e sistema. O usuário pode bloquear notificações; navegador fechado, perfil desativado ou restrições do sistema podem impedir ou atrasar avisos. Não apresentar push como canal garantido. |

Implementação: detectar suporte por recurso (`serviceWorker`, `PushManager`, `Notification`) e permissão, sem inferir por nome do navegador; registrar inscrição por dispositivo; permitir revogação; manter canal interno; mostrar ao usuário quais canais estão ativos. A disponibilidade deve ser novamente validada em testes nos dispositivos alvo quando a Etapa 2 ou 5 implementar Web Push. Referências: [WebKit: Web Push para apps da Tela de Início](https://webkit.org/blog/13878/), [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [MDN: contextos seguros](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts), [Microsoft Edge: Push](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push), [Chrome: notificações e permissão](https://developer.chrome.com/docs/capabilities/web-apis/badging-api).

## Suposições e dúvidas de negócio

As opções abaixo permitem avançar sem transformar lacunas das anotações em regras fixas. Devem ser revistas com a empresa antes das etapas correspondentes.

| Tema | Decisão inicial configurável | Pergunta pendente |
| --- | --- | --- |
| Organização | Uma empresa por implantação; fuso padrão `America/Sao_Paulo`. | Haverá várias marcas ou filiais na mesma instalação? |
| Tipos de evento | Casamento, aniversário, corporativo e outro. | Quais campos e cronogramas específicos cada tipo precisa? |
| Etapas comerciais | Orçamento, negociação, contratado, execução, concluído e cancelado. | A empresa usa etapas intermediárias ou nomes diferentes? |
| Cronograma | Modelo editável; mobiliário em D−6 meses e layout em torno de D−20 dias apenas como referência. | Qual prazo para visita, reunião final e envio de contrato? |
| Pagamentos | Sem percentuais fixos; modelos editáveis por percentual ou valor. | Existem modelos usuais de entrada e saldo? |
| Confirmações | Presença por participante; lembretes continuam ou não após confirmação conforme configuração. | Qual política padrão da empresa? |
| Conteúdo compartilhado | Privado por padrão até liberação explícita, exceto dados básicos do evento destinados ao portal. | Quais fotos e documentos cada integrante do casal pode ver? |
| Comunicação | Canal interno primeiro; e-mail, Web Push e WhatsApp somente após configuração/consentimento. | Qual provedor será contratado e qual canal é preferido por cliente? |
| Assinatura | Upload e acompanhamento manual inicialmente. | Há conta e contrato de API DocuSign ou outro provedor? |
| Arquivos | Limites de formato e tamanho definidos por configuração e infraestrutura. | Qual volume de imagens e documentos esperado? |
| Identidade visual | Marca provisória editável. | Nome, logotipo, paleta e fotografias oficiais estão disponíveis? |

Nenhuma das dúvidas acima impede a Etapa 1. Mudanças nessas decisões devem entrar em migrações e/ou configurações, sem reescrever históricos.
