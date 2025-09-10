/**
 * Parser CLI unificado e profissional para o sistema ETL
 * Versão modernizada usando yargs internamente
 * 
 * Este módulo fornece uma interface consistente para parsing
 * de argumentos de linha de comando em todos os scripts ETL.
 * 
 * NOVO: Usa yargs internamente para maior robustez e funcionalidade,
 * mantendo compatibilidade total com a API existente.
 */

import { ModernETLCommandParser } from './modern-etl-parser.js';
import { ETLOptions } from '../../types/etl.types.js';
import { logger, LogLevel } from '../logging/index.js';
import { etlConfig } from '../../../../../../config/index.js';

/**
 * Configuração para opções customizadas
 */
interface OptionConfig {
  description?: string;
  validator?: (value: string) => boolean;
  transformer?: (value: string) => any;
  defaultValue?: any;
}

/**
 * Configuração para argumentos posicionais
 */
interface PositionalArgumentConfig {
  description?: string;
  validator?: (value: any) => boolean;
  transformer?: (value: string) => any;
  defaultValue?: any;
  order?: number;
}

/**
 * Parser de linha de comando para scripts ETL
 * ATUALIZADO: Agora usa yargs internamente via ModernETLCommandParser
 * Mantém compatibilidade total com API existente
 */
export class ETLCommandParser {
  private modernParser: ModernETLCommandParser;

  constructor(scriptName: string, description: string) {
    // Delega para a implementação moderna com yargs
    this.modernParser = new ModernETLCommandParser(scriptName, description);
  }

  /**
   * Adiciona uma opção customizada (delegado para yargs)
   */
  addCustomOption(name: string, config: OptionConfig | ((value: string) => any)): this {
    this.modernParser.addCustomOption(name, config);
    return this;
  }

  /**
   * Adiciona um argumento posicional (delegado para yargs)
   */
  addPositionalArgument(name: string, config: PositionalArgumentConfig): this {
    this.modernParser.addPositionalArgument(name, config);
    return this;
  }

  /**
   * Faz o parse dos argumentos usando yargs e retorna as opções
   * Mantém compatibilidade total com chamadas existentes
   */
  parse(argv?: string[]): ETLOptions {
    // Delegar para a implementação moderna com yargs
    return this.modernParser.parse(argv);
  }

  /**
   * Exibe a mensagem de ajuda (delegado para yargs)
   */
  showHelp(): void {
    this.modernParser.showHelp();
  }

}

/**
 * Função helper para criar parser com configurações padrão
 * Agora usa a implementação modernizada com yargs
 */
export function createETLParser(scriptName: string, description: string): ETLCommandParser {
  return new ETLCommandParser(scriptName, description);
}
