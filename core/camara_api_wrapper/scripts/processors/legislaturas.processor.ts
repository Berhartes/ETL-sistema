/**
 * Processador ETL para Legislaturas da Câmara
 */

import { ETLProcessor } from '../core/etl-processor.js';
import {
  ValidationResult,
  BatchResult, // Adicionado BatchResult
  ETLOptions,
  ProcessingStatus,
  ETLResult,
  // Tipos específicos de Legislaturas (a serem criados/ajustados em etl.types.ts)
  LegislaturaBasica,
  DetalhesLegislaturaAPI,
  LiderLegislaturaAPI,
  MembroMesaLegislaturaAPI,
  LegislaturaCompleta,
  LegislaturaExtractedData,
  LegislaturaTransformedData,
} from '../types/etl.types.js'; // Ajustar os tipos conforme necessário
import { createBatchManager } from '../utils/storage/index.js';
import { etlConfig } from '../../../../../config/index.js';
import { get, replacePath } from '../utils/api/index.js';
import { endpoints } from '../config/endpoints.js'; // Adicionar endpoints de legislaturas aqui
import { withRetry } from '../utils/logging/error-handler.js';

/**
 * Processador de Legislaturas da Câmara
 */
export class LegislaturasProcessor extends ETLProcessor<LegislaturaExtractedData, LegislaturaTransformedData> {
  constructor(options: ETLOptions) {
    super(options);
  }

  protected getProcessName(): string {
    return 'Processador de Legislaturas da Câmara';
  }

  async validate(): Promise<ValidationResult> {
    const baseValidation = this.validateCommonParams();
    const erros = [...baseValidation.erros];
    const avisos = [...baseValidation.avisos];

    // Validações específicas para legislaturas, se houver
    if (this.context.options.limite && this.context.options.limite > 5) { // Exemplo de aviso
      avisos.push('Processar muitas legislaturas com todos os detalhes pode ser demorado.');
    }

    return {
      valido: erros.length === 0,
      erros,
      avisos,
    };
  }

  async extract(): Promise<LegislaturaExtractedData> {
    const limite = this.context.options.limite || 0;
    this.emitProgress(ProcessingStatus.EXTRAINDO, 5, 'Iniciando extração de legislaturas');

    try {
      // 1. Extrair lista de legislaturas
      this.context.logger.info('📜 Extraindo lista de legislaturas');
      const legislaturasBasicas = await this.extractLegislaturasLista();

      if (legislaturasBasicas.length === 0) {
        this.context.logger.warn('⚠️ Nenhuma legislatura encontrada.');
        return {
          legislaturasBasicas: [],
          legislaturasCompletas: [],
          totalProcessados: 0,
        };
      }

      let legislaturasParaProcessar = legislaturasBasicas;
      if (limite > 0 && legislaturasBasicas.length > limite) {
        this.context.logger.info(`🔢 Aplicando limite: ${limite} de ${legislaturasBasicas.length} legislaturas`);
        legislaturasParaProcessar = legislaturasBasicas.slice(0, limite);
      }

      this.emitProgress(ProcessingStatus.EXTRAINDO, 20, `Extraindo detalhes de ${legislaturasParaProcessar.length} legislaturas`);

      // 2. Extrair detalhes completos de cada legislatura (detalhes, líderes, membros da mesa)
      const legislaturasCompletas = await this.extractLegislaturasCompletas(legislaturasParaProcessar);

      this.emitProgress(ProcessingStatus.EXTRAINDO, 90, 'Extração de legislaturas concluída');

      return {
        legislaturasBasicas,
        legislaturasCompletas,
        totalProcessados: legislaturasCompletas.length,
      };
    } catch (error: any) {
      this.context.logger.error(`❌ Erro na extração de legislaturas: ${error.message}`);
      throw error;
    }
  }

  private async extractLegislaturasLista(): Promise<LegislaturaBasica[]> {
    try {
      const endpointConfig = endpoints.LEGISLATURAS.LISTA;
      const params = { ...endpointConfig.PARAMS }; // Não há 'itens' ou 'pagina' aqui

      // A API de lista de legislaturas não é paginada, retorna todos os itens de uma vez.
      const response = await withRetry(
        () => get(endpointConfig.PATH, params),
        etlConfig.camara.maxRetries,
        etlConfig.camara.pauseBetweenRequests,
        'Lista de legislaturas',
      );

      const todasLegislaturasAPI = response?.dados; // A API encapsula a lista em 'dados'

      if (!todasLegislaturasAPI || !Array.isArray(todasLegislaturasAPI)) {
        this.context.logger.warn('Nenhum dado de legislatura retornado pela API ou formato inesperado.');
        return [];
      }

      const legislaturas: LegislaturaBasica[] = todasLegislaturasAPI.map((leg: any) => ({
        id: leg.id?.toString() || '',
        uri: leg.uri || '',
        dataInicio: leg.dataInicio || '',
        dataFim: leg.dataFim || '',
      }));

      this.context.logger.info(`✅ Encontradas ${legislaturas.length} legislaturas`);
      return legislaturas;
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair lista de legislaturas: ${error.message}`);
      throw error;
    }
  }

  private async extractLegislaturasCompletas(
    legislaturas: LegislaturaBasica[],
  ): Promise<LegislaturaCompleta[]> {
    const legislaturasCompletas: LegislaturaCompleta[] = [];
    const concorrencia = this.context.options.concorrencia || 1; // Processar uma por vez por padrão, pois são menos itens

    this.context.logger.info(`🔄 Extraindo detalhes, líderes e membros da mesa com concorrência: ${concorrencia}`);

    for (let i = 0; i < legislaturas.length; i += concorrencia) {
      const lote = legislaturas.slice(i, i + concorrencia);
      this.context.logger.info(`📦 Processando lote de legislaturas ${Math.floor(i / concorrencia) + 1}: ${lote.length} legislaturas`);

      const promessas = lote.map(async (legBasica) => {
        try {
          const detalhes = await this.extractDetalhesLegislatura(legBasica.id);
          const lideres = await this.extractLideresLegislatura(legBasica.id);
          const membrosMesa = await this.extractMembrosMesaLegislatura(legBasica.id);

          this.incrementSucessos();
          return {
            ...legBasica,
            detalhes,
            lideres,
            membrosMesa,
            dataExtracao: new Date().toISOString(),
          };
        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao extrair dados completos da legislatura ${legBasica.id}: ${error.message}`);
          this.incrementFalhas();
          return null;
        }
      });

      const resultados = await Promise.allSettled(promessas);
      resultados.forEach((resultado) => {
        if (resultado.status === 'fulfilled' && resultado.value) {
          legislaturasCompletas.push(resultado.value);
        }
      });

      const progresso = Math.min(90, 20 + ((i + lote.length) / legislaturas.length) * 70);
      this.emitProgress(ProcessingStatus.EXTRAINDO, progresso, `${legislaturasCompletas.length}/${legislaturas.length} legislaturas com detalhes`);

      if (i + concorrencia < legislaturas.length) {
        await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests));
      }
    }
    this.context.logger.info(`✅ Extração de detalhes concluída: ${legislaturasCompletas.length} de ${legislaturas.length} legislaturas`);
    return legislaturasCompletas;
  }

  private async extractDetalhesLegislatura(legislaturaId: string): Promise<DetalhesLegislaturaAPI | null> {
    const endpointConfig = endpoints.LEGISLATURAS.DETALHES; // Definir em endpoints.ts
    const path = replacePath(endpointConfig.PATH, { id: legislaturaId });
    try {
      const response = await withRetry(
        () => get(path, endpointConfig.PARAMS), // Sem parâmetros adicionais para este endpoint
        etlConfig.camara.maxRetries,
        etlConfig.camara.pauseBetweenRequests,
        `Detalhes da legislatura ${legislaturaId}`,
      );
      return response?.dados || null;
    } catch (error: any) {
      this.context.logger.warn(`⚠️ Erro ao buscar detalhes da legislatura ${legislaturaId}: ${error.message}. Detalhes não serão incluídos.`);
      return null;
    }
  }

  private async extractLideresLegislatura(legislaturaId: string): Promise<LiderLegislaturaAPI[]> {
    const endpointConfig = endpoints.LEGISLATURAS.LIDERES; // Definir em endpoints.ts
    const path = replacePath(endpointConfig.PATH, { id: legislaturaId });
    try {
      // Este endpoint pode não ser paginado ou retornar todos os líderes de uma vez.
      // Se for paginado, usar apiClient.getAllPages. Assumindo que não é por enquanto.
      const response = await withRetry(
        () => get(path, endpointConfig.PARAMS), // Sem parâmetros adicionais para este endpoint
        etlConfig.camara.maxRetries,
        etlConfig.camara.pauseBetweenRequests,
        `Líderes da legislatura ${legislaturaId}`,
      );
      return response?.dados || [];
    } catch (error: any) {
      this.context.logger.warn(`⚠️ Erro ao buscar líderes da legislatura ${legislaturaId}: ${error.message}. Líderes não serão incluídos.`);
      return [];
    }
  }

  private async extractMembrosMesaLegislatura(legislaturaId: string): Promise<MembroMesaLegislaturaAPI[]> {
    const endpointConfig = endpoints.LEGISLATURAS.MESA;
    const path = replacePath(endpointConfig.PATH, { id: legislaturaId });
    try {
      // A API de membros da mesa para uma legislatura não é paginada.
      const response = await withRetry(
        () => get(path, endpointConfig.PARAMS), // PARAMS aqui podem incluir dataInicio/dataFim opcionais
        etlConfig.camara.maxRetries,
        etlConfig.camara.pauseBetweenRequests,
        `Membros da mesa da legislatura ${legislaturaId}`,
      );
      const membrosMesaAPI = response?.dados; // A API encapsula a lista em 'dados'

      if (!membrosMesaAPI || !Array.isArray(membrosMesaAPI)) {
        this.context.logger.warn(`Nenhum dado de membros da mesa retornado para legislatura ${legislaturaId} ou formato inesperado.`);
        return [];
      }
      return membrosMesaAPI;
    } catch (error: any) {
      this.context.logger.warn(`⚠️ Erro ao buscar membros da mesa da legislatura ${legislaturaId}: ${error.message}. Membros da mesa não serão incluídos.`);
      return [];
    }
  }

  async transform(data: LegislaturaExtractedData): Promise<LegislaturaTransformedData> {
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 10, 'Iniciando transformação dos dados de legislaturas');
    const legislaturasTransformadas: LegislaturaCompleta[] = [];
    let totalLideresConsultados = 0;
    let totalMembrosMesaConsultados = 0;

    for (let i = 0; i < data.legislaturasCompletas.length; i++) {
      const legislatura = data.legislaturasCompletas[i];
      // Simples transformação por enquanto
      legislaturasTransformadas.push(legislatura);

      if (legislatura.lideres?.length) totalLideresConsultados += legislatura.lideres.length;
      if (legislatura.membrosMesa?.length) totalMembrosMesaConsultados += legislatura.membrosMesa.length;

      const progresso = Math.round(((i + 1) / data.legislaturasCompletas.length) * 100);
      this.emitProgress(ProcessingStatus.TRANSFORMANDO, progresso, `${i + 1}/${data.legislaturasCompletas.length} legislaturas transformadas`);
    }

    this.context.logger.info(`✅ Transformação concluída: ${legislaturasTransformadas.length} legislaturas transformadas`);
    return {
      legislaturas: legislaturasTransformadas,
      estatisticas: {
        totalLegislaturas: legislaturasTransformadas.length,
        totalLideres: totalLideresConsultados,
        totalMembrosMesa: totalMembrosMesaConsultados,
      },
    };
  }

  async load(data: LegislaturaTransformedData): Promise<ETLResult> {
    this.emitProgress(ProcessingStatus.CARREGANDO, 5, 'Iniciando carregamento dos dados de legislaturas');
    const startTime = Date.now();
    const destinos = Array.isArray(this.context.options.destino)
      ? this.context.options.destino
      : [this.context.options.destino];

    let totalSucessos = 0;
    let totalFalhas = 0;

    const fs = await import('fs.js');
    const path = await import('path.js');
    const { getPCSaveDirectory } = await import('../utils/storage/firestore/index.js');

    // Lógica de salvamento para PC
    if (destinos.includes('pc')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 10, 'Salvando dados de legislaturas no PC');
      const rootSaveDir = getPCSaveDirectory() || './output_pc_legislaturas';
      const baseSaveDir = path.join(rootSaveDir, 'bancoDados_local', 'congressoNacional', 'camaraDeputados', 'legislaturas');
      
      try {
        fs.mkdirSync(baseSaveDir, { recursive: true }); // Diretório principal para legislaturas

        // 1. Salvar legislaturas individuais
        for (const legislatura of data.legislaturas) {
          const filePath = path.join(baseSaveDir, `${legislatura.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify(legislatura, null, 2));
          totalSucessos++;
        }
        this.emitProgress(ProcessingStatus.CARREGANDO, 40, 'Legislaturas individuais salvas no PC');
        
        // 2. Salvar metadados gerais de legislaturas
        const metadataPC = {
          totalLegislaturasProcessadas: data.legislaturas.length,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '2.0',
            opcoes: this.context.options,
          }
        };
        const metadataFilePath = path.join(baseSaveDir, `metadata_geral.json`);
        fs.writeFileSync(metadataFilePath, JSON.stringify(metadataPC, null, 2));
        totalSucessos++;
        this.emitProgress(ProcessingStatus.CARREGANDO, 50, 'Metadados de legislaturas salvos no PC');
        this.context.logger.info(`✅ Dados de legislaturas salvos no PC em: ${rootSaveDir}`);

      } catch (error: any) {
        this.context.logger.error(`❌ Erro ao salvar dados de legislaturas no PC: ${error.message}`);
        totalFalhas += data.legislaturas.length + 1; // Estimativa
      }
    }

    // Lógica de salvamento para Firestore
    if (destinos.includes('firestore') || destinos.includes('emulator')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 60, 'Iniciando salvamento de legislaturas no Firestore');
      const batchManager = await createBatchManager();
      let firestoreDocumentosSalvos = 0;
      let firestoreFalhas = 0;

      try {
        // 1. Salvar dados de cada legislatura (principal, líderes, mesa)
        this.emitProgress(ProcessingStatus.CARREGANDO, 70, 'Salvando dados detalhados das legislaturas no Firestore');
        for (const legislatura of data.legislaturas) {
          const { lideres, membrosMesa, ...dadosPrincipaisLegislatura } = legislatura;

          // Salvar dados principais da legislatura
          const basePath = `congressoNacional/camaraDeputados/legislatura/${legislatura.id}`;
          await batchManager.set(basePath, dadosPrincipaisLegislatura);

          // Salvar líderes em subcoleção
          if (lideres && lideres.length > 0) {
            for (const lider of lideres) {
              // Assumindo que 'lider.id' ou uma combinação de campos pode gerar um ID único.
              // Se não houver ID, pode ser necessário gerar um ou usar um campo como 'cargo' se for único.
              // Para simplificar, se 'lider.idDeputado' existir, usaremos, senão um ID genérico.
              // A API de líderes da legislatura (https://dadosabertos.camara.leg.br/api/v2/legislaturas/{id}/lideres)
              // retorna o 'id' do deputado. Usaremos esse 'id'.
              let liderDocId = lider.id; // 'id' é o ID do deputado
              if (!liderDocId && lider.titulo) { // Fallback se 'id' não estiver presente
                liderDocId = lider.titulo.replace(/\s+/g, '_').toLowerCase();
              }
              if (!liderDocId) { // Último fallback
                liderDocId = `lider_${Date.now()}_${Math.random().toString(36).substring(7)}`;
              }
              const liderPath = `${basePath}/lideres/${liderDocId}`;
              await batchManager.set(liderPath, lider);
            }
          }

          // Salvar membros da mesa em subcoleção
          if (membrosMesa && membrosMesa.length > 0) {
            for (const membro of membrosMesa) {
              // A API de mesa diretora (https://dadosabertos.camara.leg.br/api/v2/legislaturas/{id}/mesa)
              // retorna o 'id' do deputado. Usaremos esse 'id'.
              let membroDocId = membro.id; // 'id' é o ID do deputado
              if (!membroDocId && membro.codTitulo) { // Fallback se 'id' não estiver presente
                membroDocId = `cargo_${membro.codTitulo}`;
              } else if (!membroDocId && membro.titulo) {
                membroDocId = membro.titulo.replace(/\s+/g, '_').toLowerCase();
              }
              if (!membroDocId) { // Último fallback
                membroDocId = `membro_${Date.now()}_${Math.random().toString(36).substring(7)}`;
              }
              const membroPath = `${basePath}/mesa/${membroDocId}`;
              await batchManager.set(membroPath, membro);
            }
          }
        }
        
        // 2. Salvar metadados gerais das legislaturas (isso pode permanecer como está)
        this.emitProgress(ProcessingStatus.CARREGANDO, 85, 'Salvando metadados gerais das legislaturas no Firestore');
        const metadataPathFirestore = `congressoNacional/camaraDeputados/legislatura/metadata`;
        await batchManager.set(metadataPathFirestore, {
          totalLegislaturasProcessadas: data.legislaturas.length,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '2.0',
            opcoes: this.context.options,
          },
        });

        this.emitProgress(ProcessingStatus.CARREGANDO, 95, 'Commit das operações de legislaturas no Firestore');
        const batchResult = await batchManager.commit();
        firestoreDocumentosSalvos = batchResult.sucessos;
        firestoreFalhas = batchResult.falhas;

        this.updateLoadStats(batchResult.total, firestoreDocumentosSalvos, firestoreFalhas);
        this.context.logger.info(`✅ Carregamento de legislaturas no Firestore concluído: ${firestoreDocumentosSalvos} documentos salvos.`);
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;

      } catch (error: any) {
        this.context.logger.error(`❌ Erro no carregamento de legislaturas para Firestore: ${error.message}`);
        if (error && typeof error === 'object' && 'sucessos' in error && 'falhas' in error) {
          const failedBatchResult = error as BatchResult;
          firestoreFalhas += failedBatchResult.falhas;
          firestoreDocumentosSalvos += failedBatchResult.sucessos;
        } else {
          firestoreFalhas += data.legislaturas.length + 1; // Estimativa
        }
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;
        this.updateLoadStats(data.legislaturas.length + 1, firestoreDocumentosSalvos, firestoreFalhas);
      }
    }
    
    const duration = Date.now() - startTime;
    this.emitProgress(ProcessingStatus.CARREGANDO, 100, 'Carregamento de legislaturas finalizado');

    return {
      sucessos: totalSucessos,
      falhas: totalFalhas,
      avisos: this.context.stats.avisos,
      tempoProcessamento: duration / 1000, // Usar duration calculado
      destino: destinos.join(', '),
      // legislatura: this.context.options.legislatura, // Legislatura já está no contexto de opções, não precisa repetir se for o mesmo.
      detalhes: {
        legislaturasProcessadas: data.legislaturas.length,
        lideresEncontrados: data.estatisticas.totalLideres,
        membrosMesaEncontrados: data.estatisticas.totalMembrosMesa,
        metadadosSalvos: totalSucessos > 0,
      },
    };
  }
}
