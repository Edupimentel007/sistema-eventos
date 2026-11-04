# Paulo Guimarães — sistema de eventos

Aplicação web responsiva e instalável como PWA para organização de eventos. O painel administrativo e o portal do cliente compartilham o mesmo banco persistente. Interface em português do Brasil, valores em reais e fuso padrão `America/Sao_Paulo`.

A identidade visual usa a marca **Paulo Guimarães — Decorações de Eventos**: a escrita principal, sem fundo, fica centralizada nos cabeçalhos e na entrada; a flor secundária aparece em detalhes e no ícone instalável. O botão de tema alterna entre claro e escuro no administrativo, no portal e na entrada; a escolha fica salva neste navegador. Os PNGs do projeto são versões preparadas a partir das imagens enviadas na conversa. Para fidelidade pixel a pixel ao material gráfico original, substitua `public/logo-wordmark.png` e `public/logo-flor.png` pelos arquivos oficiais.

## O que funciona

- **Eventos e clientes:** cadastro, vínculos de várias pessoas ao evento, convites individuais, permissões de equipe, painel e agenda em visões de mês, semana, dia e lista.
- **Portal do cliente:** resumo, contagem regressiva, mapas, financeiro compartilhado, fotos de inspiração, contratos liberados e central de notificações.
- **Inspirações e contratos:** cliente envia fotos; a equipe pode enviar fotos e PDFs de contrato vinculados a um cliente. A liberação de cada contrato é explícita. O status de assinatura é manual; upload ou aprovação no portal não constituem assinatura eletrônica.
- **Acervo e fornecedores:** móveis e materiais próprios ou alugados, fotos, estoque por movimentações, reservas por evento e intervalo, aviso de quantidade insuficiente e conflito, contatos e lista do que cada fornecedor disponibiliza.
- **Financeiro:** contas a receber e a pagar por evento ou da empresa, parcelas, pagamentos parciais, estornos com histórico, filtros, resumo e CSV. Custos e notas internas não são enviados ao cliente.
- **Mensagens automáticas:** regras relativas à data do evento ou ao vencimento de parcela compartilhada, fila persistente, reagendamento, registro de falha e prevenção de duplicidade. O canal interno funciona no portal. E-mail via Resend e WhatsApp via API oficial da Meta exigem configuração real e autorização individual do cliente.

## Arquitetura e requisitos

Node.js 24 ou superior, servidor HTTP nativo, SQLite (`node:sqlite`) com migrações, interface HTML/CSS/JavaScript e service worker apenas para arquivos estáticos. Não é necessário `npm install`. O banco usa valores monetários em centavos inteiros. Sessões usam cookie HTTP-only, senhas scrypt e convites e recuperação de acesso usam tokens de uso único com expiração. O servidor autoriza cada operação e download por perfil, evento e, quando aplicável, cliente.

A configuração atual usa um processo Node e um volume persistente. Para mais instâncias ou maior concorrência, planeje PostgreSQL e um worker de notificações separado. A instalação da PWA não oferece funcionamento offline nem garante notificações fora do portal. Consulte [docs/PWA_E_NOTIFICACOES.md](docs/PWA_E_NOTIFICACOES.md).

Para publicação com dados reais, consulte [o guia Vercel e Render](docs/DEPLOY_VERCEL.md). O banco e os anexos exigem disco persistente e a conta Vercel Hobby não permite uso comercial.

## Primeira execução

No PowerShell, dentro do repositório:

```powershell
$env:OWNER_NAME = 'Seu nome'
$env:OWNER_EMAIL = 'voce@empresa.com.br'
$env:OWNER_PASSWORD = 'uma-senha-forte-com-12-ou-mais-caracteres'
npm.cmd run bootstrap:owner
npm.cmd start
```

Abra `http://127.0.0.1:3000`. O comando `bootstrap:owner` cria apenas o primeiro proprietário e não altera uma conta existente. As variáveis de [.env.example](.env.example) devem ser definidas no ambiente do processo ou da hospedagem; o projeto não carrega `.env` automaticamente.

## Roteiro de uso

1. Entre como proprietário. Cadastre clientes em **Clientes** e crie um evento em **Eventos**, com data, local e clientes vinculados. Gere os convites individuais no detalhe do evento e compartilhe os links por um canal seguro.
2. No detalhe do evento, abra **Inspirações e contratos** para subir um PDF para um cliente específico. Marque **Liberar no portal** somente quando estiver pronto. O cliente pode enviar suas fotos de inspiração nessa mesma área do portal.
3. Abra **Financeiro** no menu ou pelo evento. Escolha **Novo recebimento** ou **Nova despesa**; ao abrir pelo evento, ele já vem selecionado. Registre parcelas, recebimentos ou pagamentos. Compartilhe com clientes apenas lançamentos a receber desejados.
4. Em **Acervo e estoque**, cadastre móveis e outros itens, fotos e quantidade inicial. Registre entradas ou baixas e reserve quantidades em **Itens do evento**. O sistema impede reservas acima do estoque no mesmo período.
5. Em **Fornecedores**, cadastre contato, categoria e produtos ou serviços. Em **Mensagens**, crie regras e consulte a fila. O cliente acessa **Notificações** para ver mensagens internas e decidir se autoriza e-mail e WhatsApp.
6. Use **Agenda** para consultar eventos por mês, semana, dia ou lista. A agenda atual mostra os eventos cadastrados; reuniões e visitas entram em uma entrega futura.

## Dados fictícios para testar

O script exige um banco **separado dos dados reais** e senhas fornecidas no ambiente:

```powershell
$env:DEMO_DATABASE_PATH = 'data/demo.sqlite'
$env:DEMO_OWNER_PASSWORD = 'senha-forte-exclusiva-para-demo'
$env:DEMO_CLIENT_PASSWORD = 'outra-senha-forte-exclusiva'
npm.cmd run seed:demo
$env:DATABASE_PATH = $env:DEMO_DATABASE_PATH
npm.cmd start
```

Ele cria o casamento fictício de Ana e Lucas, com clientes, financeiro, dois fornecedores, mobiliário reservado e dois lembretes internos agendados. Contas: `proprietario@example.com`, `ana.oliveira@example.com` e `lucas.pereira@example.com`; use as senhas definidas acima. O script não altera um banco já populado. Teste o envio de fotos e contratos com arquivos seus de demonstração e use nomes e dados fictícios.

## Verificação

```powershell
npm.cmd test
npm.cmd run check
```

Os testes cobrem autenticação, migrações, isolamento entre clientes, arquivos privados, permissões de equipe, cálculos financeiros, estoque, conflitos de reserva, reagendamento de mensagens, idempotência e confirmação de provedores. Os fluxos de agenda e upload foram verificados no navegador em desktop e celular com banco de QA separado.

## Operação e serviços externos

- Em produção, use proxy HTTPS, `APP_BASE_URL` público, `COOKIE_SECURE=true`, volume persistente, acesso restrito ao banco e arquivos e monitoramento do processo. O worker de mensagens depende de um processo ativo; os agendamentos permanecem no banco durante interrupções.
- Faça backup consistente do SQLite **e** dos diretórios de arquivos privados: `MEDIA_ROOT` (padrão `data/uploads`) e `PRIVATE_UPLOAD_DIR` (padrão `data/private_uploads`, com fotos do acervo em `inventory/`). Teste a restauração em ambiente separado. Não versione bancos, arquivos de clientes ou segredos.
- Para conectar e-mail e WhatsApp, siga [docs/MENSAGENS.md](docs/MENSAGENS.md). Sem credenciais, o sistema não apresenta envios externos como realizados. Não há cobrança bancária nem assinatura eletrônica integrada.
- Reuniões, aprovações de layout, briefing completo, orçamento versionado, checklists e web push permanecem no [plano por etapas](docs/PLANO_IMPLEMENTACAO.md). Mensagens automáticas desta entrega usam eventos e parcelas, não reuniões.

Veja também [requisitos](docs/REQUISITOS.md) e [modelo de dados](docs/MODELO_DADOS.md).
