-- Esqueleto conceitual PL/SQL para baixa de titulo Lara/WinThor.
-- Nao executar em producao sem revisao de DBA, financeiro e equipe WinThor.
-- Este arquivo nao inventa colunas da PCPREST e nao implementa UPDATE direto.

CREATE OR REPLACE PACKAGE LARA_BAIXA_TITULO_PKG AS
  TYPE t_result IS RECORD (
    success                BOOLEAN,
    payment_confirmed      BOOLEAN,
    title_found            BOOLEAN,
    multiple_titles_found  BOOLEAN,
    title_already_settled  BOOLEAN,
    title_cancelled        BOOLEAN,
    amount_match           BOOLEAN,
    idempotent_replay      BOOLEAN,
    settlement_executed    BOOLEAN,
    codbanco_used          NUMBER,
    process_status         VARCHAR2(60),
    process_code           VARCHAR2(80),
    message                VARCHAR2(4000),
    technical_details      CLOB
  );

  PROCEDURE processar_baixa_confirmada (
    p_event_id              IN  VARCHAR2,
    p_idempotency_key       IN  VARCHAR2,
    p_payment_confirmed     IN  NUMBER,
    p_confirmed_at          IN  TIMESTAMP,
    p_payment_method        IN  VARCHAR2,
    p_amount_paid           IN  NUMBER,
    p_currency              IN  VARCHAR2,
    p_codbanco              IN  NUMBER DEFAULT 1007,
    p_codcli                IN  NUMBER DEFAULT NULL,
    p_title_reference       IN  VARCHAR2 DEFAULT NULL,
    p_codcob_reference      IN  VARCHAR2 DEFAULT NULL,
    p_document_reference    IN  VARCHAR2 DEFAULT NULL,
    p_txid                  IN  VARCHAR2 DEFAULT NULL,
    p_evidence_ref          IN  VARCHAR2 DEFAULT NULL,
    p_raw_payload           IN  CLOB DEFAULT NULL,
    p_result_json           OUT CLOB
  );
END LARA_BAIXA_TITULO_PKG;
/

CREATE OR REPLACE PACKAGE BODY LARA_BAIXA_TITULO_PKG AS

  c_required_bank CONSTANT NUMBER := 1007;

  PROCEDURE set_result (
    p_code        IN VARCHAR2,
    p_status      IN VARCHAR2,
    p_message     IN VARCHAR2,
    p_success     IN NUMBER,
    p_details     IN CLOB,
    p_result_json OUT CLOB
  ) IS
  BEGIN
    p_result_json :=
      '{' ||
      '"success":' || CASE WHEN p_success = 1 THEN 'true' ELSE 'false' END || ',' ||
      '"payment_confirmed":null,' ||
      '"title_found":null,' ||
      '"multiple_titles_found":null,' ||
      '"title_already_settled":null,' ||
      '"title_cancelled":null,' ||
      '"amount_match":null,' ||
      '"idempotent_replay":null,' ||
      '"settlement_executed":null,' ||
      '"codbanco_used":' || TO_CHAR(c_required_bank) || ',' ||
      '"process_status":"' || REPLACE(p_status, '"', '\"') || '",' ||
      '"process_code":"' || REPLACE(p_code, '"', '\"') || '",' ||
      '"message":"' || REPLACE(p_message, '"', '\"') || '",' ||
      '"technical_details":' || NVL(p_details, '{}') ||
      '}';
  END set_result;

  PROCEDURE registrar_idempotencia_pendente (
    p_event_id        IN VARCHAR2,
    p_idempotency_key IN VARCHAR2,
    p_raw_payload     IN CLOB
  ) IS
  BEGIN
    -- Inserir em tabela auxiliar Lara de idempotencia.
    -- Exemplo conceitual: LARA_PAYMENT_EVENT_IDEMPOTENCY.
    -- Deve existir unique key para p_idempotency_key e/ou p_event_id.
    NULL;
  END registrar_idempotencia_pendente;

  PROCEDURE registrar_auditoria (
    p_event_id        IN VARCHAR2,
    p_idempotency_key IN VARCHAR2,
    p_process_code    IN VARCHAR2,
    p_message         IN VARCHAR2,
    p_details         IN CLOB
  ) IS
  BEGIN
    -- Inserir em tabela auxiliar Lara de auditoria.
    -- Exemplo conceitual: LARA_SETTLEMENT_AUDIT_LOG.
    NULL;
  END registrar_auditoria;

  FUNCTION evento_ja_processado (
    p_event_id        IN VARCHAR2,
    p_idempotency_key IN VARCHAR2
  ) RETURN BOOLEAN IS
  BEGIN
    -- Consultar tabela auxiliar Lara de idempotencia.
    RETURN FALSE;
  END evento_ja_processado;

  FUNCTION localizar_titulo_unico (
    p_codcli             IN NUMBER,
    p_title_reference    IN VARCHAR2,
    p_codcob_reference   IN VARCHAR2,
    p_document_reference IN VARCHAR2,
    p_txid               IN VARCHAR2
  ) RETURN NUMBER IS
  BEGIN
    -- Consultar PCPREST usando somente campos reais validados no ambiente.
    -- Retornar:
    --   0  = nao encontrado
    --   1  = encontrado unico
    --   2+ = ambiguo/multiplos
    -- Nao assumir nomes de colunas ainda nao homologados.
    RETURN 0;
  END localizar_titulo_unico;

  PROCEDURE chamar_rotina_oficial_winthor (
    p_codbanco IN NUMBER
  ) IS
  BEGIN
    -- Chamar procedure oficial/homologada do WinThor.
    -- Nao implementar UPDATE direto na PCPREST aqui.
    -- A rotina deve usar obrigatoriamente p_codbanco = 1007.
    NULL;
  END chamar_rotina_oficial_winthor;

  PROCEDURE processar_baixa_confirmada (
    p_event_id              IN  VARCHAR2,
    p_idempotency_key       IN  VARCHAR2,
    p_payment_confirmed     IN  NUMBER,
    p_confirmed_at          IN  TIMESTAMP,
    p_payment_method        IN  VARCHAR2,
    p_amount_paid           IN  NUMBER,
    p_currency              IN  VARCHAR2,
    p_codbanco              IN  NUMBER DEFAULT 1007,
    p_codcli                IN  NUMBER DEFAULT NULL,
    p_title_reference       IN  VARCHAR2 DEFAULT NULL,
    p_codcob_reference      IN  VARCHAR2 DEFAULT NULL,
    p_document_reference    IN  VARCHAR2 DEFAULT NULL,
    p_txid                  IN  VARCHAR2 DEFAULT NULL,
    p_evidence_ref          IN  VARCHAR2 DEFAULT NULL,
    p_raw_payload           IN  CLOB DEFAULT NULL,
    p_result_json           OUT CLOB
  ) IS
    v_match_count NUMBER := 0;
  BEGIN
    IF NVL(p_payment_confirmed, 0) <> 1 THEN
      set_result('ERR_CONFIRMATION_NOT_VALID', 'blocked', 'Confirmacao positiva da Lara ausente.', 0, '{}', p_result_json);
      RETURN;
    END IF;

    IF p_event_id IS NULL OR p_idempotency_key IS NULL OR p_amount_paid IS NULL THEN
      set_result('ERR_MISSING_REQUIRED_DATA', 'blocked', 'Dados obrigatorios ausentes.', 0, '{}', p_result_json);
      RETURN;
    END IF;

    IF NVL(p_codbanco, -1) <> c_required_bank THEN
      set_result('ERR_MISSING_REQUIRED_DATA', 'blocked', 'codbanco deve ser 1007.', 0, '{}', p_result_json);
      RETURN;
    END IF;

    IF evento_ja_processado(p_event_id, p_idempotency_key) THEN
      set_result('OK_ALREADY_PROCESSED', 'idempotent_replay', 'Evento ja processado anteriormente.', 1, '{}', p_result_json);
      RETURN;
    END IF;

    registrar_idempotencia_pendente(p_event_id, p_idempotency_key, p_raw_payload);

    v_match_count := localizar_titulo_unico(
      p_codcli,
      p_title_reference,
      p_codcob_reference,
      p_document_reference,
      p_txid
    );

    IF v_match_count = 0 THEN
      set_result('ERR_TITLE_NOT_FOUND', 'blocked', 'Titulo nao encontrado.', 0, '{}', p_result_json);
      RETURN;
    ELSIF v_match_count > 1 THEN
      set_result('ERR_MULTIPLE_TITLES_FOUND', 'blocked', 'Mais de um titulo candidato encontrado.', 0, '{}', p_result_json);
      RETURN;
    END IF;

    -- Validar titulo elegivel, nao cancelado, nao baixado e valor compativel.
    -- Aplicar lock transacional na rotina homologada, por chave real validada.
    chamar_rotina_oficial_winthor(c_required_bank);

    registrar_auditoria(p_event_id, p_idempotency_key, 'OK_SETTLEMENT_DONE', 'Baixa executada pela rotina homologada.', '{}');
    COMMIT;

    set_result('OK_SETTLEMENT_DONE', 'settled', 'Baixa executada pela rotina homologada.', 1, '{}', p_result_json);
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      set_result('ERR_DB_WRITE_FAILURE', 'error', SQLERRM, 0, '{}', p_result_json);
  END processar_baixa_confirmada;

END LARA_BAIXA_TITULO_PKG;
/
