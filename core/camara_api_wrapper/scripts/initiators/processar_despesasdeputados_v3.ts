/**
 * Script refatorado para processamento de despesas de deputados - Versão 3
 *
 * Sistema ETL Modular da Câmara dos Deputados v3.0
 * Segue o padrão arquitetural otimizado para Firestore
 */

// IMPORTANTE: Configurar variáveis de ambiente ANTES de qualquer import do Firestore
import { configurarVariaveisAmbiente, getDestinoConfig } from '../config/environment.config.js';
import { initializeFirestore } from '../utils/storage/firestore/config.js';

import { DespesasDeputadosV3ModularProcessor } from '../processors/despesas-deputados-v3-modular.processor.js';
// ✅ CLEAN CODE: Usar factory function do parser modernizado
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { logger } from '../utils/logging/index.js';

/**
 * Função principal - REFATORADA PARA CLEAN CODE
 */
async function main(): Promise<void> {
  let inicioProcessamento: number = Date.now();
  
  try {
    // 1. 🎨 CLEAN CODE: Configurar parser modernizado com argumentos padrão
    const cli = createStandardETLParser('camara:despesas-v3', 'Processador de Despesas de Deputados - v3')
    .addCustomOption('--atualizar', {
      description: 'Modo atualização incremental (últimos 2 meses)',
      defaultValue: false
    })
    .addCustomOption('--concorrencia', {
        description: 'Número de deputados processados em paralelo (padrão: 3, máx: 8)',
        validator: (value: string) => {
            const num = parseInt(value);
            return !isNaN(num) && num >= 1 && num <= 8;
        },
        transformer: (value: string) => parseInt(value),
        defaultValue: 3
    })
    .addCustomOption('--rate-limit', {
        description: 'Intervalo entre requisições em ms (padrão: 200ms)',
        validator: (value: string) => {
            const num = parseInt(value);
            return !isNaN(num) && num >= 50 && num <= 2000;
        },
        transformer: (value: string) => parseInt(value),
        defaultValue: 200
    })
    .addCustomOption('--chunk-size', {
        description: 'Tamanho dos chunks para processamento (padrão: 10)',
        validator: (value: string) => {
            const num = parseInt(value);
            return !isNaN(num) && num >= 5 && num <= 50;
        },
        transformer: (value: string) => parseInt(value),
        defaultValue: 10
    })
    .addCustomOption('--retry-max', {
        description: 'Máximo de tentativas em caso de falha (padrão: 3)',
        validator: (value: string) => {
            const num = parseInt(value);
            return !isNaN(num) && num >= 1 && num <= 5;
        },
        transformer: (value: string) => parseInt(value),
        defaultValue: 3
    })
    .addCustomOption('--backup', {
        description: 'Criar backup antes de processar (padrão: true)',
        defaultValue: true
    })
    .addCustomOption('--validate', {
        description: 'Validar dados após processamento (padrão: true)',
        defaultValue: true
    })
    .addCustomOption('--debug', {
        description: 'Habilitar logs detalhados de debug (padrão: false)',
        defaultValue: false
    })
    .addCustomOption('--dry-run', {
        description: 'Simular execução sem salvar dados (padrão: false)',
        defaultValue: false
    })
    .addCustomOption('--pc', {
      description: 'Salva os dados localmente no PC em vez do Firestore.',
      defaultValue: false
    });

    const options = cli.parse();

    // 2. AGORA, configurar o ambiente com base nas opções parseadas
    configurarVariaveisAmbiente();
    
    // ✅ MELHORIAS: Configurar debug se habilitado
    if (options.debug) {
      process.env.DEBUG = 'true';
      logger.info('🔍 Modo debug habilitado - logs detalhados ativados');
    }
    
    // ✅ MELHORIAS: Validação pré-execução
    if (options.dryRun) {
      logger.info('🧪 Modo dry-run habilitado - simulação sem salvar dados');
    }

    // Usar legislatura atual se não especificada
    const legislaturaDefault = 57;
    const legislatura = options.legislatura || legislaturaDefault;
    
    // ✅ MELHORIAS: Validações de entrada
    if (options.concorrencia && options.concorrencia > 8) {
      logger.warn(`⚠️ Concorrência alta (${options.concorrencia}) pode sobrecarregar a API da Câmara`);
    }
    
    if (options.rateLimit && options.rateLimit < 100) {
      logger.warn(`⚠️ Rate limit baixo (${options.rateLimit}ms) pode causar bloqueios`);
    }
    
    if (options.limite && options.limite > 100) {
      logger.info(`🎯 Processando ${options.limite} deputados - modo teste extenso`);
    }

    // 3. Inicializar Firestore APÓS o parse e validações, se necessário
    if (getDestinoConfig().useRealFirestore || getDestinoConfig().useEmulator) {
      await initializeFirestore();
    }
    
    const processorOptions = {
      ...options,
      legislatura,
    };

    // ✅ MELHORIAS: Log de configuração detalhado
    logger.info('🏛️ Sistema ETL - Câmara dos Deputados v3.0');
    logger.info('💰 Processador: Despesas de Deputados');
    logger.info(`📋 Legislatura: ${processorOptions.legislatura}ª`);
    logger.info(`🎯 Limite: ${processorOptions.limite || 'sem limite'}`);
    logger.info('');
    logger.info('⚙️ Configurações de performance:');
    logger.info(`   🔄 Concorrência: ${(processorOptions as any).concorrencia || 3} deputados em paralelo`);
    logger.info(`   ⏱️ Rate Limit: ${(processorOptions as any).rateLimit || 200}ms entre requisições`);
    logger.info(`   📦 Chunk Size: ${(processorOptions as any).chunkSize || 10} itens por batch`);
    logger.info(`   🔁 Max Retries: ${(processorOptions as any).retryMax || 3} tentativas`);
    logger.info(`   💾 Backup: ${(processorOptions as any).backup !== false ? 'Habilitado' : 'Desabilitado'}`);
    logger.info(`   ✅ Validação: ${(processorOptions as any).validate !== false ? 'Habilitada' : 'Desabilitada'}`);
    logger.info(`   🔍 Debug: ${(processorOptions as any).debug ? 'Habilitado' : 'Desabilitado'}`);
    logger.info(`   🧪 Dry Run: ${(processorOptions as any).dryRun ? 'Habilitado' : 'Desabilitado'}`);
    if (processorOptions.limite) {
      logger.info(`   🎯 Limite: ${processorOptions.limite} deputados (modo teste)`);
    }
    logger.info('');
    
    // ✅ MELHORIAS: Métricas de início
    logger.info(`🚀 Iniciando processamento em: ${new Date().toLocaleString('pt-BR')}`);
    logger.info('');
    
    inicioProcessamento = Date.now();

    // Criar e executar processador modular
    const processor = new DespesasDeputadosV3ModularProcessor(processorOptions);
    const resultado = await processor.process();

    // ✅ MELHORIAS: Log de resultado final com métricas avançadas
    const tempoTotalMs = Date.now() - inicioProcessamento;
    const tempoTotalSeg = Math.round(tempoTotalMs / 1000);
    const tempoTotalMin = Math.round(tempoTotalSeg / 60);
    
    logger.info('');
    logger.info('✅ Processamento concluído');
    logger.info(`🕐 Finalizado em: ${new Date().toLocaleString('pt-BR')}`);
    logger.info('');
    logger.info('📊 Resultados:');
    logger.info(`   ✅ Sucessos: ${resultado.sucessos}`);
    logger.info(`   ❌ Falhas: ${resultado.falhas}`);
    logger.info(`   📈 Taxa de sucesso: ${resultado.sucessos > 0 ? Math.round((resultado.sucessos / (resultado.sucessos + resultado.falhas)) * 100) : 0}%`);
    logger.info('');
    logger.info('⏱️ Performance:');
    logger.info(`   ⏱️ Tempo total: ${tempoTotalSeg}s (${tempoTotalMin}min)`);
    logger.info(`   🚀 Tempo oficial: ${resultado.tempoProcessamento}s`);
    if (resultado.detalhes?.deputadosSalvos) {
      const deputadosPorMinuto = Math.round((resultado.detalhes.deputadosSalvos / tempoTotalSeg) * 60);
      logger.info(`   👥 Velocidade: ${deputadosPorMinuto} deputados/min`);
    }
    logger.info('');
    logger.info('💾 Dados processados:');
    logger.info(`   🎯 Destino: ${resultado.destino}`);
    if (resultado.detalhes) {
      logger.info(`   👥 Deputados salvos: ${resultado.detalhes.deputadosSalvos || 0}`);
      logger.info(`   💰 Despesas salvas: ${resultado.detalhes.despesasSalvas || 0}`);
      logger.info(`   🏆 Rankings gerados: ${resultado.detalhes.rankingsGerados || 0}`);
      logger.info(`   📊 Estatísticas: ${resultado.detalhes.estatisticasGeradas || 0}`);
      if (resultado.detalhes.categoriasPorcessadas) {
        logger.info(`   📋 Categorias: ${resultado.detalhes.categoriasPorcessadas}`);
      }
    }
    logger.info('');
    logger.info('🎯 Funcionalidades ativas:');
    logger.info('   ✅ Rate limiting aplicado');
    logger.info('   ✅ Processamento paralelo em chunks');
    logger.info('   ✅ Sistema de retry com backoff');
    logger.info('   ✅ Matching de categorias');
    logger.info('   ✅ Normalização de IDs');
    logger.info('   ✅ Sistema de logging detalhado');
    logger.info('');
    logger.info('📍 Para verificar resultados:');
    logger.info('   🌐 Interface: http://localhost:5173/gastos/premiacoes');
    logger.info('   🔥 Firebase: https://console.firebase.google.com/u/0/project/a-republica-brasileira/firestore');
    logger.info('------------------------------------------------');

  } catch (error: any) {
    const tempoTotalMs = Date.now() - inicioProcessamento;
    const tempoTotalSeg = Math.round(tempoTotalMs / 1000);
    
    logger.error('');
    logger.error('💥 Erro fatal no processamento');
    logger.error(`🕐 Falha em: ${new Date().toLocaleString('pt-BR')}`);
    logger.error(`⏱️ Tempo antes da falha: ${tempoTotalSeg}s`);
    logger.error(`❌ Mensagem: ${error.message}`);
    logger.error('');
    
    // ✅ MELHORIAS: Informações de contexto para debug
    if (error.code) {
      logger.error(`🔍 Código do erro: ${error.code}`);
    }
    if (error.status) {
      logger.error(`🌐 Status HTTP: ${error.status}`);
    }
    if (error.response?.data) {
      logger.error(`📡 Resposta da API: ${JSON.stringify(error.response.data).substring(0, 200)}...`);
    }
    
    logger.error('');
    logger.error('🔧 Possíveis soluções:');
    logger.error('   1. 🌐 Verificar conexão com a internet');
    logger.error('   2. 🔑 Verificar credenciais do Firestore');
    logger.error('   3. 📡 Verificar se API da Câmara está funcionando');
    logger.error('   4. 💾 Verificar espaço em disco');
    logger.error('   5. 🔄 Tentar novamente com --limite menor');
    logger.error('');
    
    if (error.stack && (process.env.DEBUG || process.argv.includes('--debug'))) {
      logger.error('🔍 Stack trace detalhado:');
      logger.error(error.stack);
      logger.error('');
    } else {
      logger.error('💡 Para ver stack trace completo, use --debug');
      logger.error('');
    }
    
    logger.error('📞 Para suporte, incluir as informações acima');
    logger.error('----------------------------------------');
    
    process.exit(1);
  }
}

// Executar com tratamento de erro global
main().catch((error) => {
  logger.error(`💥 Erro não capturado: ${error.message}`);
  process.exit(1);
});

export { main };
