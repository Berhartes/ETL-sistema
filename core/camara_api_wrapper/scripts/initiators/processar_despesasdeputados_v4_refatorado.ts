/**
 * 🔗 SCRIPT ETL UNIFICADO COM SISTEMA V4 - DUAL SYNTAX - REFATORADO
 * 
 * Sistema ETL Modular da Câmara dos Deputados v2.1 - REFATORADO
 * Utiliza o executor genérico avançado com Sistema V4 habilitado
 * 
 * 🎯 SUPORTA MÚLTIPLAS SINTAXES:
 * 
 * SINTAXE ATUAL (argumentos posicionais):
 * npm run etl:despesas -- 57 11 --firestore
 * npm run etl:despesas -- 57 --verbose --categoria "locacao"
 * 
 * SINTAXE NOVA (flags nomeadas):
 * npm run etl:despesas -- --legislatura 57 --limite 11 --firestore
 * npm run etl:despesas -- -l 57 --limite 11 --verbose --categoria "locacao"
 * 
 * SINTAXE HÍBRIDA (melhor dos dois mundos):
 * npm run etl:despesas -- 57 --limite 11 --firestore --ano 2024
 * npm run etl:despesas -- 57 --verbose --debug-categorias
 * 
 * HELP:
 * npm run etl:despesas -- --help
 */

import { DespesasDeputadosV3UnifiedProcessor } from '../processors/despesas-deputados-v3-unified.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runAdvancedEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * Configuração específica do processador de despesas v4 com Sistema V4
 */
function setupDespesasV4Parser() {
  const cli = createStandardETLParser('camara:despesas-v4-unified', 'Processador de Despesas Unificado - Sistema V4');
  
  // Adicionar opções específicas do Sistema V4
  cli.addCustomOption('--ano', {
    description: 'Filtrar despesas por ano específico (ex: 2023, 2024)',
    validator: (value: string) => {
      const ano = parseInt(value);
      return !isNaN(ano) && ano >= 2000 && ano <= new Date().getFullYear() + 1;
    },
    transformer: (value: string) => parseInt(value)
  })
  .addCustomOption('--mes', {
    description: 'Filtrar despesas por mês específico (1-12)',
    validator: (value: string) => {
      const mes = parseInt(value);
      return !isNaN(mes) && mes >= 1 && mes <= 12;
    },
    transformer: (value: string) => parseInt(value)
  })
  .addCustomOption('--atualizar', {
    description: 'Modo atualização incremental (últimos 2 meses)',
    defaultValue: false
  })
  .addCustomOption('--categoria', {
    description: 'Processar apenas uma categoria específica (nome ou código do Sistema V4)',
    validator: (value: string) => value.length > 0
  })
  .addCustomOption('--debug-categorias', {
    description: 'Ativar debug detalhado do mapeamento de categorias',
    defaultValue: false
  })
  .addCustomOption('--export-mapping', {
    description: 'Exportar relatório de mapeamento de categorias para arquivo',
    defaultValue: false
  })
  .addCustomOption('--rate-limit', {
    description: 'Controle de rate limiting (requisições por segundo)',
    validator: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 1 && num <= 50;
    },
    transformer: (value: string) => parseInt(value),
    defaultValue: 10
  })
  .addCustomOption('--chunk-size', {
    description: 'Tamanho dos chunks para processamento em lotes',
    validator: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 50 && num <= 5000;
    },
    transformer: (value: string) => parseInt(value),
    defaultValue: 500
  });

  return cli;
}

/**
 * Callback customizado para processamento avançado v4
 */
function onV4ProcessingSuccess(resultado: any) {
  // Log específico do Sistema V4
  console.log('\n🎯 [ETL-V4] RESULTADOS SISTEMA V4:');
  console.log('═'.repeat(50));
  
  if (resultado.detalhes?.categoriasMapeadas) {
    console.log(`📊 Categorias mapeadas: ${resultado.detalhes.categoriasMapeadas}`);
  }
  
  if (resultado.detalhes?.rankingsAtualizados) {
    console.log(`🏆 Rankings atualizados: ${resultado.detalhes.rankingsAtualizados}`);
  }
  
  if (resultado.detalhes?.sistemasIntegrados) {
    console.log(`🔗 Sistemas integrados: ${resultado.detalhes.sistemasIntegrados.join(', ')}`);
  }
  
  console.log('═'.repeat(50));
}

/**
 * Função principal refatorada usando o executor genérico avançado
 */
async function main(): Promise<void> {
  const cli = setupDespesasV4Parser();
  
  await runAdvancedEtlProcessor(
    DespesasDeputadosV3UnifiedProcessor,
    cli,
    'Despesas V4 Unificado - Sistema V4',
    onV4ProcessingSuccess
  );
}

// Executar automaticamente se chamado diretamente
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}

export { main as runUnifiedETL };