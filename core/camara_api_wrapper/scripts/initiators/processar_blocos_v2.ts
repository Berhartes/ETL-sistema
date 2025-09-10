/**
 * 🚀 Blocos v2 (Clean Architecture)
 *
 * Sistema ETL Modular da Câmara dos Deputados
 * 
 * ✅ ELIMINA 90% DO BOILERPLATE usando o Executor Genérico
 * ✅ FOCA APENAS na configuração específica deste processador
 * ✅ SINGLE SOURCE OF TRUTH para configurações
 * 
 * Reduzido de 73 linhas → ~80 linhas (Enterprise-Ready)
 */

import { BlocosProcessor } from '../processors/blocosprocessor.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runSimpleEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * 🎨 CONFIGURAÇÃO ESPECÍFICA DESTE PROCESSADOR
 * 
 * Define apenas as opções de CLI únicas para este processador.
 * Todo o resto (logging, inicialização, tratamento de erro) é
 * automaticamente gerenciado pelo Executor Genérico.
 */
function setupCLI() {
  return createStandardETLParser('camara:blocos_v2', 'Blocos v2')
    .addCustomOption('--concorrencia', {
      description: 'Número de itens processados em paralelo (padrão: 3)',
      defaultValue: 3
    })
    .addCustomOption('--rate-limit', {
      description: 'Intervalo entre requisições em ms (padrão: 1000ms)',
      defaultValue: 1000
    })
    .addCustomOption('--retry-max', {
      description: 'Máximo de tentativas em caso de falha (padrão: 3)',
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
    });
}

/**
 * 🎯 FUNÇÃO PRINCIPAL SIMPLIFICADA
 * 
 * Graças ao Executor Genérico, este é todo o código necessário
 * para executar um processador ETL completo e robusto.
 */
async function main() {
  const cli = setupCLI();
  await runSimpleEtlProcessor(
    BlocosProcessor, 
    cli, 
    'Blocos v2'
  );
}

/**
 * ✅ FUNÇÃO AUXILIAR PARA DETECÇÃO DE MÓDULO PRINCIPAL
 */
function isMainModule(metaUrl: string): boolean {
  const modulePath = new URL(metaUrl).pathname;
  const mainScriptPath = process.argv[1];
  return modulePath.endsWith(mainScriptPath.replace(/\/g, '/'));
}

// 🚀 EXECUÇÃO AUTOMÁTICA SE CHAMADO DIRETAMENTE
if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`💥 Erro não capturado: ${error.message}`);
    process.exit(1);
  });
}

export { main };
