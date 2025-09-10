/**
 * Dashboard de Monitoramento de Qualidade de Dados
 * Sistema avançado para monitorar e reportar qualidade de dados em tempo real
 */

import { AdvancedAnalytics, DataQualityMetrics, SuspiciousPattern } from './advanced-analytics.js';
import { SuspiciousPatternDetector, SuspiciousPatternAlert } from './suspicious-patterns-detector.js';
import { IntegrityController } from './integrity-controller.js';
import { logger } from '../logging/index.js';

export interface DashboardMetrics {
  timestamp: Date;
  operationName: string;
  dataQuality: DataQualityMetrics;
  suspiciousPatterns: SuspiciousPattern[];
  alerts: SuspiciousPatternAlert[];
  integrityScore: number;
  duplicatesRemoved: number;
  totalRecords: number;
  processingTime: number;
  errorRate: number;
  throughput: number; // records per second
}

export interface QualityTrend {
  metric: keyof DataQualityMetrics;
  values: Array<{ timestamp: Date; value: number; operationName: string }>;
  trend: 'IMPROVING' | 'STABLE' | 'DEGRADING';
  changePercentage: number;
}

export interface SystemHealth {
  overallScore: number;
  componentScores: {
    dataQuality: number;
    integrityControl: number;
    patternDetection: number;
    processingSpeed: number;
  };
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  recommendations: string[];
  lastUpdate: Date;
}

export class DataQualityDashboard {
  private analytics: AdvancedAnalytics;
  private patternDetector: SuspiciousPatternDetector;
  private metrics: DashboardMetrics[] = [];
  private maxMetricsHistory: number = 1000;
  private qualityThresholds = {
    excellent: 0.95,
    good: 0.85,
    fair: 0.75,
    poor: 0.65
  };

  constructor(maxHistorySize?: number) {
    this.analytics = new AdvancedAnalytics();
    this.patternDetector = new SuspiciousPatternDetector();
    if (maxHistorySize) {
      this.maxMetricsHistory = maxHistorySize;
    }
  }

  /**
   * Registra métricas de uma operação ETL
   */
  async recordOperation<T>(
    operationName: string,
    data: T[],
    deduplicationResult: any,
    processingTimeMs: number,
    errorCount: number = 0
  ): Promise<DashboardMetrics> {
    const startTime = Date.now();
    
    logger.info(`📊 [Dashboard] Registrando métricas para ${operationName}...`);
    
    try {
      // Calcular métricas de qualidade
      const dataQuality = this.analytics.calculateDataQuality(data, deduplicationResult);
      
      // Detectar padrões suspeitos
      const suspiciousPatterns = await this.analytics.analyzeDataPatterns(
        data,
        deduplicationResult,
        operationName
      );
      
      // Detectar alertas
      const alerts = await this.patternDetector.detectSuspiciousPatterns(
        data,
        deduplicationResult,
        operationName,
        'ETL_OPERATION'
      );
      
      // Calcular métricas de performance
      const totalRecords = data.length;
      const duplicatesRemoved = deduplicationResult.duplicatesFound || 0;
      const errorRate = totalRecords > 0 ? (errorCount / totalRecords) * 100 : 0;
      const throughput = processingTimeMs > 0 ? (totalRecords / processingTimeMs) * 1000 : 0;
      
      // Criar registro de métricas
      const metrics: DashboardMetrics = {
        timestamp: new Date(),
        operationName,
        dataQuality,
        suspiciousPatterns,
        alerts,
        integrityScore: deduplicationResult.integrityScore || 0,
        duplicatesRemoved,
        totalRecords,
        processingTime: processingTimeMs,
        errorRate,
        throughput
      };
      
      // Adicionar ao histórico
      this.metrics.push(metrics);
      
      // Manter tamanho do histórico
      if (this.metrics.length > this.maxMetricsHistory) {
        this.metrics = this.metrics.slice(-this.maxMetricsHistory);
      }
      
      // Log resumo
      this.logOperationSummary(metrics);
      
      logger.info(`📊 [Dashboard] Métricas registradas para ${operationName} em ${Date.now() - startTime}ms`);
      
      return metrics;
      
    } catch (error: any) {
      logger.error(`❌ [Dashboard] Erro ao registrar métricas para ${operationName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gera relatório de qualidade de dados atual
   */
  generateQualityReport(): {
    summary: {
      operationsTracked: number;
      averageQualityScore: number;
      totalAlertsGenerated: number;
      criticalAlertsCount: number;
      lastOperationTime: Date | null;
    };
    qualityTrends: QualityTrend[];
    recentAlerts: SuspiciousPatternAlert[];
    systemHealth: SystemHealth;
    recommendations: string[];
  } {
    const summary = this.generateSummary();
    const qualityTrends = this.calculateQualityTrends();
    const recentAlerts = this.getRecentAlerts();
    const systemHealth = this.assessSystemHealth();
    const recommendations = this.generateRecommendations(systemHealth);
    
    return {
      summary,
      qualityTrends,
      recentAlerts,
      systemHealth,
      recommendations
    };
  }

  /**
   * Gera resumo geral do sistema
   */
  private generateSummary(): {
    operationsTracked: number;
    averageQualityScore: number;
    totalAlertsGenerated: number;
    criticalAlertsCount: number;
    lastOperationTime: Date | null;
  } {
    const operationsTracked = this.metrics.length;
    const averageQualityScore = this.metrics.length > 0 ? 
      this.metrics.reduce((sum, m) => sum + m.dataQuality.overallScore, 0) / this.metrics.length : 0;
    
    const totalAlertsGenerated = this.metrics.reduce((sum, m) => sum + m.alerts.length, 0);
    const criticalAlertsCount = this.metrics.reduce((sum, m) => 
      sum + m.alerts.filter(a => a.priority === 'CRITICAL').length, 0);
    
    const lastOperationTime = this.metrics.length > 0 ? 
      this.metrics[this.metrics.length - 1].timestamp : null;
    
    return {
      operationsTracked,
      averageQualityScore,
      totalAlertsGenerated,
      criticalAlertsCount,
      lastOperationTime
    };
  }

  /**
   * Calcula tendências de qualidade
   */
  private calculateQualityTrends(): QualityTrend[] {
    const trends: QualityTrend[] = [];
    const qualityMetrics: (keyof DataQualityMetrics)[] = [
      'completeness', 'consistency', 'accuracy', 'timeliness', 'validity', 'uniqueness', 'overallScore'
    ];
    
    for (const metric of qualityMetrics) {
      const values = this.metrics.map(m => ({
        timestamp: m.timestamp,
        value: m.dataQuality[metric],
        operationName: m.operationName
      }));
      
      if (values.length < 2) continue;
      
      // Calcular tendência
      const recent = values.slice(-5); // Últimas 5 operações
      const older = values.slice(-10, -5); // 5 operações anteriores
      
      const recentAvg = recent.reduce((sum, v) => sum + v.value, 0) / recent.length;
      const olderAvg = older.length > 0 ? older.reduce((sum, v) => sum + v.value, 0) / older.length : recentAvg;
      
      const changePercentage = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
      
      let trend: 'IMPROVING' | 'STABLE' | 'DEGRADING' = 'STABLE';
      if (changePercentage > 5) trend = 'IMPROVING';
      else if (changePercentage < -5) trend = 'DEGRADING';
      
      trends.push({
        metric,
        values,
        trend,
        changePercentage
      });
    }
    
    return trends;
  }

  /**
   * Obtém alertas recentes
   */
  private getRecentAlerts(hoursBack: number = 24): SuspiciousPatternAlert[] {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    
    return this.metrics
      .filter(m => m.timestamp > cutoffTime)
      .flatMap(m => m.alerts)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 50);
  }

  /**
   * Avalia saúde geral do sistema
   */
  private assessSystemHealth(): SystemHealth {
    if (this.metrics.length === 0) {
      return {
        overallScore: 0,
        componentScores: {
          dataQuality: 0,
          integrityControl: 0,
          patternDetection: 0,
          processingSpeed: 0
        },
        status: 'CRITICAL',
        recommendations: ['Nenhuma operação registrada ainda'],
        lastUpdate: new Date()
      };
    }
    
    const recentMetrics = this.metrics.slice(-10); // Últimas 10 operações
    
    // Calcular scores por componente
    const dataQualityScore = recentMetrics.reduce((sum, m) => sum + m.dataQuality.overallScore, 0) / recentMetrics.length;
    const integrityScore = recentMetrics.reduce((sum, m) => sum + m.integrityScore, 0) / recentMetrics.length;
    
    // Score de detecção de padrões (quanto menos críticos, melhor)
    const totalCriticalAlerts = recentMetrics.reduce((sum, m) => sum + m.alerts.filter(a => a.priority === 'CRITICAL').length, 0);
    const patternDetectionScore = Math.max(0, 100 - (totalCriticalAlerts * 10)) / 100;
    
    // Score de velocidade de processamento
    const avgThroughput = recentMetrics.reduce((sum, m) => sum + m.throughput, 0) / recentMetrics.length;
    const processingSpeedScore = Math.min(1, avgThroughput / 1000); // Normalizar baseado em 1000 records/sec
    
    const componentScores = {
      dataQuality: dataQualityScore,
      integrityControl: integrityScore / 100,
      patternDetection: patternDetectionScore,
      processingSpeed: processingSpeedScore
    };
    
    const overallScore = (componentScores.dataQuality + componentScores.integrityControl + 
                         componentScores.patternDetection + componentScores.processingSpeed) / 4;
    
    // Determinar status
    let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
    if (overallScore < 0.6) status = 'CRITICAL';
    else if (overallScore < 0.8) status = 'WARNING';
    
    return {
      overallScore,
      componentScores,
      status,
      recommendations: [],
      lastUpdate: new Date()
    };
  }

  /**
   * Gera recomendações baseadas na saúde do sistema
   */
  private generateRecommendations(systemHealth: SystemHealth): string[] {
    const recommendations: string[] = [];
    
    if (systemHealth.componentScores.dataQuality < 0.8) {
      recommendations.push('Melhorar validação de dados na entrada do sistema');
    }
    
    if (systemHealth.componentScores.integrityControl < 0.85) {
      recommendations.push('Revisar configurações de deduplicação e integridade');
    }
    
    if (systemHealth.componentScores.patternDetection < 0.7) {
      recommendations.push('Muitos padrões críticos detectados - investigar origem dos dados');
    }
    
    if (systemHealth.componentScores.processingSpeed < 0.5) {
      recommendations.push('Otimizar performance do processamento ETL');
    }
    
    if (systemHealth.status === 'CRITICAL') {
      recommendations.push('CRÍTICO: Revisar imediatamente o sistema de dados');
    }
    
    return recommendations;
  }

  /**
   * Log resumo de operação
   */
  private logOperationSummary(metrics: DashboardMetrics): void {
    const qualityLevel = this.getQualityLevel(metrics.dataQuality.overallScore);
    const criticalAlerts = metrics.alerts.filter(a => a.priority === 'CRITICAL').length;
    
    logger.info(`📊 [Dashboard] ${metrics.operationName}:`);
    logger.info(`  • Qualidade: ${(metrics.dataQuality.overallScore * 100).toFixed(1)}% (${qualityLevel})`);
    logger.info(`  • Integridade: ${metrics.integrityScore.toFixed(1)}%`);
    logger.info(`  • Registros: ${metrics.totalRecords.toLocaleString()}`);
    logger.info(`  • Duplicatas removidas: ${metrics.duplicatesRemoved.toLocaleString()}`);
    logger.info(`  • Alertas críticos: ${criticalAlerts}`);
    logger.info(`  • Throughput: ${metrics.throughput.toFixed(1)} records/sec`);
    
    if (criticalAlerts > 0) {
      logger.warn(`⚠️ [Dashboard] ${criticalAlerts} alertas críticos requerem atenção!`);
    }
  }

  /**
   * Determina nível de qualidade
   */
  private getQualityLevel(score: number): string {
    if (score >= this.qualityThresholds.excellent) return 'EXCELENTE';
    if (score >= this.qualityThresholds.good) return 'BOM';
    if (score >= this.qualityThresholds.fair) return 'REGULAR';
    if (score >= this.qualityThresholds.poor) return 'RUIM';
    return 'CRÍTICO';
  }

  /**
   * Exporta dados para análise externa
   */
  exportData(): {
    metrics: DashboardMetrics[];
    summary: any;
    exportTimestamp: Date;
  } {
    return {
      metrics: this.metrics,
      summary: this.generateSummary(),
      exportTimestamp: new Date()
    };
  }

  /**
   * Gera relatório de performance
   */
  generatePerformanceReport(): {
    averageProcessingTime: number;
    averageThroughput: number;
    errorRateStats: {
      average: number;
      max: number;
      min: number;
    };
    slowestOperations: Array<{ operationName: string; processingTime: number; timestamp: Date }>;
    fastestOperations: Array<{ operationName: string; processingTime: number; timestamp: Date }>;
  } {
    if (this.metrics.length === 0) {
      return {
        averageProcessingTime: 0,
        averageThroughput: 0,
        errorRateStats: { average: 0, max: 0, min: 0 },
        slowestOperations: [],
        fastestOperations: []
      };
    }
    
    const avgProcessingTime = this.metrics.reduce((sum, m) => sum + m.processingTime, 0) / this.metrics.length;
    const avgThroughput = this.metrics.reduce((sum, m) => sum + m.throughput, 0) / this.metrics.length;
    
    const errorRates = this.metrics.map(m => m.errorRate);
    const errorRateStats = {
      average: errorRates.reduce((sum, rate) => sum + rate, 0) / errorRates.length,
      max: Math.max(...errorRates),
      min: Math.min(...errorRates)
    };
    
    const sortedByTime = [...this.metrics].sort((a, b) => b.processingTime - a.processingTime);
    const slowestOperations = sortedByTime.slice(0, 5).map(m => ({
      operationName: m.operationName,
      processingTime: m.processingTime,
      timestamp: m.timestamp
    }));
    
    const fastestOperations = sortedByTime.slice(-5).reverse().map(m => ({
      operationName: m.operationName,
      processingTime: m.processingTime,
      timestamp: m.timestamp
    }));
    
    return {
      averageProcessingTime: avgProcessingTime,
      averageThroughput: avgThroughput,
      errorRateStats,
      slowestOperations,
      fastestOperations
    };
  }

  /**
   * Limpa dados antigos
   */
  cleanup(retentionDays: number = 7): void {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const initialCount = this.metrics.length;
    
    this.metrics = this.metrics.filter(m => m.timestamp > cutoffDate);
    
    const removedCount = initialCount - this.metrics.length;
    if (removedCount > 0) {
      logger.info(`🧹 [Dashboard] Limpeza concluída: ${removedCount} registros antigos removidos`);
    }
  }

  /**
   * Obtém estatísticas rápidas
   */
  getQuickStats(): {
    totalOperations: number;
    averageQuality: number;
    recentCriticalAlerts: number;
    systemStatus: string;
    lastOperationTime: Date | null;
  } {
    const totalOperations = this.metrics.length;
    const averageQuality = this.metrics.length > 0 ? 
      this.metrics.reduce((sum, m) => sum + m.dataQuality.overallScore, 0) / this.metrics.length : 0;
    
    const recentCriticalAlerts = this.metrics
      .filter(m => m.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000))
      .reduce((sum, m) => sum + m.alerts.filter(a => a.priority === 'CRITICAL').length, 0);
    
    const systemHealth = this.assessSystemHealth();
    const lastOperationTime = this.metrics.length > 0 ? 
      this.metrics[this.metrics.length - 1].timestamp : null;
    
    return {
      totalOperations,
      averageQuality,
      recentCriticalAlerts,
      systemStatus: systemHealth.status,
      lastOperationTime
    };
  }
}