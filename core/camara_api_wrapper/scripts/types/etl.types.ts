/**
 * Tipos centralizados para o sistema ETL do Senado Federal
 *
 * Este arquivo define todas as interfaces e tipos utilizados
 * em todo o sistema ETL, garantindo consistência e type safety.
 */

import { ETLConfig } from '../../../../../config/index.js';
import { logger } from '../utils/logging/index.js';

/**
 * Opções comuns para todos os processadores ETL
 */
export interface ETLOptions {
  // Identificação e filtros
  legislatura?: number;
  limite?: number;
  senador?: string;
  deputado?: string; // Adicionado para filtro de deputado específico

  // Opções de extração de dados complementares
  mandatos?: boolean;
  filiacoes?: boolean;
  fotos?: boolean;
  orgaos?: boolean;
  frentes?: boolean;

  // Destino dos dados
  destino: Array<'firestore' | 'emulator' | 'pc'>; // Modificado para aceitar múltiplos destinos

  // Configurações de execução
  verbose?: boolean;
  dryRun?: boolean;
  forceUpdate?: boolean;

  // Filtros adicionais
  dataInicio?: string;
  dataFim?: string;
  partido?: string;
  uf?: string;

  // Concorrência para extração de perfis
  concorrencia?: number;

  // Opções específicas para datas em processadores como o de Órgãos
  dataInicioEventos?: string;
  dataFimEventos?: string;
  dataInicioVotacoes?: string;
  dataFimVotacoes?: string;

  [key: string]: any; // Assinatura de índice para permitir propriedades dinâmicas

  // Opções para otimização de busca por data (--data)
  periodosAnuaisParaVarredura?: Periodo[];
  listaDeputadosPreBuscada?: DeputadoBasico[];

  // Nova opção para processar um intervalo específico
  entre?: string; // Formato "inicio-fim", ex: "10-50"
}

/**
 * Representa um intervalo de datas genérico.
 */
export interface Periodo {
  dataInicio: string;
  dataFim: string;
}

/**
 * Resultado padrão de processamento ETL
 */
export interface ETLResult {
  // Métricas principais
  sucessos: number;
  falhas: number;
  avisos: number;

  // Tempos
  tempoProcessamento: number;
  tempoExtracao?: number;
  tempoTransformacao?: number;
  tempoCarregamento?: number;

  // Identificação
  destino: string;
  legislatura?: number;

  // Detalhes
  detalhes?: any; // Flexibilizado para aceitar diferentes estruturas de detalhes
  erros?: ETLError[];
}

/**
 * Erro estruturado do ETL
 */
export interface ETLError {
  codigo: string;
  mensagem: string;
  contexto?: any;
  timestamp: string;
  stack?: string;
}

/**
 * Contexto de processamento compartilhado
 */
export interface ProcessingContext {
  options: ETLOptions;
  config: ETLConfig;
  logger: typeof logger;
  stats: ProcessingStats;
  cache?: ProcessingCache;
}

/**
 * Estatísticas de processamento
 */
export interface ProcessingStats {
  // Tempos
  inicio: number;
  fim?: number;

  // Contadores
  processados: number;
  erros: number;
  avisos: number;
  ignorados: number;

  // Detalhes por etapa
  extracao: {
    total: number;
    sucesso: number;
    falha: number;
  };
  transformacao: {
    total: number;
    sucesso: number;
    falha: number;
  };
  carregamento: {
    total: number;
    sucesso: number;
    falha: number;
  };
}

/**
 * Cache de processamento para evitar reprocessamento
 */
export interface ProcessingCache {
  has(key: string): boolean;
  get(key: string): any;
  set(key: string, value: any): void;
  clear(): void;
}

/**
 * Metadados de processamento
 */
export interface ProcessingMetadata {
  versao: string;
  timestamp: string;
  fonte: string;
  hash?: string;
}

/**
 * Resultado de validação
 */
export interface ValidationResult {
  valido: boolean;
  erros: string[];
  avisos: string[];
}

/**
 * Opções de exportação de dados
 */
export interface ExportOptions {
  formato: 'json' | 'csv' | 'excel';
  comprimir: boolean;
  incluirMetadados: boolean;
  caminhoPersonalizado?: string;
}

/**
 * Interface para processadores ETL
 */
export interface IETLProcessor<TExtracted, TTransformed> {
  process(): Promise<ETLResult>;
  validate(): Promise<ValidationResult>;
  extract(): Promise<TExtracted>;
  transform(data: TExtracted): Promise<TTransformed>;
  load(data: TTransformed): Promise<any>;
}

/**
 * Tipos específicos para deputados
 */
export interface DeputadoBasico {
  id: string;
  nome: string;
  nomeCivil?: string;
  siglaPartido: string;
  siglaUf: string;
  idLegislatura: number;
  urlFoto?: string;
  cpf?: string;
  dataNascimento?: string;
  sexo?: string;
  escolaridade?: string;
  municipioNascimento?: string;
}

export interface PerfilDeputado extends DeputadoBasico {
  // Dados de identificação e contato
  uri?: string;
  nomeEleitoral?: string;
  cpf?: string;
  sexo?: string;
  urlWebsite?: string;
  redeSocial?: string[];
  dataNascimento?: string;
  dataFalecimento?: string;
  ufNascimento?: string;
  municipioNascimento?: string;
  escolaridade?: string;

  // Dados do último status
  email?: string;
  situacao?: string;
  condicaoEleitoral?: string;
  gabinete?: {
    nome?: string;
    predio?: string;
    sala?: string;
    andar?: string;
    telefone?: string;
    email?: string;
  };

  // Dados políticos
  mandatos?: Array<{
    idLegislatura: number;
    dataInicio?: string;
    dataFim?: string;
    siglaPartido: string;
    siglaUf: string;
    condicaoEleitoral?: string;
    situacao?: string;
  }>;

  filiacoes?: Array<{
    siglaPartido: string;
    nomePartido?: string; // Adicionado para incluir o nome do partido
    dataInicio?: string;
    dataFim?: string;
  }>;

  // Dados complementares
  orgaos?: any[];
  frentes?: any[];
  ocupacoes?: any[];
  mandatosExternos?: any[];
  historico?: any[];
  profissoes?: any[];

  // Metadados
  dataUltimaAtualizacao?: string;
  dataExtracao?: string;
}

/**
 * Tipos específicos para despesas de deputados
 */
export interface DespesaDeputado {
  idDocumento: string;
  idDeputado: string;
  mes: number;
  ano: number;
  tipoDocumento: string;
  dataDocumento: string;
  valorDocumento: number;
  nomeFornecedor: string;
  cnpjCpfFornecedor: string;
  urlDocumento?: string;
  codDocumento?: string; // Alterado para string
  tipoDespesa?: string;
  valorLiquido?: number;
  valorRestituicao?: number;
  numRessarcimento?: string;
  codLote?: number;
  codTipoDocumento?: string; // Alterado para string
  numDocumento?: string; // Adicionado
  valorGlosa?: number; // Adicionado
  parcela?: number; // Adicionado
  dataExtracao?: string;
}

/**
 * Tipos específicos para discursos de deputados
 */
export interface DiscursoDeputado {
  id: string;
  dataHoraInicio: string;
  dataHoraFim: string;
  tipoDiscurso: string;
  sumario: string;
  transcricao: string;
  palavrasChave: string[];
  faseEvento: string;
  tipoEvento: string;
  codEvento: string;
  urlAudio: string;
  urlTexto: string;
  idDeputado: string;
  dataExtracao: string;
  anoDiscurso: number;
  mesDiscurso: number;
}

/**
 * Tipos específicos para eventos de deputados
 */
export interface EventoDeputado {
  id: string; // ID do evento
  uri: string; // URI do evento
  dataHoraInicio: string;
  dataHoraFim?: string | null;
  situacao: string; // Ex: "Convocada", "Realizada", "Cancelada"
  descricao: string; // Descrição/título do evento
  localExterno?: string;
  localCamara?: {
    andar?: string;
    nome?: string; // Nome do local, ex: "Plenário Ulysses Guimarães"
    predio?: string;
    sala?: string;
  };
  orgaos?: Array<{ // Órgãos relacionados ao evento em que o deputado participou
    id: number;
    uri: string;
    sigla: string;
    nome: string;
  }>;
  tipoEvento?: { // Alterado para opcional e mantendo a estrutura original da API
    id?: string; // Pode não vir em todos os contextos
    uri?: string;
    nome?: string;
  };
  // Metadados
  idDeputado: string;
  dataExtracao: string;
  anoEvento: number;
  mesEvento: number;
}

/**
 * Dados extraídos da API para eventos de deputados
 */
export interface EventosExtractedData {
  deputados: DeputadoBasico[];
  eventosPorDeputado: Array<{
    deputadoId: string;
    eventos: any[]; // Eventos brutos da API
    totalEventos: number;
    totalPaginas: number;
    erro?: string;
  }>;
  totalProcessados: number;
}

/**
 * Dados transformados para eventos de deputados
 */
export interface EventosTransformedData {
  eventos: EventoDeputado[]; // Array de eventos transformados
  estatisticas: {
    totalEventos: number;
    deputadosComEventos: number;
    eventosPorAno: Record<number, number>;
    eventosPorTipo: Record<string, number>; // Usar tipoEvento.nome
    eventosPorSituacao: Record<string, number>; // Usar situacao
  };
}

/**
 * Tipos específicos para senadores
 */
export interface SenadorFiltro {
  codigo?: string;
  nome?: string;
  partido?: string;
  uf?: string;
  emExercicio?: boolean;
}

/**
 * Resultado de operação em batch
 */
export interface BatchResult {
  total: number;
  processados: number;
  sucessos: number;
  falhas: number;
  tempoOperacao?: number; // Adicionado para incluir o tempo de operação do batch
  detalhes?: any; // Mantido como opcional e any para flexibilidade
}

/**
 * Detalhes específicos para o resultado do processador de discursos
 */
export interface DiscursosBatchResultDetails {
  discursosSalvos: number;
  deputadosProcessados: number;
  comTranscricao?: number; // Adicionado para contagem de discursos com transcrição
  metadadosSalvos: boolean;
  batchResults: BatchResult[];
}

/**
 * Detalhes específicos para o resultado do processador de eventos de deputados
 */
export interface EventosBatchResultDetails {
  eventosSalvos: number;
  deputadosProcessados: number;
  metadadosSalvos: boolean;
  batchResults: BatchResult[];
}

/**
 * Configuração de retry
 */
export interface RetryConfig {
  maxAttempts: number;
  delay: number;
  backoff: 'linear' | 'exponential';
  shouldRetry?: (error: any, attempt: number) => boolean;
}

/**
 * Status de processamento
 */
export enum ProcessingStatus {
  INICIADO = 'INICIADO',
  EXTRAINDO = 'EXTRAINDO',
  TRANSFORMANDO = 'TRANSFORMANDO',
  CARREGANDO = 'CARREGANDO',
  FINALIZADO = 'FINALIZADO',
  ERRO = 'ERRO',
  CANCELADO = 'CANCELADO'
}

/**
 * Evento de progresso
 */
export interface ProgressEvent {
  status: ProcessingStatus;
  progresso: number; // 0-100
  mensagem: string;
  detalhes?: any;
}

/**
 * Callback de progresso
 */
export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Tipos específicos para Partidos
 */
export interface PartidoBasico {
  id: string;
  sigla: string;
  nome: string;
  uri: string;
  idLegislatura: number;
}

export interface DetalhesPartidoAPI {
  id: string;
  sigla: string;
  nome: string;
  uri: string;
  status?: {
    data?: string;
    idLegislatura?: string;
    lider?: {
      nome?: string;
      siglaPartido?: string;
      uri?: string;
      uf?: string;
      idLegislatura?: number;
      urlFoto?: string;
    };
    situacao?: string;
    totalMembros?: string;
    totalPosse?: string;
  };
  numeroEleitoral?: string | null;
  urlLogo?: string | null;
  urlWebiste?: string | null; // Mantendo o typo 'Webiste' se for assim na API, ou corrigir para 'Website'
  urlFacebook?: string | null;
  // Adicionar outros campos conforme a API real
}

export interface LiderPartidoAPI {
  idLegislatura: number;
  nome: string;
  siglaPartido: string;
  termoInicio: string; // Verificar tipo de dado (data?)
  titulo: string;
  uriDeputado: string;
  urlFoto: string;
  // Adicionar outros campos conforme a API real
}

export interface MembroPartidoAPI {
  id: number; // ID do deputado
  uri: string;
  nome: string;
  siglaPartido: string;
  uriPartido: string;
  siglaUf: string;
  idLegislatura: number;
  urlFoto: string;
  email?: string;
  dataUltimaAtualizacaoStatus?: string; // Verificar tipo de dado (data?)
  // Adicionar outros campos conforme a API real
}

export interface PartidoCompleto extends PartidoBasico {
  detalhes: DetalhesPartidoAPI | null;
  lideres: LiderPartidoAPI[];
  membros: MembroPartidoAPI[];
  dataExtracao: string;
}

export interface PartidoExtractedData {
  partidosBasicos: PartidoBasico[];
  partidosCompletos: PartidoCompleto[];
  totalProcessados: number;
}

export interface PartidoTransformedData {
  partidos: PartidoCompleto[];
  estatisticas: {
    totalPartidos: number;
    totalLideresConsultados: number;
    totalMembrosConsultados: number;
    partidosPorLegislatura: Record<number, number>;
    // Outras estatísticas relevantes
  };
}

/**
 * Tipos específicos para Órgãos da Câmara
 */
export interface OrgaoBasico {
  id: string;
  sigla: string;
  nome: string;
  uri: string;
  // Adicionar outros campos básicos se necessário, como:
  // apelido?: string;
  // codTipoOrgao?: string;
  // tipoOrgao?: string;
  // nomePublicacao?: string;
}

export interface DetalhesOrgaoAPI {
  id: string;
  uri: string;
  sigla: string;
  nome: string;
  apelido?: string;
  codTipoOrgao?: number;
  tipoOrgao?: string;
  nomePublicacao?: string;
  nomeResumido?: string;
  dataInicio?: string; // Verificar formato da data
  dataFim?: string | null; // Verificar formato da data
  // Adicionar outros campos conforme a API de detalhes do órgão
  // Ex: sala, andar, predio, telefone, email, etc.
}

export interface EventoOrgaoAPI {
  id: string; // ID do evento
  uri: string; // URI do evento
  dataHoraInicio: string; // Verificar formato
  dataHoraFim?: string | null; // Verificar formato
  situacao: string;
  descricao: string;
  localExterno?: string;
  localCamara?: {
    andar?: string;
    nome?: string;
    predio?: string;
    sala?: string;
  };
  orgaos: Array<{ // Lista de órgãos relacionados ao evento
    id: number;
    uri: string;
    sigla: string;
    nome: string;
  }>;
  // Adicionar outros campos conforme a API de eventos do órgão
  // Ex: tipoEvento, urlRegistro, etc.
}

export interface MembroOrgaoAPI {
  idDeputado: number; // ID do deputado membro
  uriDeputado: string;
  nomeDeputado: string;
  siglaPartido?: string;
  siglaUf?: string;
  urlFotoDeputado?: string;
  dataInicio: string; // Verificar formato
  dataFim?: string | null; // Verificar formato
  idPapel?: number; // Código do papel/cargo do membro no órgão
  nomePapel?: string; // Descrição do papel/cargo
  // Adicionar outros campos conforme a API de membros do órgão
}

export interface VotacaoOrgaoAPI {
  id: string; // ID da votação
  uri: string; // URI da votação
  dataHoraRegistro: string; // Verificar formato
  siglaOrgao: string;
  uriOrgao: string;
  uriEvento?: string; // Se a votação estiver ligada a um evento
  proposicaoObjeto?: string; // Descrição do que foi votado
  resumo?: string;
  aprovacao?: number; // 0 para não, 1 para sim, ou outro indicador
  // Adicionar outros campos conforme a API de votações do órgão
  // Ex: votosSim, votosNao, votosAbstencao, etc.
}

export interface OrgaoCompleto extends OrgaoBasico {
  detalhes: DetalhesOrgaoAPI | null;
  eventos: EventoOrgaoAPI[];
  membros: MembroOrgaoAPI[];
  votacoes: VotacaoOrgaoAPI[];
  dataExtracao: string;
}

export interface OrgaoExtractedData {
  orgaosBasicos: OrgaoBasico[];
  orgaosCompletos: OrgaoCompleto[];
  totalProcessados: number;
}

export interface OrgaoTransformedData {
  orgaos: OrgaoCompleto[];
  estatisticas: {
    totalOrgaos: number;
    totalEventos: number;
    totalMembros: number;
    totalVotacoes: number;
    // Outras estatísticas relevantes
  };
}

/**
 * Tipos específicos para Legislaturas da Câmara
 */
export interface LegislaturaBasica {
  id: string;
  uri: string;
  dataInicio: string;
  dataFim: string;
}

export interface DetalhesLegislaturaAPI {
  id: string;
  uri: string;
  dataInicio: string;
  dataFim: string;
  // Adicionar outros campos se a API de detalhes da legislatura fornecer mais informações
  // Ex: pautaPrincipal, resumoDosTrabalhos, etc.
}

export interface LiderLegislaturaAPI {
  id: string; // ID do deputado líder
  uri: string; // URI do deputado
  nome: string;
  siglaPartido: string;
  uriPartido: string;
  siglaUf: string;
  idLegislatura: number;
  urlFoto: string;
  // Campos específicos da liderança
  titulo?: string; // Ex: "Líder do Governo"
  dataInicioLideranca?: string; // Verificar formato
  dataFimLideranca?: string | null; // Verificar formato
  // Adicionar outros campos conforme a API de líderes da legislatura
}

export interface MembroMesaLegislaturaAPI {
  id: string; // ID do deputado membro da mesa
  uri: string; // URI do deputado
  nome: string;
  siglaPartido: string;
  uriPartido: string;
  siglaUf: string;
  idLegislatura: number;
  urlFoto: string;
  email?: string | null; // Adicionado com base no XML de exemplo (pode ser nulo/vazio)

  // Campos específicos do cargo na mesa, conforme XML:
  titulo?: string; // Ex: "Presidente", "1º Secretário"
  codTitulo?: string;
  dataInicio?: string; // Data de início do papel na mesa
  dataFim?: string | null; // Data de fim do papel na mesa
  // Adicionar outros campos conforme a API de membros da mesa
}

export interface LegislaturaCompleta extends LegislaturaBasica {
  detalhes: DetalhesLegislaturaAPI | null;
  lideres: LiderLegislaturaAPI[];
  membrosMesa: MembroMesaLegislaturaAPI[];
  dataExtracao: string;
}

export interface LegislaturaExtractedData {
  legislaturasBasicas: LegislaturaBasica[];
  legislaturasCompletas: LegislaturaCompleta[];
  totalProcessados: number;
}

export interface LegislaturaTransformedData {
  legislaturas: LegislaturaCompleta[];
  estatisticas: {
    totalLegislaturas: number;
    totalLideres: number;
    totalMembrosMesa: number;
    // Outras estatísticas relevantes
  };
}
