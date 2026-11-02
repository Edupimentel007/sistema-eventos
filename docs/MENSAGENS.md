# Mensagens automáticas

As automações podem avisar clientes **antes ou depois da data do evento** e **antes ou depois do vencimento de uma parcela compartilhada**. O proprietário define ocasião, antecedência, canal e texto em **Administrativo → Mensagens**. O servidor grava cada agendamento no SQLite, cancela os pendentes quando a data muda ou a regra é pausada e reconcilia a fila a cada minuto enquanto o processo está ativo. Os horários relativos ao vencimento usam o fuso do evento e o horário local escolhido na regra; datas do evento usam o horário próprio do evento.

Esta entrega oferece três canais:

| Canal | Requer serviço externo | Condição de uso |
| --- | --- | --- |
| No portal | Não | Cliente com acesso ativo ao evento. A mensagem aparece em **Notificações**. |
| E-mail | Sim, Resend | Chave, remetente verificado e autorização do cliente no portal. |
| WhatsApp | Sim, Cloud API oficial da Meta | Credenciais, número, modelo aprovado, telefone internacional e autorização do cliente. |

Uma mensagem no estado **enviado** teve aceitação confirmada pela API do provedor (ou foi gravada no portal). **Entrega** só é registrada se chegar confirmação, como o webhook do WhatsApp; o e-mail aceito pelo Resend não é apresentado como entregue. Falhas e tentativas ficam registradas. Falhas com resultado incerto não podem ser reenviadas pela interface até que a operação seja conferida no provedor, para reduzir duplicidade.

## Começar com notificações no portal

1. Mantenha `NOTIFICATIONS_WORKER` ausente ou diferente de `false`, com o processo Node continuamente ativo.
2. Cadastre um evento contratado e vincule um cliente que tenha ativado o portal.
3. Em **Mensagens → Automações**, crie uma regra com canal **No portal**, ocasião **Data do evento**, antecedência e texto. Variáveis disponíveis: `{cliente}`, `{evento}`, `{data_evento}`, `{hora_evento}`, `{local}`, `{parcela_valor}` e `{vencimento}`.
4. Confira **Fila e envios**. Para testar em dados fictícios, use uma data de evento futura e um intervalo que produza um agendamento próximo. O servidor só cria agendamentos futuros aplicáveis; não envia retroativamente avisos cujo horário já passou.
5. Entre no portal do cliente para consultar e marcar a mensagem como lida após o horário agendado.

As regras são globais e somente o proprietário pode criá-las ou editá-las. A equipe com permissão `messages` consulta somente mensagens de eventos aos quais está vinculada. O cliente vê apenas notificações internas dos seus eventos.

## Conectar e-mail pelo Resend

1. Crie uma conta no [Resend](https://resend.com/) e [adicione e verifique um domínio de envio](https://resend.com/docs/dashboard/domains/introduction). A documentação informa que é necessário possuir ao menos um domínio verificado para enviar.
2. Crie uma chave de API com permissão de envio e escolha um endereço desse domínio, por exemplo `avisos@seudominio.com.br`.
3. Configure **somente no ambiente do servidor**, nunca no JavaScript público ou no repositório:

   ```powershell
   $env:RESEND_API_KEY = 'chave-fornecida-pelo-resend'
   $env:RESEND_FROM = 'Sua Empresa <avisos@seudominio.com.br>'
   ```

4. Reinicie a aplicação. Em **Mensagens → Conectar canais**, confirme que o e-mail aparece como configurado.
5. O cliente deve autorizar e-mail em **Portal → Notificações → Preferências de contato**.
6. Crie uma regra de canal **E-mail**, com assunto e mensagem. Os envios usam a [API de e-mail do Resend](https://resend.com/docs/api-reference/emails/send-email) e a chave `Idempotency-Key` por mensagem. O [Resend documenta a proteção de idempotência por 24 horas](https://resend.com/docs/dashboard/emails/idempotency-keys); após erro ambíguo, confira o painel do provedor antes de qualquer intervenção.

O sistema guarda o identificador retornado pelo Resend quando a API aceita o envio. Ainda não recebe webhooks de entrega do Resend; o campo de entrega fica vazio.

## Conectar WhatsApp pela API oficial da Meta

1. Tenha um portfólio empresarial da Meta, uma conta WhatsApp Business e um número registrado na Cloud API. A [coleção oficial da Meta](https://www.postman.com/meta/whatsapp-business-platform/overview) descreve os recursos e pré-requisitos.
2. Crie e obtenha aprovação para um **modelo de mensagem** na Meta. Anote seu nome, idioma e a ordem exata das variáveis do corpo. O texto efetivamente enviado vem do modelo aprovado; o texto digitado no sistema é uma prévia para a equipe. A [referência oficial de envio de modelos](https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive) usa o endpoint `/{Phone-Number-ID}/messages`.
3. Obtenha um token com permissão `whatsapp_business_messaging`, o ID do número e a versão da Graph API usada pela sua conta. Configure no servidor:

   ```powershell
   $env:WHATSAPP_ACCESS_TOKEN = 'token-da-meta'
   $env:WHATSAPP_PHONE_NUMBER_ID = 'id-numerico-do-telefone'
   $env:WHATSAPP_GRAPH_VERSION = 'vXX.YY'
   $env:WHATSAPP_VERIFY_TOKEN = 'segredo-aleatorio-para-verificacao'
   $env:WHATSAPP_APP_SECRET = 'segredo-do-app-meta'
   ```

4. Publique a aplicação em HTTPS e configure na Meta o webhook público `https://seu-dominio/api/webhooks/whatsapp`, usando o mesmo `WHATSAPP_VERIFY_TOKEN`. O servidor valida a assinatura HMAC dos POSTs com `WHATSAPP_APP_SECRET` e usa os status do webhook para registrar entrega. Não aponte o webhook para `127.0.0.1`.
5. Cadastre o telefone do cliente em formato internacional, por exemplo `+5511999999999`. O próprio cliente deve autorizar WhatsApp nas preferências do portal.
6. Em **Mensagens → Automações**, escolha **WhatsApp**, informe o nome/idioma do modelo aprovado e as variáveis na ordem esperada. Confira a fila e teste primeiro com um número autorizado de teste.

Sem credenciais ou modelo aprovado, a aplicação não afirma que mensagens foram enviadas. Uma resposta da API com `wamid` confirma aceitação do envio; entrega ou leitura depende do webhook correspondente. Após falha de rede de resultado incerto, a interface bloqueia o reprocessamento automático para evitar duplicidade.

## Operação e limites

- O processo Node deve permanecer ativo. Se ele parar, os jobs ficam persistidos e serão processados ao reiniciar; mensagens com processamento interrompido ficam em falha para conferência antes de repetir.
- Configure `DEFAULT_TIMEZONE` para o fuso padrão; cada evento pode ter seu próprio fuso. Para vencimentos, o horário da regra é aplicado nesse fuso.
- Em produção, mantenha banco e arquivos em volume persistente e faça backup consistente. Não versione tokens, chaves, números privados ou bancos.
- A automação atual cobre data do evento e parcelas compartilhadas. Reuniões ainda não são cadastradas no produto e, portanto, não geram lembretes nesta entrega. Push web também continua pendente; instalar a PWA não garante notificações fora do portal.
- A autorização de contato é individual, configurada pelo cliente no portal e pode ser retirada. A equipe não pode habilitá-la em nome do cliente nesta interface.
