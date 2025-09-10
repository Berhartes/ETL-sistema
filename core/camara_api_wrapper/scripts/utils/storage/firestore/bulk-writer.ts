/**
 * BulkWriterManager - Gerenciador otimizado para escritas em massa no Firestore
 * 
 * Este módulo fornece uma interface otimizada para operações de escrita em lote
 * no Firestore, substituindo loops de await individuais por operações eficientes.
 */

import { getFirestore, BulkWriter, BulkWriterOptions } from 'firebase-admin/firestore';
import { logger } from '../../logging/index.js';
import { timeoutMonitor, parseNetworkPhases } from './timeout-monitor.js';

export interface BulkWriteOperation {
  type: 'set' | 'update' | 'delete';
  docRef: any;
  data?: any;
  options?: { merge?: boolean };
}

export interface BulkWriteResult {
  sucessos: number;
  falhas: number;
  tempoExecucao: number;
  operacoesPorSegundo: number;
}

export interface BulkWriterConfig extends BulkWriterOptions {
  maxOperationsPerBatch?: number;
  maxConcurrentBatches?: number;
  enableMetrics?: boolean;
  enableRetryLogging?: boolean;
}

/**
 * Gerenciador otimizado para operações de escrita em massa no Firestore
 */
export class BulkWriterManager {
  private bulkWriter: BulkWriter;
  private db: any;
  private config: Required<BulkWriterConfig>;
  private metrics: {
    operacoesEnfileiradas: number;
    operacoesConcluidas: number;
    operacoesFalharam: number;
    tempoInicio?: number;
    tempoFim?: number;
  };

  constructor(config: BulkWriterConfig = {}) {
    this.db = getFirestore();
    this.config = {
      // 🚨 CRITICAL FIX: Configurações defensivas padrão para resolver DEADLINE_EXCEEDED
      throttling: true,
      ...config,
      maxOperationsPerBatch: config.maxOperationsPerBatch ?? 250, // Reduzido de 500 para 250
      maxConcurrentBatches: config.maxConcurrentBatches ?? 8,     // Reduzido de 10 para 8
      enableMetrics: config.enableMetrics ?? true,
      enableRetryLogging: config.enableRetryLogging ?? true       // Ativado por padrão para debug
    };

    this.metrics = {
      operacoesEnfileiradas: 0,
      operacoesConcluidas: 0,
      operacoesFalharam: 0
    };

    this.bulkWriter = this.createBulkWriter();
  }

  private createBulkWriter(): BulkWriter {
    const writer = this.db.bulkWriter(this.config);

    // Configurar callbacks para métricas e logging
    writer.onWriteResult((documentRef: any, result: any) => {
      this.metrics.operacoesConcluidas++;
      if (this.config.enableMetrics && this.metrics.operacoesConcluidas % 100 === 0) {
        logger.debug(`BulkWriter: ${this.metrics.operacoesConcluidas} operações concluídas`);
      }
    });

    writer.onWriteError((error: any) => {
      this.metrics.operacoesFalharam++;
      
      // 🚨 CRITICAL FIX: Tratamento específico para DEADLINE_EXCEEDED
      const isTimeoutError = error.message?.includes('DEADLINE_EXCEEDED') || 
                             error.code === 4 || 
                             error.message?.includes('deadline exceeded');
      
      if (this.config.enableRetryLogging || isTimeoutError) {
        if (isTimeoutError) {
          logger.error(`🚨 DEADLINE_EXCEEDED detectado: ${error.message}`);
          logger.warn(`📊 Operação ${this.metrics.operacoesFalharam}: Timeout após tentativas de retry`);
          
          // ✅ TIMEOUT MONITORING: Registrar evento para análise
          timeoutMonitor.recordTimeout({
            operationType: 'bulkWriter',
            operationCount: this.metrics.operacoesEnfileiradas,
            timeoutDuration: 60000, // Timeout padrão do Firestore
            errorMessage: error.message,
            networkPhases: parseNetworkPhases(error.message)
          });
        } else {
          logger.warn(`BulkWriter erro: ${error.message}`);
        }
      }
      
      // ✅ ENHANCED RETRY: Estratégia robusta para timeouts
      if (isTimeoutError) {
        // Para timeouts, retornar false força uma nova tentativa com backoff exponencial
        logger.info(`🔄 Forçando retry com backoff exponencial para timeout`);
        return false;
      }
      
      return true; // Continua tentativas automáticas para outros erros
    });

    return writer;
  }

  /**
   * Adiciona uma operação de escrita (set) à fila
   */
  set(docRef: any, data: any, options?: { merge?: boolean }): void {
    this.bulkWriter.set(docRef, data, options);
    this.metrics.operacoesEnfileiradas++;
  }

  /**
   * Adiciona uma operação de atualização à fila
   */
  update(docRef: any, data: any): void {
    this.bulkWriter.update(docRef, data);
    this.metrics.operacoesEnfileiradas++;
  }

  /**
   * Adiciona uma operação de deleção à fila
   */
  delete(docRef: any): void {
    this.bulkWriter.delete(docRef);
    this.metrics.operacoesEnfileiradas++;
  }

  /**
   * Método de conveniência para operações em lote
   */
  batchOperations(operations: BulkWriteOperation[]): void {
    for (const op of operations) {
      switch (op.type) {
        case 'set':
          this.set(op.docRef, op.data, op.options);
          break;
        case 'update':
          this.update(op.docRef, op.data);
          break;
        case 'delete':
          this.delete(op.docRef);
          break;
      }
    }
  }

  /**
   * 🚨 ENHANCED COMMIT: Executa operações com recuperação avançada de timeout
   */
  async commit(): Promise<BulkWriteResult> {
    this.metrics.tempoInicio = Date.now();

    try {
      logger.info(`BulkWriter: Iniciando commit de ${this.metrics.operacoesEnfileiradas} operações`);
      
      // ✅ TIMEOUT RECOVERY: Implementa timeout personalizado mais robusto
      const commitPromise = this.bulkWriter.close();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('BulkWriter commit timeout after 120 seconds'));
        }, 120000); // 120s timeout personalizado
      });
      
      await Promise.race([commitPromise, timeoutPromise]);
      
      this.metrics.tempoFim = Date.now();
      const tempoExecucao = this.metrics.tempoFim - this.metrics.tempoInicio;
      const operacoesPorSegundo = this.metrics.operacoesConcluidas / (tempoExecucao / 1000);

      const result: BulkWriteResult = {
        sucessos: this.metrics.operacoesConcluidas,
        falhas: this.metrics.operacoesFalharam,
        tempoExecucao,
        operacoesPorSegundo: Math.round(operacoesPorSegundo)
      };

      if (this.config.enableMetrics) {
        this.logPerformanceMetrics(result);
      }

      // ✅ SUCCESS MONITORING: Registrar operações bem-sucedidas
      timeoutMonitor.recordSuccessfulOperation(this.metrics.operacoesConcluidas);

      // 🚨 CRITICAL ANALYSIS: Log detalhado para investigar problemas
      if (this.metrics.operacoesFalharam > 0) {
        const taxaFalhas = this.metrics.operacoesFalharam / this.metrics.operacoesEnfileiradas * 100;
        logger.warn(`⚠️ BulkWriter: ${this.metrics.operacoesFalharam} falhas (${taxaFalhas.toFixed(1)}%)`);
        
        if (taxaFalhas > 10) {
          logger.error(`🚨 ALTA TAXA DE FALHAS DETECTADA: ${taxaFalhas.toFixed(1)}% - Possível problema de rede/Firestore`);
        }
      }

      return result;
    } catch (error: any) {
      const isTimeoutError = error.message?.includes('timeout') || error.message?.includes('DEADLINE_EXCEEDED');
      
      if (isTimeoutError) {
        logger.error(`🚨 COMMIT TIMEOUT CRÍTICO: ${error.message}`);
        logger.error(`📊 Estatísticas no momento do timeout:`);
        logger.error(`   - Operações enfileiradas: ${this.metrics.operacoesEnfileiradas}`);
        logger.error(`   - Operações concluídas: ${this.metrics.operacoesConcluidas}`);
        logger.error(`   - Operações que falharam: ${this.metrics.operacoesFalharam}`);
        
        // ✅ CRITICAL TIMEOUT MONITORING: Registrar timeout crítico de commit
        timeoutMonitor.recordTimeout({
          operationType: 'bulkWriter',
          operationCount: this.metrics.operacoesEnfileiradas,
          timeoutDuration: 120000, // Nosso timeout personalizado de 120s
          errorMessage: error.message,
          networkPhases: parseNetworkPhases(error.message)
        });
        
        // Gerar relatório imediato se padrão crítico
        if (timeoutMonitor.isCriticalTimeoutPattern()) {
          logger.error('🚨 PADRÃO CRÍTICO DE TIMEOUTS DETECTADO - Gerando relatório');
          timeoutMonitor.generateReport(600000); // Últimos 10 minutos
        }
      } else {
        logger.error('Erro durante commit do BulkWriter:', error);
      }
      
      throw error;
    }
  }

  /**
   * Obtém métricas atuais sem executar commit
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Reseta o BulkWriter para reutilização
   */
  reset(): void {
    this.bulkWriter = this.createBulkWriter();
    this.metrics = {
      operacoesEnfileiradas: 0,
      operacoesConcluidas: 0,
      operacoesFalharam: 0
    };
  }

  private logPerformanceMetrics(result: BulkWriteResult): void {
    const { sucessos, falhas, tempoExecucao, operacoesPorSegundo } = result;
    
    logger.info('📊 BulkWriter Performance Report:');
    logger.info(`   ✅ Sucessos: ${sucessos.toLocaleString()}`);
    logger.info(`   ❌ Falhas: ${falhas.toLocaleString()}`);
    logger.info(`   ⏱️ Tempo: ${(tempoExecucao / 1000).toFixed(2)}s`);
    logger.info(`   🚀 Velocidade: ${operacoesPorSegundo.toLocaleString()} ops/s`);

    // Análise de performance
    if (operacoesPorSegundo < 100) {
      logger.warn('⚠️ Performance baixa detectada. Considere otimizar consultas ou estrutura de dados.');
    } else if (operacoesPorSegundo > 1000) {
      logger.info('🎯 Excelente performance! BulkWriter otimizado funcionando bem.');
    }

    // Taxa de falhas
    const taxaFalhas = falhas / (sucessos + falhas) * 100;
    if (taxaFalhas > 5) {
      logger.warn(`⚠️ Alta taxa de falhas: ${taxaFalhas.toFixed(1)}%. Verifique conectividade ou estrutura de dados.`);
    }
  }
}

/**
 * Factory function para criar BulkWriterManager com configurações otimizadas para ETL
 */
export function createOptimizedBulkWriter(config?: BulkWriterConfig): BulkWriterManager {
  const etlOptimizedConfig: BulkWriterConfig = {
    // 🚨 CRITICAL FIX: Configurações defensivas para resolver DEADLINE_EXCEEDED
    maxOperationsPerBatch: 250,    // Reduzido de 500 para 250 - menos pressão de rede
    maxConcurrentBatches: 8,       // Reduzido de 15 para 8 - evita saturação de conexão
    enableMetrics: true,
    enableRetryLogging: true,      // Ativado para debug de timeouts
    throttling: true,
    // ✅ TIMEOUT OPTIMIZATION: Configurações robustas de retry
    ...config
  };

  return new BulkWriterManager(etlOptimizedConfig);
}

/**
 * Utilitário para migrar de operações sequenciais para BulkWriter
 */
export async function migrateToBulkWriter<T>(
  items: T[],
  itemToOperation: (item: T) => BulkWriteOperation,
  config?: BulkWriterConfig
): Promise<BulkWriteResult> {
  const bulkWriter = createOptimizedBulkWriter(config);
  
  logger.info(`🔄 Migrando ${items.length} operações sequenciais para BulkWriter`);
  
  const operations = items.map(itemToOperation);
  bulkWriter.batchOperations(operations);
  
  return await bulkWriter.commit();
}