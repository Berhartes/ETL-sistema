/**
 * Script para processar órgãos da Câmara dos Deputados
 *
 * Sistema ETL Modular da Câmara dos Deputados v2.1 - REFATORADO
 * Utiliza o executor genérico para eliminar código duplicado
 *
 * Uso:
 *   npm run camara:orgaos -- [opções]
 *
 * Exemplos:
 *   npm run camara:orgaos                       # Processa todos os órgãos
 *   npm run camara:orgaos -- --limite 10        # Limita a 10 órgãos
 *   npm run camara:orgaos -- --pc --verbose     # Salva no PC com logs detalhados
 *   npm run camara:orgaos -- --emulator         # Usa Firestore Emulator
 */

import { OrgaosProcessor } from '../processors/orgaos.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runSimpleEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * Configuração específica do processador de órgãos
 */
function setupOrgaosParser() {
  const cli = createStandardETLParser('camara:orgaos', 'Processador de Órgãos da Câmara');
  
  // Opções específicas para processamento de órgãos
  cli.addCustomOption('--incluir-eventos', {
    description: 'Incluir eventos dos órgãos no processamento',
    defaultValue: false
  })
  .addCustomOption('--incluir-votacoes', {
    description: 'Incluir votações dos órgãos no processamento',
    defaultValue: false
  })
  .addCustomOption('--data-inicio-eventos', {
    description: 'Data de início para buscar eventos (formato YYYY-MM-DD)',
    validator: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  })
  .addCustomOption('--data-fim-eventos', {
    description: 'Data de fim para buscar eventos (formato YYYY-MM-DD)',
    validator: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  })
  .addCustomOption('--concorrencia', {
    description: 'Número de órgãos processados em paralelo (padrão: 2)',
    validator: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 1 && num <= 5;
    },
    transformer: (value: string) => parseInt(value),
    defaultValue: 2
  });

  return cli;
}

/**
 * Função principal refatorada usando o executor genérico
 */
async function main(): Promise<void> {
  const cli = setupOrgaosParser();
  
  await runSimpleEtlProcessor(
    OrgaosProcessor,
    cli,
    'Órgãos da Câmara'
  );
}

// Executar automaticamente se chamado diretamente
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}

export { main };