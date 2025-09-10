/**
 * Sistema de Alertas Automáticos para Anomalias
 * Monitora dados e envia alertas em tempo real para padrões críticos
 */

import { SuspiciousPatternAlert, SuspiciousPatternDetector } from './suspicious-patterns-detector.js';
import { DataQualityDashboard, DashboardMetrics } from './data-quality-dashboard.js';
import { logger } from '../logging/index.js';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  condition: AlertCondition;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  enabled: boolean;
  cooldownMinutes: number; // Tempo mínimo entre alertas do mesmo tipo
  actions: AlertAction[];
  metadata: Record<string, any>;
}

export interface AlertCondition {
  type: 'THRESHOLD' | 'PATTERN' | 'TREND' | 'ANOMALY';
  metric: string;
  operator: 'GT' | 'LT' | 'EQ' | 'GTE' | 'LTE' | 'CONTAINS' | 'MATCHES';
  value: number | string | RegExp;
  timeWindow?: number; // Em minutos
  aggregation?: 'AVG' | 'MAX' | 'MIN' | 'SUM' | 'COUNT';
}

export interface AlertAction {
  type: 'LOG' | 'EMAIL' | 'WEBHOOK' | 'BLOCK_OPERATION' | 'ESCALATE';
  config: Record<string, any>;
  enabled: boolean;
}

export interface AutomatedAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  timestamp: Date;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  operationName: string;
  affectedData: {
    type: string;
    count: number;
    records: string[];
  };
  triggerValue: number | string;
  threshold: number | string;
  actions: AlertAction[];
  resolved: boolean;
  resolvedAt?: Date;
  metadata: Record<string, any>;
}

export class AutomatedAlertingSystem {
  private dashboard: DataQualityDashboard;
  private patternDetector: SuspiciousPatternDetector;
  private alertRules: Map<string, AlertRule> = new Map();
  private firedAlerts: AutomatedAlert[] = [];
  private cooldownTracker: Map<string, Date> = new Map();
  private maxAlertHistory: number = 1000;

  constructor(dashboard: DataQualityDashboard, patternDetector: SuspiciousPatternDetector) {
    this.dashboard = dashboard;
    this.patternDetector = patternDetector;
    this.initializeDefaultRules();
  }

  /**
   * Inicializa regras padrão do sistema
   */
  private initializeDefaultRules(): void {
    // Regra para qualidade de dados baixa
    this.addRule({
      id: 'low-data-quality',
      name: 'Qualidade de Dados Baixa',
      description: 'Detecta quando a qualidade geral dos dados está abaixo de 80%',
      condition: {
        type: 'THRESHOLD',
        metric: 'dataQuality.overallScore',
        operator: 'LT',
        value: 0.8
      },
      severity: 'HIGH',
      enabled: true,
      cooldownMinutes: 30,
      actions: [
        { type: 'LOG', config: { level: 'ERROR' }, enabled: true }
      ],
      metadata: { category: 'DATA_QUALITY' }
    });

    // Regra para muitas duplicatas
    this.addRule({
      id: 'high-duplicates',
      name: 'Alto Número de Duplicatas',
      description: 'Detecta quando há muitas duplicatas removidas (>5% dos dados)',
      condition: {
        type: 'THRESHOLD',
        metric: 'duplicatePercentage',
        operator: 'GT',
        value: 5
      },
      severity: 'MEDIUM',
      enabled: true,
      cooldownMinutes: 15,
      actions: [
        { type: 'LOG', config: { level: 'WARN' }, enabled: true }
      ],
      metadata: { category: 'INTEGRITY' }
    });

    // Regra para padrões críticos
    this.addRule({
      id: 'critical-patterns',
      name: 'Padrões Críticos Detectados',
      description: 'Detecta quando há padrões críticos nos dados',
      condition: {
        type: 'THRESHOLD',
        metric: 'criticalPatterns',
        operator: 'GT',
        value: 0
      },
      severity: 'CRITICAL',
      enabled: true,
      cooldownMinutes: 5,
      actions: [
        { type: 'LOG', config: { level: 'ERROR' }, enabled: true },
        { type: 'ESCALATE', config: { level: 'IMMEDIATE' }, enabled: true }
      ],
      metadata: { category: 'SECURITY' }
    });

    // Regra para baixa completude
    this.addRule({
      id: 'low-completeness',
      name: 'Baixa Completude de Dados',
      description: 'Detecta quando a completude dos dados está abaixo de 90%',
      condition: {
        type: 'THRESHOLD',
        metric: 'dataQuality.completeness',
        operator: 'LT',
        value: 0.9
      },
      severity: 'MEDIUM',
      enabled: true,
      cooldownMinutes: 20,
      actions: [
        { type: 'LOG', config: { level: 'WARN' }, enabled: true }
      ],
      metadata: { category: 'DATA_QUALITY' }
    });

    // Regra para baixa precisão
    this.addRule({
      id: 'low-accuracy',
      name: 'Baixa Precisão de Dados',
      description: 'Detecta quando a precisão dos dados está abaixo de 95%',
      condition: {
        type: 'THRESHOLD',
        metric: 'dataQuality.accuracy',
        operator: 'LT',
        value: 0.95
      },
      severity: 'HIGH',
      enabled: true,
      cooldownMinutes: 30,
      actions: [
        { type: 'LOG', config: { level: 'ERROR' }, enabled: true }
      ],
      metadata: { category: 'DATA_QUALITY' }
    });

    // Regra para alto tempo de processamento
    this.addRule({
      id: 'slow-processing',
      name: 'Processamento Lento',
      description: 'Detecta quando o processamento está muito lento (<100 records/sec)',
      condition: {
        type: 'THRESHOLD',
        metric: 'throughput',
        operator: 'LT',
        value: 100
      },
      severity: 'MEDIUM',
      enabled: true,
      cooldownMinutes: 60,
      actions: [
        { type: 'LOG', config: { level: 'WARN' }, enabled: true }
      ],
      metadata: { category: 'PERFORMANCE' }
    });

    // Regra para alta taxa de erro
    this.addRule({
      id: 'high-error-rate',
      name: 'Alta Taxa de Erro',
      description: 'Detecta quando a taxa de erro está acima de 1%',
      condition: {
        type: 'THRESHOLD',
        metric: 'errorRate',
        operator: 'GT',
        value: 1
      },
      severity: 'HIGH',
      enabled: true,
      cooldownMinutes: 15,
      actions: [
        { type: 'LOG', config: { level: 'ERROR' }, enabled: true }
      ],
      metadata: { category: 'RELIABILITY' }
    });

    logger.info(`🚨 [Automated Alerts] ${this.alertRules.size} regras padrão inicializadas`);
  }

  /**
   * Adiciona uma nova regra de alerta
   */
  addRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    logger.info(`🚨 [Automated Alerts] Regra adicionada: ${rule.name}`);
  }

  /**
   * Remove uma regra de alerta
   */
  removeRule(ruleId: string): boolean {
    const success = this.alertRules.delete(ruleId);
    if (success) {
      logger.info(`🚨 [Automated Alerts] Regra removida: ${ruleId}`);
    }
    return success;
  }

  /**
   * Processa métricas e verifica regras de alerta
   */
  async processMetrics(metrics: DashboardMetrics): Promise<AutomatedAlert[]> {
    const firedAlerts: AutomatedAlert[] = [];
    
    logger.debug(`🚨 [Automated Alerts] Processando métricas para ${metrics.operationName}`);

    // Verificar cada regra
    for (const [ruleId, rule] of this.alertRules) {
      if (!rule.enabled) continue;

      // Verificar cooldown
      const cooldownKey = `${ruleId}-${metrics.operationName}`;
      const lastFired = this.cooldownTracker.get(cooldownKey);
      if (lastFired && (Date.now() - lastFired.getTime()) < rule.cooldownMinutes * 60 * 1000) {
        continue;
      }

      // Avaliar condição
      const alertTriggered = await this.evaluateCondition(rule.condition, metrics);
      
      if (alertTriggered.triggered) {
        const alert = await this.createAlert(rule, metrics, alertTriggered);
        firedAlerts.push(alert);
        this.firedAlerts.push(alert);
        
        // Atualizar cooldown
        this.cooldownTracker.set(cooldownKey, new Date());
        
        // Executar ações
        await this.executeActions(rule.actions, alert);
      }
    }

    // Manter histórico limitado
    if (this.firedAlerts.length > this.maxAlertHistory) {
      this.firedAlerts = this.firedAlerts.slice(-this.maxAlertHistory);
    }

    if (firedAlerts.length > 0) {
      logger.info(`🚨 [Automated Alerts] ${firedAlerts.length} alertas disparados para ${metrics.operationName}`);
    }

    return firedAlerts;
  }

  /**
   * Avalia se uma condição foi atendida
   */
  private async evaluateCondition(
    condition: AlertCondition, 
    metrics: DashboardMetrics
  ): Promise<{ triggered: boolean; actualValue: any; threshold: any }> {
    const actualValue = this.extractMetricValue(condition.metric, metrics);
    const threshold = condition.value;
    
    let triggered = false;
    
    switch (condition.operator) {
      case 'GT':
        triggered = actualValue > threshold;
        break;
      case 'LT':
        triggered = actualValue < threshold;
        break;
      case 'EQ':
        triggered = actualValue === threshold;
        break;
      case 'GTE':
        triggered = actualValue >= threshold;
        break;
      case 'LTE':
        triggered = actualValue <= threshold;
        break;
      case 'CONTAINS':
        triggered = String(actualValue).includes(String(threshold));
        break;
      case 'MATCHES':
        if (threshold instanceof RegExp) {
          triggered = threshold.test(String(actualValue));
        } else {
          triggered = String(actualValue) === String(threshold);
        }
        break;
    }
    
    return { triggered, actualValue, threshold };
  }

  /**
   * Extrai valor da métrica baseado no caminho
   */
  private extractMetricValue(metricPath: string, metrics: DashboardMetrics): any {
    // Métricas especiais calculadas
    if (metricPath === 'duplicatePercentage') {
      return metrics.totalRecords > 0 ? (metrics.duplicatesRemoved / metrics.totalRecords) * 100 : 0;
    }
    
    if (metricPath === 'criticalPatterns') {
      return metrics.alerts.filter(a => a.priority === 'CRITICAL').length;
    }
    
    // Navegar pelo objeto usando o caminho
    const parts = metricPath.split('.');
    let value: any = metrics;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * Cria um alerta
   */
  private async createAlert(
    rule: AlertRule, 
    metrics: DashboardMetrics, 
    evaluation: { triggered: boolean; actualValue: any; threshold: any }
  ): Promise<AutomatedAlert> {
    const alertId = `${rule.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Determinar registros afetados
    const affectedRecords = this.determineAffectedRecords(rule, metrics);
    
    const alert: AutomatedAlert = {
      id: alertId,
      ruleId: rule.id,
      ruleName: rule.name,
      timestamp: new Date(),
      severity: rule.severity,
      message: this.generateAlertMessage(rule, evaluation),
      operationName: metrics.operationName,
      affectedData: {
        type: metrics.operationName,
        count: affectedRecords.length,
        records: affectedRecords
      },
      triggerValue: evaluation.actualValue,
      threshold: evaluation.threshold,
      actions: rule.actions,
      resolved: false,
      metadata: {
        ...rule.metadata,
        condition: rule.condition,
        metricsSnapshot: {
          timestamp: metrics.timestamp,
          totalRecords: metrics.totalRecords,
          duplicatesRemoved: metrics.duplicatesRemoved,
          qualityScore: metrics.dataQuality.overallScore
        }
      }
    };
    
    return alert;
  }

  /**
   * Determina registros afetados pelo alerta
   */
  private determineAffectedRecords(rule: AlertRule, metrics: DashboardMetrics): string[] {
    // Para alertas de padrões críticos, usar registros dos padrões
    if (rule.id === 'critical-patterns') {
      return metrics.alerts
        .filter(a => a.priority === 'CRITICAL')
        .flatMap(a => a.pattern.affectedRecords)
        .slice(0, 10); // Limitar para não sobrecarregar
    }
    
    // Para outros alertas, usar uma amostra dos registros
    return [`sample_${metrics.operationName}_${Date.now()}`];
  }

  /**
   * Gera mensagem do alerta
   */
  private generateAlertMessage(
    rule: AlertRule, 
    evaluation: { actualValue: any; threshold: any }
  ): string {
    const { actualValue, threshold } = evaluation;
    
    switch (rule.id) {
      case 'low-data-quality':
        return `Qualidade de dados baixa: ${(actualValue * 100).toFixed(1)}% (limite: ${(threshold * 100).toFixed(1)}%)`;
      case 'high-duplicates':
        return `Alto número de duplicatas: ${actualValue.toFixed(1)}% (limite: ${threshold}%)`;
      case 'critical-patterns':
        return `${actualValue} padrões críticos detectados`;
      case 'low-completeness':
        return `Baixa completude: ${(actualValue * 100).toFixed(1)}% (limite: ${(threshold * 100).toFixed(1)}%)`;
      case 'low-accuracy':
        return `Baixa precisão: ${(actualValue * 100).toFixed(1)}% (limite: ${(threshold * 100).toFixed(1)}%)`;
      case 'slow-processing':
        return `Processamento lento: ${actualValue.toFixed(1)} records/sec (limite: ${threshold} records/sec)`;
      case 'high-error-rate':
        return `Alta taxa de erro: ${actualValue.toFixed(1)}% (limite: ${threshold}%)`;
      default:
        return `${rule.name}: ${actualValue} (limite: ${threshold})`;
    }
  }

  /**
   * Executa ações do alerta
   */
  private async executeActions(actions: AlertAction[], alert: AutomatedAlert): Promise<void> {
    for (const action of actions) {
      if (!action.enabled) continue;

      try {
        await this.executeAction(action, alert);
      } catch (error: any) {
        logger.error(`❌ [Automated Alerts] Erro ao executar ação ${action.type}: ${error.message}`);
      }
    }
  }

  /**
   * Executa uma ação específica
   */
  private async executeAction(action: AlertAction, alert: AutomatedAlert): Promise<void> {
    switch (action.type) {
      case 'LOG':
        const level = action.config.level || 'INFO';
        const logMessage = `🚨 [ALERTA ${alert.severity}] ${alert.message}`;
        
        switch (level) {
          case 'ERROR':
            logger.error(logMessage);
            break;
          case 'WARN':
            logger.warn(logMessage);
            break;
          default:
            logger.info(logMessage);
        }
        break;

      case 'ESCALATE':
        logger.error(`🚨 [ESCALAÇÃO] ${alert.severity}: ${alert.message}`);
        logger.error(`  • Operação: ${alert.operationName}`);
        logger.error(`  • Valor: ${alert.triggerValue}`);
        logger.error(`  • Limite: ${alert.threshold}`);
        logger.error(`  • Registros afetados: ${alert.affectedData.count}`);
        break;

      case 'BLOCK_OPERATION':
        logger.error(`🚨 [BLOQUEIO] Operação bloqueada: ${alert.operationName}`);
        // Aqui seria implementada a lógica de bloqueio real
        break;

      case 'EMAIL':
        // Implementar envio de email
        logger.info(`📧 [EMAIL] Enviando alerta por email: ${alert.message}`);
        break;

      case 'WEBHOOK':
        // Implementar webhook
        logger.info(`🔗 [WEBHOOK] Enviando webhook: ${alert.message}`);
        break;

      default:
        logger.warn(`⚠️ [Automated Alerts] Ação desconhecida: ${action.type}`);
    }
  }

  /**
   * Resolve um alerta
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.firedAlerts.find(a => a.id === alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      logger.info(`✅ [Automated Alerts] Alerta resolvido: ${alertId}`);
      return true;
    }
    return false;
  }

  /**
   * Obtém alertas ativos
   */
  getActiveAlerts(): AutomatedAlert[] {
    return this.firedAlerts.filter(a => !a.resolved);
  }

  /**
   * Obtém alertas por severidade
   */
  getAlertsBySeverity(severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): AutomatedAlert[] {
    return this.firedAlerts.filter(a => a.severity === severity);
  }

  /**
   * Obtém estatísticas de alertas
   */
  getAlertStatistics(): {
    total: number;
    active: number;
    resolved: number;
    bySeverity: Record<string, number>;
    byRule: Record<string, number>;
    recentAlerts: AutomatedAlert[];
  } {
    const total = this.firedAlerts.length;
    const active = this.firedAlerts.filter(a => !a.resolved).length;
    const resolved = this.firedAlerts.filter(a => a.resolved).length;
    
    const bySeverity = {
      CRITICAL: this.firedAlerts.filter(a => a.severity === 'CRITICAL').length,
      HIGH: this.firedAlerts.filter(a => a.severity === 'HIGH').length,
      MEDIUM: this.firedAlerts.filter(a => a.severity === 'MEDIUM').length,
      LOW: this.firedAlerts.filter(a => a.severity === 'LOW').length
    };
    
    const byRule: Record<string, number> = {};
    for (const alert of this.firedAlerts) {
      byRule[alert.ruleName] = (byRule[alert.ruleName] || 0) + 1;
    }
    
    const recentAlerts = this.firedAlerts
      .filter(a => a.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 20);
    
    return {
      total,
      active,
      resolved,
      bySeverity,
      byRule,
      recentAlerts
    };
  }

  /**
   * Limpa alertas antigos
   */
  cleanup(retentionDays: number = 30): void {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const initialCount = this.firedAlerts.length;
    
    this.firedAlerts = this.firedAlerts.filter(a => a.timestamp > cutoffDate);
    
    // Limpar cooldown tracker
    const cooldownCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const [key, date] of this.cooldownTracker) {
      if (date < cooldownCutoff) {
        this.cooldownTracker.delete(key);
      }
    }
    
    const removedCount = initialCount - this.firedAlerts.length;
    if (removedCount > 0) {
      logger.info(`🧹 [Automated Alerts] Limpeza concluída: ${removedCount} alertas antigos removidos`);
    }
  }

  /**
   * Habilita/desabilita uma regra
   */
  toggleRule(ruleId: string, enabled: boolean): boolean {
    const rule = this.alertRules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
      logger.info(`🚨 [Automated Alerts] Regra ${rule.name} ${enabled ? 'habilitada' : 'desabilitada'}`);
      return true;
    }
    return false;
  }

  /**
   * Obtém configuração atual das regras
   */
  getRulesConfiguration(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * Gera relatório de alertas
   */
  generateAlertReport(): {
    summary: ReturnType<AutomatedAlertingSystem['getAlertStatistics']>;
    rules: AlertRule[];
    recentActivity: Array<{
      timestamp: Date;
      type: 'ALERT_FIRED' | 'ALERT_RESOLVED' | 'RULE_ADDED' | 'RULE_DISABLED';
      description: string;
    }>;
  } {
    const summary = this.getAlertStatistics();
    const rules = this.getRulesConfiguration();
    
    // Atividade recente baseada nos alertas
    const recentActivity = summary.recentAlerts.map(alert => ({
      timestamp: alert.timestamp,
      type: 'ALERT_FIRED' as const,
      description: `${alert.severity}: ${alert.message}`
    }));
    
    return {
      summary,
      rules,
      recentActivity
    };
  }
}