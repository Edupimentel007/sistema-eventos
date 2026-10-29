# Jardim — sistema de eventos

Aplicação web em português do Brasil para uma empresa de organização e decoração de eventos. A **Etapa 1** entrega duas áreas conectadas ao mesmo banco persistente: painel administrativo e portal do cliente. Um incremento posterior antecipa o controle financeiro essencial, solicitado pelo proprietário. O restante do produto segue o plano em [docs/PLANO_IMPLEMENTACAO.md](docs/PLANO_IMPLEMENTACAO.md).

## Arquitetura

- Node.js 24 com servidor HTTP nativo e SQLite (`node:sqlite`), sem dependências de terceiros. O banco usa migrações versionadas, chave estrangeira e WAL.
- Interface responsiva em HTML, CSS e JavaScript. Manifesto e service worker permitem instalação como PWA em navegadores compatíveis. Dados de usuários não são armazenados no cache da PWA. **Não há operação offline nem push nesta etapa.**
- O módulo financeiro armazena valores em centavos inteiros, separa contas a receber e a pagar e só expõe ao portal obrigações explicitamente compartilhadas com clientes do evento. Não processa cobranças bancárias.
- Sessões por cookie HTTP-only, senhas com scrypt, tokens de convite e recuperação com expiração e uso único. Autorização de perfil e de evento acontece no servidor. O DTO do portal é separado do DTO interno.
- Esta configuração usa um único processo e um volume persistente. Para múltiplas instâncias ou maior concorrência, planeje a migração do repositório de dados para PostgreSQL antes da expansão da infraestrutura.

## Requisitos

Node.js 24 ou superior. Não é necessário `npm install`.

## Primeira execução

No PowerShell, dentro do repositório:

```powershell
$env:OWNER_NAME = 'Seu nome'
$env:OWNER_EMAIL = 'voce@empresa.com.br'
$env:OWNER_PASSWORD = 'uma-senha-forte-com-12-ou-mais-caracteres'
npm.cmd run bootstrap:owner
npm.cmd start
```

Abra `http://127.0.0.1:3000`. A senha do exemplo deve ser substituída por um segredo próprio. O comando `bootstrap:owner` só cria o primeiro proprietário; não sobrescreve um proprietário existente.

As variáveis são `DATABASE_PATH` (padrão `data/events.sqlite`), `PORT` (3000), `HOST` (`127.0.0.1`), `APP_BASE_URL` (URL usada nos convites), `COOKIE_SECURE` (`true` em HTTPS), `BRAND_NAME` (nome exibido na interface; o manifesto PWA ainda usa o nome provisório Jardim), `CONTACT_EMAIL`, `CONTACT_PHONE` (contatos exibidos no portal) e `DEFAULT_TIMEZONE` (padrão `America/Sao_Paulo`). Consulte [.env.example](.env.example). As variáveis devem ser configuradas no ambiente do processo ou no serviço de hospedagem; o projeto não lê `.env` automaticamente.

## Fluxo da Etapa 1

1. Entre como proprietário, cadastre um ou mais clientes em **Clientes**. É possível buscar e editar seus contatos.
2. Crie um evento com data, fuso, locais separados e clientes vinculados. O painel e o calendário passam a mostrar o evento.
3. Abra o evento, gere o link individual de convite e compartilhe manualmente com cada cliente.
4. O cliente aceita o convite, cria sua senha e acessa somente o(s) evento(s) ao(s) qual(is) foi vinculado. O portal apresenta data, contagem regressiva, locais e mapas.
5. Em **Equipe e acessos**, crie um membro e escolha permissões por módulo. Compartilhe o link de ativação manualmente.

Convites não são enviados automaticamente. Se um usuário esquecer a senha, o proprietário pode gerar um link de recuperação no painel de acessos; não há integração de e-mail configurada. A recuperação invalida sessões anteriores.

## Financeiro antecipado

No administrativo, abra **Financeiro** pelo menu lateral no computador ou pela barra de navegação no celular. Registre contas a receber ou a pagar, relacione-as a um evento quando aplicável e acompanhe parcelas, vencimentos e pagamentos parciais. Abra um lançamento para registrar valor recebido/pago, adicionar ou ajustar parcelas, ou estornar um registro com motivo. O resumo mostra receita e custo previstos por vencimento; o caixa realizado considera a data do pagamento. A listagem oferece filtros por evento, situação e período e exportação CSV. O proprietário tem acesso completo; integrantes da equipe precisam da permissão do módulo financeiro e de vínculo com o evento para registros de um evento. A visão consolidada usa apenas dados que essa pessoa pode consultar. A receita prevista soma contas cadastradas manualmente e ainda não é gerada a partir de contrato assinado.

Uma conta a receber de evento pode ser marcada para compartilhamento com todos os clientes vinculados ou apenas com um cliente escolhido. Nesse caso, o portal mostra somente o valor informado pela equipe, as parcelas, os vencimentos e os pagamentos reconhecidos dessa conta. Custos, contas a pagar, anotações internas e informações de outros eventos permanecem fora da resposta do portal. O compartilhamento é uma decisão explícita de quem cadastra a conta.

Os pagamentos são registros manuais de valores já recebidos ou pagos; o sistema não faz cobrança nem transferência. O formulário permite dividir uma conta em parcelas com valores e vencimentos definidos na criação, mas ainda não oferece modelos reutilizáveis por percentual ou marco do evento. A primeira versão financeira também não inclui renegociação formal, upload de comprovantes, conciliação bancária ou integração com provedores de pagamento. As demais capacidades continuam planejadas para a Etapa 4.

## Dados fictícios para demonstração

O script exige um **arquivo de banco diferente do banco real** e senhas fornecidas no ambiente:

```powershell
$env:DEMO_DATABASE_PATH = 'data/demo.sqlite'
$env:DEMO_OWNER_PASSWORD = 'senha-forte-exclusiva-para-demo'
$env:DEMO_CLIENT_PASSWORD = 'outra-senha-forte-exclusiva'
npm.cmd run seed:demo
$env:DATABASE_PATH = $env:DEMO_DATABASE_PATH
npm.cmd start
```

O script cria um casamento fictício para Ana e Lucas, com duas contas de cliente, anotações internas, parcelas, um recebimento e despesas. As contas de exemplo são `proprietario@example.com`, `ana.oliveira@example.com` e `lucas.pereira@example.com`, usando as senhas de demonstração definidas acima. O script se recusa a popular um banco que já tenha usuários ou eventos.

## Validação

```powershell
npm.cmd test
npm.cmd run check
```

Os testes cobrem persistência, limites de acesso dos clientes, ausência de notas internas e custos no portal, permissões de equipe, edição de clientes por escopo, convites, recuperação, migração do banco anterior, cálculos em centavos, pagamentos parciais, estornos e idempotência. O roteiro manual de navegador está em [docs/PLANO_IMPLEMENTACAO.md](docs/PLANO_IMPLEMENTACAO.md).

## Operação e segurança

- Em produção, exponha o servidor atrás de um proxy HTTPS, configure `APP_BASE_URL` com a URL pública HTTPS, `COOKIE_SECURE=true` e mantenha o banco em volume persistente com acesso restrito. O processo Node não deve ser exposto diretamente à internet sem proxy, TLS e medidas de operação adequadas.
- Faça backup periódico do arquivo de banco com o processo parado, ou use uma rotina de backup consistente de SQLite. Guarde cópias criptografadas fora do servidor e teste a restauração em ambiente separado. Para restaurar, pare a aplicação, preserve uma cópia do estado atual, reponha o arquivo de banco e reinicie. Migrações pendentes são aplicadas na inicialização.
- Não versione bancos, credenciais, links de convite ou arquivos com dados pessoais. Revogue convites compartilhados indevidamente e limite o acesso a backups. Configure retenção e exclusão de dados conforme a política da empresa.
- O projeto ainda não oferece upload de arquivos, notificações externas, assinatura eletrônica ou cobrança bancária. Esses fluxos só serão habilitados com armazenamento protegido e provedores reais nas etapas correspondentes.

Veja [docs/REQUISITOS.md](docs/REQUISITOS.md), [docs/MODELO_DADOS.md](docs/MODELO_DADOS.md) e [docs/PWA_E_NOTIFICACOES.md](docs/PWA_E_NOTIFICACOES.md) para escopo, evolução e limitações de notificações por dispositivo.
