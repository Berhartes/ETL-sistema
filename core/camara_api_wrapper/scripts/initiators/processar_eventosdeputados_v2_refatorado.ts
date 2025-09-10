/**
 * Script para processar eventos de deputados da Câmara dos Deputados
 *
 * Sistema ETL Modular da Câmara dos Deputados v2.1 - REFATORADO
 * Utiliza o executor genérico para eliminar código duplicado
 *
 * Uso:
 *   npm run camara:eventos -- [legislatura] [opções]
 *
 * Exemplos:
 *   npm run camara:eventos                       # Processa legislatura atual
 *   npm run camara:eventos -- 57 --limite 100    # Legislatura 57, limitado a 100 eventos
 *   npm run camara:eventos -- --pc --verbose     # Salva no PC com logs detalhados
 */

import { EventosDeputadosProcessor } from '../processors/eventos-deputados.processor.js';
import { createStandardETLParser } from '../utils/cli/modern-etl-parser.js';
import { runSimpleEtlProcessor } from '../utils/etl/run-etl-processor.js';

/**
 * Configuração específica do processador de eventos
 */
function setupEventosParser() {
  const cli = createStandardETLParser('camara:eventos', 'Processador de Eventos de Deputados');
  
  // Opções específicas para processamento de eventos
  cli.addCustomOption('--data', {
    description: 'Processa a legislatura inteira, dividindo por ano. Ignora --data-inicio, --data-fim e --atualizar.'
  })
  .addCustomOption('--tipo-evento', {
    description: 'ID do tipo de evento para filtrar'
  })
  .addCustomOption('--situacao-evento', {
    description: 'Situação do evento para filtrar (Ex: Realizada, Cancelada)'
  })
  .addCustomOption('--concorrencia-deputados', {
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
  const cli = setupEventosParser();
  
  await runSimpleEtlProcessor(
    EventosDeputadosProcessor,
    cli,
    'Eventos de Deputados'
  );
}

// Executar automaticamente se chamado diretamente
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}

export { main };