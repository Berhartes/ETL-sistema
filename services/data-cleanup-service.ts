/**
 * Serviço de Limpeza de Dados Históricos
 * 
 * Responsável por identificar e corrigir dados inconsistentes
 * que já existem no Firestore, especialmente "relacionamentos fantasmas"
 */

import { collection, getDocs, query, where, writeBatch, doc, limit as firestoreLimit, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { dataValidationService, type SupplierProfile } from './data-validation-service.js';

export interface CleanupResult {
  totalAnalyzed: number;
  totalCleaned: number;
  totalErrors: number;
  removedRelationships: number;
  correctedProfiles: string[];
  errors: string[];
  executionTime: number;
}

export interface CleanupOptions {
  dryRun?: boolean;
  batchSize?: number;
  maxProfiles?: number;
  onlyWithIssues?: boolean;
  backupBeforeCleanup?: boolean;
}

export class DataCleanupService {
  private static instance: DataCleanupService;
  
  private constructor() {}
  
  public static getInstance(): DataCleanupService {
    if (!DataCleanupService.instance) {
      DataCleanupService.instance = new DataCleanupService();
    }
    return DataCleanupService.instance;
  }

  /**
   * Executa limpeza completa dos dados históricos
   */
  async executeFullCleanup(options: CleanupOptions = {}): Promise<CleanupResult> {
    const startTime = Date.now();
    const opts = {
      dryRun: false,
      batchSize: 50,
      maxProfiles: 1000,
      onlyWithIssues: true,
      backupBeforeCleanup: true,
      ...options
    };

    console.log('🧹 INICIANDO LIMPEZA DE DADOS HISTÓRICOS');
    console.log('=' .repeat(50));
    console.log(`📊 Configurações:`);
    console.log(`   • Modo: ${opts.dryRun ? 'DRY-RUN (sem alterações)' : 'EXECUÇÃO REAL'}`);
    console.log(`   • Batch size: ${opts.batchSize}`);
    console.log(`   • Máx. perfis: ${opts.maxProfiles}`);
    console.log(`   • Apenas com problemas: ${opts.onlyWithIssues}`);
    console.log('=' .repeat(50));

    const result: CleanupResult = {
      totalAnalyzed: 0,
      totalCleaned: 0,
      totalErrors: 0,
      removedRelationships: 0,
      correctedProfiles: [],
      errors: [],
      executionTime: 0
    };

    try {
      // 1. Buscar todos os perfis de fornecedores
      const profiles = await this.getAllSupplierProfiles(opts.maxProfiles);
      result.totalAnalyzed = profiles.length;
      
      console.log(`🔍 Analisando ${profiles.length} perfis de fornecedores...`);

      // 2. Processar em batches
      for (let i = 0; i < profiles.length; i += opts.batchSize) {
        const batch = profiles.slice(i, i + opts.batchSize);
        const batchResult = await this.processBatch(batch, opts);
        
        result.totalCleaned += batchResult.totalCleaned;
        result.totalErrors += batchResult.totalErrors;
        result.removedRelationships += batchResult.removedRelationships;
        result.correctedProfiles.push(...batchResult.correctedProfiles);
        result.errors.push(...batchResult.errors);

        console.log(`📈 Progresso: ${Math.min(i + opts.batchSize, profiles.length)}/${profiles.length} perfis processados`);
      }

    } catch (error) {
      const errorMsg = `Erro durante limpeza: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
      result.errors.push(errorMsg);
      result.totalErrors++;
      console.error('❌', errorMsg);
    }

    result.executionTime = Date.now() - startTime;
    this.printCleanupReport(result, opts.dryRun);

    return result;
  }

  /**
   * Busca todos os perfis de fornecedores do Firestore
   */
  private async getAllSupplierProfiles(maxProfiles: number): Promise<Array<{ cnpj: string; data: any }>> {
    const profiles: Array<{ cnpj: string; data: any }> = [];
    
    try {
      const fornecedoresRef = collection(db, 'fornecedores');
      const q = query(fornecedoresRef, firestoreLimit(maxProfiles));
      const snapshot = await getDocs(q);
      
      snapshot.forEach(doc => {
        profiles.push({
          cnpj: doc.id,
          data: doc.data()
        });
      });
      
    } catch (error) {
      console.error('❌ Erro ao buscar perfis:', error);
    }
    
    return profiles;
  }

  /**
   * Processa um batch de perfis
   */
  private async processBatch(
    batch: Array<{ cnpj: string; data: any }>, 
    options: CleanupOptions
  ): Promise<Omit<CleanupResult, 'totalAnalyzed' | 'executionTime'>> {
    const result = {
      totalCleaned: 0,
      totalErrors: 0,
      removedRelationships: 0,
      correctedProfiles: [] as string[],
      errors: [] as string[]
    };

    const batchWrite = writeBatch(db);
    let batchOperations = 0;

    for (const profile of batch) {
      try {
        const cleanupResult = await this.analyzeAndCleanProfile(profile, options);
        
        if (cleanupResult.needsCleaning) {
          result.totalCleaned++;
          result.removedRelationships += cleanupResult.removedRelationships;
          result.correctedProfiles.push(profile.cnpj);
          
          if (!options.dryRun && cleanupResult.sanitizedData) {
            const docRef = doc(db, 'fornecedores', profile.cnpj);
            batchWrite.set(docRef, cleanupResult.sanitizedData, { merge: true });
            batchOperations++;
          }
        }
        
        if (cleanupResult.errors.length > 0) {
          result.totalErrors++;
          result.errors.push(...cleanupResult.errors);
        }
        
      } catch (error) {
        result.totalErrors++;
        const errorMsg = `Erro ao processar perfil ${profile.cnpj}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
        result.errors.push(errorMsg);
      }
    }

    // Executar batch write se houver operações
    if (batchOperations > 0 && !options.dryRun) {
      try {
        await batchWrite.commit();
        console.log(`✅ Batch de ${batchOperations} operações executado com sucesso`);
      } catch (error) {
        result.totalErrors++;
        result.errors.push(`Erro ao executar batch write: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }

    return result;
  }

  /**
   * Analisa e limpa um perfil individual
   */
  private async analyzeAndCleanProfile(
    profile: { cnpj: string; data: any }, 
    options: CleanupOptions
  ): Promise<{
    needsCleaning: boolean;
    removedRelationships: number;
    sanitizedData?: any;
    errors: string[];
  }> {
    const errors: string[] = [];
    
    try {
      // Converter para formato esperado pelo validador
      const supplierProfile: SupplierProfile = {
        cnpj: profile.cnpj,
        nome: profile.data.nome || 'Fornecedor sem nome',
        relacionamentoDeputados: profile.data.relacionamentoDeputados || [],
        totalRecebido: profile.data.totalRecebido || 0,
        numeroTransacoes: profile.data.numeroTransacoes || 0
      };

      // Validar perfil
      const validationResult = dataValidationService.validateSupplierProfile(supplierProfile);
      
      if (validationResult.isValid) {
        return {
          needsCleaning: false,
          removedRelationships: 0,
          errors: []
        };
      }

      // Se apenas queremos perfis com problemas e este está ok, pular
      if (options.onlyWithIssues && validationResult.isValid) {
        return {
          needsCleaning: false,
          removedRelationships: 0,
          errors: []
        };
      }

      // Tentar sanitizar
      const { sanitizedProfile, removedRelationships, issues } = dataValidationService.sanitizeSupplierProfile(supplierProfile);
      
      console.log(`🔧 Limpando perfil ${profile.data.nome} (${profile.cnpj}):`);
      console.log(`   • Relacionamentos removidos: ${removedRelationships}`);
      console.log(`   • Issues: ${issues.join(', ')}`);

      return {
        needsCleaning: true,
        removedRelationships,
        sanitizedData: {
          ...profile.data,
          relacionamentoDeputados: sanitizedProfile.relacionamentoDeputados,
          totalRecebido: sanitizedProfile.totalRecebido,
          numeroTransacoes: sanitizedProfile.numeroTransacoes,
          // Adicionar metadados da limpeza
          _cleanupMetadata: {
            cleanedAt: new Date().toISOString(),
            removedRelationships,
            issues,
            originalTotalRecebido: profile.data.totalRecebido,
            originalNumeroTransacoes: profile.data.numeroTransacoes
          }
        },
        errors: validationResult.errors
      };

    } catch (error) {
      errors.push(`Erro ao analisar perfil ${profile.cnpj}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      return {
        needsCleaning: false,
        removedRelationships: 0,
        errors
      };
    }
  }

  /**
   * Busca perfis com problemas específicos
   */
  async findProblemsProfiles(): Promise<Array<{ cnpj: string; issues: string[] }>> {
    console.log('🔍 Buscando perfis com problemas...');
    
    const problematicProfiles: Array<{ cnpj: string; issues: string[] }> = [];
    
    try {
      const profiles = await this.getAllSupplierProfiles(1000);
      
      for (const profile of profiles) {
        const issues: string[] = [];
        
        // Verificar relacionamentos sem transações
        if (profile.data.relacionamentoDeputados) {
          for (const rel of profile.data.relacionamentoDeputados) {
            if (!rel.transacoes || !Array.isArray(rel.transacoes) || rel.transacoes.length === 0) {
              issues.push(`Relacionamento com ${rel.deputadoNome} sem transações`);
            }
          }
        }
        
        // Verificar inconsistências financeiras
        if (profile.data.relacionamentoDeputados && profile.data.relacionamentoDeputados.length === 0) {
          if (profile.data.totalRecebido > 0) {
            issues.push(`Total recebido > 0 mas sem relacionamentos`);
          }
          if (profile.data.numeroTransacoes > 0) {
            issues.push(`Número de transações > 0 mas sem relacionamentos`);
          }
        }
        
        if (issues.length > 0) {
          problematicProfiles.push({
            cnpj: profile.cnpj,
            issues
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Erro ao buscar perfis problemáticos:', error);
    }
    
    console.log(`📊 Encontrados ${problematicProfiles.length} perfis com problemas`);
    return problematicProfiles;
  }

  /**
   * Exibe relatório de limpeza
   */
  private printCleanupReport(result: CleanupResult, isDryRun: boolean): void {
    console.log('\n' + '='.repeat(50));
    console.log('📊 RELATÓRIO DE LIMPEZA DE DADOS');
    console.log('='.repeat(50));
    console.log(`🎯 Modo: ${isDryRun ? 'DRY-RUN (simulação)' : 'EXECUÇÃO REAL'}`);
    console.log(`📈 Perfis analisados: ${result.totalAnalyzed}`);
    console.log(`🧹 Perfis limpos: ${result.totalCleaned}`);
    console.log(`❌ Erros encontrados: ${result.totalErrors}`);
    console.log(`🗑️ Relacionamentos removidos: ${result.removedRelationships}`);
    console.log(`⏱️ Tempo de execução: ${(result.executionTime / 1000).toFixed(2)}s`);
    
    if (result.correctedProfiles.length > 0) {
      console.log('\n📋 Perfis corrigidos:');
      result.correctedProfiles.slice(0, 10).forEach(cnpj => {
        console.log(`   • ${cnpj}`);
      });
      if (result.correctedProfiles.length > 10) {
        console.log(`   ... e mais ${result.correctedProfiles.length - 10} perfis`);
      }
    }
    
    if (result.errors.length > 0) {
      console.log('\n⚠️ Erros encontrados:');
      result.errors.slice(0, 5).forEach(error => {
        console.log(`   • ${error}`);
      });
      if (result.errors.length > 5) {
        console.log(`   ... e mais ${result.errors.length - 5} erros`);
      }
    }
    
    const successRate = result.totalAnalyzed > 0 ? 
      ((result.totalAnalyzed - result.totalErrors) / result.totalAnalyzed) * 100 : 100;
    
    console.log(`\n✅ Taxa de sucesso: ${successRate.toFixed(1)}%`);
    console.log('='.repeat(50));
  }

  /**
   * Executa diagnóstico rápido sem alterações
   */
  async quickDiagnosis(): Promise<{ 
    totalProfiles: number; 
    problematicProfiles: number; 
    issues: Record<string, number> 
  }> {
    console.log('🔍 DIAGNÓSTICO RÁPIDO DE QUALIDADE DOS DADOS');
    console.log('='.repeat(50));

    const issues: Record<string, number> = {
      'relacionamentos_sem_transacoes': 0,
      'inconsistencia_financeira': 0,
      'relacionamentos_vazios': 0,
      'dados_ausentes': 0
    };

    let totalProfiles = 0;
    let problematicProfiles = 0;

    try {
      const profiles = await this.getAllSupplierProfiles(500);
      totalProfiles = profiles.length;

      for (const profile of profiles) {
        let hasIssues = false;

        // Verificar relacionamentos sem transações
        if (profile.data.relacionamentoDeputados) {
          for (const rel of profile.data.relacionamentoDeputados) {
            if (!rel.transacoes || !Array.isArray(rel.transacoes) || rel.transacoes.length === 0) {
              issues.relacionamentos_sem_transacoes++;
              hasIssues = true;
            }
          }
        }

        // Verificar inconsistências financeiras
        if (profile.data.relacionamentoDeputados?.length === 0 && profile.data.totalRecebido > 0) {
          issues.inconsistencia_financeira++;
          hasIssues = true;
        }

        // Verificar se tem relacionamentos vazios
        if (!profile.data.relacionamentoDeputados || profile.data.relacionamentoDeputados.length === 0) {
          issues.relacionamentos_vazios++;
          hasIssues = true;
        }

        // Verificar dados essenciais ausentes
        if (!profile.data.nome || !profile.cnpj) {
          issues.dados_ausentes++;
          hasIssues = true;
        }

        if (hasIssues) {
          problematicProfiles++;
        }
      }

    } catch (error) {
      console.error('❌ Erro durante diagnóstico:', error);
    }

    console.log(`📊 Resultados do diagnóstico:`);
    console.log(`   • Total de perfis: ${totalProfiles}`);
    console.log(`   • Perfis problemáticos: ${problematicProfiles} (${((problematicProfiles/totalProfiles)*100).toFixed(1)}%)`);
    console.log(`   • Relacionamentos sem transações: ${issues.relacionamentos_sem_transacoes}`);
    console.log(`   • Inconsistências financeiras: ${issues.inconsistencia_financeira}`);
    console.log(`   • Relacionamentos vazios: ${issues.relacionamentos_vazios}`);
    console.log(`   • Dados ausentes: ${issues.dados_ausentes}`);
    console.log('='.repeat(50));

    return {
      totalProfiles,
      problematicProfiles,
      issues
    };
  }
}

// Export singleton instance
export const dataCleanupService = DataCleanupService.getInstance();