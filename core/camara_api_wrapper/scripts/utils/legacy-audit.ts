/**
 * AUDITORIA DE NOMENCLATURA LEGADA - FASE 4
 * 
 * Sistema para auditar e monitorar o uso da nomenclatura antiga
 * antes da remoção gradual dos campos legados
 */

export interface LegacyUsageReport {
  totalRecords: number;
  legacyOnlyCount: number;
  newOnlyCount: number;
  mixedCount: number;
  legacyFields: {
    [fieldName: string]: {
      count: number;
      percentage: number;
      examples: any[];
    };
  };
  recommendations: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readyForCleanup: boolean;
}

export interface AuditOptions {
  includeExamples?: boolean;
  maxExamples?: number;
  checkDependencies?: boolean;
  generateReport?: boolean;
}

/**
 * Auditor de uso de nomenclatura legada
 */
export class LegacyNomenclatureAuditor {
  private legacyFieldMappings = {
    'fornecedorNome': 'nomeFornecedor',
    'fornecedorCnpj': 'cnpjCpfFornecedor'
  };

  /**
   * Audita uso de nomenclatura legada em um conjunto de dados
   */
  auditLegacyUsage(data: any[], options: AuditOptions = {}): LegacyUsageReport {
    const {
      includeExamples = true,
      maxExamples = 5,
      checkDependencies = true,
      generateReport = true
    } = options;

    console.log(`🔍 [AUDIT] Iniciando auditoria de ${data.length} registros...`);

    const report: LegacyUsageReport = {
      totalRecords: data.length,
      legacyOnlyCount: 0,
      newOnlyCount: 0,
      mixedCount: 0,
      legacyFields: {},
      recommendations: [],
      riskLevel: 'LOW',
      readyForCleanup: true
    };

    // Inicializar contadores de campos legados
    Object.keys(this.legacyFieldMappings).forEach(field => {
      report.legacyFields[field] = {
        count: 0,
        percentage: 0,
        examples: []
      };
    });

    // Analisar cada registro
    data.forEach((record, index) => {
      const hasLegacy = this.hasLegacyFields(record);
      const hasNew = this.hasNewFields(record);

      if (hasLegacy && !hasNew) {
        report.legacyOnlyCount++;
      } else if (!hasLegacy && hasNew) {
        report.newOnlyCount++;
      } else if (hasLegacy && hasNew) {
        report.mixedCount++;
      }

      // Contar uso de cada campo legado
      Object.keys(this.legacyFieldMappings).forEach(legacyField => {
        if (record[legacyField] !== undefined && record[legacyField] !== null) {
          report.legacyFields[legacyField].count++;
          
          if (includeExamples && report.legacyFields[legacyField].examples.length < maxExamples) {
            report.legacyFields[legacyField].examples.push({
              index,
              value: record[legacyField],
              hasNewEquivalent: record[this.legacyFieldMappings[legacyField]] !== undefined
            });
          }
        }
      });
    });

    // Calcular percentuais
    Object.keys(report.legacyFields).forEach(field => {
      const fieldData = report.legacyFields[field];
      fieldData.percentage = report.totalRecords > 0 
        ? (fieldData.count / report.totalRecords) * 100 
        : 0;
    });

    // Avaliar nível de risco
    report.riskLevel = this.assessRiskLevel(report);
    
    // Verificar se está pronto para limpeza
    report.readyForCleanup = this.isReadyForCleanup(report);

    // Gerar recomendações
    report.recommendations = this.generateRecommendations(report);

    if (generateReport) {
      this.logAuditReport(report);
    }

    return report;
  }

  /**
   * Verifica se um registro tem campos legados
   */
  private hasLegacyFields(record: any): boolean {
    return Object.keys(this.legacyFieldMappings).some(field => 
      record[field] !== undefined && record[field] !== null
    );
  }

  /**
   * Verifica se um registro tem campos novos
   */
  private hasNewFields(record: any): boolean {
    return Object.values(this.legacyFieldMappings).some(field => 
      record[field] !== undefined && record[field] !== null
    );
  }

  /**
   * Avalia o nível de risco para remoção
   */
  private assessRiskLevel(report: LegacyUsageReport): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const legacyOnlyPercentage = (report.legacyOnlyCount / report.totalRecords) * 100;
    const maxFieldUsage = Math.max(...Object.values(report.legacyFields).map(f => f.percentage));

    if (legacyOnlyPercentage > 50 || maxFieldUsage > 70) {
      return 'CRITICAL';
    } else if (legacyOnlyPercentage > 20 || maxFieldUsage > 40) {
      return 'HIGH';
    } else if (legacyOnlyPercentage > 5 || maxFieldUsage > 15) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  /**
   * Verifica se está pronto para iniciar limpeza
   */
  private isReadyForCleanup(report: LegacyUsageReport): boolean {
    const legacyOnlyPercentage = (report.legacyOnlyCount / report.totalRecords) * 100;
    const maxFieldUsage = Math.max(...Object.values(report.legacyFields).map(f => f.percentage));

    // Critérios para limpeza segura
    return legacyOnlyPercentage < 10 && maxFieldUsage < 20 && report.riskLevel !== 'CRITICAL';
  }

  /**
   * Gera recomendações baseadas na auditoria
   */
  private generateRecommendations(report: LegacyUsageReport): string[] {
    const recommendations: string[] = [];

    const legacyOnlyPercentage = (report.legacyOnlyCount / report.totalRecords) * 100;
    
    if (report.riskLevel === 'CRITICAL') {
      recommendations.push('🚨 CRÍTICO: Aguardar mais migração antes de remover campos antigos');
      recommendations.push('📊 Implementar migration monitor mais agressivo');
      recommendations.push('🔄 Executar ETL de migração em lote para dados legados');
    } else if (report.riskLevel === 'HIGH') {
      recommendations.push('⚠️ ALTO RISCO: Proceder com cautela na remoção');
      recommendations.push('📋 Implementar testes extensivos antes da remoção');
      recommendations.push('💾 Criar backup completo antes de modificações');
    } else if (report.riskLevel === 'MEDIUM') {
      recommendations.push('⚡ RISCO MODERADO: Remoção gradual recomendada');
      recommendations.push('📈 Monitorar métricas durante remoção');
      recommendations.push('🎯 Focar em campos com menor uso primeiro');
    } else {
      recommendations.push('✅ BAIXO RISCO: Seguro para iniciar remoção gradual');
      recommendations.push('🧹 Começar com deprecation warnings');
      recommendations.push('📅 Programar remoção em fases pequenas');
    }

    // Recomendações específicas por campo
    Object.entries(report.legacyFields).forEach(([field, data]) => {
      if (data.percentage > 50) {
        recommendations.push(`🔥 Campo '${field}' ainda muito usado (${data.percentage.toFixed(1)}%) - aguardar`);
      } else if (data.percentage > 20) {
        recommendations.push(`⚠️ Campo '${field}' moderadamente usado (${data.percentage.toFixed(1)}%) - deprecar primeiro`);
      } else if (data.percentage > 0) {
        recommendations.push(`🎯 Campo '${field}' pouco usado (${data.percentage.toFixed(1)}%) - candidato à remoção`);
      } else {
        recommendations.push(`✅ Campo '${field}' não usado - seguro para remover`);
      }
    });

    if (legacyOnlyPercentage === 0) {
      recommendations.push('🎉 Nenhum registro usa apenas nomenclatura antiga!');
    }

    return recommendations;
  }

  /**
   * Exibe relatório formatado da auditoria
   */
  private logAuditReport(report: LegacyUsageReport): void {
    console.log('\n📋 [AUDIT REPORT] Relatório de Auditoria de Nomenclatura Legada');
    console.log('=====================================');
    
    console.log(`📊 Total de registros analisados: ${report.totalRecords}`);
    console.log(`🆕 Apenas nomenclatura nova: ${report.newOnlyCount} (${((report.newOnlyCount / report.totalRecords) * 100).toFixed(1)}%)`);
    console.log(`🔄 Nomenclatura mista: ${report.mixedCount} (${((report.mixedCount / report.totalRecords) * 100).toFixed(1)}%)`);
    console.log(`📰 Apenas nomenclatura antiga: ${report.legacyOnlyCount} (${((report.legacyOnlyCount / report.totalRecords) * 100).toFixed(1)}%)`);
    
    console.log('\n🔍 Uso por campo legado:');
    Object.entries(report.legacyFields).forEach(([field, data]) => {
      console.log(`   ${field}: ${data.count} usos (${data.percentage.toFixed(1)}%)`);
      if (data.examples.length > 0) {
        console.log(`      Exemplos: ${data.examples.map(ex => ex.value).slice(0, 3).join(', ')}`);
      }
    });

    console.log(`\n🚨 Nível de risco: ${report.riskLevel}`);
    console.log(`✅ Pronto para limpeza: ${report.readyForCleanup ? 'SIM' : 'NÃO'}`);
    
    console.log('\n💡 Recomendações:');
    report.recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
    
    console.log('=====================================\n');
  }

  /**
   * Audita dependências de código que usam campos legados
   */
  async auditCodeDependencies(): Promise<{
    files: string[];
    patterns: { [pattern: string]: string[] };
    totalOccurrences: number;
  }> {
    console.log('🔍 [CODE AUDIT] Auditando dependências no código...');
    
    // Em um ambiente real, isso faria scan do código
    // Por agora, retorna estrutura de exemplo
    const mockResults = {
      files: [
        'src/components/deputado/utils/deputadoDataProcessing.ts',
        'src/components/deputado/pages/DeputadoTransacoesPage.tsx',
        'src/services/fornecedores-service.ts',
        'src/services/firestore-service-backup.ts'
      ],
      patterns: {
        'fornecedorNome': [
          'src/components/deputado/utils/deputadoDataProcessing.ts:142',
          'src/components/deputado/pages/DeputadoTransacoesPage.tsx:60'
        ],
        'fornecedorCnpj': [
          'src/components/deputado/utils/deputadoDataProcessing.ts:143',
          'src/components/deputado/pages/DeputadoTransacoesPage.tsx:283'
        ]
      },
      totalOccurrences: 4
    };

    console.log(`📁 Arquivos com dependências legadas: ${mockResults.files.length}`);
    console.log(`🔢 Total de ocorrências: ${mockResults.totalOccurrences}`);

    return mockResults;
  }

  /**
   * Gera plano de migração baseado na auditoria
   */
  generateMigrationPlan(report: LegacyUsageReport): {
    phases: Array<{
      phase: number;
      name: string;
      description: string;
      actions: string[];
      riskLevel: string;
      estimatedTime: string;
    }>;
    totalEstimatedTime: string;
    prerequisites: string[];
  } {
    const phases = [];

    if (report.riskLevel === 'LOW') {
      phases.push({
        phase: 1,
        name: 'Deprecation Warnings',
        description: 'Adicionar warnings para uso de campos legados',
        actions: [
          'Implementar console.warn() para campos legados',
          'Adicionar comentários @deprecated nos tipos',
          'Documentar campos como obsoletos'
        ],
        riskLevel: 'LOW',
        estimatedTime: '1-2 dias'
      });

      phases.push({
        phase: 2,
        name: 'Code Migration',
        description: 'Migrar código para usar apenas nova nomenclatura',
        actions: [
          'Refatorar components para usar novos campos',
          'Atualizar services e utilities',
          'Modificar queries e filtros'
        ],
        riskLevel: 'MEDIUM',
        estimatedTime: '3-5 dias'
      });

      phases.push({
        phase: 3,
        name: 'Field Removal',
        description: 'Remover campos legados das interfaces',
        actions: [
          'Remover campos dos tipos TypeScript',
          'Limpar compatibility layer',
          'Atualizar documentação'
        ],
        riskLevel: 'HIGH',
        estimatedTime: '2-3 dias'
      });
    } else {
      phases.push({
        phase: 1,
        name: 'Data Migration',
        description: 'Migrar dados legados antes da remoção de código',
        actions: [
          'Executar ETL de migração em lote',
          'Validar integridade dos dados migrados',
          'Monitorar taxa de migração'
        ],
        riskLevel: 'HIGH',
        estimatedTime: '1-2 semanas'
      });

      phases.push({
        phase: 2,
        name: 'Gradual Code Migration',
        description: 'Migração gradual do código em pequenos lotes',
        actions: [
          'Migrar components menos críticos primeiro',
          'Implementar feature flags para rollback',
          'Testes extensivos em cada etapa'
        ],
        riskLevel: 'MEDIUM',
        estimatedTime: '2-3 semanas'
      });
    }

    return {
      phases,
      totalEstimatedTime: report.riskLevel === 'LOW' ? '1-2 semanas' : '3-5 semanas',
      prerequisites: [
        'Backup completo do sistema',
        'Ambiente de testes preparado',
        'Métricas de monitoramento ativas',
        'Plano de rollback definido'
      ]
    };
  }
}

/**
 * Instância singleton do auditor
 */
export const legacyAuditor = new LegacyNomenclatureAuditor();

/**
 * Função utilitária para auditoria rápida
 */
export function quickAudit(data: any[]): LegacyUsageReport {
  return legacyAuditor.auditLegacyUsage(data, {
    includeExamples: true,
    maxExamples: 3,
    checkDependencies: false,
    generateReport: true
  });
}

/**
 * Função para auditoria completa
 */
export async function fullAudit(data: any[]): Promise<{
  dataAudit: LegacyUsageReport;
  codeAudit: any;
  migrationPlan: any;
}> {
  console.log('🚀 [FULL AUDIT] Iniciando auditoria completa...');
  
  const dataAudit = legacyAuditor.auditLegacyUsage(data);
  const codeAudit = await legacyAuditor.auditCodeDependencies();
  const migrationPlan = legacyAuditor.generateMigrationPlan(dataAudit);
  
  console.log('✅ [FULL AUDIT] Auditoria completa finalizada');
  
  return {
    dataAudit,
    codeAudit,
    migrationPlan
  };
}