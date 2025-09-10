/**
 * Script para processar perfis de deputados da Câmara dos Deputados
 *
 * Sistema ETL Modular da Câmara dos Deputados v2.1 - REFATORADO
 * Utiliza o executor genérico para eliminar código duplicado
 *
 * Uso:
 *   npm run camara:perfil-deputados -- [legislatura] [opções]
 *
 * Exemplos:
 *   npm run camara:perfil-deputados                    # Processa legislatura atual
 *   npm run camara:perfil-deputados -- 57 --limite 50  # Legislatura 57, limitado a 50 deputados
 *   npm run camara:perfil-deputados -- --pc --verbose  # Salva no PC com logs detalhados
 */

import { PerfilDeputadosProcessor } from '../processors/perfil-deputados.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runSimpleEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * Configuração específica do processador de perfis de deputados
 */
function setupPerfilDeputadosParser() {
  const cli = createStandardETLParser('camara:perfil-deputados', 'Processador de Perfis de Deputados');
  
  // Opções específicas para processamento de perfis
  cli.addCustomOption('--mandatos', {
    description: 'Incluir dados dos mandatos dos deputados',
    defaultValue: true
  })
  .addCustomOption('--filiacoes', {
    description: 'Incluir histórico de filiações partidárias',
    defaultValue: true
  })
  .addCustomOption('--fotos', {
    description: 'Baixar e incluir fotos dos deputados',
    defaultValue: false
  })
  .addCustomOption('--orgaos', {
    description: 'Incluir participação em órgãos',
    defaultValue: true
  })
  .addCustomOption('--frentes', {
    description: 'Incluir participação em frentes parlamentares',
    defaultValue: true
  })
  .addCustomOption('--concorrencia', {
    description: 'Número de deputados processados em paralelo (padrão: 5)',
    validator: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 1 && num <= 10;
    },
    transformer: (value: string) => parseInt(value),
    defaultValue: 5
  });

  return cli;
}

/**
 * Função principal refatorada usando o executor genérico
 */
async function main(): Promise<void> {
  const cli = setupPerfilDeputadosParser();
  
  await runSimpleEtlProcessor(
    PerfilDeputadosProcessor,
    cli,
    'Perfis de Deputados'
  );
}

// Executar automaticamente se chamado diretamente
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}

export { main };