import type { Timestamp } from 'firebase-admin/firestore';

/**
 * ===================================================================
 * MAPEAMENTO API CÂMARA DOS DEPUTADOS → ESTRUTURA INTERNA FIRESTORE
 * ===================================================================
 * 
 * Este arquivo documenta como os campos retornados pela API da Câmara dos
 * Deputados são mapeados para a estrutura interna do sistema.
 * 
 * ## FONTE: API Câmara dos Deputados
 * URL: https://dadosabertos.camara.leg.br/api/v2/deputados/{id}/despesas
 * 
 * ## FORMATO ORIGINAL (API):
 * ```json
 * {
 *   "ano": 2025,                          // number - ANO DA DESPESA
 *   "mes": 3,                            // number - MÊS DA DESPESA  
 *   "tipoDespesa": "COMBUSTÍVEIS E LUBRIFICANTES.",
 *   "codDocumento": 7883228,
 *   "tipoDocumento": "Nota Fiscal Eletrônica", 
 *   "dataDocumento": "2025-03-17T15:57:36",  // ISO 8601
 *   "numDocumento": "1366652",
 *   "valorDocumento": 100.0,
 *   "urlDocumento": "http://www.camara.leg.br/...",
 *   "nomeFornecedor": "026 - P WAY - CASCOL...",
 *   "cnpjCpfFornecedor": "00306597002655",
 *   "valorLiquido": 100.0,
 *   "valorGlosa": 0.0,
 *   "numRessarcimento": null,
 *   "codLote": 2119085,
 *   "parcela": 0
 * }
 * ```
 * 
 * ## MAPEAMENTO PARA DespesaOptimizada:
 * 
 * | API CAMPO           | TIPO INTERNO     | OBSERVAÇÕES                    |
 * |---------------------|--------------|--------------------------------|
 * | ano                 | ano          | ✅ PRESERVADO - Campo crítico |
 * | mes                 | mes          | ✅ PRESERVADO - Campo crítico |
 * | tipoDespesa         | tipoDespesa  | Normalizado (sem acentos)      |
 * | valorLiquido        | valorLiquido | Convertido para number         |
 * | dataDocumento       | dataDocumento| Convertido para Timestamp      |
 * | nomeFornecedor      | nomeFornecedor| ✅ NOMENCLATURA PADRONIZADA   |
 * | cnpjCpfFornecedor   | cnpjCpfFornecedor| ✅ NOMENCLATURA PADRONIZADA|
 * | urlDocumento        | urlDocumento | Opcional                       |
 * | numDocumento        | numDocumento | ✅ AGORA INCLUÍDO             |
 * | codDocumento        | codDocumento | ✅ AGORA INCLUÍDO             |
 * | valorDocumento      | valorDocumento| ✅ AGORA INCLUÍDO            |
 * | valorGlosa          | valorGlosa   | ✅ AGORA INCLUÍDO             |
 * | codLote             | codLote      | ✅ AGORA INCLUÍDO             |
 * | parcela             | parcela      | ✅ AGORA INCLUÍDO             |
 * 
 * ## CAMPOS DERIVADOS/CALCULADOS:
 * - anoMes: `"${ano}-${mes.padStart(2, '0')}"` (ex: "2025-03")
 * - id: `"${deputadoId}_${ano}_${mes}_${timestamp}_${random}"`  
 * - deputadoId: Injetado durante processamento
 * - deputadoNome: Injetado durante processamento  
 * - partidoDeputado: Injetado durante processamento
 * - ufDeputado: Injetado durante processamento
 * 
 * ## VALIDAÇÕES CRÍTICAS:
 * ⚠️  PROBLEMA RESOLVIDO: "anos/undefined"
 * - Campos 'ano' e 'mes' são PRESERVADOS da API original
 * - Fallback apenas se API não retornar os campos
 * - Validação rigorosa antes de salvar no Firestore
 * 
 * ## ESTRUTURA FIRESTORE RESULTANTE:
 * ```
 * monitorgastos/
 *   ├── despesas/lista/{deputadoId}/
 *   │   └── anos/{ano}/           ← 🎯 ANO PRESERVADO DA API
 *   │       └── dados: { despesas: DespesaOptimizada[] }
 *   └── fornecedores/lista/{cnpj}/
 *       └── anos/{ano}/           ← 🎯 ANO PRESERVADO DA API
 *           └── dados: { transacoes: DespesaOptimizada[] }
 * ```
 * ===================================================================
 */

/**
 * Interface para o documento de um deputado na estrutura otimizada.
 * Coleção: deputados/{deputadoId}
 */
export interface DeputadoOptimizado {
  // Dados básicos
  id: string;
  nome: string;
  nomeCivil?: string;
  siglaPartido: string;
  siglaUf: string;
  urlFoto: string;
  cpf?: string;
  dataNascimento?: string;
  dataFalecimento?: string;
  sexo?: string;
  escolaridade?: string;
  ufNascimento?: string;
  municipioNascimento?: string;
  urlWebsite?: string;
  
  // Status atual
  nomeEleitoral?: string;
  situacao?: string;
  condicaoEleitoral?: string;
  descricaoStatus?: string;
  email?: string;
  
  // Gabinete
  gabinete?: {
    nome?: string;
    predio?: string;
    sala?: string;
    andar?: string;
    telefone?: string;
    email?: string;
  };
  
  // Redes sociais
  redeSocial?: string[];
  
  // Agregações pré-calculadas
  totalGastos: number;
  totalGastos2024: number;
  totalGastos2023: number;
  mediaGastosMensal: number;
  
  // Scores e rankings
  scoreInvestigativo: number;
  posicaoRanking: number;
  posicaoRankingUF: number;
  
  // Conformidade
  numeroAlertas: number;
  indicadorConformidade: 'NORMAL' | 'SUSPEITO' | 'ALTO_RISCO' | 'ORGANIZAÇÃO_CRIMINOSA';
  
  // Estatísticas detalhadas
  numeroTransacoes: number;
  numeroFornecedores: number;
  maiorTransacao: number;
  menorTransacao: number;
  medianaTransacao: number;
  gastosFimMes?: Record<string, number>; // 'ano-mes' -> total gasto nos últimos 5 dias
  
  // Novos campos para análise CEAP
  gastosPorMes?: Record<string, number>;
  padroesSuspeitos?: string[];
  transacoesFragmentacao?: number;
  valoresRedondosPercentual?: number;
  transacoesAcimaLimite?: number;
  
  // OTIMIZAÇÃO: Fornecedores relacionados ao deputado (evita joins complexos)
  fornecedoresRelacionados?: Array<{
    cnpj: string;
    nome: string;
    totalGasto: number;
    numeroTransacoes: number;
    categorias: string[];
    primeiraTransacao: string;
    ultimaTransacao: string;
    maiorTransacao: number;
    menorTransacao: number;
    mediaTransacao: number;
    scoreRisco: number;
    alertas: string[];
  }>;
  
  ultimaAtualizacao: Timestamp;
}

/**
 * Interface para o documento de uma despesa na estrutura otimizada.
 * ✅ PADRONIZADA: Usa nomenclatura oficial da API da Câmara dos Deputados
 * Coleção: despesas/{despesaId}
 */
export interface DespesaOptimizada {
  // ID único da despesa
  id: string;
  
  // Chaves para consultas e filtros
  deputadoId: string;
  deputadoNome: string; // Desnormalizado para evitar joins
  ano: number;
  mes: number;
  anoMes: string; // Formato "YYYY-MM" para facilitar queries
  
  // ✅ DADOS DA DESPESA - NOMENCLATURA PADRONIZADA API CÂMARA
  tipoDespesa: string;
  valorLiquido: number;
  valorDocumento: number; // ✅ NOVO: Valor original do documento
  valorGlosa: number; // ✅ NOVO: Valor de glosa aplicada
  dataDocumento: Timestamp;
  
  // ✅ DADOS DO DOCUMENTO - NOMENCLATURA PADRONIZADA API CÂMARA  
  numDocumento: string; // ✅ NOVO: Número do documento
  codDocumento: number; // ✅ NOVO: Código do documento
  codLote: number; // ✅ NOVO: Código do lote
  parcela: number; // ✅ NOVO: Número da parcela
  
  // ✅ DADOS DO FORNECEDOR - NOMENCLATURA PADRONIZADA API CÂMARA
  nomeFornecedor: string; // ✅ CAMPO OFICIAL DA API CÂMARA
  cnpjCpfFornecedor: string | null; // ✅ CAMPO OFICIAL DA API CÂMARA - CNPJ ou CPF
  
  // ✅ MIGRAÇÃO FASE 4 COMPLETADA - Campos legados removidos
  // Sistema agora usa exclusivamente nomenclatura padronizada da API Câmara
  
  // Metadados para otimização de consultas (campos derivados)
  partidoDeputado: string;
  ufDeputado: string;

  // Campos de análise (campos derivados)
  indicadorSuspeicao: 'NORMAL' | 'SUSPEITO' | 'CRÍTICO';
  alertas: string[];
  
  // URL do documento oficial da Câmara
  urlDocumento?: string;
}

/**
 * INTERFACE REMOVIDA: FornecedorOptimizado
 * 
 * Esta interface foi ELIMINADA para evitar redundância.
 * 
 * MIGRAÇÃO REALIZADA:
 * - Campos investigativos (scoreInvestigativo, categoriaRisco) → 
 *   Movidos para investigative-analytics.module.ts (módulo desativado)
 * - Campos essenciais (cnpj, nome, totalRecebido, etc.) → 
 *   Substituídos por PerfilFornecedorCompleto + funções helper
 * - despesasPorDeputado → 
 *   Substituído por relacionamentoDeputados em PerfilFornecedorCompleto
 * 
 * COMPATIBILIDADE:
 * Use PerfilFornecedorCompleto + fornecedor-utils.ts para todos os casos
 * 
 * REMOVIDO EM: v3.3-ultra-otimizado
 */

/**
 * Interface para rankings pré-calculados
 * Coleção: rankings/{rankingId}
 */
export interface RankingOptimizado {
  id: string;
  tipo: 'deputados' | 'fornecedores';
  subtipo: 'gastos_totais' | 'score_investigativo' | 'total_recebido' | 'todos_anos_geral' | 'ano_geral' | 'categoria_todos_anos' | 'categoria_ano';
  periodo: string;
  categoria?: string; // Para rankings de categoria específica
  
  ranking: Array<{
    posicao: number;
    id: string;
    nome: string;
    valor: number;
    metadados?: Record<string, any>;
  }>;
  
  totalItens: number;
  ultimaAtualizacao: Timestamp;
}

/**
 * Interface para alertas investigativos
 * Coleção: alertas/{alertaId}
 */
export interface AlertaInvestigativo {
  id: string;
  tipo: 'SUPERFATURAMENTO' | 'LIMITE_EXCEDIDO' | 'FORNECEDOR_SUSPEITO' | 'CONCENTRACAO_IRREGULAR' | 'CONCENTRACAO' | 'COMPORTAMENTAL';
  gravidade: 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';
  
  deputadoId: string | null;
  deputadoNome: string | null;
  // ✅ NOMENCLATURA PADRONIZADA API CÂMARA
  cnpjCpfFornecedor?: string; // ✅ CAMPO OFICIAL DA API CÂMARA
  nomeFornecedor?: string; // ✅ CAMPO OFICIAL DA API CÂMARA
  
  // ✅ FASE 4 COMPLETADA - Uso exclusivo de nomenclatura padronizada
  
  valor: number;
  percentualDesvio?: number;
  titulo: string;
  descricao: string;
  
  status: 'ATIVO' | 'INVESTIGANDO' | 'RESOLVIDO';
  dataDeteccao: Timestamp;
  categoria: string;
  metadados?: any;
  
  // Para consultas otimizadas (opcionais para compatibilidade)
  ano?: number;
  anoMes?: string;
}

/**
 * Interface para estatísticas globais
 * Coleção: estatisticas/{periodo}
 */
export interface EstatisticasGlobais {
  id: string;
  periodo: string;
  
  totalDeputados: number;
  totalFornecedores: number;
  totalDespesas: number;
  volumeTotal: number;
  volumeMedio: number;
  transacoesTotais: number;
  
  deputadosSuspeitos: number;
  deputadosCriticos: number;
  fornecedoresSuspeitos: number;
  fornecedoresCriticos: number;
  
  maiorGastoDeputado: number;
  menorGastoDeputado: number;
  mediaGastoDeputado: number;
  
  // 🆕 CAMPOS PARA OTIMIZAÇÃO DE PREMIAÇÕES
  categorias?: string[];
  totalCategorias?: number;
  estatisticasPorAno?: Record<string, any>;
  estatisticasPorCategoria?: Record<string, any>;
  anosDisponiveis?: number[];
  
  // 🆕 CAMPOS ADICIONAIS PARA ANÁLISE ESTATÍSTICA
  distribuicaoGastos?: any;
  metricas?: any;
  resumoPorAno?: Record<string, any>;
  resumoPorCategoria?: Record<string, any>;
  rankingsDisponiveis?: {
    geral: string;
    porAno: string[];
    porCategoria: string[];
    fornecedores: string;
  };
  
  ultimaAtualizacao: Timestamp;
}

/**
 * Interface COMPLETA para o perfil de consumidor de um deputado dentro de um fornecedor específico.
 * Subcoleção: fornecedores/{cnpj}/perfis-consumidor/{deputadoId}
 * 
 * SUBSTITUI COMPLETAMENTE a subcoleção deputados/ - contém TODAS as informações
 */
export interface PerfilConsumidorDeputado {
  // === IDENTIFICAÇÃO COMPLETA DO DEPUTADO ===
  deputadoId: string;
  nomeEleitoral: string;
  nomeCivil: string;
  partido: string;
  estado: string;
  urlFoto?: string;

  // === MÉTRICAS DE RELACIONAMENTO FINANCEIRO ===
  totalGasto: number;
  numeroTransacoes: number;
  valorMedioTransacao: number;
  maiorTransacao: number;
  menorTransacao: number;
  percentualDoFornecedor: number; // % que representa dos gastos totais do fornecedor
  participacaoPercentualFornecedor: number; // Alias para compatibilidade
  posicaoRankingClientes: number; // Ranking entre os deputados clientes

  // === ANÁLISE TEMPORAL COMPLETA ===
  primeiraTransacao: Timestamp;
  ultimaTransacao: Timestamp;
  duracaoRelacaoDias: number;
  frequenciaTransacoesPorMes: number;

  // === ANÁLISE DE CATEGORIAS E PADRÕES ===
  categorias: string[];
  numeroCategorias: number;

  // === DADOS INVESTIGATIVOS (SEM ANÁLISES COMPLEXAS) ===
  padroesSuspeitos: string[]; // Vazio - sem análises
  scoreRisco: number; // 0 - neutro

  // === METADADOS ===
  ultimaAtualizacao: Timestamp;
}

/**
 * Interface para histórico anual de um deputado em um fornecedor específico.
 * Subcoleção: fornecedores/{cnpj}/deputados/{deputadoId}/historico/{ano}
 */
export interface HistoricoAnualDeputado {
  ano: number;
  deputadoId: string;
  totalGastoAno: number;
  transacoesAno: number;
  mesesAtivosAno: number;
  categoriasMaisUsadas: Array<{
    categoria: string;
    valor: number;
    percentual: number;
  }>;
  evolucaoMensal: Record<string, number>; // 'YYYY-MM' -> valor
  alertasAno: string[];
  comparacaoAnterior: {
    crescimentoPercentual: number;
    mudancaComportamento: string[];
  };
  
  ultimaAtualizacao: Timestamp;
}

/**
 * Interface para padrões de consumo detectados de um deputado em um fornecedor.
 * Documento: fornecedores/{cnpj}/deputados/{deputadoId}/padroes/consumo
 */
export interface PadroesConsumoDeputado {
  deputadoId: string;
  
  // === PADRÕES TEMPORAIS ===
  sazonalidade: {
    mesesMaiorGasto: number[];
    mesesMenorGasto: number[];
    variabilidadeMensal: number; // Desvio padrão
  };
  
  // === PADRÕES DE VALORES ===
  valoresFrequentes: Array<{
    valor: number;
    frequencia: number;
    percentual: number;
  }>;
  concentracaoValores: number; // 0-100 (quanto mais concentrado em poucos valores)
  
  // === PADRÕES DE CATEGORIAS ===
  fidelidade: Record<string, number>; // categoria -> % do tempo que usa
  diversificacao: number; // 0-100
  
  // === PADRÕES SUSPEITOS ===
  valoresRedondos: number; // % de transações com valores redondos
  sequenciasTemporais: Array<{
    tipo: 'MENSAL_FIXO' | 'QUINZENAL' | 'DIARIO';
    confianca: number; // 0-100
  }>;
  
  ultimaAtualizacao: Timestamp;
}

/**
 * Interface para alertas específicos de um deputado em um fornecedor.
 * Subcoleção: fornecedores/{cnpj}/deputados/{deputadoId}/alertas/{alertaId}
 */
export interface AlertaDeputadoFornecedor {
  id: string;
  deputadoId: string;
  cnpjCpfFornecedor: string; // ✅ FASE 4: Atualizado para nomenclatura padrão
  
  tipo: 'CONCENTRACAO_EXCESSIVA' | 'MUDANCA_COMPORTAMENTO' | 'VALORES_SUSPEITOS' | 'FREQUENCIA_ANOMALA' | 'CATEGORIA_INCONSISTENTE';
  gravidade: 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';
  
  descricao: string;
  valorEnvolvido: number;
  percentualDesvio: number;
  
  dadosContexto: {
    periodoAnalisado: string;
    comparativo: Record<string, any>;
    evidencias: string[];
  };
  
  status: 'ATIVO' | 'INVESTIGANDO' | 'RESOLVIDO' | 'FALSO_POSITIVO';
  dataDeteccao: Timestamp;
  dataResolucao?: Timestamp;
  
  investigador?: string;
  observacoes?: string;
  
  ultimaAtualizacao: Timestamp;
}
