/**
 * Script para processar discursos de deputados da Câmara dos Deputados
 *
 * Sistema ETL Modular da Câmara dos Deputados v2.1 - REFATORADO
 * Utiliza o executor genérico para eliminar código duplicado
 *
 * Uso:
 *   npm run camara:discursos -- [legislatura] [opções]
 *
 * Exemplos:
 *   npm run camara:discursos                       # Processa legislatura atual
 *   npm run camara:discursos -- 57 --limite 100    # Legislatura 57, limitado a 100 discursos
 *   npm run camara:discursos -- --pc --verbose     # Salva no PC com logs detalhados
 */

import { DiscursosDeputadosProcessor } from '../processors/discursos-deputados.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runSimpleEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * Configuração específica do processador de discursos
 */
function setupDiscursosParser() {
  const cli = createStandardETLParser('camara:discursos', 'Processador de Discursos de Deputados');
  
  // Opções específicas para processamento de discursos
  cli.addCustomOption('--incluir-transcricoes', {
    description: 'Incluir transcrições completas dos discursos',
    defaultValue: true
  })
  .addCustomOption('--palavras-chave', {
    description: 'Filtrar discursos por palavras-chave (separadas por vírgula)'
  })
  .addCustomOption('--tipo-discurso', {
    description: 'Filtrar por tipo de discurso específico'
  })
  .addCustomOption('--concorrencia-deputados', {
    description: 'Número de deputados processados em paralelo (padrão: 3)',
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
  const cli = setupDiscursosParser();
  
  await runSimpleEtlProcessor(
    DiscursosDeputadosProcessor,
    cli,
    'Discursos de Deputados'
  );
}

// Executar automaticamente se chamado diretamente
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}

export { main };