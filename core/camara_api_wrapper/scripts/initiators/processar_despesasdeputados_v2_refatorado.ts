/**
 * Script para processar despesas de deputados da Câmara dos Deputados
 *
 * Sistema ETL Modular da Câmara dos Deputados v2.1 - REFATORADO
 * Utiliza o executor genérico para eliminar código duplicado
 *
 * Uso:
 *   npm run camara:despesas -- [legislatura] [limite] [opções]
 *
 * Exemplos:
 *   npm run camara:despesas                       # Processa legislatura atual
 *   npm run camara:despesas -- 57 100             # Legislatura 57, limitado a 100 deputados
 *   npm run camara:despesas -- --pc --verbose     # Salva no PC com logs detalhados
 */

import { DespesasDeputadosProcessor } from '../processors/despesas-deputados.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runSimpleEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * Configuração específica do processador de despesas
 */
function setupDespesasParser() {
  const cli = createStandardETLParser('camara:despesas', 'Processador de Despesas de Deputados');
  
  // Opções específicas para processamento de despesas
  cli.addCustomOption('--categoria', {
    description: 'Filtrar por categoria específica de despesa'
  })
  .addCustomOption('--fornecedor', {
    description: 'Filtrar por CNPJ ou nome do fornecedor'
  })
  .addCustomOption('--valor-minimo', {
    description: 'Filtrar despesas com valor mínimo',
    validator: (value: string) => {
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0;
    },
    transformer: (value: string) => parseFloat(value)
  })
  .addCustomOption('--ano', {
    description: 'Filtrar despesas por ano específico',
    validator: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 2000 && num <= new Date().getFullYear();
    },
    transformer: (value: string) => parseInt(value)
  })
  .addCustomOption('--concorrencia-deputados', {
    description: 'Número de deputados processados em paralelo (padrão: 10)',
    validator: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 1 && num <= 20;
    },
    transformer: (value: string) => parseInt(value),
    defaultValue: 10
  })
  .addCustomOption('--chunk-size', {
    description: 'Tamanho dos blocos de dados para processamento (padrão: 100)',
    validator: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 10 && num <= 1000;
    },
    transformer: (value: string) => parseInt(value),
    defaultValue: 100
  });

  return cli;
}

/**
 * Função principal refatorada usando o executor genérico
 */
async function main(): Promise<void> {
  const cli = setupDespesasParser();
  
  await runSimpleEtlProcessor(
    DespesasDeputadosProcessor,
    cli,
    'Despesas de Deputados v2'
  );
}

// Executar automaticamente se chamado diretamente
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}

export { main };