/**
 * Detector de Padrões Suspeitos - Sistema Avançado de Análise
 * Integra com o sistema de analytics para detectar padrões complexos
 */

import { AdvancedAnalytics, SuspiciousPattern, DataQualityMetrics } from './advanced-analytics.js';
import { logger } from '../logging/index.js';

export interface SuspiciousPatternAlert {
  id: string;
  timestamp: Date;
  pattern: SuspiciousPattern;
  context: {
    operationName: string;
    dataType: string;
    affectedDataCount: number;
    totalDataCount: number;
  };
  action: 'LOGGED' | 'FLAGGED' | 'BLOCKED' | 'ESCALATED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  metadata: Record<string, any>;
}

export interface PatternDetectionConfig {
  enableTemporalAnalysis: boolean;
  enableMonetaryAnalysis: boolean;
  enableBehavioralAnalysis: boolean;
  enableStructuralAnalysis: boolean;
  
  // Thresholds para alertas
  criticalPatternThreshold: number;
  highPatternThreshold: number;
  mediumPatternThreshold: number;
  
  // Configurações específicas
  temporalAnomalyThreshold: number;
  monetaryOutlierThreshold: number;
  behavioralFragmentationThreshold: number;
  structuralCompletenessThreshold: number;
  
  // Ações automáticas
  autoBlockCriticalPatterns: boolean;
  autoFlagHighPatterns: boolean;
  escalateToCriticalPatterns: boolean;
  
  // Configurações de relatórios
  generatePeriodicReports: boolean;
  reportIntervalHours: number;
  maxAlertsPerOperation: number;
}

export class SuspiciousPatternDetector {
  private analytics: AdvancedAnalytics;
  private config: PatternDetectionConfig;
  private alerts: SuspiciousPatternAlert[] = [];
  private detectionHistory: Map<string, SuspiciousPatternAlert[]> = new Map();
  
  constructor(config?: Partial<PatternDetectionConfig>) {
    this.analytics = new AdvancedAnalytics();
    this.config = {
      enableTemporalAnalysis: true,
      enableMonetaryAnalysis: true,
      enableBehavioralAnalysis: true,
      enableStructuralAnalysis: true,
      
      criticalPatternThreshold: 90,
      highPatternThreshold: 75,
      mediumPatternThreshold: 50,
      
      temporalAnomalyThreshold: 3.0,
      monetaryOutlierThreshold: 3.0,
      behavioralFragmentationThreshold: 0.4,
      structuralCompletenessThreshold: 0.8,
      
      autoBlockCriticalPatterns: true,
      autoFlagHighPatterns: true,
      escalateToCriticalPatterns: true,
      
      generatePeriodicReports: true,
      reportIntervalHours: 24,
      maxAlertsPerOperation: 100,
      
      ...config
    };
  }

  /**
   * Detecta padrões suspeitos em dados e gera alertas
   */
  async detectSuspiciousPatterns<T>(
    data: T[],
    deduplicationResult: any,
    operationName: string,
    dataType: string = 'UNKNOWN'
  ): Promise<SuspiciousPatternAlert[]> {
    logger.info(`🔍 [Pattern Detector] Iniciando detecção de padrões suspeitos para ${operationName}`);
    
    const operationAlerts: SuspiciousPatternAlert[] = [];
    
    try {
      // Análise básica de padrões
      const patterns = await this.analytics.analyzeDataPatterns(data, deduplicationResult, operationName);
      
      // Processar cada padrão detectado
      for (const pattern of patterns) {
        const alert = await this.createAlertFromPattern(pattern, operationName, dataType, data.length);
        
        // Aplicar regras de ação automática
        this.applyAutoActions(alert);
        
        operationAlerts.push(alert);
        this.alerts.push(alert);
        
        // Limitar número de alertas por operação
        if (operationAlerts.length >= this.config.maxAlertsPerOperation) {
          logger.warn(`⚠️ [Pattern Detector] Limite de alertas atingido para ${operationName}`);
          break;
        }
      }
      
      // Análise de qualidade de dados
      const dataQuality = this.analytics.calculateDataQuality(data, deduplicationResult);
      await this.analyzeDataQuality(dataQuality, operationName, dataType, operationAlerts);
      
      // Salvar histórico
      this.detectionHistory.set(operationName, operationAlerts);
      
      // Log resumo
      this.logDetectionSummary(operationName, operationAlerts);
      
      return operationAlerts;
      
    } catch (error: any) {
      logger.error(`❌ [Pattern Detector] Erro na detecção de padrões para ${operationName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cria alerta a partir de um padrão detectado
   */
  private async createAlertFromPattern(
    pattern: SuspiciousPattern,
    operationName: string,
    dataType: string,
    totalDataCount: number
  ): Promise<SuspiciousPatternAlert> {
    const alertId = `${operationName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const priority = this.mapSeverityToPriority(pattern.severity);
    const action = this.determineAction(pattern, priority);
    
    return {
      id: alertId,
      timestamp: new Date(),
      pattern,
      context: {
        operationName,
        dataType,
        affectedDataCount: pattern.affectedRecords.length,
        totalDataCount
      },
      action,
      priority,
      metadata: {
        confidence: pattern.confidence,
        suggestedAction: pattern.suggestedAction,
        patternType: pattern.type,
        detectionTimestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Aplica ações automáticas baseadas na configuração
   */
  private applyAutoActions(alert: SuspiciousPatternAlert): void {
    switch (alert.priority) {
      case 'CRITICAL':
        if (this.config.autoBlockCriticalPatterns) {
          alert.action = 'BLOCKED';
          logger.error(`🚨 [Pattern Detector] BLOQUEADO: ${alert.pattern.description}`);
        }
        if (this.config.escalateToCriticalPatterns) {
          alert.action = 'ESCALATED';
          logger.error(`🚨 [Pattern Detector] ESCALADO: ${alert.pattern.description}`);
        }
        break;
        
      case 'HIGH':
        if (this.config.autoFlagHighPatterns) {
          alert.action = 'FLAGGED';
          logger.warn(`⚠️ [Pattern Detector] SINALIZADO: ${alert.pattern.description}`);
        }
        break;
        
      default:
        alert.action = 'LOGGED';
        logger.info(`📝 [Pattern Detector] REGISTRADO: ${alert.pattern.description}`);
    }
  }

  /**
   * Analisa qualidade de dados e gera alertas específicos
   */
  private async analyzeDataQuality(
    dataQuality: DataQualityMetrics,
    operationName: string,
    dataType: string,
    operationAlerts: SuspiciousPatternAlert[]
  ): Promise<void> {
    // Alerta para completude baixa
    if (dataQuality.completeness < this.config.structuralCompletenessThreshold) {
      const completenessAlert = await this.createDataQualityAlert(
        'STRUCTURAL',
        'MEDIUM',
        `Baixa completude de dados: ${(dataQuality.completeness * 100).toFixed(1)}%`,
        operationName,
        dataType,
        { completeness: dataQuality.completeness, threshold: this.config.structuralCompletenessThreshold }
      );
      operationAlerts.push(completenessAlert);
    }
    
    // Alerta para precisão baixa
    if (dataQuality.accuracy < 0.9) {
      const accuracyAlert = await this.createDataQualityAlert(
        'STRUCTURAL',
        'HIGH',
        `Baixa precisão de dados: ${(dataQuality.accuracy * 100).toFixed(1)}%`,
        operationName,
        dataType,
        { accuracy: dataQuality.accuracy, threshold: 0.9 }
      );
      operationAlerts.push(accuracyAlert);
    }
    
    // Alerta para unicidade baixa
    if (dataQuality.uniqueness < 0.95) {
      const uniquenessAlert = await this.createDataQualityAlert(
        'BEHAVIORAL',
        'HIGH',
        `Baixa unicidade de dados: ${(dataQuality.uniqueness * 100).toFixed(1)}%`,
        operationName,
        dataType,
        { uniqueness: dataQuality.uniqueness, threshold: 0.95 }
      );
      operationAlerts.push(uniquenessAlert);
    }
    
    // Alerta para score geral baixo
    if (dataQuality.overallScore < 0.8) {
      const overallAlert = await this.createDataQualityAlert(
        'STRUCTURAL',
        'CRITICAL',
        `Score geral de qualidade baixo: ${(dataQuality.overallScore * 100).toFixed(1)}%`,
        operationName,
        dataType,
        { overallScore: dataQuality.overallScore, threshold: 0.8 }
      );
      operationAlerts.push(overallAlert);
    }
  }

  /**
   * Cria alerta específico para qualidade de dados
   */
  private async createDataQualityAlert(
    type: 'TEMPORAL' | 'MONETARY' | 'BEHAVIORAL' | 'STRUCTURAL',
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    description: string,
    operationName: string,
    dataType: string,
    metadata: Record<string, any>
  ): Promise<SuspiciousPatternAlert> {
    const pattern: SuspiciousPattern = {
      type,
      severity,
      description,
      affectedRecords: [],
      confidence: 85,
      suggestedAction: 'Verificar qualidade dos dados de origem',
      metadata
    };
    
    return this.createAlertFromPattern(pattern, operationName, dataType, 0);
  }

  /**
   * Mapeia severidade para prioridade
   */
  private mapSeverityToPriority(severity: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    switch (severity) {
      case 'CRITICAL': return 'CRITICAL';
      case 'HIGH': return 'HIGH';
      case 'MEDIUM': return 'MEDIUM';
      default: return 'LOW';
    }
  }

  /**
   * Determina ação baseada no padrão e prioridade
   */
  private determineAction(pattern: SuspiciousPattern, priority: string): 'LOGGED' | 'FLAGGED' | 'BLOCKED' | 'ESCALATED' {
    if (pattern.confidence >= this.config.criticalPatternThreshold) {
      return 'ESCALATED';
    }
    if (pattern.confidence >= this.config.highPatternThreshold) {
      return 'FLAGGED';
    }
    return 'LOGGED';
  }

  /**
   * Gera log resumo da detecção
   */
  private logDetectionSummary(operationName: string, alerts: SuspiciousPatternAlert[]): void {
    const summary = {
      total: alerts.length,
      critical: alerts.filter(a => a.priority === 'CRITICAL').length,
      high: alerts.filter(a => a.priority === 'HIGH').length,
      medium: alerts.filter(a => a.priority === 'MEDIUM').length,
      low: alerts.filter(a => a.priority === 'LOW').length,
      
      actions: {
        blocked: alerts.filter(a => a.action === 'BLOCKED').length,
        escalated: alerts.filter(a => a.action === 'ESCALATED').length,
        flagged: alerts.filter(a => a.action === 'FLAGGED').length,
        logged: alerts.filter(a => a.action === 'LOGGED').length
      }
    };
    
    logger.info(`📊 [Pattern Detector] Resumo da detecção para ${operationName}:`);
    logger.info(`  • Total de alertas: ${summary.total}`);
    logger.info(`  • Críticos: ${summary.critical}, Altos: ${summary.high}, Médios: ${summary.medium}, Baixos: ${summary.low}`);
    logger.info(`  • Ações: Bloqueados: ${summary.actions.blocked}, Escalados: ${summary.actions.escalated}, Sinalizados: ${summary.actions.flagged}, Registrados: ${summary.actions.logged}`);
    
    // Alertas críticos merecem atenção especial
    if (summary.critical > 0) {
      logger.error(`🚨 [Pattern Detector] ATENÇÃO: ${summary.critical} padrões críticos detectados em ${operationName}!`);
    }
  }

  /**
   * Análise de tendências em padrões detectados
   */
  async analyzeTrends(timeWindowHours: number = 24): Promise<{
    increasingPatterns: string[];
    decreasingPatterns: string[];
    newPatterns: string[];
    recommendations: string[];
  }> {
    const cutoffTime = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);
    const recentAlerts = this.alerts.filter(a => a.timestamp > cutoffTime);
    
    // Análise de tendências por tipo de padrão
    const patternCounts = new Map<string, number>();
    const patternTypes = new Set<string>();
    
    recentAlerts.forEach(alert => {
      const patternKey = `${alert.pattern.type}_${alert.pattern.severity}`;
      patternCounts.set(patternKey, (patternCounts.get(patternKey) || 0) + 1);
      patternTypes.add(patternKey);
    });
    
    // Comparar com período anterior
    const previousCutoff = new Date(cutoffTime.getTime() - timeWindowHours * 60 * 60 * 1000);
    const previousAlerts = this.alerts.filter(a => a.timestamp > previousCutoff && a.timestamp <= cutoffTime);
    
    const previousPatternCounts = new Map<string, number>();
    previousAlerts.forEach(alert => {
      const patternKey = `${alert.pattern.type}_${alert.pattern.severity}`;
      previousPatternCounts.set(patternKey, (previousPatternCounts.get(patternKey) || 0) + 1);
    });
    
    const increasingPatterns: string[] = [];
    const decreasingPatterns: string[] = [];
    const newPatterns: string[] = [];
    
    patternTypes.forEach(patternType => {
      const currentCount = patternCounts.get(patternType) || 0;
      const previousCount = previousPatternCounts.get(patternType) || 0;
      
      if (previousCount === 0 && currentCount > 0) {
        newPatterns.push(patternType);
      } else if (currentCount > previousCount * 1.5) {
        increasingPatterns.push(patternType);
      } else if (currentCount < previousCount * 0.5) {
        decreasingPatterns.push(patternType);
      }
    });
    
    // Gerar recomendações
    const recommendations: string[] = [];
    
    if (increasingPatterns.length > 0) {
      recommendations.push(`Investigar aumento nos padrões: ${increasingPatterns.join(', ')}`);
    }
    
    if (newPatterns.length > 0) {
      recommendations.push(`Analisar novos padrões emergentes: ${newPatterns.join(', ')}`);
    }
    
    if (recentAlerts.filter(a => a.priority === 'CRITICAL').length > 5) {
      recommendations.push('Alto número de padrões críticos - revisar processamento de dados');
    }
    
    return {
      increasingPatterns,
      decreasingPatterns,
      newPatterns,
      recommendations
    };
  }

  /**
   * Gera relatório detalhado de padrões suspeitos
   */
  generateDetailedReport(): {
    summary: {
      totalAlerts: number;
      alertsByPriority: Record<string, number>;
      alertsByType: Record<string, number>;
      alertsByAction: Record<string, number>;
    };
    recentAlerts: SuspiciousPatternAlert[];
    recommendations: string[];
    operationSummary: Array<{
      operationName: string;
      alertCount: number;
      criticalCount: number;
      lastDetection: Date;
    }>;
  } {
    const summary = {
      totalAlerts: this.alerts.length,
      alertsByPriority: {
        CRITICAL: this.alerts.filter(a => a.priority === 'CRITICAL').length,
        HIGH: this.alerts.filter(a => a.priority === 'HIGH').length,
        MEDIUM: this.alerts.filter(a => a.priority === 'MEDIUM').length,
        LOW: this.alerts.filter(a => a.priority === 'LOW').length
      },
      alertsByType: {
        TEMPORAL: this.alerts.filter(a => a.pattern.type === 'TEMPORAL').length,
        MONETARY: this.alerts.filter(a => a.pattern.type === 'MONETARY').length,
        BEHAVIORAL: this.alerts.filter(a => a.pattern.type === 'BEHAVIORAL').length,
        STRUCTURAL: this.alerts.filter(a => a.pattern.type === 'STRUCTURAL').length
      },
      alertsByAction: {
        BLOCKED: this.alerts.filter(a => a.action === 'BLOCKED').length,
        ESCALATED: this.alerts.filter(a => a.action === 'ESCALATED').length,
        FLAGGED: this.alerts.filter(a => a.action === 'FLAGGED').length,
        LOGGED: this.alerts.filter(a => a.action === 'LOGGED').length
      }
    };
    
    const recentAlerts = this.alerts
      .filter(a => a.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 50);
    
    const operationSummary = Array.from(this.detectionHistory.entries()).map(([operationName, alerts]) => ({
      operationName,
      alertCount: alerts.length,
      criticalCount: alerts.filter(a => a.priority === 'CRITICAL').length,
      lastDetection: alerts.length > 0 ? alerts[alerts.length - 1].timestamp : new Date(0)
    }));
    
    const recommendations = this.generateRecommendations(summary);
    
    return {
      summary,
      recentAlerts,
      recommendations,
      operationSummary
    };
  }

  /**
   * Gera recomendações baseadas no resumo de alertas
   */
  private generateRecommendations(summary: any): string[] {
    const recommendations: string[] = [];
    
    if (summary.alertsByPriority.CRITICAL > 10) {
      recommendations.push('Alto número de alertas críticos - revisar imediatamente a qualidade dos dados');
    }
    
    if (summary.alertsByType.MONETARY > summary.totalAlerts * 0.4) {
      recommendations.push('Muitas anomalias monetárias - verificar validação de valores');
    }
    
    if (summary.alertsByType.TEMPORAL > summary.totalAlerts * 0.3) {
      recommendations.push('Padrões temporais suspeitos - analisar cronologia dos dados');
    }
    
    if (summary.alertsByAction.BLOCKED > 0) {
      recommendations.push('Dados bloqueados detectados - verificar processamento manual');
    }
    
    return recommendations;
  }

  /**
   * Limpa alertas antigos para otimizar performance
   */
  cleanup(retentionDays: number = 30): void {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    
    const initialCount = this.alerts.length;
    this.alerts = this.alerts.filter(alert => alert.timestamp > cutoffDate);
    
    // Limpar histórico de detecções antigas
    for (const [operationName, alerts] of this.detectionHistory.entries()) {
      const filteredAlerts = alerts.filter(alert => alert.timestamp > cutoffDate);
      if (filteredAlerts.length === 0) {
        this.detectionHistory.delete(operationName);
      } else {
        this.detectionHistory.set(operationName, filteredAlerts);
      }
    }
    
    const finalCount = this.alerts.length;
    logger.info(`🧹 [Pattern Detector] Limpeza concluída: ${initialCount - finalCount} alertas antigos removidos`);
  }

  /**
   * Obtém estatísticas do detector
   */
  getStats(): {
    totalAlerts: number;
    operationsMonitored: number;
    averageAlertsPerOperation: number;
    criticalAlertPercentage: number;
    lastDetectionTime: Date | null;
  } {
    const totalAlerts = this.alerts.length;
    const operationsMonitored = this.detectionHistory.size;
    const averageAlertsPerOperation = operationsMonitored > 0 ? totalAlerts / operationsMonitored : 0;
    const criticalAlerts = this.alerts.filter(a => a.priority === 'CRITICAL').length;
    const criticalAlertPercentage = totalAlerts > 0 ? (criticalAlerts / totalAlerts) * 100 : 0;
    const lastDetectionTime = this.alerts.length > 0 ? 
      this.alerts[this.alerts.length - 1].timestamp : null;
    
    return {
      totalAlerts,
      operationsMonitored,
      averageAlertsPerOperation,
      criticalAlertPercentage,
      lastDetectionTime
    };
  }
}