/**
 * 🚨 TIMEOUT MONITOR - Sistema de monitoramento avançado para timeouts do Firestore
 * 
 * Monitora e analisa padrões de timeout em operações do Firestore,
 * fornecendo insights para otimização e alerta precoce de problemas.
 */

import { logger } from '../../logging/index.js';

export interface TimeoutEvent {
  timestamp: number;
  operationType: 'bulkWriter' | 'individual' | 'query';
  operationCount: number;
  timeoutDuration: number;
  errorMessage: string;
  networkPhases?: {
    nameResolution?: number;
    metadataFilters?: number;
    lbPick?: number;
    remoteAddr?: string;
  };
}

export interface TimeoutAnalysis {
  totalTimeouts: number;
  averageTimeoutDuration: number;
  mostCommonErrorPattern: string;
  timeoutRate: number;
  networkIssuesDetected: boolean;
  recommendations: string[];
}

/**
 * Monitor avançado para timeouts do Firestore
 */
export class FirestoreTimeoutMonitor {
  private timeoutEvents: TimeoutEvent[] = [];
  private readonly maxEvents = 1000; // Manter últimos 1000 eventos
  private totalOperations = 0;

  /**
   * Registra um evento de timeout
   */
  recordTimeout(event: Omit<TimeoutEvent, 'timestamp'>): void {
    const timeoutEvent: TimeoutEvent = {
      ...event,
      timestamp: Date.now()
    };

    this.timeoutEvents.push(timeoutEvent);
    
    // Manter apenas os últimos eventos
    if (this.timeoutEvents.length > this.maxEvents) {
      this.timeoutEvents = this.timeoutEvents.slice(-this.maxEvents);
    }

    // Log imediato para timeouts críticos
    if (event.operationCount > 100 || event.timeoutDuration > 60000) {
      logger.error(`🚨 TIMEOUT CRÍTICO DETECTADO:`);
      logger.error(`   Tipo: ${event.operationType}`);
      logger.error(`   Operações: ${event.operationCount}`);
      logger.error(`   Duração: ${event.timeoutDuration}ms`);
      logger.error(`   Erro: ${event.errorMessage}`);
      
      if (event.networkPhases) {
        logger.error(`   Fases de Rede:`);
        logger.error(`     - Name Resolution: ${event.networkPhases.nameResolution}ms`);
        logger.error(`     - Metadata Filters: ${event.networkPhases.metadataFilters}ms`);
        logger.error(`     - LB Pick: ${event.networkPhases.lbPick}ms`);
        logger.error(`     - Remote Addr: ${event.networkPhases.remoteAddr}`);
      }
    }
  }

  /**
   * Registra operações bem-sucedidas para calcular taxa de timeout
   */
  recordSuccessfulOperation(operationCount: number = 1): void {
    this.totalOperations += operationCount;
  }

  /**
   * Analisa padrões de timeout e fornece insights
   */
  analyzeTimeouts(timeWindow?: number): TimeoutAnalysis {
    const cutoffTime = timeWindow ? Date.now() - timeWindow : 0;
    const recentTimeouts = this.timeoutEvents.filter(event => event.timestamp > cutoffTime);

    if (recentTimeouts.length === 0) {
      return {
        totalTimeouts: 0,
        averageTimeoutDuration: 0,
        mostCommonErrorPattern: '',
        timeoutRate: 0,
        networkIssuesDetected: false,
        recommendations: ['✅ Nenhum timeout detectado no período analisado']
      };
    }

    // Análise de duração média
    const averageTimeoutDuration = recentTimeouts.reduce((sum, event) => sum + event.timeoutDuration, 0) / recentTimeouts.length;

    // Análise de padrões de erro
    const errorPatterns = recentTimeouts.reduce((acc, event) => {
      const pattern = this.extractErrorPattern(event.errorMessage);
      acc[pattern] = (acc[pattern] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const mostCommonErrorPattern = Object.entries(errorPatterns)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || '';

    // Análise de problemas de rede
    const networkIssues = recentTimeouts.filter(event => 
      event.networkPhases && (
        (event.networkPhases.nameResolution || 0) > 1000 ||
        (event.networkPhases.metadataFilters || 0) > 2000 ||
        (event.networkPhases.lbPick || 0) > 5000
      )
    );

    // Taxa de timeout
    const timeoutOperations = recentTimeouts.reduce((sum, event) => sum + event.operationCount, 0);
    const timeoutRate = timeoutOperations / (this.totalOperations + timeoutOperations) * 100;

    // Recomendações
    const recommendations = this.generateRecommendations(recentTimeouts, averageTimeoutDuration, networkIssues.length > 0);

    return {
      totalTimeouts: recentTimeouts.length,
      averageTimeoutDuration,
      mostCommonErrorPattern,
      timeoutRate,
      networkIssuesDetected: networkIssues.length > 0,
      recommendations
    };
  }

  /**
   * Extrai padrão do erro para análise
   */
  private extractErrorPattern(errorMessage: string): string {
    if (errorMessage.includes('DEADLINE_EXCEEDED')) return 'DEADLINE_EXCEEDED';
    if (errorMessage.includes('UNAVAILABLE')) return 'UNAVAILABLE';
    if (errorMessage.includes('RESOURCE_EXHAUSTED')) return 'RESOURCE_EXHAUSTED';
    if (errorMessage.includes('timeout')) return 'TIMEOUT';
    return 'OTHER';
  }

  /**
   * Gera recomendações baseadas na análise
   */
  private generateRecommendations(timeouts: TimeoutEvent[], avgDuration: number, hasNetworkIssues: boolean): string[] {
    const recommendations: string[] = [];

    if (timeouts.length > 10) {
      recommendations.push('🚨 Alta frequência de timeouts - Considere reduzir tamanho dos batches');
    }

    if (avgDuration > 60000) {
      recommendations.push('⏰ Timeouts muito longos - Implemente timeouts mais curtos com retry');
    }

    if (hasNetworkIssues) {
      recommendations.push('🌐 Problemas de rede detectados - Verifique conectividade e considere endpoint regional');
    }

    const bulkWriterTimeouts = timeouts.filter(t => t.operationType === 'bulkWriter');
    if (bulkWriterTimeouts.length > 0) {
      const avgOperationsPerTimeout = bulkWriterTimeouts.reduce((sum, t) => sum + t.operationCount, 0) / bulkWriterTimeouts.length;
      if (avgOperationsPerTimeout > 100) {
        recommendations.push('📊 Batches muito grandes - Reduzir maxOperationsPerBatch para < 100');
      }
    }

    const highLBPickTimeouts = timeouts.filter(t => 
      t.networkPhases && (t.networkPhases.lbPick || 0) > 3000
    );
    if (highLBPickTimeouts.length > 0) {
      recommendations.push('⚖️ Problemas de Load Balancer - Configurar keep-alive e connection pooling');
    }

    if (recommendations.length === 0) {
      recommendations.push('💡 Continuar monitoramento - Padrões normais detectados');
    }

    return recommendations;
  }

  /**
   * Gera relatório detalhado de timeouts
   */
  generateReport(timeWindow?: number): void {
    const analysis = this.analyzeTimeouts(timeWindow);
    
    logger.info('📊 ===== RELATÓRIO DE TIMEOUT FIRESTORE =====');
    logger.info(`🔢 Total de timeouts: ${analysis.totalTimeouts}`);
    logger.info(`⏱️ Duração média: ${analysis.averageTimeoutDuration.toFixed(0)}ms`);
    logger.info(`📈 Taxa de timeout: ${analysis.timeoutRate.toFixed(2)}%`);
    logger.info(`🔍 Padrão mais comum: ${analysis.mostCommonErrorPattern}`);
    logger.info(`🌐 Problemas de rede: ${analysis.networkIssuesDetected ? 'SIM' : 'NÃO'}`);
    
    logger.info('💡 Recomendações:');
    analysis.recommendations.forEach(rec => logger.info(`   ${rec}`));
    
    logger.info('============================================');
  }

  /**
   * Reseta estatísticas
   */
  reset(): void {
    this.timeoutEvents = [];
    this.totalOperations = 0;
    logger.info('🔄 TimeoutMonitor resetado');
  }

  /**
   * Verifica se há padrão de timeout crítico
   */
  isCriticalTimeoutPattern(): boolean {
    const recentTimeouts = this.timeoutEvents.filter(event => 
      Date.now() - event.timestamp < 300000 // últimos 5 minutos
    );

    return recentTimeouts.length >= 5; // 5 ou mais timeouts em 5 minutos
  }
}

/**
 * Instância global do monitor
 */
export const timeoutMonitor = new FirestoreTimeoutMonitor();

/**
 * Utilitário para extrair informações de rede de mensagens de erro
 */
export function parseNetworkPhases(errorMessage: string): TimeoutEvent['networkPhases'] | undefined {
  try {
    const nameResolutionMatch = errorMessage.match(/name resolution: ([\d.]+)s/);
    const metadataFiltersMatch = errorMessage.match(/metadata filters: ([\d.]+)s/);
    const lbPickMatch = errorMessage.match(/LB pick: ([\d.]+)s/);
    const remoteAddrMatch = errorMessage.match(/remote_addr=\[([^\]]+)\]/);

    if (!nameResolutionMatch && !metadataFiltersMatch && !lbPickMatch) {
      return undefined;
    }

    return {
      nameResolution: nameResolutionMatch ? parseFloat(nameResolutionMatch[1]) * 1000 : undefined,
      metadataFilters: metadataFiltersMatch ? parseFloat(metadataFiltersMatch[1]) * 1000 : undefined,
      lbPick: lbPickMatch ? parseFloat(lbPickMatch[1]) * 1000 : undefined,
      remoteAddr: remoteAddrMatch ? remoteAddrMatch[1] : undefined
    };
  } catch (error) {
    logger.warn('Erro ao parsear fases de rede do erro:', error);
    return undefined;
  }
}