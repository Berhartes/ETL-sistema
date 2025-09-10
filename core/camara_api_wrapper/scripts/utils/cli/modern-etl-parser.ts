/**
 * ETLCommandParser Modernizado com yargs
 * 
 * Esta versão mantém compatibilidade com a API existente enquanto
 * usa yargs internamente para parsing mais robusto e declarativo.
 */

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { ETLOptions } from '../../types/etl.types.js';
import { logger, LogLevel } from '../logging/index.js';
// ✅ CONFIGURAÇÃO CENTRALIZADA: Import direto para máxima robustez
import { etlConfig } from '../../config/etl.config.js';

/**
 * Configuração para opções customizadas (mantém compatibilidade)
 */
interface OptionConfig {
  description?: string;
  validator?: (value: string) => boolean;
  transformer?: (value: string) => any;
  defaultValue?: any;
}

/**
 * Configuração para argumentos posicionais (mantém compatibilidade)
 */
interface PositionalArgumentConfig {
  description?: string;
  validator?: (value: any) => boolean;
  transformer?: (value: string) => any;
  defaultValue?: any;
  order?: number;
}

/**
 * ETLCommandParser moderno usando yargs internamente
 * Mantém compatibilidade total com API existente
 */
export class ModernETLCommandParser {
  private scriptName: string;
  private description: string;
  private customOptions: Map<string, OptionConfig | ((value: string) => any)> = new Map();
  private positionalArgs: Array<{ name: string } & PositionalArgumentConfig> = [];

  constructor(scriptName: string, description: string) {
    this.scriptName = scriptName;
    this.description = description;
  }

  /**
   * Adiciona uma opção customizada (API compatível)
   */
  addCustomOption(name: string, config: OptionConfig | ((value: string) => any)): this {
    this.customOptions.set(name, config);
    return this;
  }

  /**
   * Adiciona um argumento posicional (API compatível)
   */
  addPositionalArgument(name: string, config: PositionalArgumentConfig): this {
    this.positionalArgs.push({ name, ...config });
    this.positionalArgs.sort((a, b) => (a.order || 0) - (b.order || 0));
    return this;
  }

  /**
   * Parse usando yargs com DUAL SYNTAX - argumentos posicionais E flags nomeadas
   * 
   * SUPORTADO:
   * - Sintaxe atual: npm run etl:despesas -- 57 11 --firestore
   * - Sintaxe nova:  npm run etl:despesas -- --legislatura 57 --limite 11 --firestore  
   * - Híbrida:       npm run etl:despesas -- 57 --limite 11 --firestore
   */
  parse(argv?: string[]): ETLOptions {
    const inputArgs = argv ? argv : process.argv.slice(2);
    
    let yargsInstance = yargs(argv ? argv : hideBin(process.argv))
      .scriptName(`npm run ${this.scriptName}`)
      .usage(this.description)
      .version(false)
      .strict(false) // Allow positional args and unknown options
      .parserConfiguration({
        'camel-case-expansion': false,
        'strip-aliased': false,
        'strip-dashed': false,
        'parse-positional-numbers': true // Handle numeric positionals better
      });

    // Configure yargs with all standard ETL options
    this.configureStandardOptions(yargsInstance);
    
    // Add custom options
    this.configureCustomOptions(yargsInstance);
    
    // 🔄 DUAL SYNTAX: Configure argumentos posicionais nativamente no yargs
    this.configurePositionalArguments(yargsInstance);
    
    // Configure help
    this.configureHelp(yargsInstance);

    // Parse arguments
    const parsedArgs = yargsInstance.parseSync();

    // 🎨 DUAL SYNTAX: Process legacy positional syntax if needed
    const processedArgs = this.handleLegacyPositionalSyntax(parsedArgs, inputArgs);

    // Convert to ETLOptions format
    return this.convertToETLOptions(processedArgs);
  }

  private configureStandardOptions(yargsInstance: any): void {
    yargsInstance
      // Legislatura options (integração com argumentos posicionais)
      .option('legislatura', {
        alias: 'l',
        type: 'number',
        description: `Número da legislatura (${etlConfig.camara.legislatura.min}-${etlConfig.camara.legislatura.max}) - pode ser posicional`,
        coerce: (value: number) => {
          if (value < etlConfig.camara.legislatura.min || value > etlConfig.camara.legislatura.max) {
            throw new Error(`Legislatura inválida: ${value}. Deve estar entre ${etlConfig.camara.legislatura.min} e ${etlConfig.camara.legislatura.max}`);
          }
          return value;
        }
      })
      
      // Shortcuts for legislaturas
      .option('57', {
        type: 'boolean',
        description: 'Atalho para legislatura 57',
        hidden: false
      })
      .option('58', {
        type: 'boolean',
        description: 'Atalho para legislatura 58',
        hidden: false
      })

      // Filters
      .option('limite', {
        type: 'number',
        description: 'Limita o processamento a N itens (0 = sem limite) - pode ser posicional',
        coerce: (value: number) => {
          if (value < 0 || value > 1000) {
            throw new Error(`Limite inválido: ${value}. Deve estar entre 0 e 1000.`);
          }
          return value;
        }
      })
      
      .option('deputado', {
        alias: 'd',
        type: 'string',
        description: 'Processa apenas o deputado especificado'
      })
      
      .option('partido', {
        type: 'string',
        description: 'Filtra por partido (ex: PT, PSDB)',
        coerce: (value: string) => value.toUpperCase()
      })
      
      .option('uf', {
        type: 'string',
        description: 'Filtra por estado (ex: SP, RJ)',
        coerce: (value: string) => {
          const uf = value.toUpperCase();
          const ufsValidas = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 
                            'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 
                            'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
          if (!ufsValidas.includes(uf)) {
            throw new Error(`UF inválida: ${uf}. Use uma sigla válida de estado brasileiro.`);
          }
          return uf;
        }
      })

      // Date filters
      .option('data-inicio', {
        type: 'string',
        description: 'Data de início (YYYY-MM-DD)',
        coerce: (value: string) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new Error(`Formato de data inválido: ${value}. Use YYYY-MM-DD`);
          }
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            throw new Error(`Data inválida: ${value}`);
          }
          return value;
        }
      })
      
      .option('data-fim', {
        type: 'string',
        description: 'Data de fim (YYYY-MM-DD)',
        coerce: (value: string) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new Error(`Formato de data inválido: ${value}. Use YYYY-MM-DD`);
          }
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            throw new Error(`Data inválida: ${value}`);
          }
          return value;
        }
      })

      // Destination options
      .option('firestore', {
        type: 'boolean',
        description: 'Salva no Firestore (produção) - PADRÃO'
      })
      
      .option('emulator', {
        type: 'boolean',
        description: 'Usa o Firestore Emulator'
      })
      
      .option('pc', {
        alias: 'local',
        type: 'boolean',
        description: 'Salva localmente no PC'
      })

      // Execution options
      .option('verbose', {
        alias: 'v',
        type: 'boolean',
        description: 'Modo verboso com logs detalhados'
      })
      
      .option('dry-run', {
        type: 'boolean',
        description: 'Simula execução sem salvar dados'
      })
      
      .option('force', {
        type: 'boolean',
        description: 'Força atualização mesmo se já processado'
      });
  }

  private configureCustomOptions(yargsInstance: any): void {
    this.customOptions.forEach((config, name) => {
      const optionName = name.replace('--', '');
      
      if (typeof config === 'function') {
        // Legacy function-based config
        yargsInstance.option(optionName, {
          type: 'string',
          description: `Opção customizada: ${optionName}`,
          coerce: config
        });
      } else if (config) {
        // Modern object-based config
        yargsInstance.option(optionName, {
          type: 'string',
          description: config.description || `Opção customizada: ${optionName}`,
          default: config.defaultValue,
          required: false,
          coerce: (value: any) => {
            // Skip validation for undefined/null values (optional parameters)
            if (value === undefined || value === null || value === config.defaultValue) {
              return config.defaultValue;
            }
            // Only validate and transform actual provided values
            if (config.validator && !config.validator(String(value))) {
              throw new Error(`Valor inválido para --${optionName}: ${value}`);
            }
            return config.transformer ? config.transformer(String(value)) : value;
          }
        });
      }
    });
  }

  /**
   * 🎯 REFINED: Detecta sintaxe posicional mais precisamente
   */
  private isLegacyPositionalSyntax(args: string[]): boolean {
    if (args.length === 0) return false;
    
    // Filtra argumentos que não são flags (não começam com -)
    const nonFlagArgs = args.filter(arg => !arg.startsWith('-'));
    if (nonFlagArgs.length === 0) return false;
    
    // Se já tem flags nomeadas para legislatura ou limite, não é sintaxe posicional
    const hasNamedFlags = args.some(arg => 
      arg === '--legislatura' || arg === '-l' || arg === '--limite'
    );
    if (hasNamedFlags) return false;
    
    // Verifica se há números nas primeiras 3 posições (indicativo de sintaxe legada)
    const firstThreeNonFlags = nonFlagArgs.slice(0, 3);
    const numericArgs = firstThreeNonFlags.filter(arg => /^\d+$/.test(arg));
    
    // Se há números soltos e estão nas primeiras posições dos argumentos, é sintaxe legada
    return numericArgs.length > 0 && args.indexOf(numericArgs[0]) <= 2;
  }

  /**
   * 🔄 UNIFIED: Configura argumentos posicionais nativamente no yargs
   */
  private configurePositionalArguments(yargsInstance: any): void {
    // Configurar argumentos posicionais como opções que também podem ser posicionais
    this.positionalArgs.forEach((posArg, index) => {
      const optionConfig = {
        description: posArg.description || `${posArg.name} (posicional: posição ${index + 1} ou --${posArg.name})`,
        type: this.inferYargsType(posArg),
        default: posArg.defaultValue,
        coerce: (value: any) => {
          if (value === undefined || value === null) return posArg.defaultValue;
          
          let processedValue = posArg.transformer ? posArg.transformer(String(value)) : value;
          
          if (posArg.validator && !posArg.validator(processedValue)) {
            throw new Error(`Valor inválido para '${posArg.name}': ${value}`);
          }
          
          return processedValue;
        }
      };
      
      yargsInstance.option(posArg.name, optionConfig);
    });
  }
  
  /**
   * Infer yargs type from positional argument config
   */
  private inferYargsType(posArg: { name: string } & PositionalArgumentConfig): 'string' | 'number' | 'boolean' {
    if (posArg.name === 'legislatura' || posArg.name === 'limite') return 'number';
    if (posArg.transformer && posArg.transformer.toString().includes('parseInt')) return 'number';
    return 'string';
  }

  /**
   * 🎨 REFINED: Handle legacy positional syntax more elegantly
   */
  private handleLegacyPositionalSyntax(parsedArgs: any, inputArgs: string[]): any {
    // Se não há sintaxe posicional ou argumentos já foram definidos via flags, retorna como está
    if (!this.isLegacyPositionalSyntax(inputArgs)) {
      return parsedArgs;
    }
    
    const result = { ...parsedArgs };
    const nonFlagArgs = inputArgs.filter(arg => !arg.startsWith('-'));
    
    // Aplica mapeamento direto baseado na configuração dos argumentos posicionais
    this.positionalArgs.forEach((posArg, index) => {
      // Só sobrescreve se o valor não foi definido via flag e há argumento posicional disponível
      if (index < nonFlagArgs.length && (result[posArg.name] === undefined || result[posArg.name] === posArg.defaultValue)) {
        const rawValue = nonFlagArgs[index];
        
        try {
          let processedValue = posArg.transformer ? posArg.transformer(rawValue) : rawValue;
          
          if (posArg.validator && !posArg.validator(processedValue)) {
            logger.warn(`Argumento posicional inválido para '${posArg.name}': ${rawValue}. Usando padrão: ${posArg.defaultValue}`);
            processedValue = posArg.defaultValue;
          }
          
          result[posArg.name] = processedValue;
        } catch (error) {
          logger.warn(`Erro ao processar argumento posicional '${posArg.name}': ${rawValue}. Usando padrão: ${posArg.defaultValue}`);
          result[posArg.name] = posArg.defaultValue;
        }
      }
    });
    
    return result;
  }

  private configureHelp(yargsInstance: any): void {
    yargsInstance
      .usage(`\n${this.description}\n\n🎯 Sistema dual de argumentos\n\nUso: npm run ${this.scriptName} [legislatura] [limite] [opções]`)
      .example(`npm run ${this.scriptName}`, 'Configuração padrão')
      .example(``, '')
      .example(`# 📍 Sintaxe posicional (compatível):`, '')
      .example(`npm run ${this.scriptName} -- 57 11 --firestore`, 'Legislatura 57, limite 11')
      .example(`npm run ${this.scriptName} -- 57 --verbose`, 'Legislatura 57, sem limite')
      .example(`npm run ${this.scriptName} -- 58 5 --emulator --debug`, 'Teste com 5 deputados')
      .example(``, '')
      .example(`# 🏷️ Sintaxe nomeada (mais explícita):`, '')
      .example(`npm run ${this.scriptName} -- --legislatura 57 --limite 11`, 'Flags nomeadas')
      .example(`npm run ${this.scriptName} -- -l 57 --limite 11 --verbose`, 'Com aliases')
      .example(`npm run ${this.scriptName} -- --legislatura 58 --debug`, 'Filtros avançados')
      .example(``, '')
      .example(`# 🔄 Sintaxe híbrida:`, '')
      .example(`npm run ${this.scriptName} -- 57 --limite 11 --firestore`, 'Posicional + nomeada')
      .example(`npm run ${this.scriptName} -- 57 --verbose`, 'Combinação de sintaxes')
      .epilogue(`
🎯 Detecção automática: O sistema detecta automaticamente qual sintaxe você está usando.

🔧 VARIÁVEIS DE AMBIENTE:
  CAMARA_CONCURRENCY        Requisições simultâneas (padrão: ${etlConfig.camara.concurrency})
  CAMARA_MAX_RETRIES        Tentativas máximas (padrão: ${etlConfig.camara.maxRetries})
  FIRESTORE_EMULATOR_HOST   Host do emulator (padrão: ${etlConfig.firestore.emulatorHost})
  LOG_LEVEL                 Nível de log: error, warn, info, debug (padrão: ${etlConfig.logging.level})

✨ Compatibilidade total: Todos os comandos existentes continuam funcionando.
📖 Mais informações: Execute com --verbose para logs detalhados`)
      .help()
      .alias('help', 'h');
  }

  private convertToETLOptions(parsedArgs: any): ETLOptions {
    // Handle legislatura shortcuts
    let legislatura = parsedArgs.legislatura;
    if (parsedArgs['57']) legislatura = 57;
    if (parsedArgs['58']) legislatura = 58;

    // Handle destination options
    const destino: ('firestore' | 'emulator' | 'pc')[] = [];
    if (parsedArgs.firestore || (!parsedArgs.emulator && !parsedArgs.pc)) {
      destino.push('firestore');
    }
    if (parsedArgs.emulator) destino.push('emulator');
    if (parsedArgs.pc) destino.push('pc');

    // Validate date range
    if (parsedArgs.dataInicio && parsedArgs.dataFim) {
      const inicio = new Date(parsedArgs.dataInicio);
      const fim = new Date(parsedArgs.dataFim);
      
      if (inicio > fim) {
        throw new Error('Data de início não pode ser posterior à data de fim');
      }
    }

    // Configure logger if verbose
    if (parsedArgs.verbose) {
      logger.setLevel(LogLevel.DEBUG);
    }

    // Convert to ETLOptions format
    const options: ETLOptions = {
      legislatura,
      limite: parsedArgs.limite,
      deputado: parsedArgs.deputado,
      partido: parsedArgs.partido,
      uf: parsedArgs.uf,
      dataInicio: parsedArgs.dataInicio,
      dataFim: parsedArgs.dataFim,
      destino: destino.length > 0 ? destino : ['firestore'],
      verbose: parsedArgs.verbose,
      dryRun: parsedArgs.dryRun,
      forceUpdate: parsedArgs.force
    };

    // Add custom options - only if they have actual values (not undefined)
    this.customOptions.forEach((_, name) => {
      const optionName = name.replace('--', '');
      const value = parsedArgs[optionName];
      if (value !== undefined && value !== null) {
        options[optionName] = value;
      }
    });

    // Add positional arguments
    this.positionalArgs.forEach((posArg) => {
      if (parsedArgs[posArg.name] !== undefined) {
        options[posArg.name] = parsedArgs[posArg.name];
      }
    });

    return options;
  }

  /**
   * Show help (compatibility method)
   */
  showHelp(): void {
    // This will be handled by yargs automatically
    process.exit(0);
  }
}

/**
 * Factory function - RECOMENDADA para clean code
 * Esconde detalhes de implementação e oferece interface mais limpa
 */
export function createModernETLParser(scriptName: string, description: string): ModernETLCommandParser {
  return new ModernETLCommandParser(scriptName, description);
}

/**
 * Factory function com configuração pré-definida para scripts ETL padrão
 * Inclui configurações comuns para argumentos posicionais (legislatura, limite)
 */
export function createStandardETLParser(scriptName: string, description: string): ModernETLCommandParser {
  const parser = new ModernETLCommandParser(scriptName, description);
  
  // Configurar argumentos posicionais padrão com validações robustas
  parser
    .addPositionalArgument('legislatura', {
      description: `Número da legislatura (${etlConfig.camara.legislatura.min}-${etlConfig.camara.legislatura.max}) - ex: 57`,
      transformer: (value: string) => {
        const num = parseInt(value);
        if (isNaN(num)) throw new Error(`Legislatura deve ser um número: ${value}`);
        return num;
      },
      validator: (value: number) => 
        value >= etlConfig.camara.legislatura.min && value <= etlConfig.camara.legislatura.max,
      defaultValue: etlConfig.camara.legislatura.atual || 57,
      order: 0
    })
    .addPositionalArgument('limite', {
      description: 'Número máximo de itens a processar (0 = sem limite)',
      transformer: (value: string) => {
        const num = parseInt(value);
        if (isNaN(num)) throw new Error(`Limite deve ser um número: ${value}`);
        return num;
      },
      validator: (value: number) => value >= 0 && value <= 1000, // Limite razoável para segurança
      defaultValue: 0,
      order: 1
    });
    
  return parser;
}