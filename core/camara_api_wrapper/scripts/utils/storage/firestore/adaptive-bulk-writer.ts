/**
 * 🚀 ADAPTIVE BULK WRITER - Sistema inteligente de ajuste automático de batch size
 * 
 * Este módulo implementa um BulkWriter adaptativo que ajusta automaticamente
 * o tamanho dos batches baseado na performance e taxa de sucesso.
 */

import { BulkWriterManager, BulkWriterConfig, createOptimizedBulkWriter, BulkWriteResult } from './bulk-writer.js';
import { timeoutMonitor } from './timeout-monitor.js';
import { logger } from '../../logging/index.js';

export interface AdaptiveConfig extends BulkWriterConfig {
  minBatchSize?: number;
  maxBatchSize?: number;
  targetSuccessRate?: number;
  adaptationSensitivity?: number;
}

export interface PerformanceMetrics {
  successRate: number;
  averageOperationsPerSecond: number;
  timeoutRate: number;
  networkStability: 'excellent' | 'good' | 'poor' | 'critical';
}

/**
 * BulkWriter inteligente que se adapta às condições de rede e performance
 */
export class AdaptiveBulkWriterManager {
  private bulkWriter: BulkWriterManager;
  private config: Required<AdaptiveConfig>;
  private performanceHistory: BulkWriteResult[] = [];
  private currentBatchSize: number;
  private currentConcurrency: number;
  private adaptationCounter = 0;
  
  constructor(config: AdaptiveConfig = {}) {
    this.config = {
      // Configurações padrão adaptativas
      minBatchSize: config.minBatchSize ?? 50,
      maxBatchSize: config.maxBatchSize ?? 300,
      targetSuccessRate: config.targetSuccessRate ?? 95,
      adaptationSensitivity: config.adaptationSensitivity ?? 3,
      maxOperationsPerBatch: config.maxOperationsPerBatch ?? 250,
      maxConcurrentBatches: config.maxConcurrentBatches ?? 8,
      enableMetrics: config.enableMetrics ?? true,
      enableRetryLogging: config.enableRetryLogging ?? true,
      throttling: config.throttling ?? true,
      ...config
    };

    this.currentBatchSize = this.config.maxOperationsPerBatch!;
    this.currentConcurrency = this.config.maxConcurrentBatches!;
    
    this.bulkWriter = this.createAdaptiveBulkWriter();
  }

  private createAdaptiveBulkWriter(): BulkWriterManager {
    return createOptimizedBulkWriter({
      ...this.config,
      maxOperationsPerBatch: this.currentBatchSize,
      maxConcurrentBatches: this.currentConcurrency
    });
  }

  /**
   * Adiciona operação de escrita com adaptação inteligente
   */
  set(docRef: any, data: any, options?: { merge?: boolean }): void {
    this.bulkWriter.set(docRef, data, options);
  }

  update(docRef: any, data: any): void {
    this.bulkWriter.update(docRef, data);
  }

  delete(docRef: any): void {
    this.bulkWriter.delete(docRef);
  }

  /**
   * Commit com adaptação automática baseada em performance
   */
  async commit(): Promise<BulkWriteResult> {
    const startTime = Date.now();
    let result: BulkWriteResult;

    try {
      logger.info(`🧠 Adaptive BulkWriter: Iniciando commit (batch: ${this.currentBatchSize}, concurrency: ${this.currentConcurrency})`);
      
      result = await this.bulkWriter.commit();
      
      // Registrar performance para análise
      this.performanceHistory.push(result);
      
      // Manter apenas últimos 10 resultados
      if (this.performanceHistory.length > 10) {
        this.performanceHistory = this.performanceHistory.slice(-10);
      }

      // Adaptar configurações baseado na performance
      await this.adaptConfigurationsBasedOnPerformance(result);
      
      return result;
      
    } catch (error: any) {
      const errorResult: BulkWriteResult = {
        sucessos: 0,
        falhas: this.bulkWriter.getMetrics().operacoesEnfileiradas,
        tempoExecucao: Date.now() - startTime,
        operacoesPorSegundo: 0
      };
      
      this.performanceHistory.push(errorResult);
      
      // Adaptação agressiva em caso de erro
      await this.handleErrorAdaptation(error);
      
      throw error;
    } finally {
      // Reset do BulkWriter para próxima operação
      this.bulkWriter.reset();
    }
  }

  /**
   * Adapta configurações baseado na performance histórica
   */
  private async adaptConfigurationsBasedOnPerformance(result: BulkWriteResult): Promise<void> {
    if (this.performanceHistory.length < 2) {
      logger.debug('🧠 Adaptive: Histórico insuficiente para adaptação');
      return;
    }

    const metrics = this.calculatePerformanceMetrics();
    const adaptation = this.calculateOptimalConfiguration(metrics);
    
    if (adaptation.shouldAdapt) {
      this.currentBatchSize = adaptation.newBatchSize;
      this.currentConcurrency = adaptation.newConcurrency;
      
      logger.info(`🧠 ADAPTAÇÃO AUTOMÁTICA:`);
      logger.info(`   📊 Success Rate: ${metrics.successRate.toFixed(1)}%`);
      logger.info(`   🚀 Performance: ${metrics.averageOperationsPerSecond.toFixed(0)} ops/s`);
      logger.info(`   🌐 Network: ${metrics.networkStability}`);
      logger.info(`   ⚙️ Novo Batch Size: ${this.currentBatchSize}`);
      logger.info(`   ⚙️ Nova Concurrency: ${this.currentConcurrency}`);
      
      // Recriar BulkWriter com novas configurações
      this.bulkWriter = this.createAdaptiveBulkWriter();
      
      this.adaptationCounter++;
    } else {
      logger.debug('🧠 Adaptive: Configurações mantidas (performance adequada)');
    }
  }

  /**
   * Calcula métricas de performance baseado no histórico
   */
  private calculatePerformanceMetrics(): PerformanceMetrics {
    const recentResults = this.performanceHistory.slice(-5); // Últimos 5 commits
    
    const totalOperations = recentResults.reduce((sum, r) => sum + r.sucessos + r.falhas, 0);
    const totalSuccesses = recentResults.reduce((sum, r) => sum + r.sucessos, 0);
    const successRate = totalOperations > 0 ? (totalSuccesses / totalOperations) * 100 : 0;
    
    const averageOperationsPerSecond = recentResults.reduce((sum, r) => sum + r.operacoesPorSegundo, 0) / recentResults.length;
    
    // Analisar timeouts recentes
    const timeoutAnalysis = timeoutMonitor.analyzeTimeouts(300000); // Últimos 5 minutos
    const timeoutRate = timeoutAnalysis.timeoutRate;
    
    // Determinar estabilidade de rede
    let networkStability: PerformanceMetrics['networkStability'];
    if (timeoutRate === 0 && successRate > 98) {
      networkStability = 'excellent';
    } else if (timeoutRate < 2 && successRate > 95) {
      networkStability = 'good';
    } else if (timeoutRate < 10 && successRate > 85) {
      networkStability = 'poor';
    } else {
      networkStability = 'critical';
    }

    return {
      successRate,
      averageOperationsPerSecond,
      timeoutRate,
      networkStability
    };
  }

  /**
   * Calcula configuração ótima baseada nas métricas
   */
  private calculateOptimalConfiguration(metrics: PerformanceMetrics): {
    shouldAdapt: boolean;
    newBatchSize: number;
    newConcurrency: number;
    reason: string;
  } {
    const { successRate, networkStability, averageOperationsPerSecond } = metrics;
    let newBatchSize = this.currentBatchSize;
    let newConcurrency = this.currentConcurrency;
    let shouldAdapt = false;
    let reason = '';

    // Lógica de adaptação baseada na estabilidade da rede
    switch (networkStability) {
      case 'excellent':
        // Rede excelente: pode aumentar batch size moderadamente
        if (successRate > this.config.targetSuccessRate && averageOperationsPerSecond > 200) {
          newBatchSize = Math.min(this.currentBatchSize + 25, this.config.maxBatchSize);
          newConcurrency = Math.min(this.currentConcurrency + 1, 12);
          shouldAdapt = newBatchSize !== this.currentBatchSize || newConcurrency !== this.currentConcurrency;
          reason = 'Rede excelente - incrementando performance';
        }
        break;

      case 'good':
        // Rede boa: manter configurações estáveis
        if (successRate < this.config.targetSuccessRate - 2) {
          newBatchSize = Math.max(this.currentBatchSize - 15, this.config.minBatchSize);
          shouldAdapt = true;
          reason = 'Ajustando para manter taxa de sucesso';
        }
        break;

      case 'poor':
        // Rede ruim: reduzir batch size agressivamente
        newBatchSize = Math.max(this.currentBatchSize - 30, this.config.minBatchSize);
        newConcurrency = Math.max(this.currentConcurrency - 2, 3);
        shouldAdapt = true;
        reason = 'Rede instável - reduzindo carga';
        break;

      case 'critical':
        // Rede crítica: configurações mínimas de segurança
        newBatchSize = this.config.minBatchSize;
        newConcurrency = 3;
        shouldAdapt = true;
        reason = 'Rede crítica - configurações de emergência';
        break;
    }

    // Evitar adaptações muito frequentes
    if (shouldAdapt && this.adaptationCounter > 0 && this.adaptationCounter % this.config.adaptationSensitivity !== 0) {
      shouldAdapt = false;
      reason = 'Aguardando estabilização antes de nova adaptação';
    }

    return {
      shouldAdapt,
      newBatchSize,
      newConcurrency,
      reason
    };
  }

  /**
   * Adaptação especial para erros críticos
   */
  private async handleErrorAdaptation(error: any): Promise<void> {
    const isTimeoutError = error.message?.includes('DEADLINE_EXCEEDED') || error.message?.includes('timeout');
    
    if (isTimeoutError) {
      // Redução agressiva para timeouts
      this.currentBatchSize = Math.max(Math.floor(this.currentBatchSize * 0.6), this.config.minBatchSize);
      this.currentConcurrency = Math.max(Math.floor(this.currentConcurrency * 0.7), 2);
      
      logger.error(`🚨 ADAPTAÇÃO DE EMERGÊNCIA (timeout):`);
      logger.error(`   ⚙️ Batch Size reduzido para: ${this.currentBatchSize}`);
      logger.error(`   ⚙️ Concurrency reduzida para: ${this.currentConcurrency}`);
      
      // Recriar BulkWriter com configurações de emergência
      this.bulkWriter = this.createAdaptiveBulkWriter();
    }
  }

  /**
   * Obtém métricas atuais
   */
  getMetrics() {
    return {
      ...this.bulkWriter.getMetrics(),
      currentBatchSize: this.currentBatchSize,
      currentConcurrency: this.currentConcurrency,
      adaptationCount: this.adaptationCounter,
      performanceHistory: this.performanceHistory.slice(-3) // Últimos 3 resultados
    };
  }

  /**
   * Gera relatório de adaptação
   */
  generateAdaptationReport(): void {
    const metrics = this.calculatePerformanceMetrics();
    
    logger.info('🧠 ===== RELATÓRIO ADAPTIVE BULK WRITER =====');
    logger.info(`📊 Taxa de Sucesso: ${metrics.successRate.toFixed(1)}%`);
    logger.info(`🚀 Performance: ${metrics.averageOperationsPerSecond.toFixed(0)} ops/s`);
    logger.info(`🌐 Estabilidade de Rede: ${metrics.networkStability}`);
    logger.info(`⚙️ Batch Size Atual: ${this.currentBatchSize}`);
    logger.info(`⚙️ Concurrency Atual: ${this.currentConcurrency}`);
    logger.info(`🔄 Total de Adaptações: ${this.adaptationCounter}`);
    logger.info('===========================================');
  }

  /**
   * Reset completo do sistema adaptativo
   */
  reset(): void {
    this.bulkWriter.reset();
    this.performanceHistory = [];
    this.adaptationCounter = 0;
    this.currentBatchSize = this.config.maxOperationsPerBatch!;
    this.currentConcurrency = this.config.maxConcurrentBatches!;
    logger.info('🔄 AdaptiveBulkWriter resetado');
  }
}

/**
 * Factory function para criar AdaptiveBulkWriterManager
 */
export function createAdaptiveBulkWriter(config?: AdaptiveConfig): AdaptiveBulkWriterManager {
  return new AdaptiveBulkWriterManager(config);
}