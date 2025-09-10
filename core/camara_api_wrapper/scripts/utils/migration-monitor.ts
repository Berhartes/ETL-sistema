/**
 * MONITOR DE MIGRAÇÃO - FASE 2
 * 
 * Sistema de monitoramento e logging da migração de nomenclatura
 * para transição do sistema legado para nomenclatura API Câmara
 */

import { getMigrationStats, logMigrationProgress } from './compatibility-layer.js';

export interface MigrationMonitorConfig {
  enableLogging: boolean;
  enableMetrics: boolean;
  logInterval: number; // em ms
  metricsInterval: number; // em ms
  enableAlerts: boolean;
  alertThreshold: number; // percentual mínimo de migração esperado
}

export interface MigrationMetrics {
  timestamp: number;
  context: string;
  totalRecords: number;
  newNomenclature: number;
  oldNomenclature: number;
  mixed: number;
  percentageMigrated: number;
  processingRate: number; // registros por segundo
  errorRate: number;
  memoryUsage?: number;
}

export class MigrationMonitor {
  private config: MigrationMonitorConfig;
  private metrics: MigrationMetrics[] = [];
  private alerts: string[] = [];
  private lastLogTime = 0;
  private lastMetricsTime = 0;
  private processedRecords = 0;
  private errors = 0;
  private startTime = Date.now();

  constructor(config: Partial<MigrationMonitorConfig> = {}) {
    this.config = {
      enableLogging: true,
      enableMetrics: true,
      logInterval: 10000, // 10 segundos
      metricsInterval: 30000, // 30 segundos
      enableAlerts: true,
      alertThreshold: 80, // 80% de migração esperado
      ...config
    };
  }

  /**
   * Monitorar processamento de dados durante a migração
   */
  monitorProcessing(data: any[], context: string): void {
    const now = Date.now();
    
    if (!this.config.enableLogging && !this.config.enableMetrics) {
      return;
    }

    try {
      // Calcular estatísticas de migração
      const stats = getMigrationStats(data);
      this.processedRecords += data.length;

      // Logging periódico
      if (this.config.enableLogging && (now - this.lastLogTime) >= this.config.logInterval) {
        logMigrationProgress(stats, context);
        this.lastLogTime = now;
      }

      // Métricas periódicas
      if (this.config.enableMetrics && (now - this.lastMetricsTime) >= this.config.metricsInterval) {
        this.collectMetrics(stats, context);
        this.lastMetricsTime = now;
      }

      // Alertas de progresso
      if (this.config.enableAlerts) {
        this.checkAndGenerateAlerts(stats, context);
      }

    } catch (error) {
      this.errors++;
      console.error(`🚨 [MigrationMonitor] Erro no monitoramento de ${context}: ${error.message}`);
    }
  }

  /**
   * Coletar métricas detalhadas
   */
  private collectMetrics(stats: ReturnType<typeof getMigrationStats>, context: string): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.startTime) / 1000;
    const processingRate = elapsedSeconds > 0 ? this.processedRecords / elapsedSeconds : 0;
    const errorRate = this.processedRecords > 0 ? (this.errors / this.processedRecords) * 100 : 0;

    const metrics: MigrationMetrics = {
      timestamp: now,
      context,
      totalRecords: stats.total,
      newNomenclature: stats.newNomenclature,
      oldNomenclature: stats.oldNomenclature,
      mixed: stats.mixed,
      percentageMigrated: stats.percentageMigrated,
      processingRate: Math.round(processingRate * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      memoryUsage: this.getMemoryUsage()
    };

    this.metrics.push(metrics);

    // Manter apenas as últimas 100 métricas para evitar uso excessivo de memória
    if (this.metrics.length > 100) {
      this.metrics = this.metrics.slice(-100);
    }

    console.log(`📊 [MigrationMetrics] ${context}:`, {
      'Taxa Migração': `${metrics.percentageMigrated.toFixed(1)}%`,
      'Taxa Processamento': `${metrics.processingRate} reg/s`,
      'Taxa Erro': `${metrics.errorRate.toFixed(2)}%`,
      'Memória': `${metrics.memoryUsage}MB`
    });
  }

  /**
   * Verificar e gerar alertas
   */
  private checkAndGenerateAlerts(stats: ReturnType<typeof getMigrationStats>, context: string): void {
    // Alerta: Taxa de migração baixa
    if (stats.percentageMigrated < this.config.alertThreshold && stats.total > 10) {
      const alertMessage = `🚨 Taxa de migração baixa em ${context}: ${stats.percentageMigrated.toFixed(1)}% (esperado: >${this.config.alertThreshold}%)`;
      this.generateAlert(alertMessage);
    }

    // Alerta: Muitos registros com nomenclatura antiga
    if (stats.oldNomenclature > stats.newNomenclature && stats.total > 50) {
      const alertMessage = `⚠️ Predominância de nomenclatura antiga em ${context}: ${stats.oldNomenclature} antigos vs ${stats.newNomenclature} novos`;
      this.generateAlert(alertMessage);
    }

    // Alerta: Taxa de erro alta
    const errorRate = this.processedRecords > 0 ? (this.errors / this.processedRecords) * 100 : 0;
    if (errorRate > 5) { // Mais de 5% de erro
      const alertMessage = `❌ Taxa de erro alta em ${context}: ${errorRate.toFixed(2)}%`;
      this.generateAlert(alertMessage);
    }
  }

  /**
   * Gerar alerta único (evitar duplicatas)
   */
  private generateAlert(message: string): void {
    if (!this.alerts.includes(message)) {
      this.alerts.push(message);
      console.warn(message);
      
      // Manter apenas os últimos 20 alertas
      if (this.alerts.length > 20) {
        this.alerts = this.alerts.slice(-20);
      }
    }
  }

  /**
   * Obter uso de memória (quando disponível)
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      return Math.round(usage.heapUsed / 1024 / 1024); // MB
    }
    return 0;
  }

  /**
   * Gerar relatório de migração
   */
  generateMigrationReport(): {
    summary: {
      totalProcessed: number;
      errors: number;
      errorRate: number;
      elapsedTime: number;
      averageProcessingRate: number;
    };
    recentMetrics: MigrationMetrics[];
    alerts: string[];
    recommendations: string[];
  } {
    const now = Date.now();
    const elapsedSeconds = (now - this.startTime) / 1000;
    const errorRate = this.processedRecords > 0 ? (this.errors / this.processedRecords) * 100 : 0;
    const averageProcessingRate = elapsedSeconds > 0 ? this.processedRecords / elapsedSeconds : 0;

    // Gerar recomendações baseadas nas métricas
    const recommendations = this.generateRecommendations();

    return {
      summary: {
        totalProcessed: this.processedRecords,
        errors: this.errors,
        errorRate: Math.round(errorRate * 100) / 100,
        elapsedTime: Math.round(elapsedSeconds),
        averageProcessingRate: Math.round(averageProcessingRate * 100) / 100
      },
      recentMetrics: this.metrics.slice(-10), // Últimas 10 métricas
      alerts: [...this.alerts],
      recommendations
    };
  }

  /**
   * Gerar recomendações baseadas no monitoramento
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    // Análise das métricas mais recentes
    const recentMetrics = this.metrics.slice(-5);
    if (recentMetrics.length === 0) {
      return ['Execute mais processamentos para gerar recomendações'];
    }

    const averageMigrationRate = recentMetrics.reduce((sum, m) => sum + m.percentageMigrated, 0) / recentMetrics.length;
    const averageErrorRate = recentMetrics.reduce((sum, m) => sum + m.errorRate, 0) / recentMetrics.length;

    // Recomendações baseadas na taxa de migração
    if (averageMigrationRate < 50) {
      recommendations.push('🔄 Considere executar a migração completa dos dados legados');
      recommendations.push('📋 Verifique se os dados de origem estão na nomenclatura esperada');
    } else if (averageMigrationRate < 80) {
      recommendations.push('⚡ Migração em progresso - continue monitorando');
    } else {
      recommendations.push('✅ Taxa de migração adequada - foque na otimização');
    }

    // Recomendações baseadas na taxa de erro
    if (averageErrorRate > 5) {
      recommendations.push('🚨 Taxa de erro alta - investigate os logs de erro');
      recommendations.push('🔍 Verifique a integridade dos dados de entrada');
    } else if (averageErrorRate > 1) {
      recommendations.push('⚠️ Monitore erros ocasionais para evitar degradação');
    }

    // Recomendações baseadas no desempenho
    const averageProcessingRate = recentMetrics.reduce((sum, m) => sum + m.processingRate, 0) / recentMetrics.length;
    if (averageProcessingRate < 10) {
      recommendations.push('🐌 Performance baixa - considere otimizações de processamento');
    }

    return recommendations;
  }

  /**
   * Resetar monitoramento
   */
  reset(): void {
    this.metrics = [];
    this.alerts = [];
    this.processedRecords = 0;
    this.errors = 0;
    this.startTime = Date.now();
    this.lastLogTime = 0;
    this.lastMetricsTime = 0;

    console.log('🔄 [MigrationMonitor] Monitor resetado');
  }

  /**
   * Obter alertas ativos
   */
  getActiveAlerts(): string[] {
    return [...this.alerts];
  }

  /**
   * Obter métricas mais recentes
   */
  getRecentMetrics(count = 10): MigrationMetrics[] {
    return this.metrics.slice(-count);
  }

  /**
   * Configurar thresholds de alerta
   */
  updateConfig(newConfig: Partial<MigrationMonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ [MigrationMonitor] Configuração atualizada:', newConfig);
  }
}

// Instância singleton do monitor
export const migrationMonitor = new MigrationMonitor();

/**
 * Utilitário para monitoramento rápido em uma linha
 */
export function quickMonitor(data: any[], context: string): void {
  migrationMonitor.monitorProcessing(data, context);
}

/**
 * Utilitário para logging de progresso simples
 */
export function simpleProgress(data: any[], context: string): void {
  const stats = getMigrationStats(data);
  console.log(`📊 [${context}] Migração: ${stats.percentageMigrated.toFixed(1)}% (${stats.newNomenclature}/${stats.total} registros)`);
}