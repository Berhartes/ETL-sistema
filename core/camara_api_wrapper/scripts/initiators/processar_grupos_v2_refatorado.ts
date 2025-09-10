/**
 * Script para processar grupos parlamentares da Câmara dos Deputados
 *
 * Sistema ETL Modular da Câmara dos Deputados v2.1 - REFATORADO
 * Utiliza o executor genérico para eliminar código duplicado
 *
 * Uso:
 *   npm run camara:grupos -- [legislatura] [opções]
 *
 * Exemplos:
 *   npm run camara:grupos                       # Processa legislatura atual
 *   npm run camara:grupos -- 57 --limite 10     # Legislatura 57, limitado a 10
 *   npm run camara:grupos -- --pc --verbose     # Salva no PC com logs detalhados
 */

import { GruposProcessor } from '../processors/grupos.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runSimpleEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * Configuração específica do processador de grupos
 */
function setupGruposParser() {
  const cli = createStandardETLParser('camara:grupos', 'Processador de Grupos Parlamentares');
  
  // Opções específicas para processamento de grupos
  cli.addCustomOption('--incluir-membros', {
    description: 'Incluir lista de membros de cada grupo',
    defaultValue: true
  })
  .addCustomOption('--incluir-detalhes-completos', {
    description: 'Incluir detalhes completos de cada grupo',
    defaultValue: true
  })
  .addCustomOption('--concorrencia', {
    description: 'Número de grupos processados em paralelo (padrão: 3)',
    validator: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 1 && num <= 8;
    },
    transformer: (value: string) => parseInt(value),
    defaultValue: 3
  });

  return cli;
}

/**
 * Função principal refatorada usando o executor genérico
 */
async function main(): Promise<void> {
  const cli = setupGruposParser();
  
  await runSimpleEtlProcessor(
    GruposProcessor,
    cli,
    'Grupos Parlamentares'
  );
}

// Executar automaticamente se chamado diretamente
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}

export { main };