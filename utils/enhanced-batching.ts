/**
 * Sistema de Batching Otimizado para Firestore
 * 
 * Sistema enterprise-grade para operações em lote no Firestore:
 * - Chunking inteligente baseado em tamanho e quantidade
 * - Retry automático com backoff exponencial
 * - Monitoramento de performance
 * - Rate limiting automático
 * - Deduplicação de dados
 * - Validação de dados antes do salvamento
 */

import { getFirestore, WriteBatch, DocumentReference, Firestore } from 'firebase-admin/firestore';
import { professionalLogger } from './logger.js';
import { retryFirestoreOperation } from './retry.js';
import { recordMetric, startOperation } from './monitoring.js';

// Configurações baseadas no .env
const BATCHING_CONFIG = {
  maxBatchSize: parseInt(process.env.FIRESTORE_BATCH_SIZE || '500'),
  maxDocumentSize: parseInt(process.env.FIRESTORE_MAX_SIZE || '1048576'), // 1MB
  maxConcurrentBatches: parseInt(process.env.MAX_CONCURRENT_CONNECTIONS || '10'),
  batchTimeout: parseInt(process.env.OPERATION_TIMEOUT || '300000'), // 5 minutos
  enableValidation: true,
  enableDeduplication: true
};

// Tipos para operações em lote
export interface BatchOperation {
  type: 'set' | 'update' | 'delete';
  ref: DocumentReference;
  data?: any;
  merge?: boolean;
}

export interface BatchResult {
  success: boolean;
  processedCount: number;
  errors: Array<{
    operation: BatchOperation;
    error: any;
  }>;
  metrics: {
    totalTime: number;
    batchCount: number;
    avgBatchTime: number;
    throughput: number; // operações por segundo
  };
}

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  pattern?: RegExp;
  custom?: (value: any) => boolean | string;
}

// Classe para validação de dados
class DataValidator {
  private rules: Map<string, ValidationRule[]> = new Map();

  /**
   * Registra regras de validação para um tipo de documento
   */
  registerRules(documentType: string, rules: ValidationRule[]): void {
    this.rules.set(documentType, rules);
  }

  /**
   * Valida um documento
   */
  validate(documentType: string, data: any): { valid: boolean; errors: string[] } {
    const rules = this.rules.get(documentType);
    if (!rules) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];

    for (const rule of rules) {
      const value = data[rule.field];

      // Campo obrigatório
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`Campo obrigatório: ${rule.field}`);
        continue;
      }

      // Se campo não existe e não é obrigatório, pular outras validações
      if (value === undefined || value === null) {
        continue;
      }

      // Tipo
      if (rule.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== rule.type) {
          errors.push(`Campo ${rule.field} deve ser do tipo ${rule.type}, recebido ${actualType}`);
          continue;
        }
      }

      // Tamanho máximo para strings
      if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
        errors.push(`Campo ${rule.field} excede tamanho máximo de ${rule.maxLength} caracteres`);
      }

      // Valor mínimo/máximo para números
      if (typeof value === 'number') {
        if (rule.minValue !== undefined && value < rule.minValue) {
          errors.push(`Campo ${rule.field} deve ser maior que ${rule.minValue}`);
        }
        if (rule.maxValue !== undefined && value > rule.maxValue) {
          errors.push(`Campo ${rule.field} deve ser menor que ${rule.maxValue}`);
        }
      }

      // Padrão regex
      if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
        errors.push(`Campo ${rule.field} não atende ao padrão exigido`);
      }

      // Validação customizada
      if (rule.custom) {
        const result = rule.custom(value);
        if (result !== true) {
          errors.push(typeof result === 'string' ? result : `Validação customizada falhou para ${rule.field}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

// Classe principal para batching otimizado
export class EnhancedBatchProcessor {
  private firestore: Firestore;
  private validator = new DataValidator();
  private processedIds = new Set<string>(); // Para deduplicação

  constructor() {
    this.firestore = getFirestore();
    this.setupDefaultValidationRules();
  }

  /**
   * Configura regras de validação padrão
   */
  private setupDefaultValidationRules(): void {
    // Regras para despesas
    this.validator.registerRules('despesas', [
      { field: 'ano', required: true, type: 'number', minValue: 2000, maxValue: new Date().getFullYear() },
      { field: 'mes', required: true, type: 'number', minValue: 1, maxValue: 12 },
      { field: 'valor', required: true, type: 'number', minValue: 0 },
      { field: 'nomeFornecedor', required: true, type: 'string', maxLength: 200 },
      { field: 'nomeDeputado', required: true, type: 'string', maxLength: 100 },
      { 
        field: 'cnpjCpf', 
        type: 'string',
        custom: (value: string) => {
          if (!value) return true; // Campo opcional
          // Validação básica de CNPJ/CPF
          const cleaned = value.replace(/\D/g, '');
          return cleaned.length === 11 || cleaned.length === 14 || 'CNPJ/CPF deve ter 11 ou 14 dígitos';
        }
      }
    ]);

    // Regras para fornecedores
    this.validator.registerRules('fornecedores', [
      { field: 'nome', required: true, type: 'string', maxLength: 200 },
      { field: 'cnpjCpf', required: true, type: 'string' }
    ]);

    // Regras para deputados
    this.validator.registerRules('deputados', [
      { field: 'nome', required: true, type: 'string', maxLength: 100 },
      { field: 'id', required: true, type: 'number', minValue: 1 },
      { field: 'partido', type: 'string', maxLength: 10 },
      { field: 'uf', type: 'string', maxLength: 2 }
    ]);
  }

  /**
   * Registra regras de validação customizadas
   */
  registerValidationRules(documentType: string, rules: ValidationRule[]): void {
    this.validator.registerRules(documentType, rules);
  }

  /**
   * Calcula o tamanho aproximado de um documento em bytes
   */
  private calculateDocumentSize(data: any): number {
    return new Blob([JSON.stringify(data)]).size;
  }

  /**
   * Divide operações em chunks otimizados
   */
  private createOptimalChunks(operations: BatchOperation[]): BatchOperation[][] {
    const chunks: BatchOperation[][] = [];
    let currentChunk: BatchOperation[] = [];
    let currentChunkSize = 0;

    for (const operation of operations) {
      const docSize = operation.data ? this.calculateDocumentSize(operation.data) : 100; // Estimativa para delete

      // Se adicionar esta operação excederia os limites, finalizar chunk atual
      if (
        currentChunk.length >= BATCHING_CONFIG.maxBatchSize ||
        currentChunkSize + docSize > BATCHING_CONFIG.maxDocumentSize
      ) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = [];
          currentChunkSize = 0;
        }
      }

      currentChunk.push(operation);
      currentChunkSize += docSize;
    }

    // Adicionar último chunk se não estiver vazio
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Executa um lote de operações
   */
  private async executeBatch(operations: BatchOperation[], batchIndex: number): Promise<{
    success: boolean;
    processedCount: number;
    errors: Array<{ operation: BatchOperation; error: any }>;
    executionTime: number;
  }> {
    const finishOperation = startOperation(`batch_${batchIndex}`);
    const startTime = Date.now();

    try {
      const batch = this.firestore.batch();
      const errors: Array<{ operation: BatchOperation; error: any }> = [];

      // Preparar operações
      for (const operation of operations) {
        try {
          switch (operation.type) {
            case 'set':
              batch.set(operation.ref, operation.data!, { merge: operation.merge || false });
              break;
            case 'update':
              batch.update(operation.ref, operation.data!);
              break;
            case 'delete':
              batch.delete(operation.ref);
              break;
          }
        } catch (error) {
          errors.push({ operation, error });
        }
      }

      // Executar lote com retry
      await retryFirestoreOperation(
        async () => await batch.commit(),
        `firestore_batch_${batchIndex}`
      );

      const executionTime = Date.now() - startTime;
      finishOperation(true);

      recordMetric('firestore.batch.success', 1);
      recordMetric('firestore.batch.operations', operations.length - errors.length);
      recordMetric('firestore.batch.execution_time', executionTime);

      professionalLogger.info(`Lote ${batchIndex} executado com sucesso`, {
        batchIndex,
        operationsCount: operations.length - errors.length,
        errorsCount: errors.length,
        executionTime: `${executionTime}ms`
      });

      return {
        success: true,
        processedCount: operations.length - errors.length,
        errors,
        executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      finishOperation(false, error);

      recordMetric('firestore.batch.error', 1);

      professionalLogger.error(`Falha no lote ${batchIndex}`, error, {
        batchIndex,
        operationsCount: operations.length,
        executionTime: `${executionTime}ms`
      });

      return {
        success: false,
        processedCount: 0,
        errors: operations.map(operation => ({ operation, error })),
        executionTime
      };
    }
  }

  /**
   * Valida e filtra operações
   */
  private validateAndFilterOperations(
    operations: BatchOperation[],
    documentType?: string
  ): { valid: BatchOperation[]; invalid: Array<{ operation: BatchOperation; errors: string[] }> } {
    const valid: BatchOperation[] = [];
    const invalid: Array<{ operation: BatchOperation; errors: string[] }> = [];

    for (const operation of operations) {
      const errors: string[] = [];

      // Validar referência
      if (!operation.ref) {
        errors.push('Referência do documento é obrigatória');
      }

      // Validar dados para operações que requerem dados
      if ((operation.type === 'set' || operation.type === 'update') && !operation.data) {
        errors.push('Dados são obrigatórios para operações set/update');
      }

      // Validação de schema se documentType especificado
      if (documentType && operation.data && BATCHING_CONFIG.enableValidation) {
        const validation = this.validator.validate(documentType, operation.data);
        if (!validation.valid) {
          errors.push(...validation.errors);
        }
      }

      // Verificar tamanho do documento
      if (operation.data) {
        const size = this.calculateDocumentSize(operation.data);
        if (size > BATCHING_CONFIG.maxDocumentSize) {
          errors.push(`Documento excede tamanho máximo (${size} bytes)`);
        }
      }

      // Deduplicação
      if (BATCHING_CONFIG.enableDeduplication) {
        const operationId = `${operation.ref.path}_${operation.type}`;
        if (this.processedIds.has(operationId)) {
          errors.push('Operação duplicada');
        } else {
          this.processedIds.add(operationId);
        }
      }

      if (errors.length === 0) {
        valid.push(operation);
      } else {
        invalid.push({ operation, errors });
      }
    }

    return { valid, invalid };
  }

  /**
   * Processa operações em lote com otimizações avançadas
   */
  async processBatch(
    operations: BatchOperation[],
    options: {
      documentType?: string;
      maxConcurrency?: number;
      skipValidation?: boolean;
      onProgress?: (processed: number, total: number) => void;
    } = {}
  ): Promise<BatchResult> {
    const startTime = Date.now();
    const finishOperation = startOperation('enhanced_batch_processing');

    professionalLogger.info('Iniciando processamento em lote', {
      totalOperations: operations.length,
      documentType: options.documentType,
      maxConcurrency: options.maxConcurrency || BATCHING_CONFIG.maxConcurrentBatches
    });

    try {
      // Validação e filtragem
      let validOperations = operations;
      let allErrors: Array<{ operation: BatchOperation; error: any }> = [];

      if (!options.skipValidation) {
        const validation = this.validateAndFilterOperations(operations, options.documentType);
        validOperations = validation.valid;
        
        // Converter erros de validação para o formato padrão
        allErrors = validation.invalid.map(({ operation, errors }) => ({
          operation,
          error: new Error(`Validation failed: ${errors.join(', ')}`)
        }));
      }

      if (validOperations.length === 0) {
        professionalLogger.warn('Nenhuma operação válida para processar');
        finishOperation(false);
        return {
          success: false,
          processedCount: 0,
          errors: allErrors,
          metrics: {
            totalTime: Date.now() - startTime,
            batchCount: 0,
            avgBatchTime: 0,
            throughput: 0
          }
        };
      }

      // Criar chunks otimizados
      const chunks = this.createOptimalChunks(validOperations);
      professionalLogger.info(`Operações divididas em ${chunks.length} lotes`);

      // Processar chunks com concorrência limitada
      const maxConcurrency = Math.min(
        options.maxConcurrency || BATCHING_CONFIG.maxConcurrentBatches,
        chunks.length
      );

      let processedCount = 0;
      const batchTimes: number[] = [];

      // Processar chunks em grupos limitados por concorrência
      for (let i = 0; i < chunks.length; i += maxConcurrency) {
        const chunkGroup = chunks.slice(i, i + maxConcurrency);
        
        const batchPromises = chunkGroup.map((chunk, index) =>
          this.executeBatch(chunk, i + index)
        );

        const results = await Promise.all(batchPromises);

        // Processar resultados
        for (const result of results) {
          processedCount += result.processedCount;
          allErrors.push(...result.errors);
          batchTimes.push(result.executionTime);
        }

        // Callback de progresso
        if (options.onProgress) {
          options.onProgress(processedCount, validOperations.length);
        }
      }

      const totalTime = Date.now() - startTime;
      const avgBatchTime = batchTimes.length > 0 ? batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length : 0;
      const throughput = totalTime > 0 ? (processedCount / totalTime) * 1000 : 0; // ops/segundo

      finishOperation(true);

      // Métricas finais
      recordMetric('firestore.batch_processor.total_operations', processedCount);
      recordMetric('firestore.batch_processor.total_time', totalTime);
      recordMetric('firestore.batch_processor.throughput', throughput);

      const result: BatchResult = {
        success: allErrors.length === 0,
        processedCount,
        errors: allErrors,
        metrics: {
          totalTime,
          batchCount: chunks.length,
          avgBatchTime,
          throughput
        }
      };

      professionalLogger.info('Processamento em lote concluído', {
        processedCount,
        errorCount: allErrors.length,
        batchCount: chunks.length,
        totalTime: `${totalTime}ms`,
        throughput: `${throughput.toFixed(2)} ops/s`
      });

      return result;

    } catch (error) {
      finishOperation(false, error);
      professionalLogger.error('Erro crítico no processamento em lote', error);
      
      return {
        success: false,
        processedCount: 0,
        errors: [{ operation: operations[0], error }],
        metrics: {
          totalTime: Date.now() - startTime,
          batchCount: 0,
          avgBatchTime: 0,
          throughput: 0
        }
      };
    }
  }

  /**
   * Limpa cache de deduplicação
   */
  clearDeduplicationCache(): void {
    this.processedIds.clear();
    professionalLogger.debug('Cache de deduplicação limpo');
  }

  /**
   * Obtém estatísticas do processador
   */
  getStats(): {
    deduplicationCacheSize: number;
    config: typeof BATCHING_CONFIG;
  } {
    return {
      deduplicationCacheSize: this.processedIds.size,
      config: BATCHING_CONFIG
    };
  }
}

// Instância global
export const enhancedBatchProcessor = new EnhancedBatchProcessor();

// Funções utilitárias
export function createBatchOperation(
  type: 'set' | 'update' | 'delete',
  ref: DocumentReference,
  data?: any,
  merge?: boolean
): BatchOperation {
  return { type, ref, data, merge };
}

export async function processDespesasBatch(
  despesas: any[],
  collectionName: string = 'despesas'
): Promise<BatchResult> {
  const firestore = getFirestore();
  
  const operations: BatchOperation[] = despesas.map(despesa => {
    const docId = `${despesa.ano}-${despesa.mes}-${despesa.codDocumento}`;
    const ref = firestore.collection(collectionName).doc(docId);
    
    return createBatchOperation('set', ref, despesa, true);
  });

  return enhancedBatchProcessor.processBatch(operations, {
    documentType: 'despesas',
    onProgress: (processed, total) => {
      const percentage = Math.round((processed / total) * 100);
      professionalLogger.info(`Progresso: ${processed}/${total} (${percentage}%)`);
    }
  });
}