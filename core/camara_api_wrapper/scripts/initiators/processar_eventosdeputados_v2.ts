/**
 * 🚀 Processador de Eventos de Deputados - Versão 2 (Clean Architecture)
 *
 * Sistema ETL Modular da Câmara dos Deputados v2.0
 * 
 * ✅ ELIMINA 90% DO BOILERPLATE usando o Executor Genérico
 * ✅ FOCA APENAS na configuração específica deste processador
 * ✅ SINGLE SOURCE OF TRUTH para configurações
 * 
 * Reduzido de 218 → ~95 linhas (56% menos código)
 */

import { EventosDeputadosProcessor } from '../processors/eventos-deputados.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runSimpleEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * 🎨 CONFIGURAÇÃO ESPECÍFICA DO PROCESSADOR DE EVENTOS
 * 
 * Define apenas as opções de CLI únicas para este processador.
 * Todo o resto (logging, inicialização, tratamento de erro) é
 * automaticamente gerenciado pelo Executor Genérico.
 */
function setupCLI() {
  return createStandardETLParser('camara:eventos-v2', 'Processador de Eventos de Deputados - v2')
    .addCustomOption('--concorrencia', {
      description: 'Número de deputados processados em paralelo (padrão: 3, máx: 5)',
      defaultValue: 3
    })
    .addCustomOption('--dias-atualizacao', {
      description: 'Processar eventos dos últimos N dias (padrão: 60)',
      defaultValue: 60
    })
    .addCustomOption('--incluir-detalhes', {
      description: 'Incluir detalhes completos dos eventos (padrão: true)',
      defaultValue: true
    })
    .addCustomOption('--filtro-situacao', {
      description: 'Filtrar por situação do evento (ex: "Cancelado", "Realizado")',
      defaultValue: null
    })
    .addCustomOption('--filtro-tipo', {
      description: 'Filtrar por tipo de evento (ex: "Audiência Pública")',
      defaultValue: null
    })
    .addCustomOption('--incluir-historico', {
      description: 'Incluir histórico completo de mudanças (padrão: false)',
      defaultValue: false
    })
    .addCustomOption('--ordem', {
      description: 'Ordem de processamento: "asc" ou "desc" (padrão: desc)',
      defaultValue: 'desc'
    })
    .addCustomOption('--items-per-page', {
      description: 'Itens por página da API (padrão: 100, máx: 100)',
      defaultValue: 100
    })
    .addCustomOption('--rate-limit', {
      description: 'Intervalo entre requisições em ms (padrão: 800ms)',
      defaultValue: 800
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
    EventosDeputadosProcessor, 
    cli, 
    'Eventos de Deputados v2'
  );
}

/**
 * ✅ FUNÇÃO AUXILIAR PARA DETECÇÃO DE MÓDULO PRINCIPAL
 */
function isMainModule(metaUrl: string): boolean {
  const modulePath = new URL(metaUrl).pathname;
  const mainScriptPath = process.argv[1];
  return modulePath.endsWith(mainScriptPath.replace(/\\/g, '/'));
}

// 🚀 EXECUÇÃO AUTOMÁTICA SE CHAMADO DIRETAMENTE
if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`💥 Erro não capturado: ${error.message}`);
    process.exit(1);
  });
}

export { main };