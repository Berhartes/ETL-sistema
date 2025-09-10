/**
 * Exemplo de ETL Robusto usando o Sistema Enterprise
 * 
 * Este arquivo demonstra como usar todos os sistemas implementados:
 * - Logging profissional com Winston
 * - Sistema de retry com backoff exponencial  
 * - Monitoramento em tempo real
 * - Batching otimizado para Firestore
 * - Validação de dados
 * - Health checks
 */

import 'dotenv/config';
import { 
  setupETLRobustness,
  createRobustETLProcessor,
  professionalLogger,
  retryCamaraAPI,
  processDespesasBatch,
  printDashboard,
  printSystemConfiguration
} from '../../../../../lib/index.js';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirestore } from '../utils/storage/firestore/config.js';

/**
 * Exemplo 1: Configuração Básica do Sistema
 */
async function exemploConfiguracaoBasica(): Promise<void> {
  console.log('🚀 EXEMPLO 1: Configuração Básica do Sistema\n');

  // Configurar todo o sistema de robustez
  setupETLRobustness({
    enableMonitoring: true,
    logLevel: 'info',
    contextInfo: {
      operation: 'exemplo_basico',
      user: 'sistema',
      version: '1.0.0'
    }
  });

  // Imprimir configuração atual
  printSystemConfiguration();
  
  professionalLogger.info('Sistema configurado e pronto para uso!');
}

/**
 * Exemplo 2: Processamento de Dados com Retry Automático
 */
async function exemploProcessamentoComRetry(): Promise<void> {
  console.log('\n🔄 EXEMPLO 2: Processamento com Retry Automático\n');

  const logger = professionalLogger.setContext({ operation: 'fetch_deputados' });

  try {
    // Simular chamada para API da Câmara com retry automático
    const deputados = await retryCamaraAPI(async () => {
      logger.info('Buscando dados de deputados na API...');
      
      // Simular falha ocasional para demonstrar retry
      if (Math.random() < 0.3) {
        throw new Error('Erro de rede simulado');
      }
      
      // Simular dados retornados
      return [
        { id: 1, nome: 'João Silva', partido: 'ABC', uf: 'SP' },
        { id: 2, nome: 'Maria Santos', partido: 'XYZ', uf: 'RJ' }
      ];
    }, 'buscar_deputados');

    logger.info(`Sucesso! Obtidos ${deputados.length} deputados`, {
      count: deputados.length,
      deputados: deputados.map(d => d.nome)
    });

  } catch (error) {
    logger.error('Falha definitiva na busca de deputados', error);
  }
}

/**
 * Exemplo 3: Processamento em Lote com Validação
 */
async function exemploProcessamentoLote(): Promise<void> {
  console.log('\n📦 EXEMPLO 3: Processamento em Lote com Validação\n');

  // Dados simulados de despesas
  const despesasSimuladas = [
    {
      ano: 2024,
      mes: 1,
      codDocumento: '12345',
      valor: 1500.50,
      nomeFornecedor: 'Empresa ABC Ltda',
      nomeDeputado: 'João Silva',
      cnpjCpf: '12345678901234',
      tipoDespesa: 'Combustíveis'
    },
    {
      ano: 2024,
      mes: 1,
      codDocumento: '12346',
      valor: 800.00,
      nomeFornecedor: 'Hotel XYZ',
      nomeDeputado: 'Maria Santos',
      cnpjCpf: '98765432100',
      tipoDespesa: 'Hospedagem'
    }
  ];

  const logger = professionalLogger.setContext({ 
    operation: 'batch_processing',
    totalRecords: despesasSimuladas.length 
  });

  try {
    logger.info('Iniciando processamento em lote');

    // Processar com batching otimizado e validação automática
    const resultado = await processDespesasBatch(despesasSimuladas, 'despesas_exemplo');

    if (resultado.success) {
      logger.info('Lote processado com sucesso!', {
        processedCount: resultado.processedCount,
        batchCount: resultado.metrics.batchCount,
        totalTime: `${resultado.metrics.totalTime}ms`,
        throughput: `${resultado.metrics.throughput.toFixed(2)} ops/s`
      });
    } else {
      logger.error('Falhas no processamento do lote', {
        processedCount: resultado.processedCount,
        errorCount: resultado.errors.length,
        firstError: resultado.errors[0]?.error?.message
      });
    }

  } catch (error) {
    logger.error('Erro crítico no processamento em lote', error);
  }
}

/**
 * Exemplo 4: Processador ETL Completo
 */
async function exemploProcessadorCompleto(): Promise<void> {
  console.log('\n🏭 EXEMPLO 4: Processador ETL Completo\n');

  const processor = createRobustETLProcessor('exemplo_completo');

  try {
    // Fase 1: Extração com retry automático
    const dadosBrutos = await processor.execute(async () => {
      processor.logger.info('Extraindo dados da fonte...');
      
      // Simular extração de dados
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return {
        deputados: [
          { id: 1, nome: 'Deputado A' },
          { id: 2, nome: 'Deputado B' }
        ],
        despesas: [
          { id: 1, valor: 100, deputadoId: 1 },
          { id: 2, valor: 200, deputadoId: 2 }
        ]
      };
    }, 'extracao_dados');

    // Fase 2: Transformação
    const dadosTransformados = await processor.execute(async () => {
      processor.logger.info('Transformando dados...');
      
      // Simular transformação
      return dadosBrutos.despesas.map(despesa => ({
        ...despesa,
        valorFormatado: `R$ ${despesa.valor.toFixed(2)}`,
        timestamp: new Date().toISOString()
      }));
    }, 'transformacao_dados');

    // Fase 3: Carregamento com batching
    await processor.execute(async () => {
      processor.logger.info(`Carregando ${dadosTransformados.length} registros...`);
      
      // Simular salvamento
      await new Promise(resolve => setTimeout(resolve, 500));
      
      processor.logger.info('Dados carregados com sucesso!');
    }, 'carregamento_dados');

    processor.finish(true);

  } catch (error) {
    processor.finish(false, error);
  }
}

/**
 * Exemplo 5: Monitoramento e Dashboard
 */
async function exemploMonitoramento(): Promise<void> {
  console.log('\n📊 EXEMPLO 5: Monitoramento e Dashboard\n');

  // Simular algumas operações para gerar métricas
  for (let i = 0; i < 5; i++) {
    try {
      await retryCamaraAPI(async () => {
        // Simular operação com sucesso/falha aleatória
        if (Math.random() < 0.2) {
          throw new Error(`Erro simulado na operação ${i + 1}`);
        }
        return `Resultado ${i + 1}`;
      }, `operacao_${i + 1}`);
    } catch (error) {
      // Ignorar erros para demonstração
    }
  }

  // Aguardar um pouco para métricas se acumularem
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Imprimir dashboard
  await printDashboard();
}

/**
 * Função principal - executa todos os exemplos
 */
async function main(): Promise<void> {
  try {
    console.log('🎯 DEMONSTRAÇÃO DO SISTEMA DE ROBUSTEZ ETL');
    console.log('='.repeat(80));
    console.log('Esta demonstração mostra todos os recursos implementados:\n');

    // Inicializar Firestore (necessário para alguns exemplos)
    try {
      await initializeFirestore();
      console.log('✅ Firestore inicializado (modo emulador/real conforme configuração)\n');
    } catch (error) {
      console.log('⚠️  Firestore não inicializado - alguns exemplos podem não funcionar\n');
    }

    // Executar exemplos sequencialmente
    await exemploConfiguracaoBasica();
    await exemploProcessamentoComRetry();
    await exemploProcessamentoLote();
    await exemploProcessadorCompleto();
    await exemploMonitoramento();

    console.log('\n✅ TODOS OS EXEMPLOS EXECUTADOS COM SUCESSO!');
    console.log('\nPara usar em seus processadores ETL:');
    console.log('1. Importe: import { setupETLRobustness, createRobustETLProcessor } from "../../lib/index.js"');
    console.log('2. Configure: setupETLRobustness({ enableMonitoring: true })');
    console.log('3. Use: const processor = createRobustETLProcessor("meu_etl")');
    console.log('4. Execute operações com: await processor.execute(...)');

  } catch (error) {
    console.error('❌ Erro na execução dos exemplos:', error);
    process.exit(1);
  }
}

// Executar apenas se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  main().finally(() => {
    console.log('\n👋 Demonstração finalizada. Para mais informações, consulte a documentação.');
    process.exit(0);
  });
}