# Publicação: Vercel e Render

O site e a PWA ficam na **Vercel**. A API, o SQLite, os arquivos privados e o processamento de mensagens ficam em **um serviço Node no Render**, com disco persistente. A Vercel encaminha `/api/*` ao Render pelo mesmo domínio visto pelo navegador. O backend atual usa operações SQLite síncronas e grava anexos em disco; uma Function isolada da Vercel não preservaria esses dados.

Para uso comercial, a Vercel exige o plano **Pro**: o [plano Hobby](https://vercel.com/docs/plans/hobby) é limitado a projetos pessoais. O [Pro](https://vercel.com/docs/plans/pro-plan) custa US$ 20 por mês. O serviço Render com disco também exige plano pago: a instância inicial custa cerca de US$ 7 por mês e o disco de 1 GB acrescenta cerca de US$ 0,25 por mês, conforme os [preços do Render](https://render.com/pricing). Revise os preços vigentes e autorize a cobrança antes de criar esses recursos. Para reduzir custos, o Render pode servir o aplicativo completo sem Vercel.

## 1. Criar o backend no Render

1. Crie um Blueprint no Render a partir do repositório `Edupimentel007/sistema-eventos`, branch `main`. O arquivo [`render.yaml`](../render.yaml) define um web service Node 24, testes e verificação de sintaxe no build, verificação em `/api/health` e disco em `/var/data`.
2. Revise o plano **pago** `0.5c-512mb`, a região `virginia` e o disco inicial de 1 GB antes de confirmar. O Render não oferece disco persistente no plano gratuito. O disco pode crescer, mas não diminuir; com ele, o serviço fica limitado a uma instância e há uma breve interrupção durante cada implantação.
3. Quando o Render pedir os valores de `OWNER_NAME`, `OWNER_EMAIL` e `OWNER_PASSWORD`, informe a conta real do proprietário e uma senha exclusiva de pelo menos 12 caracteres. Esses valores não estão no repositório. O `initialDeployHook` executa `npm run bootstrap:owner` uma vez, após a primeira implantação bem-sucedida. Confira o resultado nos logs e depois remova `OWNER_PASSWORD` das variáveis do serviço.
4. Aguarde `https://<servico>.onrender.com/api/health` responder `{"status":"ok"}`. Anote o endereço HTTPS do serviço; ele entra na regra de proxy da Vercel. O Render fornece `PORT`; não configure outro valor.

`DATABASE_PATH`, `MEDIA_ROOT` e `PRIVATE_UPLOAD_DIR` apontam para `/var/data`. Mantenha os três no mesmo disco. O script de demonstração não faz parte da implantação e não deve ser executado no banco real.

## 2. Configurar a Vercel

Importe o **mesmo repositório** na Vercel como projeto com framework **Other**. O arquivo [`vercel.json`](../vercel.json) já define `public` como diretório de saída, entrega os arquivos existentes e encaminha `/api/*` ao backend. Configure a variável de ambiente `BACKEND_URL` na Vercel com a origem HTTPS do Render, por exemplo `https://nome-do-servico.onrender.com`, **sem barra final**. Configure-a antes da primeira implantação; o proxy depende dela. Não inclua `/api` no valor.

A rota de proxy mantém login, financeiro e downloads protegidos no mesmo domínio da PWA. A rota final atende as páginas do app, como `/entrar`, `/app` e `/portal`. Confira após a implantação que as respostas da API não sejam armazenadas em cache.

Na configuração do serviço Render, defina `APP_BASE_URL` como a origem HTTPS **definitiva** da Vercel, por exemplo `https://nome-do-app.vercel.app`, sem barra final. O servidor usa essa origem para links de convite e recuperação de acesso e para validar operações de escrita vindas do app. `COOKIE_SECURE=true` já está no Blueprint. Se houver domínio próprio, atualize `APP_BASE_URL` para ele antes de enviar novos convites.

Se optar por usar apenas o Render, defina `APP_BASE_URL` com o endereço HTTPS `onrender.com` do próprio serviço. O servidor Node já entrega a interface e a API pelo mesmo endereço.

## 3. Verificar antes de cadastrar dados reais

1. Abra `https://<app>.vercel.app/api/health` e confirme `{"status":"ok"}`. Verifique também `/api/config` e a marca na página de entrada.
2. Entre como proprietário. Crie um cliente e um evento; atualize a página e confirme que os registros continuam lá. Teste um convite de cliente e o acesso isolado ao portal.
3. Envie uma foto de inspiração e um PDF de contrato. Confirme o download autorizado e que o arquivo continua disponível após reiniciar o serviço Render.
4. Registre uma parcela e uma movimentação de estoque; confira os valores após atualizar a página. Teste a fila de mensagens internas e a autenticação novamente.
5. Confira chamadas `POST`, `PATCH` e `DELETE` pelo domínio da Vercel. Se retornarem 403, revise `APP_BASE_URL` e a validação de origem no servidor antes de liberar o app.

O serviço Render precisa permanecer ativo para processar lembretes agendados. E-mail e WhatsApp só serão enviados depois de configurar os respectivos provedores e autorizações em [MENSAGENS.md](MENSAGENS.md). A instalação da PWA não garante notificações do sistema.

## Backup e operação

Faça cópias consistentes do banco SQLite **e** de `/var/data/uploads` e `/var/data/private_uploads` para um destino externo. Inclua o estado do WAL do SQLite no procedimento e teste a restauração em ambiente separado. Os snapshots automáticos do disco no Render ajudam na recuperação, mas não substituem um backup independente. Monitore o espaço usado no disco e aumente-o antes de esgotar a capacidade.

Referências oficiais: [Blueprints do Render](https://render.com/docs/blueprint-spec), [discos persistentes do Render](https://render.com/docs/disks), [versões do Node no Render](https://render.com/docs/node-version), [rewrites externas da Vercel](https://vercel.com/docs/routing/rewrites) e [configuração de projeto da Vercel](https://vercel.com/docs/project-configuration/vercel-json).
