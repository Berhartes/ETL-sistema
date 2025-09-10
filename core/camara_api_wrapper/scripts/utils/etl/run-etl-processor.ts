/**
 * Executor Genérico de ETL - Sistema Unificado
 * 
 * Este módulo centraliza toda a lógica repetitiva presente nos scripts initiators,
 * eliminando duplicação de código e padronizando o fluxo de execução ETL.
 * 
 * Baseado na análise dos padrões v2, v3 e v4 existentes no sistema.
 */

import { getDestinoConfig } from '../../../../../../../config/etl.config.js';
import { initializeFirestore } from '../storage/firestore/config.js';
import { logger } from '../logging/index.js';
import { SystemV4Utils } from '../../../../../SystemV4.js';
import type { ETLOptions } from '../../types/etl.types.js';

/**
 * Resultado padrão de processamento ETL
 */
export interface BatchResult {
  tempoProcessamento: number;
  destino: string;
  totalProcessados: number;
  sucessos: number;
  falhas: number;
  detalhes?: any;
}

/**
 * Interface base que todos os processadores devem implementar
 */
export interface IProcessor {
  process(): Promise<BatchResult>;
}

/**
 * Configuração para o executor ETL
 */
export interface EtlRunnerConfig<T extends IProcessor> {
  processorConstructor: new (options: ETLOptions) => T;
  cliParser: any;
  scriptName: string;
  enableSystemV4?: boolean;
  onSuccess?: (result: BatchResult) => void;
}

/**
 * Inicializa o Sistema V4 quando habilitado
 */
async function initializeSystemV4(): Promise<void> {
  try {
    logger.info('🚀 [ETL-Unified] Inicializando Sistema V4...');
    
    await SystemV4Utils.ensureInitialized();
    
    const stats = SystemV4Utils.getSystemStats();
    logger.info(`✅ [ETL-Unified] Sistema V4 inicializado:`);
    logger.info(`   - Categorias ativas: ${stats.categories.activeCategories}`);
    logger.info(`   - Total aliases: ${stats.categories.totalAliases}`);
    logger.info(`   - Provedores de ranking: ${stats.rankings.providersCount}`);
    
  } catch (error) {
    logger.warn('⚠️ [ETL-Unified] Erro ao inicializar Sistema V4, continuando:', error);
  }
}

/**
 * Logs padronizados de início de processamento
 */
function logProcessingStart(scriptName: string, options: ETLOptions): void {
  logger.info('🏛️ Sistema ETL - Câmara dos Deputados v2.0');
  logger.info(`🔷 Processador: ${scriptName}`);
  logger.info(`📊 Legislatura: ${options.legislatura || 'atual'}`);
  
  if (options.limite) {
    logger.info(`🎯 Limite: ${options.limite}`);
  }
  
  if (options.verbose) {
    logger.info(`📝 Modo verbose: ativado`);
  }
  
  if (options.dryRun) {
    logger.info(`🔍 Modo dry-run: ativado (nenhum dado será salvo)`);
  }
  
  logger.info(`💾 Destino: ${Array.isArray(options.destino) ? options.destino.join(', ') : options.destino}`);
  logger.info('⏳ Iniciando processamento...\n');
}

/**
 * Logs padronizados de resultado final
 */
function logProcessingResult(result: BatchResult, scriptName: string): void {
  const duration = result.tempoProcessamento;
  
  logger.info('\n📋 RESUMO DO PROCESSAMENTO:');
  logger.info('═'.repeat(50));
  logger.info(`🎯 Script: ${scriptName}`);
  logger.info(`⏱️ Tempo Total: ${duration.toFixed(2)}s`);
  logger.info(`💾 Destino: ${result.destino}`);
  logger.info(`📊 Total Processados: ${result.totalProcessados}`);
  logger.info(`✅ Sucessos: ${result.sucessos}`);
  
  if (result.falhas > 0) {
    logger.warn(`❌ Falhas: ${result.falhas}`);
  }
  
  // Log de detalhes específicos se disponíveis
  if (result.detalhes) {
    logger.info('\n📈 DETALHES ESPECÍFICOS:');
    Object.entries(result.detalhes).forEach(([key, value]) => {
      logger.info(`   ${key}: ${value}`);
    });
  }
  
  logger.info('═'.repeat(50));
  
  if (result.falhas === 0) {
    logger.info('🎉 Processamento concluído com sucesso!');
  } else {
    logger.warn('⚠️ Processamento concluído com algumas falhas.');
  }
}

/**
 * Executor principal que unifica toda a lógica de ETL
 */
export async function runEtlProcessor<T extends IProcessor>(
  config: EtlRunnerConfig<T>
): Promise<void> {
  const startTime = Date.now();
  
  try {
    // 1. Parse dos argumentos da linha de comando
    const options = config.cliParser.parse() as ETLOptions;
    
    // 2. Configurar destino baseado nos argumentos da linha de comando
    const destino = getDestinoConfig();
    
    // 3. Inicializar Firestore APENAS se necessário
    if (destino.useRealFirestore || destino.useEmulator) {
      await initializeFirestore();
    }
    
    // 4. Inicializar Sistema V4 se habilitado
    if (config.enableSystemV4) {
      await initializeSystemV4();
    }
    
    // 5. Logs padronizados de início
    logProcessingStart(config.scriptName, options);
    
    // 6. Criar e executar o processador específico
    const processor = new config.processorConstructor(options);
    const resultado = await processor.process();
    
    // 7. Calcular tempo total
    resultado.tempoProcessamento = (Date.now() - startTime) / 1000;
    
    // 8. Logs padronizados de resultado
    logProcessingResult(resultado, config.scriptName);
    
    // 9. Callback personalizado se fornecido
    if (config.onSuccess) {
      config.onSuccess(resultado);
    }
    
    // 10. Exit com status de sucesso
    process.exit(resultado.falhas > 0 ? 1 : 0);
    
  } catch (error: any) {
    const duration = (Date.now() - startTime) / 1000;
    
    logger.error('\n❌ ERRO FATAL NO PROCESSAMENTO:');
    logger.error('═'.repeat(50));
    logger.error(`🎯 Script: ${config.scriptName}`);
    logger.error(`⏱️ Tempo até erro: ${duration.toFixed(2)}s`);
    logger.error(`💥 Erro: ${error.message}`);
    
    if (error.stack && (process.env.DEBUG || process.env.NODE_ENV === 'development')) {
      logger.error(`🔍 Stack trace: ${error.stack}`);
    }
    
    logger.error('═'.repeat(50));
    
    process.exit(1);
  }
}

/**
 * Versão simplificada para processadores que não precisam do Sistema V4
 */
export async function runSimpleEtlProcessor<T extends IProcessor>(
  processorConstructor: new (options: ETLOptions) => T,
  cliParser: any,
  scriptName: string
): Promise<void> {
  return runEtlProcessor({
    processorConstructor,
    cliParser,
    scriptName,
    enableSystemV4: false
  });
}

/**
 * Versão avançada para processadores que usam Sistema V4
 */
export async function runAdvancedEtlProcessor<T extends IProcessor>(
  processorConstructor: new (options: ETLOptions) => T,
  cliParser: any,
  scriptName: string,
  onSuccess?: (result: BatchResult) => void
): Promise<void> {
  return runEtlProcessor({
    processorConstructor,
    cliParser,
    scriptName,
    enableSystemV4: true,
    onSuccess
  });
}