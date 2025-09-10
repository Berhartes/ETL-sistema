/**
 * UTILITÁRIO DE COMPATIBILIDADE - MIGRAÇÃO DE NOMENCLATURA
 * 
 * Este arquivo gerencia a transição da nomenclatura antiga para a nova
 * durante a FASE 2 da padronização. Será removido na FASE 4.
 */

import { DespesaOptimizada } from '../types/firestore.types.js';

/**
 * Normaliza uma despesa para garantir que tenha ambas nomenclaturas
 * durante a fase de transição.
 */
export function normalizeDespesaCompatibility(despesa: any): DespesaOptimizada {
  // ✅ GARANTIR NOMENCLATURA NOVA (Padrão API Câmara)
  const nomeFornecedor = despesa.nomeFornecedor || despesa.fornecedorNome || '';
  const cnpjCpfFornecedor = despesa.cnpjCpfFornecedor || despesa.fornecedorCnpj || null;
  
  // ✅ CAMPOS OBRIGATÓRIOS COM FALLBACKS
  return {
    ...despesa,
    
    // NOMENCLATURA NOVA (Prioritária)
    nomeFornecedor,
    cnpjCpfFornecedor,
    
    // NOMENCLATURA ANTIGA (Para compatibilidade transitória)
    fornecedorNome: nomeFornecedor,
    fornecedorCnpj: cnpjCpfFornecedor,
    
    // CAMPOS NOVOS COM DEFAULTS
    valorDocumento: despesa.valorDocumento ?? despesa.valorLiquido ?? 0,
    valorGlosa: despesa.valorGlosa ?? 0,
    numDocumento: despesa.numDocumento ?? '',
    codDocumento: despesa.codDocumento ?? 0,
    codLote: despesa.codLote ?? 0,
    parcela: despesa.parcela ?? 0,
  } as DespesaOptimizada;
}

/**
 * Utilitário para acessar nome do fornecedor com fallback automático
 */
export function getFornecedorNome(despesa: any): string {
  return despesa.nomeFornecedor || despesa.fornecedorNome || 'Nome não informado';
}

/**
 * Utilitário para acessar CNPJ/CPF do fornecedor com fallback automático
 */
export function getFornecedorCnpj(despesa: any): string | null {
  return despesa.cnpjCpfFornecedor || despesa.fornecedorCnpj || null;
}

/**
 * Verifica se uma despesa usa a nomenclatura nova
 */
export function isNewNomenclature(despesa: any): boolean {
  return Boolean(despesa.nomeFornecedor && despesa.cnpjCpfFornecedor !== undefined);
}

/**
 * Verifica se uma despesa usa a nomenclatura antiga
 */
export function isOldNomenclature(despesa: any): boolean {
  return Boolean(despesa.fornecedorNome && despesa.fornecedorCnpj !== undefined);
}

/**
 * Estatísticas de migração para monitoramento
 */
export function getMigrationStats(despesas: any[]): {
  total: number;
  newNomenclature: number;
  oldNomenclature: number;
  mixed: number;
  percentageMigrated: number;
} {
  const stats = {
    total: despesas.length,
    newNomenclature: 0,
    oldNomenclature: 0,
    mixed: 0,
    percentageMigrated: 0
  };
  
  for (const despesa of despesas) {
    const hasNew = isNewNomenclature(despesa);
    const hasOld = isOldNomenclature(despesa);
    
    if (hasNew && hasOld) {
      stats.mixed++;
    } else if (hasNew) {
      stats.newNomenclature++;
    } else if (hasOld) {
      stats.oldNomenclature++;
    }
  }
  
  stats.percentageMigrated = stats.total > 0 
    ? ((stats.newNomenclature + stats.mixed) / stats.total) * 100 
    : 0;
    
  return stats;
}

/**
 * Logger para monitoramento da migração
 */
export function logMigrationProgress(stats: ReturnType<typeof getMigrationStats>, context: string): void {
  console.log(`🔄 [MIGRATION] ${context}:`);
  console.log(`   📊 Total: ${stats.total}`);
  console.log(`   ✅ Nova nomenclatura: ${stats.newNomenclature} (${(stats.newNomenclature/stats.total*100).toFixed(1)}%)`);
  console.log(`   ⚠️ Nomenclatura antiga: ${stats.oldNomenclature} (${(stats.oldNomenclature/stats.total*100).toFixed(1)}%)`);
  console.log(`   🔄 Mistas: ${stats.mixed} (${(stats.mixed/stats.total*100).toFixed(1)}%)`);
  console.log(`   📈 Progresso migração: ${stats.percentageMigrated.toFixed(1)}%`);
}

/**
 * Type guard para verificar se um objeto é uma DespesaOptimizada válida
 */
export function isDespesaOptimizada(obj: any): obj is DespesaOptimizada {
  return obj && 
         typeof obj.id === 'string' &&
         typeof obj.deputadoId === 'string' &&
         typeof obj.ano === 'number' &&
         typeof obj.mes === 'number' &&
         (obj.nomeFornecedor || obj.fornecedorNome); // Aceita ambas nomenclaturas
}