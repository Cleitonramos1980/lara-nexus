# Lara + Bradesco BolePix (Boleto Hibrido)

## Escopo implementado no backend Lara

A Lara foi estendida para suportar BolePix sem substituir a arquitetura atual.

### Novas rotas HTTP

- `POST /api/lara/pagamentos/bolepix`
- `POST /api/lara/bradesco/bolepix/token/test`
- `POST /api/lara/bradesco/bolepix/gerar`
- `POST /api/lara/bradesco/bolepix/alterar`
- `POST /api/lara/bradesco/bolepix/consultar`
- `POST /api/lara/bradesco/bolepix/listar`
- `POST /api/lara/bradesco/bolepix/baixar`
- `POST /api/lara/bradesco/bolepix/webhook/cadastrar`
- `POST /api/lara/bradesco/bolepix/webhook/pagamento`

## Configuracoes operacionais adicionadas

### Chaves gerais

- `LARA_BOLEPIX_BRADESCO_ENABLED`
- `LARA_BOLEPIX_BRADESCO_FAILFAST`
- `BRADESCO_BOLEPIX_AMBIENTE`
- `BRADESCO_BOLEPIX_BASE_URL`
- `BRADESCO_BOLEPIX_TOKEN_URL`
- `BRADESCO_BOLEPIX_SCOPE`
- `BRADESCO_BOLEPIX_TIMEOUT_MS`

### Credenciais OAuth

- `BRADESCO_BOLEPIX_CLIENT_ID`
- `BRADESCO_BOLEPIX_CLIENT_SECRET`

### Contrato Bradesco (cobranca)

- `BRADESCO_BOLEPIX_COD_USUARIO`
- `BRADESCO_BOLEPIX_PRODUTO`
- `BRADESCO_BOLEPIX_TIPO_ACESSO`
- `BRADESCO_BOLEPIX_BENEF_CNPJ_RAIZ`
- `BRADESCO_BOLEPIX_BENEF_FILIAL`
- `BRADESCO_BOLEPIX_BENEF_CONTROLE`
- `BRADESCO_BOLEPIX_NEGOCIACAO`

### mTLS

- `BRADESCO_BOLEPIX_MTLS_CERT_PATH`
- `BRADESCO_BOLEPIX_MTLS_KEY_PATH`
- `BRADESCO_BOLEPIX_MTLS_PFX_PATH`
- `BRADESCO_BOLEPIX_MTLS_PASSPHRASE`
- `BRADESCO_BOLEPIX_MTLS_CA_PATH`
- `BRADESCO_BOLEPIX_MTLS_REJECT_UNAUTHORIZED`

## Comportamento funcional

1. Quando `pagamentos/bolepix` e acionado, Lara:
   - identifica cliente e titulos no contexto atual;
   - tenta emissao oficial no Bradesco (se habilitado);
   - em caso de falha:
     - se `LARA_BOLEPIX_BRADESCO_FAILFAST=true`, retorna erro;
     - senao, usa fallback interno (linha + url + copia e cola local).

2. O payload retornado para o canal contem:
   - `linha_digitavel`
   - `url_boleto`
   - `pix_copia_cola`
   - `txid`/`nosso_numero`/QR quando disponiveis.

3. A Lara registra logs tecnicos em `LARA_INTEGRACOES_LOG` e case operacional (`BOLEPIX_ENVIADO`).

## Token e autenticacao Bradesco

- Endpoint de token usado: `/auth/server-mtls/v2/token`
- Metodo: `POST`
- Body: `application/x-www-form-urlencoded`
  - `grant_type=client_credentials`
  - `client_id`
  - `client_secret`
  - `scope` (opcional)
- mTLS obrigatorio quando certificado estiver configurado.

## Idempotencia

- Operacoes Bradesco usam `idempotency_key`.
- Repeticao com mesma chave retorna `status=duplicate`.
- Webhook de pagamento BolePix tambem tem dedupe interno.

## Webhook de pagamento BolePix

A rota `POST /api/lara/bradesco/bolepix/webhook/pagamento` registra evento e rastreabilidade.

Importante:
- no estado atual, a baixa financeira automatica em `PCPREST/PCMOVCR` nao e executada por este webhook;
- a resposta marca `settlement_executed=false` ate a rotina homologada de baixa/conciliacao ser plugada.

## Producao: pre-requisitos

1. Credenciais Bradesco validas (Client ID/Secret).
2. Certificado mTLS correto para o ambiente.
3. Cadeia confiavel configurada.
4. Webhook Bradesco cadastrado com URL publica TLS 1.2+.
5. Validacao ponta a ponta com titulo real antes de ativar baixa automatica.

