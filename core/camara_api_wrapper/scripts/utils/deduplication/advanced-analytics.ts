/**
 * Análise Avançada de Dados para Detecção de Padrões Suspeitos
 * Funcionalidades extras para melhorar o sistema de deduplicação
 */

import { IntegrityController, DeduplicationResult } from './integrity-controller.js';
import { logger } from '../logging/index.js';

export interface SuspiciousPattern {
  type: 'TEMPORAL' | 'MONETARY' | 'BEHAVIORAL' | 'STRUCTURAL';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  affectedRecords: string[];
  confidence: number; // 0-100
  suggestedAction: string;
  metadata: Record<string, any>;
}

export interface DataQualityMetrics {
  completeness: number; // % de campos preenchidos
  consistency: number; // % de dados consistentes
  accuracy: number; // % de dados precisos
  timeliness: number; // % de dados atuais
  validity: number; // % de dados válidos
  uniqueness: number; // % de dados únicos
  overallScore: number; // Score geral de qualidade
}

export interface CrossReferenceAnalysis {
  deputadoFornecedorInconsistencies: Array<{
    deputadoId: string;
    cnpjCpfFornecedor: string;
    issue: string;
    severity: string;
  }>;
  temporalAnomalies: Array<{
    recordId: string;
    anomalyType: string;
    expectedValue: any;
    actualValue: any;
  }>;
  monetaryOutliers: Array<{
    recordId: string;
    value: number;
    zScore: number;
    percentile: number;
  }>;
}

export class AdvancedAnalytics {
  private suspiciousPatterns: SuspiciousPattern[] = [];
  private qualityMetrics: DataQualityMetrics | null = null;
  private crossReferenceResults: CrossReferenceAnalysis | null = null;

  /**
   * Análise completa de padrões suspeitos
   */
  async analyzeDataPatterns<T>(
    data: T[],
    deduplicationResult: DeduplicationResult<T>,
    operationName: string
  ): Promise<SuspiciousPattern[]> {
    logger.info(`🔍 [Analytics] Iniciando análise de padrões suspeitos para ${operationName}`);
    
    this.suspiciousPatterns = [];
    
    // Análise temporal
    await this.analyzeTemporalPatterns(data, operationName);
    
    // Análise monetária
    await this.analyzeMonetaryPatterns(data, operationName);
    
    // Análise comportamental
    await this.analyzeBehavioralPatterns(data, deduplicationResult, operationName);
    
    // Análise estrutural
    await this.analyzeStructuralPatterns(data, operationName);
    
    // Log resultados
    const criticalPatterns = this.suspiciousPatterns.filter(p => p.severity === 'CRITICAL');
    const highPatterns = this.suspiciousPatterns.filter(p => p.severity === 'HIGH');
    
    logger.info(`🔍 [Analytics] Análise concluída para ${operationName}:`);
    logger.info(`  • Padrões críticos: ${criticalPatterns.length}`);
    logger.info(`  • Padrões de alto risco: ${highPatterns.length}`);
    logger.info(`  • Total de padrões: ${this.suspiciousPatterns.length}`);
    
    return this.suspiciousPatterns;
  }

  /**
   * Análise temporal de padrões
   */
  private async analyzeTemporalPatterns<T>(data: T[], operationName: string): Promise<void> {
    const recordsWithDates = data.filter((record: any) => record.dataDocumento);
    
    if (recordsWithDates.length === 0) return;
    
    // Detectar clusters temporais suspeitos
    const dateGroups = new Map<string, T[]>();
    recordsWithDates.forEach((record: any) => {
      const date = new Date(record.dataDocumento).toDateString();
      if (!dateGroups.has(date)) {
        dateGroups.set(date, []);
      }
      dateGroups.get(date)!.push(record);
    });
    
    // Identificar dias com volume anormal
    const avgPerDay = recordsWithDates.length / dateGroups.size;
    const threshold = avgPerDay * 3; // 3x a média
    
    for (const [date, records] of dateGroups) {
      if (records.length > threshold) {
        this.suspiciousPatterns.push({
          type: 'TEMPORAL',
          severity: 'HIGH',
          description: `Volume anormal de transações em ${date}`,
          affectedRecords: records.map((r: any) => r.id || r.numeroDocumento).filter(Boolean),
          confidence: 85,
          suggestedAction: 'Verificar se houve processamento em lote suspeito',
          metadata: {
            date,
            recordCount: records.length,
            averagePerDay: avgPerDay,
            threshold
          }
        });
      }
    }
    
    // Detectar padrões de fim de mês
    const endOfMonthPattern = recordsWithDates.filter((record: any) => {
      const date = new Date(record.dataDocumento);
      const day = date.getDate();
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      return day >= lastDay - 2; // Últimos 2 dias do mês
    });
    
    if (endOfMonthPattern.length > recordsWithDates.length * 0.3) {
      this.suspiciousPatterns.push({
        type: 'TEMPORAL',
        severity: 'MEDIUM',
        description: 'Concentração suspeita de transações no fim do mês',
        affectedRecords: endOfMonthPattern.map((r: any) => r.id || r.numeroDocumento).filter(Boolean),
        confidence: 70,
        suggestedAction: 'Investigar possível manipulação de prazos',
        metadata: {
          endOfMonthCount: endOfMonthPattern.length,
          totalRecords: recordsWithDates.length,
          percentage: (endOfMonthPattern.length / recordsWithDates.length) * 100
        }
      });
    }
  }

  /**
   * Análise monetária de padrões
   */
  private async analyzeMonetaryPatterns<T>(data: T[], operationName: string): Promise<void> {
    const recordsWithValues = data.filter((record: any) => 
      record.valorLiquido !== undefined && record.valorLiquido !== null
    );
    
    if (recordsWithValues.length === 0) return;
    
    const values = recordsWithValues.map((record: any) => record.valorLiquido);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Detectar valores redondos suspeitos
    const roundValues = values.filter(v => v % 100 === 0 || v % 1000 === 0);
    if (roundValues.length > values.length * 0.4) {
      this.suspiciousPatterns.push({
        type: 'MONETARY',
        severity: 'HIGH',
        description: 'Percentual anormal de valores redondos',
        affectedRecords: recordsWithValues
          .filter((r: any) => r.valorLiquido % 100 === 0 || r.valorLiquido % 1000 === 0)
          .map((r: any) => r.id || r.numeroDocumento)
          .filter(Boolean),
        confidence: 80,
        suggestedAction: 'Verificar se valores foram manipulados',
        metadata: {
          roundValuesCount: roundValues.length,
          totalValues: values.length,
          percentage: (roundValues.length / values.length) * 100
        }
      });
    }
    
    // Detectar outliers monetários
    const outliers = recordsWithValues.filter((record: any) => {
      const zScore = Math.abs(record.valorLiquido - mean) / stdDev;
      return zScore > 3; // 3 desvios padrão
    });
    
    if (outliers.length > 0) {
      this.suspiciousPatterns.push({
        type: 'MONETARY',
        severity: 'MEDIUM',
        description: 'Valores monetários outliers detectados',
        affectedRecords: outliers.map((r: any) => r.id || r.numeroDocumento).filter(Boolean),
        confidence: 75,
        suggestedAction: 'Validar valores extremos',
        metadata: {
          outliersCount: outliers.length,
          mean: mean,
          stdDev: stdDev,
          threshold: 3
        }
      });
    }
    
    // Detectar fragmentação suspeita
    const fragmentationPattern = this.detectFragmentation(recordsWithValues);
    if (fragmentationPattern.length > 0) {
      this.suspiciousPatterns.push({
        type: 'MONETARY',
        severity: 'CRITICAL',
        description: 'Possível fragmentação para evitar limites',
        affectedRecords: fragmentationPattern.map((r: any) => r.id || r.numeroDocumento).filter(Boolean),
        confidence: 90,
        suggestedAction: 'Investigar possível evasão de limites',
        metadata: {
          fragmentationGroups: fragmentationPattern.length,
          suspiciousPattern: true
        }
      });
    }
  }

  /**
   * Análise comportamental de padrões
   */
  private async analyzeBehavioralPatterns<T>(
    data: T[],
    deduplicationResult: DeduplicationResult<T>,
    operationName: string
  ): Promise<void> {
    // Analisar padrões de duplicação
    const duplicatePatterns = deduplicationResult.duplicateDetails;
    
    // Detectar duplicações sistemáticas
    const systematicDuplicates = duplicatePatterns.filter(d => 
      d.conflictFields.length > 3 && d.severity === 'HIGH'
    );
    
    if (systematicDuplicates.length > 5) {
      this.suspiciousPatterns.push({
        type: 'BEHAVIORAL',
        severity: 'HIGH',
        description: 'Padrão sistemático de duplicações',
        affectedRecords: systematicDuplicates.map(d => d.duplicateKey),
        confidence: 85,
        suggestedAction: 'Investigar possível manipulação intencional',
        metadata: {
          systematicCount: systematicDuplicates.length,
          totalDuplicates: duplicatePatterns.length
        }
      });
    }
    
    // Analisar padrões de fornecedores
    const fornecedorPatterns = this.analyzeFornecedorPatterns(data);
    this.suspiciousPatterns.push(...fornecedorPatterns);
  }

  /**
   * Análise estrutural de padrões
   */
  private async analyzeStructuralPatterns<T>(data: T[], operationName: string): Promise<void> {
    // Analisar completude dos dados
    const completeness = this.calculateCompleteness(data);
    
    if (completeness < 0.8) {
      this.suspiciousPatterns.push({
        type: 'STRUCTURAL',
        severity: 'MEDIUM',
        description: 'Baixa completude dos dados',
        affectedRecords: [],
        confidence: 70,
        suggestedAction: 'Verificar fonte de dados',
        metadata: {
          completeness: completeness,
          threshold: 0.8
        }
      });
    }
    
    // Analisar consistência de formatos
    const inconsistentFormats = this.detectFormatInconsistencies(data);
    if (inconsistentFormats.length > 0) {
      this.suspiciousPatterns.push({
        type: 'STRUCTURAL',
        severity: 'LOW',
        description: 'Inconsistências de formato detectadas',
        affectedRecords: inconsistentFormats,
        confidence: 60,
        suggestedAction: 'Padronizar formatos de dados',
        metadata: {
          inconsistentCount: inconsistentFormats.length
        }
      });
    }
  }

  /**
   * Detecta fragmentação suspeita
   */
  private detectFragmentation(records: any[]): any[] {
    const fragmentationCandidates: any[] = [];
    
    // Agrupar por fornecedor e deputado
    const groups = new Map<string, any[]>();
    records.forEach(record => {
      const key = `${record.deputadoId}_${record.cnpjCpfFornecedor}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(record);
    });
    
    // Analisar cada grupo
    for (const [key, groupRecords] of groups) {
      if (groupRecords.length < 3) continue;
      
      // Verificar se há valores similares em período curto
      const sortedByDate = groupRecords.sort((a, b) => 
        new Date(a.dataDocumento).getTime() - new Date(b.dataDocumento).getTime()
      );
      
      for (let i = 0; i < sortedByDate.length - 2; i++) {
        const record1 = sortedByDate[i];
        const record2 = sortedByDate[i + 1];
        const record3 = sortedByDate[i + 2];
        
        const date1 = new Date(record1.dataDocumento);
        const date2 = new Date(record2.dataDocumento);
        const date3 = new Date(record3.dataDocumento);
        
        // Verificar se as transações são próximas no tempo
        const timeDiff1 = Math.abs(date2.getTime() - date1.getTime());
        const timeDiff2 = Math.abs(date3.getTime() - date2.getTime());
        
        if (timeDiff1 < 24 * 60 * 60 * 1000 && timeDiff2 < 24 * 60 * 60 * 1000) {
          // Verificar se os valores são similares
          const value1 = record1.valorLiquido;
          const value2 = record2.valorLiquido;
          const value3 = record3.valorLiquido;
          
          const avgValue = (value1 + value2 + value3) / 3;
          const threshold = avgValue * 0.1; // 10% de variação
          
          if (Math.abs(value1 - avgValue) < threshold &&
              Math.abs(value2 - avgValue) < threshold &&
              Math.abs(value3 - avgValue) < threshold) {
            fragmentationCandidates.push(record1, record2, record3);
          }
        }
      }
    }
    
    return fragmentationCandidates;
  }

  /**
   * Analisa padrões de fornecedores
   */
  private analyzeFornecedorPatterns(data: any[]): SuspiciousPattern[] {
    const patterns: SuspiciousPattern[] = [];
    
    // Agrupar por fornecedor
    const fornecedorGroups = new Map<string, any[]>();
    data.forEach(record => {
      if (record.cnpjCpfFornecedor) {
        if (!fornecedorGroups.has(record.cnpjCpfFornecedor)) {
          fornecedorGroups.set(record.cnpjCpfFornecedor, []);
        }
        fornecedorGroups.get(record.cnpjCpfFornecedor)!.push(record);
      }
    });
    
    // Analisar cada fornecedor
    for (const [cnpj, records] of fornecedorGroups) {
      // Verificar concentração em poucos deputados
      const deputadosUnicos = new Set(records.map(r => r.deputadoId));
      const totalValue = records.reduce((sum, r) => sum + r.valorLiquido, 0);
      
      if (deputadosUnicos.size <= 2 && totalValue > 100000) {
        patterns.push({
          type: 'BEHAVIORAL',
          severity: 'HIGH',
          description: `Fornecedor ${cnpj} concentrado em poucos deputados`,
          affectedRecords: records.map(r => r.id || r.numeroDocumento).filter(Boolean),
          confidence: 85,
          suggestedAction: 'Investigar possível concentração suspeita',
          metadata: {
            cnpjCpfFornecedor: cnpj,
            deputadosCount: deputadosUnicos.size,
            totalValue: totalValue,
            recordsCount: records.length
          }
        });
      }
    }
    
    return patterns;
  }

  /**
   * Calcula completude dos dados
   */
  private calculateCompleteness(data: any[]): number {
    if (data.length === 0) return 0;
    
    const requiredFields = ['id', 'valorLiquido', 'dataDocumento', 'deputadoId'];
    let totalFields = 0;
    let filledFields = 0;
    
    data.forEach(record => {
      requiredFields.forEach(field => {
        totalFields++;
        if (record[field] !== null && record[field] !== undefined && record[field] !== '') {
          filledFields++;
        }
      });
    });
    
    return filledFields / totalFields;
  }

  /**
   * Detecta inconsistências de formato
   */
  private detectFormatInconsistencies(data: any[]): string[] {
    const inconsistent: string[] = [];
    
    data.forEach(record => {
      // Verificar formato de CNPJ
      if (record.cnpjCpfFornecedor && record.cnpjCpfFornecedor.length !== 14) {
        inconsistent.push(record.id || record.numeroDocumento);
      }
      
      // Verificar formato de data
      if (record.dataDocumento && isNaN(new Date(record.dataDocumento).getTime())) {
        inconsistent.push(record.id || record.numeroDocumento);
      }
    });
    
    return [...new Set(inconsistent)];
  }

  /**
   * Calcula métricas de qualidade de dados
   */
  calculateDataQuality<T>(data: T[], deduplicationResult: DeduplicationResult<T>): DataQualityMetrics {
    const completeness = this.calculateCompleteness(data);
    const consistency = this.calculateConsistency(data);
    const accuracy = this.calculateAccuracy(data);
    const timeliness = this.calculateTimeliness(data);
    const validity = this.calculateValidity(data);
    const uniqueness = 1 - (deduplicationResult.duplicatesFound / (data.length + deduplicationResult.duplicatesFound));
    
    const overallScore = (completeness + consistency + accuracy + timeliness + validity + uniqueness) / 6;
    
    this.qualityMetrics = {
      completeness,
      consistency,
      accuracy,
      timeliness,
      validity,
      uniqueness,
      overallScore
    };
    
    return this.qualityMetrics;
  }

  /**
   * Calcula consistência dos dados
   */
  private calculateConsistency(data: any[]): number {
    let consistentRecords = 0;
    
    data.forEach(record => {
      let consistent = true;
      
      // Verificar se valor documento >= valor líquido
      if (record.valorDocumento && record.valorLiquido && 
          record.valorDocumento < record.valorLiquido) {
        consistent = false;
      }
      
      // Verificar se data está dentro do período esperado
      if (record.dataDocumento) {
        const date = new Date(record.dataDocumento);
        const currentYear = new Date().getFullYear();
        if (date.getFullYear() < 2020 || date.getFullYear() > currentYear) {
          consistent = false;
        }
      }
      
      if (consistent) {
        consistentRecords++;
      }
    });
    
    return data.length > 0 ? consistentRecords / data.length : 0;
  }

  /**
   * Calcula precisão dos dados
   */
  private calculateAccuracy(data: any[]): number {
    let accurateRecords = 0;
    
    data.forEach(record => {
      let accurate = true;
      
      // Verificar formato de CNPJ
      if (record.cnpjCpfFornecedor) {
        const cnpj = record.cnpjCpfFornecedor.replace(/\D/g, '');
        if (cnpj.length !== 14) {
          accurate = false;
        }
      }
      
      // Verificar valores monetários
      if (record.valorLiquido && (record.valorLiquido < 0 || record.valorLiquido > 1000000)) {
        accurate = false;
      }
      
      if (accurate) {
        accurateRecords++;
      }
    });
    
    return data.length > 0 ? accurateRecords / data.length : 0;
  }

  /**
   * Calcula atualidade dos dados
   */
  private calculateTimeliness(data: any[]): number {
    const currentDate = new Date();
    let timelyRecords = 0;
    
    data.forEach(record => {
      if (record.dataDocumento) {
        const recordDate = new Date(record.dataDocumento);
        const diffMonths = (currentDate.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
        
        if (diffMonths <= 12) { // Dados dos últimos 12 meses
          timelyRecords++;
        }
      }
    });
    
    return data.length > 0 ? timelyRecords / data.length : 0;
  }

  /**
   * Calcula validade dos dados
   */
  private calculateValidity(data: any[]): number {
    let validRecords = 0;
    
    data.forEach(record => {
      let valid = true;
      
      // Verificar se campos obrigatórios estão preenchidos
      const requiredFields = ['id', 'valorLiquido', 'dataDocumento', 'deputadoId'];
      requiredFields.forEach(field => {
        if (!record[field] || record[field] === '') {
          valid = false;
        }
      });
      
      if (valid) {
        validRecords++;
      }
    });
    
    return data.length > 0 ? validRecords / data.length : 0;
  }

  /**
   * Análise cruzada de referências
   */
  performCrossReferenceAnalysis(
    deputados: any[],
    fornecedores: any[],
    despesas: any[]
  ): CrossReferenceAnalysis {
    const deputadoFornecedorInconsistencies: any[] = [];
    const temporalAnomalies: any[] = [];
    const monetaryOutliers: any[] = [];
    
    // Detectar inconsistências deputado-fornecedor
    const deputadosIds = new Set(deputados.map(d => d.id));
    const fornecedoresCnpjs = new Set(fornecedores.map(f => f.cnpj));
    
    despesas.forEach(despesa => {
      if (!deputadosIds.has(despesa.deputadoId)) {
        deputadoFornecedorInconsistencies.push({
          deputadoId: despesa.deputadoId,
          cnpjCpfFornecedor: despesa.cnpjCpfFornecedor,
          issue: 'Deputado não encontrado',
          severity: 'HIGH'
        });
      }
      
      if (despesa.cnpjCpfFornecedor && !fornecedoresCnpjs.has(despesa.cnpjCpfFornecedor)) {
        deputadoFornecedorInconsistencies.push({
          deputadoId: despesa.deputadoId,
          cnpjCpfFornecedor: despesa.cnpjCpfFornecedor,
          issue: 'Fornecedor não encontrado',
          severity: 'MEDIUM'
        });
      }
    });
    
    // Detectar anomalias temporais
    despesas.forEach(despesa => {
      const date = new Date(despesa.dataDocumento);
      const expectedYear = new Date().getFullYear();
      
      if (date.getFullYear() > expectedYear) {
        temporalAnomalies.push({
          recordId: despesa.id,
          anomalyType: 'FUTURE_DATE',
          expectedValue: expectedYear,
          actualValue: date.getFullYear()
        });
      }
    });
    
    // Detectar outliers monetários
    const values = despesas.map(d => d.valorLiquido);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    despesas.forEach(despesa => {
      const zScore = Math.abs(despesa.valorLiquido - mean) / stdDev;
      if (zScore > 3) {
        monetaryOutliers.push({
          recordId: despesa.id,
          value: despesa.valorLiquido,
          zScore: zScore,
          percentile: this.calculatePercentile(values, despesa.valorLiquido)
        });
      }
    });
    
    this.crossReferenceResults = {
      deputadoFornecedorInconsistencies,
      temporalAnomalies,
      monetaryOutliers
    };
    
    return this.crossReferenceResults;
  }

  /**
   * Calcula percentil de um valor
   */
  private calculatePercentile(values: number[], value: number): number {
    const sorted = values.sort((a, b) => a - b);
    const index = sorted.indexOf(value);
    return (index / sorted.length) * 100;
  }

  /**
   * Gera relatório completo de análise
   */
  generateAdvancedReport(): {
    suspiciousPatterns: SuspiciousPattern[];
    dataQuality: DataQualityMetrics | null;
    crossReference: CrossReferenceAnalysis | null;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    
    // Recomendações baseadas em padrões suspeitos
    const criticalPatterns = this.suspiciousPatterns.filter(p => p.severity === 'CRITICAL');
    if (criticalPatterns.length > 0) {
      recommendations.push('Investigar imediatamente padrões críticos detectados');
    }
    
    // Recomendações baseadas em qualidade
    if (this.qualityMetrics && this.qualityMetrics.overallScore < 0.8) {
      recommendations.push('Melhorar qualidade dos dados na fonte');
    }
    
    // Recomendações baseadas em referências cruzadas
    if (this.crossReferenceResults && this.crossReferenceResults.deputadoFornecedorInconsistencies.length > 0) {
      recommendations.push('Corrigir inconsistências entre deputados e fornecedores');
    }
    
    return {
      suspiciousPatterns: this.suspiciousPatterns,
      dataQuality: this.qualityMetrics,
      crossReference: this.crossReferenceResults,
      recommendations
    };
  }
}