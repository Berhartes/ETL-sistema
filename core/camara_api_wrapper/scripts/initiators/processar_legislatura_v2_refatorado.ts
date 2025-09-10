/**
 * Script para processar legislaturas da Câmara dos Deputados
 *
 * Sistema ETL Modular da Câmara dos Deputados v2.1 - REFATORADO
 * Utiliza o executor genérico para eliminar código duplicado
 *
 * Uso:
 *   npm run camara:legislaturas -- [opções]
 *
 * Exemplos:
 *   npm run camara:legislaturas                       # Processa todas as legislaturas
 *   npm run camara:legislaturas -- --limite 5         # Limita a 5 legislaturas
 *   npm run camara:legislaturas -- --pc --verbose     # Salva no PC com logs detalhados
 */

import { LegislaturasProcessor } from '../processors/legislaturas.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runSimpleEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * Configuração específica do processador de legislaturas
 */
function setupLegislaturasParser() {
  const cli = createStandardETLParser('camara:legislaturas', 'Processador de Legislaturas');
  
  // Opções específicas para processamento de legislaturas
  cli.addCustomOption('--incluir-historico-completo', {
    description: 'Incluir histórico completo das legislaturas',
    defaultValue: true
  })
  .addCustomOption('--apenas-ativas', {
    description: 'Processar apenas legislaturas ativas',
    defaultValue: false
  })
  .addCustomOption('--ano-inicio', {
    description: 'Filtrar legislaturas por ano de início',
    validator: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 1900 && num <= new Date().getFullYear();
    },
    transformer: (value: string) => parseInt(value)
  });

  return cli;
}

/**
 * Função principal refatorada usando o executor genérico
 */
async function main(): Promise<void> {
  const cli = setupLegislaturasParser();
  
  await runSimpleEtlProcessor(
    LegislaturasProcessor,
    cli,
    'Legislaturas'
  );
}

// Executar automaticamente se chamado diretamente
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}

export { main };