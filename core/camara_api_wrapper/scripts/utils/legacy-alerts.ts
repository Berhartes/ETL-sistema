/**
 * SISTEMA DE ALERTAS PARA USO DE NOMENCLATURA LEGADA - FASE 4
 * 
 * Sistema para detectar e alertar sobre uso de campos legados
 * durante a transição para a nova nomenclatura da API
 */

export interface AlertConfig {
  enabled: boolean;
  logLevel: 'info' | 'warn' | 'error';
  includeStackTrace: boolean;
  throttleMs: number;
  reportToConsole: boolean;
  reportToFile: boolean;
  filePath?: string;
}

export interface LegacyUsageAlert {
  timestamp: number;
  field: string;
  context: string;
  value?: any;
  stackTrace?: string;
  recommendation: string;
  severity: 'low' | 'medium' | 'high';
}

/**
 * Sistema de alertas para uso de nomenclatura legada
 */
export class LegacyUsageAlerter {
  private config: AlertConfig;
  private alertQueue: LegacyUsageAlert[] = [];
  private lastAlerts: Map<string, number> = new Map();
  private deprecationWarnings: Set<string> = new Set();

  constructor(config: Partial<AlertConfig> = {}) {
    this.config = {
      enabled: true,
      logLevel: 'warn',
      includeStackTrace: false,
      throttleMs: 30000, // 30 segundos entre alertas do mesmo tipo
      reportToConsole: true,
      reportToFile: false,
      ...config
    };

    // Inicializar warnings para campos legados
    this.setupDeprecationWarnings();
  }

  /**
   * Configura warnings de depreciação para campos legados
   */
  private setupDeprecationWarnings(): void {
    this.deprecationWarnings.add('fornecedorNome');
    this.deprecationWarnings.add('fornecedorCnpj');
  }

  /**
   * Alerta sobre uso de campo legado
   */
  alertLegacyUsage(
    field: string,
    context: string,
    value?: any,
    severity: 'low' | 'medium' | 'high' = 'medium'
  ): void {
    if (!this.config.enabled) return;

    const alertKey = `${field}_${context}`;
    const now = Date.now();
    const lastAlert = this.lastAlerts.get(alertKey);

    // Throttling - evita spam de alertas
    if (lastAlert && (now - lastAlert) < this.config.throttleMs) {
      return;
    }

    const alert: LegacyUsageAlert = {
      timestamp: now,
      field,
      context,
      value: this.sanitizeValue(value),
      stackTrace: this.config.includeStackTrace ? this.getStackTrace() : undefined,
      recommendation: this.getRecommendation(field),
      severity
    };

    this.processAlert(alert);
    this.lastAlerts.set(alertKey, now);
  }

  /**
   * Processa e exibe o alerta
   */
  private processAlert(alert: LegacyUsageAlert): void {
    // Adicionar à fila
    this.alertQueue.push(alert);

    // Limitar tamanho da fila
    if (this.alertQueue.length > 100) {
      this.alertQueue.shift();
    }

    if (this.config.reportToConsole) {
      this.logToConsole(alert);
    }

    if (this.config.reportToFile && this.config.filePath) {
      this.logToFile(alert);
    }
  }

  /**
   * Exibe alerta no console
   */
  private logToConsole(alert: LegacyUsageAlert): void {
    const emoji = this.getSeverityEmoji(alert.severity);
    const timestamp = new Date(alert.timestamp).toISOString();

    const message = [
      `${emoji} [LEGACY USAGE] ${alert.field} usado em ${alert.context}`,
      `   Timestamp: ${timestamp}`,
      `   Severidade: ${alert.severity.toUpperCase()}`,
      `   Recomendação: ${alert.recommendation}`
    ];

    if (alert.value !== undefined) {
      message.push(`   Valor: ${JSON.stringify(alert.value)}`);
    }

    if (alert.stackTrace) {
      message.push(`   Stack: ${alert.stackTrace}`);
    }

    const logMethod = this.getLogMethod(alert.severity);
    console[logMethod](message.join('\n'));
  }

  /**
   * Salva alerta em arquivo
   */
  private async logToFile(alert: LegacyUsageAlert): Promise<void> {
    if (!this.config.filePath) return;

    const logEntry = {
      ...alert,
      timestamp: new Date(alert.timestamp).toISOString()
    };

    // Em ambiente real, salvaria em arquivo
    // Por agora, apenas simula o comportamento
    console.log(`📁 [FILE LOG] Alerta salvo em ${this.config.filePath}:`, logEntry);
  }

  /**
   * Obtém emoji baseado na severidade
   */
  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case 'low': return '💡';
      case 'medium': return '⚠️';
      case 'high': return '🚨';
      default: return '📋';
    }
  }

  /**
   * Obtém método de log baseado na severidade
   */
  private getLogMethod(severity: string): 'info' | 'warn' | 'error' {
    switch (severity) {
      case 'low': return 'info';
      case 'high': return 'error';
      default: return 'warn';
    }
  }

  /**
   * Gera recomendação para o campo legado
   */
  private getRecommendation(field: string): string {
    const recommendations = {
      'fornecedorNome': 'Use "nomeFornecedor" em vez de "fornecedorNome"',
      'fornecedorCnpj': 'Use "cnpjCpfFornecedor" em vez de "fornecedorCnpj"'
    };

    return recommendations[field] || `Campo "${field}" está depreciado. Consulte a documentação para alternativas.`;
  }

  /**
   * Sanitiza valor para log
   */
  private sanitizeValue(value: any): any {
    if (typeof value === 'string' && value.length > 50) {
      return value.substring(0, 50) + '...';
    }
    return value;
  }

  /**
   * Obtém stack trace atual
   */
  private getStackTrace(): string {
    const stack = new Error().stack;
    if (!stack) return 'Stack trace não disponível';
    
    return stack
      .split('\n')
      .slice(3, 6) // Pegar apenas as linhas relevantes
      .map(line => line.trim())
      .join(' -> ');
  }

  /**
   * Obtém estatísticas dos alertas
   */
  getAlertStats(): {
    total: number;
    byField: { [field: string]: number };
    bySeverity: { [severity: string]: number };
    recentAlerts: LegacyUsageAlert[];
  } {
    const stats = {
      total: this.alertQueue.length,
      byField: {} as { [field: string]: number },
      bySeverity: {} as { [severity: string]: number },
      recentAlerts: this.alertQueue.slice(-10) // Últimos 10 alertas
    };

    // Contar por campo
    this.alertQueue.forEach(alert => {
      stats.byField[alert.field] = (stats.byField[alert.field] || 0) + 1;
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
    });

    return stats;
  }

  /**
   * Limpa histórico de alertas
   */
  clearAlerts(): void {
    this.alertQueue.length = 0;
    this.lastAlerts.clear();
  }

  /**
   * Gera relatório de alertas
   */
  generateAlertReport(): string {
    const stats = this.getAlertStats();
    
    const report = [
      '📋 [ALERT REPORT] Relatório de Alertas de Nomenclatura Legada',
      '================================================',
      `📊 Total de alertas: ${stats.total}`,
      '',
      '🔍 Alertas por campo:',
      ...Object.entries(stats.byField).map(([field, count]) => 
        `   ${field}: ${count} ocorrências`
      ),
      '',
      '⚡ Alertas por severidade:',
      ...Object.entries(stats.bySeverity).map(([severity, count]) => 
        `   ${severity}: ${count} ocorrências`
      ),
      '',
      '🕒 Alertas recentes:',
      ...stats.recentAlerts.slice(-5).map(alert => 
        `   ${new Date(alert.timestamp).toLocaleTimeString()}: ${alert.field} em ${alert.context}`
      ),
      '================================================'
    ];

    return report.join('\n');
  }
}

/**
 * Proxy para interceptar acessos a propriedades legadas
 */
export function createLegacyProxy<T extends object>(
  target: T,
  alerter: LegacyUsageAlerter,
  context: string
): T {
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === 'string' && (prop === 'fornecedorNome' || prop === 'fornecedorCnpj')) {
        alerter.alertLegacyUsage(prop, context, obj[prop], 'medium');
      }
      return obj[prop];
    },
    
    set(obj, prop, value) {
      if (typeof prop === 'string' && (prop === 'fornecedorNome' || prop === 'fornecedorCnpj')) {
        alerter.alertLegacyUsage(prop, `${context}_write`, value, 'high');
      }
      obj[prop] = value;
      return true;
    }
  });
}

/**
 * Decorator para funções que usam nomenclatura legada
 */
export function deprecatedField(newField: string, severity: 'low' | 'medium' | 'high' = 'medium') {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = function(...args: any[]) {
      if (legacyAlerter.config.enabled) {
        legacyAlerter.alertLegacyUsage(
          propertyKey,
          `${target.constructor.name}.${propertyKey}`,
          undefined,
          severity
        );
        
        console.warn(`⚠️ [DEPRECATED] ${propertyKey} está depreciado. Use ${newField} em vez disso.`);
      }
      
      return originalMethod.apply(this, args);
    };
    
    return descriptor;
  };
}

/**
 * Função utilitária para verificar e alertar sobre uso de campos legados
 */
export function checkLegacyFields(
  data: any,
  context: string,
  alerter: LegacyUsageAlerter = legacyAlerter
): void {
  if (!data || typeof data !== 'object') return;

  const legacyFields = ['fornecedorNome', 'fornecedorCnpj'];
  
  legacyFields.forEach(field => {
    if (data.hasOwnProperty(field) && data[field] !== undefined && data[field] !== null) {
      alerter.alertLegacyUsage(field, context, data[field]);
    }
  });
}

/**
 * Instância global do sistema de alertas
 */
export const legacyAlerter = new LegacyUsageAlerter({
  enabled: true,
  logLevel: 'warn',
  includeStackTrace: false,
  throttleMs: 30000,
  reportToConsole: true,
  reportToFile: false
});

/**
 * Função para inicializar o sistema de alertas
 */
export function initializeLegacyAlerts(config: Partial<AlertConfig> = {}): LegacyUsageAlerter {
  const alerter = new LegacyUsageAlerter(config);
  
  console.log('🚨 [LEGACY ALERTS] Sistema de alertas inicializado');
  console.log(`   Alertas habilitados: ${alerter.config.enabled}`);
  console.log(`   Nível de log: ${alerter.config.logLevel}`);
  console.log(`   Throttle: ${alerter.config.throttleMs}ms`);
  
  return alerter;
}

/**
 * Função para desabilitar alertas temporariamente
 */
export function disableLegacyAlerts(): void {
  legacyAlerter.config.enabled = false;
  console.log('⏸️ [LEGACY ALERTS] Alertas temporariamente desabilitados');
}

/**
 * Função para reabilitar alertas
 */
export function enableLegacyAlerts(): void {
  legacyAlerter.config.enabled = true;
  console.log('▶️ [LEGACY ALERTS] Alertas reabilitados');
}