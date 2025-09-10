/**
 * SISTEMA DE FEATURE FLAGS - FASE 4 MIGRAÇÃO SEGURA
 * 
 * Sistema para controlar a remoção gradual de campos legados com rollback automático
 */

export interface FeatureFlags {
  // Controles de migração
  ENABLE_LEGACY_FIELD_REMOVAL: boolean;
  STRICT_LEGACY_VALIDATION: boolean;
  AUTO_ROLLBACK_ON_ERROR: boolean;
  
  // Controles de validação
  VALIDATE_NEW_NOMENCLATURE: boolean;
  LOG_LEGACY_USAGE: boolean;
  BLOCK_LEGACY_WRITES: boolean;
  
  // Controles de performance
  BYPASS_LEGACY_FALLBACKS: boolean;
  OPTIMIZE_NEW_FIELD_ACCESS: boolean;
}

export interface MigrationState {
  phase: 'preparation' | 'step1' | 'step2' | 'step3' | 'completed' | 'rollback';
  completedSteps: string[];
  errorCount: number;
  lastError?: string;
  rollbackReason?: string;
  startTime: number;
  lastUpdate: number;
}

/**
 * Classe para gerenciamento de feature flags da migração
 */
export class MigrationFeatureFlags {
  private flags: FeatureFlags;
  private state: MigrationState;
  private errorThreshold: number = 5;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(initialFlags: Partial<FeatureFlags> = {}) {
    this.flags = {
      // Configuração conservadora por padrão
      ENABLE_LEGACY_FIELD_REMOVAL: false,
      STRICT_LEGACY_VALIDATION: false,
      AUTO_ROLLBACK_ON_ERROR: true,
      
      VALIDATE_NEW_NOMENCLATURE: true,
      LOG_LEGACY_USAGE: true,
      BLOCK_LEGACY_WRITES: false,
      
      BYPASS_LEGACY_FALLBACKS: false,
      OPTIMIZE_NEW_FIELD_ACCESS: false,
      
      ...initialFlags
    };

    this.state = {
      phase: 'preparation',
      completedSteps: [],
      errorCount: 0,
      startTime: Date.now(),
      lastUpdate: Date.now()
    };

    this.startMonitoring();
  }

  /**
   * Verifica se uma feature está habilitada
   */
  isEnabled(flag: keyof FeatureFlags): boolean {
    return this.flags[flag];
  }

  /**
   * Habilita uma feature com validação
   */
  enableFeature(flag: keyof FeatureFlags, reason: string = ''): boolean {
    console.log(`🚀 [FEATURE FLAGS] Habilitando ${flag}${reason ? ` - ${reason}` : ''}`);
    
    // Verificações de segurança antes de habilitar features críticas
    if (flag === 'ENABLE_LEGACY_FIELD_REMOVAL') {
      if (this.state.errorCount > 0) {
        console.warn(`⚠️ [FEATURE FLAGS] Bloqueando ${flag} - Erros detectados: ${this.state.errorCount}`);
        return false;
      }
      
      if (this.state.phase === 'rollback') {
        console.warn(`⚠️ [FEATURE FLAGS] Bloqueando ${flag} - Sistema em modo rollback`);
        return false;
      }
    }

    this.flags[flag] = true;
    this.updateState();
    return true;
  }

  /**
   * Desabilita uma feature
   */
  disableFeature(flag: keyof FeatureFlags, reason: string = ''): void {
    console.log(`⏹️ [FEATURE FLAGS] Desabilitando ${flag}${reason ? ` - ${reason}` : ''}`);
    this.flags[flag] = false;
    this.updateState();
  }

  /**
   * Avança para próxima fase da migração
   */
  advancePhase(step: string): boolean {
    const phases: MigrationState['phase'][] = ['preparation', 'step1', 'step2', 'step3', 'completed'];
    const currentIndex = phases.indexOf(this.state.phase);
    
    if (currentIndex < phases.length - 1) {
      this.state.phase = phases[currentIndex + 1];
      this.state.completedSteps.push(step);
      this.state.lastUpdate = Date.now();
      
      console.log(`✅ [MIGRATION] Avançando para fase: ${this.state.phase} (${step})`);
      
      // Habilitar features apropriadas para cada fase
      this.configurePhaseFeatures();
      
      return true;
    }
    
    return false;
  }

  /**
   * Configura features apropriadas para cada fase
   */
  private configurePhaseFeatures(): void {
    switch (this.state.phase) {
      case 'preparation':
        this.flags.LOG_LEGACY_USAGE = true;
        this.flags.VALIDATE_NEW_NOMENCLATURE = true;
        break;
        
      case 'step1':
        this.flags.ENABLE_LEGACY_FIELD_REMOVAL = true;
        this.flags.STRICT_LEGACY_VALIDATION = false;
        break;
        
      case 'step2':
        this.flags.STRICT_LEGACY_VALIDATION = true;
        this.flags.BLOCK_LEGACY_WRITES = true;
        break;
        
      case 'step3':
        this.flags.BYPASS_LEGACY_FALLBACKS = true;
        this.flags.OPTIMIZE_NEW_FIELD_ACCESS = true;
        break;
        
      case 'completed':
        // Todas as otimizações habilitadas
        this.flags.BYPASS_LEGACY_FALLBACKS = true;
        this.flags.OPTIMIZE_NEW_FIELD_ACCESS = true;
        this.flags.LOG_LEGACY_USAGE = false;
        break;
    }
  }

  /**
   * Registra erro e verifica se deve fazer rollback
   */
  reportError(error: string, context: string = ''): void {
    this.state.errorCount++;
    this.state.lastError = `${error} ${context ? `(${context})` : ''}`;
    this.state.lastUpdate = Date.now();
    
    console.error(`❌ [MIGRATION ERROR] ${this.state.lastError}`);
    console.error(`📊 [ERROR COUNT] Total: ${this.state.errorCount}/${this.errorThreshold}`);
    
    // Auto-rollback se habilitado e threshold atingido
    if (this.flags.AUTO_ROLLBACK_ON_ERROR && this.state.errorCount >= this.errorThreshold) {
      this.initiateRollback(`Threshold de erros atingido: ${this.state.errorCount}`);
    }
  }

  /**
   * Inicia rollback automático
   */
  initiateRollback(reason: string): void {
    console.warn(`🔄 [ROLLBACK] Iniciando rollback automático: ${reason}`);
    
    this.state.phase = 'rollback';
    this.state.rollbackReason = reason;
    this.state.lastUpdate = Date.now();
    
    // Desabilitar todas as features perigosas
    this.flags.ENABLE_LEGACY_FIELD_REMOVAL = false;
    this.flags.STRICT_LEGACY_VALIDATION = false;
    this.flags.BLOCK_LEGACY_WRITES = false;
    this.flags.BYPASS_LEGACY_FALLBACKS = false;
    
    // Reativar logs para debugging
    this.flags.LOG_LEGACY_USAGE = true;
    this.flags.VALIDATE_NEW_NOMENCLATURE = true;
    
    console.warn(`🚨 [ROLLBACK] Sistema restaurado ao estado seguro`);
  }

  /**
   * Obtém status atual da migração
   */
  getStatus(): {
    phase: string;
    flags: FeatureFlags;
    state: MigrationState;
    isHealthy: boolean;
    recommendations: string[];
  } {
    const isHealthy = this.state.errorCount < this.errorThreshold && this.state.phase !== 'rollback';
    
    const recommendations: string[] = [];
    
    if (this.state.errorCount > 0) {
      recommendations.push(`Investigar ${this.state.errorCount} erros detectados`);
    }
    
    if (this.state.phase === 'rollback') {
      recommendations.push(`Resolver problema que causou rollback: ${this.state.rollbackReason}`);
    }
    
    if (this.flags.LOG_LEGACY_USAGE && this.state.phase === 'completed') {
      recommendations.push('Considerar desabilitar logs de uso legado para otimizar performance');
    }

    return {
      phase: this.state.phase,
      flags: { ...this.flags },
      state: { ...this.state },
      isHealthy,
      recommendations
    };
  }

  /**
   * Inicia monitoramento automático
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const status = this.getStatus();
      
      if (!status.isHealthy) {
        console.warn(`⚠️ [HEALTH CHECK] Sistema não saudável:`, {
          phase: status.phase,
          errors: this.state.errorCount,
          lastError: this.state.lastError
        });
      }
      
      // Log periódico de status (apenas quando há atividade)
      if (Date.now() - this.state.lastUpdate < 300000) { // 5 minutos
        console.log(`📊 [MIGRATION STATUS] Fase: ${this.state.phase}, Erros: ${this.state.errorCount}`);
      }
    }, 60000); // Check a cada minuto
  }

  /**
   * Para monitoramento
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  /**
   * Atualiza timestamp de última atualização
   */
  private updateState(): void {
    this.state.lastUpdate = Date.now();
  }

  /**
   * Reset completo do sistema (use com cuidado!)
   */
  reset(): void {
    console.warn(`🔄 [RESET] Reiniciando sistema de feature flags`);
    
    this.state = {
      phase: 'preparation',
      completedSteps: [],
      errorCount: 0,
      startTime: Date.now(),
      lastUpdate: Date.now()
    };
    
    // Restaurar configuração conservadora
    Object.keys(this.flags).forEach(key => {
      this.flags[key as keyof FeatureFlags] = false;
    });
    
    this.flags.LOG_LEGACY_USAGE = true;
    this.flags.VALIDATE_NEW_NOMENCLATURE = true;
    this.flags.AUTO_ROLLBACK_ON_ERROR = true;
  }
}

/**
 * Instância global do sistema de feature flags
 */
export const migrationFlags = new MigrationFeatureFlags({
  // Configuração inicial conservadora
  LOG_LEGACY_USAGE: true,
  VALIDATE_NEW_NOMENCLATURE: true,
  AUTO_ROLLBACK_ON_ERROR: true
});

/**
 * Utilitários para uso fácil
 */
export const featureFlags = {
  /**
   * Verifica se remoção de campos legados está habilitada
   */
  canRemoveLegacyFields(): boolean {
    return migrationFlags.isEnabled('ENABLE_LEGACY_FIELD_REMOVAL');
  },

  /**
   * Verifica se deve usar validação estrita
   */
  shouldUseStrictValidation(): boolean {
    return migrationFlags.isEnabled('STRICT_LEGACY_VALIDATION');
  },

  /**
   * Verifica se deve fazer log de uso legado
   */
  shouldLogLegacyUsage(): boolean {
    return migrationFlags.isEnabled('LOG_LEGACY_USAGE');
  },

  /**
   * Verifica se deve bloquear escritas legadas
   */
  shouldBlockLegacyWrites(): boolean {
    return migrationFlags.isEnabled('BLOCK_LEGACY_WRITES');
  },

  /**
   * Reporta erro de migração
   */
  reportError(error: string, context?: string): void {
    migrationFlags.reportError(error, context);
  },

  /**
   * Obtém status de saúde do sistema
   */
  getHealthStatus() {
    return migrationFlags.getStatus();
  }
};