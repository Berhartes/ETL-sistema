/**
 * Configurações de Deduplicação por Tipo de Dado Sensível
 */

import { DeduplicationConfig } from './integrity-controller.js';

/**
 * Configuração para deduplicação de deputados
 */
export const DEPUTADO_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  primaryKeys: ['id'], // ID do deputado é único
  secondaryKeys: ['nome', 'siglaPartido', 'siglaUf'], // Campos sempre disponíveis
  sensitiveFields: [
    'nome',
    'siglaPartido',
    'siglaUf',
    'urlFoto'
  ],
  conflictResolution: 'MERGE',
  auditLevel: 'COMPREHENSIVE'
};

/**
 * Configuração para deduplicação de despesas
 * CORREÇÃO CRÍTICA: Dados da API oficial NÃO devem ser deduplicados agressivamente
 */
export const DESPESA_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  primaryKeys: ['id'], // APENAS ID da API - dados oficiais são únicos por definição
  secondaryKeys: [], // REMOVIDO - não usar chaves secundárias para dados oficiais
  sensitiveFields: [
    'valorLiquido',
    'valorDocumento',
    'valorGlosa',
    'valorRestituicao',
    'numeroDocumento',
    'cnpjCpfFornecedor',
    'dataDocumento',
    'deputadoId'
  ],
  conflictResolution: 'KEEP_LAST', // ALTERADO - manter dados mais recentes da API
  auditLevel: 'BASIC' // REDUZIDO - dados oficiais já são validados
};

/**
 * Configuração para deduplicação de fornecedores
 */
export const FORNECEDOR_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  primaryKeys: ['cnpj'], // CNPJ é único
  secondaryKeys: ['nome'], // Nome como verificação adicional
  sensitiveFields: [
    'cnpj',
    'nome',
    'totalGasto',
    'numeroTransacoes',
    'scoreInvestigativo',
    'scoreRisco'
  ],
  conflictResolution: 'MERGE',
  auditLevel: 'COMPREHENSIVE'
};

/**
 * Configuração para deduplicação de dados da API
 * CORREÇÃO: Dados oficiais da API devem ser preservados
 */
export const API_DATA_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  primaryKeys: ['id'], // APENAS ID da API - cada registro é único
  secondaryKeys: [], // REMOVIDO - não aplicar verificação secundária em dados oficiais
  sensitiveFields: [
    'valorLiquido',
    'valorDocumento',
    'cnpjCpfFornecedor',
    'dataDocumento',
    'numeroDocumento'
  ],
  conflictResolution: 'KEEP_LAST', // Dados da API mais recentes são preferidos
  auditLevel: 'BASIC' // REDUZIDO - dados oficiais já são validados pelo governo
};

/**
 * Configuração para deduplicação de rankings
 * CORREÇÃO CRÍTICA: Rankings têm IDs únicos compostos por categoria+período
 */
export const RANKING_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  primaryKeys: ['id', 'periodo', 'categoria'], // Chave composta única para rankings
  secondaryKeys: [], // REMOVIDO - rankings têm estrutura específica
  sensitiveFields: [
    'totalGastos',
    'quantidadeTransacoes',
    'posicao'
  ],
  conflictResolution: 'KEEP_LAST', // Rankings mais recentes são preferidos
  auditLevel: 'BASIC'
};

/**
 * Configuração para deduplicação de transações por fornecedor
 */
export const TRANSACAO_FORNECEDOR_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  primaryKeys: ['cnpjCpfFornecedor', 'deputadoId', 'numeroDocumento'], // Chave composta
  secondaryKeys: ['dataDocumento', 'valorLiquido'], // Verificação adicional
  sensitiveFields: [
    'cnpjCpfFornecedor',
    'valorLiquido',
    'numeroDocumento',
    'dataDocumento',
    'deputadoId'
  ],
  conflictResolution: 'ABORT_ON_CONFLICT', // Transações devem ser únicas
  auditLevel: 'COMPREHENSIVE'
};

/**
 * Configuração para deduplicação de alertas investigativos
 */
export const ALERTA_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  primaryKeys: ['id'], // ID do alerta
  secondaryKeys: ['deputadoId', 'cnpjCpfFornecedor', 'tipo'], // Verificação por contexto
  sensitiveFields: [
    'deputadoId',
    'cnpjCpfFornecedor',
    'valorEnvolvido',
    'gravidade',
    'descricao'
  ],
  conflictResolution: 'MERGE',
  auditLevel: 'DETAILED'
};

/**
 * CONFIGURAÇÃO ESPECIAL PARA DADOS OFICIAIS DA API
 * PRESERVA TODOS OS REGISTROS - SEM DEDUPLICAÇÃO AGRESSIVA
 */
export const API_SAFE_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  primaryKeys: ['id'], // APENAS ID único da API
  secondaryKeys: [], // SEM verificação secundária
  sensitiveFields: [], // SEM campos sensíveis - todos são válidos
  conflictResolution: 'KEEP_LAST', // Manter dados mais recentes
  auditLevel: 'BASIC' // Auditoria mínima
};

/**
 * Mapeamento de configurações por tipo de operação
 */
export const DEDUPLICATION_CONFIGS = {
  DEPUTADOS: DEPUTADO_DEDUPLICATION_CONFIG,
  DESPESAS: API_SAFE_DEDUPLICATION_CONFIG, // ALTERADO - usar configuração segura
  FORNECEDORES: FORNECEDOR_DEDUPLICATION_CONFIG,
  API_DATA: API_SAFE_DEDUPLICATION_CONFIG, // ALTERADO - usar configuração segura
  RANKINGS: RANKING_DEDUPLICATION_CONFIG,
  TRANSACOES_FORNECEDOR: TRANSACAO_FORNECEDOR_DEDUPLICATION_CONFIG,
  ALERTAS: ALERTA_DEDUPLICATION_CONFIG
};

/**
 * Utilitário para obter configuração por tipo
 */
export function getDeduplicationConfig(type: keyof typeof DEDUPLICATION_CONFIGS): DeduplicationConfig {
  return DEDUPLICATION_CONFIGS[type];
}

/**
 * Validador de campos sensíveis por tipo
 */
export const SENSITIVE_FIELD_VALIDATORS = {
  CPF: (value: string): boolean => {
    const cpf = value.replace(/\D/g, '');
    return cpf.length === 11 && !(/^(\d)\1+$/.test(cpf));
  },
  
  CNPJ: (value: string): boolean => {
    const cnpj = value.replace(/\D/g, '');
    return cnpj.length === 14 && !(/^(\d)\1+$/.test(cnpj));
  },
  
  VALOR_MONETARIO: (value: number): boolean => {
    return typeof value === 'number' && value >= 0 && value <= 10000000; // CORRIGIDO - limite aumentado para R$ 10Mi
  },
  
  DATA: (value: string): boolean => {
    const date = new Date(value);
    return !isNaN(date.getTime()) && date.getFullYear() >= 1990 && date.getFullYear() <= 2030; // CORRIGIDO - aceitar dados históricos
  },
  
  NUMERO_DOCUMENTO: (value: string): boolean => {
    return Boolean(value && value.length >= 3 && value.length <= 50);
  }
};

/**
 * Validador universal de campos sensíveis
 */
export function validateSensitiveField(fieldName: string, value: any): boolean {
  if (value === null || value === undefined) return false;
  
  const fieldType = detectFieldType(fieldName);
  const validator = (SENSITIVE_FIELD_VALIDATORS as any)[fieldType];
  
  if (!validator) return true; // Se não há validador específico, assume válido
  
  try {
    return Boolean(validator(String(value)));
  } catch (error) {
    return false;
  }
}

/**
 * Detecta tipo de campo baseado no nome
 */
function detectFieldType(fieldName: string): keyof typeof SENSITIVE_FIELD_VALIDATORS {
  const normalizedName = fieldName.toLowerCase();
  
  if (normalizedName.includes('cpf')) return 'CPF';
  if (normalizedName.includes('cnpj')) return 'CNPJ';
  if (normalizedName.includes('valor') || normalizedName.includes('gasto')) return 'VALOR_MONETARIO';
  if (normalizedName.includes('data')) return 'DATA';
  if (normalizedName.includes('numero') && normalizedName.includes('documento')) return 'NUMERO_DOCUMENTO';
  
  return 'NUMERO_DOCUMENTO'; // Padrão
}