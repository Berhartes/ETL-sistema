/**
 * Processador ETL para Blocos Parlamentares da Câmara
 *
 * Implementa o fluxo ETL completo para extrair, transformar e carregar
 * blocos parlamentares incluindo seus partidos e membros.
 */

import { ETLProcessor } from '../core/etl-processor.js';
import {
  ValidationResult,
  BatchResult,
  ETLOptions,
  ProcessingStatus,
  ETLResult
} from '../types/etl.types.js';
import { createBatchManager } from '../utils/storage/index.js';
import { etlConfig } from '../../../../../config/index.js';
import { apiClient, get, replacePath } from '../utils/api/index.js';
import { endpoints } from '../config/endpoints.js';
import { withRetry } from '../utils/logging/error-handler.js';

/**
 * Interface para Bloco Parlamentar básico
 */
interface BlocoBasico {
  id: string;
  nome: string;
  idLegislatura: number;
}

/**
 * Interface para Bloco Parlamentar completo
 */
interface BlocoCompleto {
  id: string;
  nome: string;
  idLegislatura: number;
  detalhes: any;
  partidos: any[];
  membrosPartidos: Array<{
    partidoId: string;
    partidoNome: string;
    membros: any[];
  }>;
  dataExtracao: string;
}

/**
 * Interface para Partido do Bloco
 */
interface PartidoBloco {
  id: string;
  sigla: string;
  nome: string;
  uri: string;
}

/**
 * Dados extraídos da API
 */
interface ExtractedData {
  blocos: BlocoBasico[];
  blocosCompletos: BlocoCompleto[];
  totalProcessados: number;
}

/**
 * Dados transformados
 */
interface TransformedData {
  blocos: BlocoCompleto[];
  estatisticas: {
    totalBlocos: number;
    totalPartidos: number;
    totalMembros: number;
    blocosPorLegislatura: Record<number, number>;
  };
}

/**
 * Processador de Blocos Parlamentares
 */
export class BlocosProcessor extends ETLProcessor<ExtractedData, TransformedData> {
  constructor(options: ETLOptions) {
    super(options);
  }

  /**
   * Nome do processador
   */
  protected getProcessName(): string {
    return 'Processador de Blocos Parlamentares';
  }

  /**
   * Validação específica do processador
   */
  async validate(): Promise<ValidationResult> {
    const baseValidation = this.validateCommonParams();
    const erros = [...baseValidation.erros];
    const avisos = [...baseValidation.avisos];

    // Validações específicas de blocos
    if (!this.context.options.legislatura) {
      erros.push('Legislatura é obrigatória para extrair blocos');
    }

    // Avisos sobre configurações
    if (this.context.options.limite && this.context.options.limite > 50) {
      avisos.push('Limite muito alto pode causar lentidão. Considere processar em lotes menores.');
    }

    if (this.context.options.verbose) {
      avisos.push('Modo verbose ativo - logs detalhados serão exibidos.');
    }

    return {
      valido: erros.length === 0,
      erros,
      avisos
    };
  }

  /**
   * Extração de dados da API da Câmara
   */
  async extract(): Promise<ExtractedData> {
    const legislatura = this.context.options.legislatura!;
    const limite = this.context.options.limite || 0;

    this.emitProgress(ProcessingStatus.EXTRAINDO, 10, 'Iniciando extração de dados');

    try {
      // 1. Extrair lista de blocos da legislatura
      this.context.logger.info(`📋 Extraindo lista de blocos da ${legislatura}ª Legislatura`);
      const blocosBasicos = await this.extractBlocosLegislatura(legislatura);

      if (blocosBasicos.length === 0) {
        this.context.logger.warn('⚠️ Nenhum bloco encontrado para a legislatura especificada');
        return {
          blocos: [],
          blocosCompletos: [],
          totalProcessados: 0
        };
      }

      // Aplicar limite se especificado
      let blocosParaProcessar = blocosBasicos;
      if (limite > 0 && blocosBasicos.length > limite) {
        this.context.logger.info(`🔢 Aplicando limite: ${limite} de ${blocosBasicos.length} blocos`);
        blocosParaProcessar = blocosBasicos.slice(0, limite);
      }

      this.emitProgress(ProcessingStatus.EXTRAINDO, 30, `Extraindo detalhes de ${blocosParaProcessar.length} blocos`);

      // 2. Extrair detalhes completos de cada bloco
      const blocosCompletos = await this.extractBlocosCompletos(blocosParaProcessar);

      this.emitProgress(ProcessingStatus.EXTRAINDO, 90, 'Extração concluída');

      return {
        blocos: blocosBasicos,
        blocosCompletos,
        totalProcessados: blocosCompletos.length
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na extração: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai lista de blocos da legislatura
   */
  private async extractBlocosLegislatura(legislatura: number): Promise<BlocoBasico[]> {
    try {
      const endpointConfig = endpoints.BLOCOS.LISTA;
      const params = {
        ...endpointConfig.PARAMS,
        idLegislatura: legislatura.toString(),
        ordem: 'ASC',
        ordenarPor: 'nome'
      };

      // Usar getAllPages para extrair todas as páginas de blocos
      const todosBlocos = await apiClient.getAllPages(
        endpointConfig.PATH,
        params,
        {
          context: `Lista de blocos da legislatura ${legislatura}`,
          maxPages: 10
        }
      );

      if (!todosBlocos || !Array.isArray(todosBlocos)) {
        throw new Error(`Nenhum bloco encontrado para a legislatura ${legislatura}`);
      }

      const blocos: BlocoBasico[] = todosBlocos.map((bloco: any) => ({
        id: bloco.id?.toString() || '',
        nome: bloco.nome || '',
        idLegislatura: legislatura
      }));

      this.context.logger.info(`✅ Encontrados ${blocos.length} blocos na ${legislatura}ª Legislatura`);
      return blocos;

    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair lista de blocos: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai detalhes completos dos blocos
   */
  private async extractBlocosCompletos(blocos: BlocoBasico[]): Promise<BlocoCompleto[]> {
    const blocosCompletos: BlocoCompleto[] = [];
    const concorrencia = this.context.options.concorrencia || 2;

    this.context.logger.info(`🔄 Extraindo detalhes completos com concorrência: ${concorrencia}`);

    // Processar em lotes para controlar concorrência
    for (let i = 0; i < blocos.length; i += concorrencia) {
      const lote = blocos.slice(i, i + concorrencia);

      this.context.logger.info(`📦 Processando lote ${Math.floor(i / concorrencia) + 1}: ${lote.length} blocos`);

      // Processar lote em paralelo
      const promessas = lote.map(async (bloco) => {
        try {
          const blocoCompleto = await this.extractBlocoCompleto(bloco);
          this.incrementSucessos();
          return blocoCompleto;
        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao extrair bloco ${bloco.id}: ${error.message}`);
          this.incrementFalhas();
          return null;
        }
      });

      const resultados = await Promise.allSettled(promessas);

      // Coletar blocos válidos
      resultados.forEach((resultado) => {
        if (resultado.status === 'fulfilled' && resultado.value) {
          blocosCompletos.push(resultado.value);
        }
      });

      // Progresso
      const progresso = Math.min(90, 30 + (i / blocos.length) * 60);
      this.emitProgress(ProcessingStatus.EXTRAINDO, progresso, `${blocosCompletos.length}/${blocos.length} blocos extraídos`);

      // Pausa entre lotes
      if (i + concorrencia < blocos.length) {
        await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests));
      }
    }

    this.context.logger.info(`✅ Extração concluída: ${blocosCompletos.length} blocos de ${blocos.length} blocos`);
    return blocosCompletos;
  }

  /**
   * Extrai detalhes completos de um bloco
   */
  private async extractBlocoCompleto(bloco: BlocoBasico): Promise<BlocoCompleto> {
    try {
      // 1. Extrair detalhes do bloco
      const detalhes = await this.extractDetalhesBloco(bloco.id);

      // 2. Extrair partidos do bloco
      const partidos = await this.extractPartidosBloco(bloco.id);

      // 3. Extrair membros de cada partido
      const membrosPartidos = await this.extractMembrosPartidos(partidos, bloco.idLegislatura);

      return {
        id: bloco.id,
        nome: bloco.nome,
        idLegislatura: bloco.idLegislatura,
        detalhes,
        partidos,
        membrosPartidos,
        dataExtracao: new Date().toISOString()
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair bloco completo ${bloco.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai detalhes de um bloco específico
   */
  private async extractDetalhesBloco(blocoId: string): Promise<any> {
    const endpointConfig = endpoints.BLOCOS.DETALHES;
    const endpoint = replacePath(endpointConfig.PATH, { codigo: blocoId });

    const response = await withRetry(
      () => get(endpoint, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Detalhes do bloco ${blocoId}`
    );

    return response?.dados || {};
  }

  /**
   * Extrai partidos de um bloco
   */
  private async extractPartidosBloco(blocoId: string): Promise<PartidoBloco[]> {
    const endpoint = `/blocos/${blocoId}/partidos`;
    // Removemos os parâmetros de paginação, pois o endpoint não os suporta.
    const params = {}; 

    const response = await withRetry(
      () => get(endpoint, params),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Partidos do bloco ${blocoId}`
    );

    const partidos = response?.dados || [];
    return partidos.map((partido: any) => ({
      id: partido.id?.toString() || '',
      sigla: partido.sigla || '',
      nome: partido.nome || '',
      uri: partido.uri || ''
    }));
  }

  /**
   * Extrai membros de múltiplos partidos
   */
  private async extractMembrosPartidos(partidos: PartidoBloco[], legislatura: number): Promise<Array<{
    partidoId: string;
    partidoNome: string;
    membros: any[];
  }>> {
    const membrosPartidos: Array<{
      partidoId: string;
      partidoNome: string;
      membros: any[];
    }> = [];

    for (const partido of partidos) {
      try {
        const membros = await this.extractMembrosPartido(partido.id, legislatura);
        membrosPartidos.push({
          partidoId: partido.id,
          partidoNome: partido.nome,
          membros
        });
      } catch (error: any) {
        this.context.logger.warn(`⚠️ Erro ao extrair membros do partido ${partido.id}: ${error.message}`);
        membrosPartidos.push({
          partidoId: partido.id,
          partidoNome: partido.nome,
          membros: []
        });
      }
    }

    return membrosPartidos;
  }

  /**
   * Extrai membros de um partido específico
   */
  private async extractMembrosPartido(partidoId: string, legislatura: number): Promise<any[]> {
    const endpoint = `/partidos/${partidoId}/membros`;
    const params = {
      idLegislatura: legislatura.toString(),
      itens: '100',
      pagina: '1'
    };

    const response = await withRetry(
      () => get(endpoint, params),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Membros do partido ${partidoId}`
    );

    return response?.dados || [];
  }

  /**
   * Transformação dos dados extraídos
   */
  async transform(data: ExtractedData): Promise<TransformedData> {
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 10, 'Iniciando transformação dos dados');

    try {
      const blocosTransformados: BlocoCompleto[] = [];
      let totalPartidos = 0;
      let totalMembros = 0;
      const blocosPorLegislatura: Record<number, number> = {};

      for (let i = 0; i < data.blocosCompletos.length; i++) {
        const bloco = data.blocosCompletos[i];

        try {
          const blocoTransformado = this.transformBloco(bloco);
          blocosTransformados.push(blocoTransformado);

          // Atualizar estatísticas
          totalPartidos += bloco.partidos.length;
          totalMembros += bloco.membrosPartidos.reduce((sum, mp) => sum + mp.membros.length, 0);

          // Contar por legislatura
          blocosPorLegislatura[bloco.idLegislatura] = (blocosPorLegislatura[bloco.idLegislatura] || 0) + 1;

        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao transformar bloco: ${error.message}`);
          this.incrementFalhas();
        }

        // Progresso
        const progresso = Math.round((i / data.blocosCompletos.length) * 100);
        this.emitProgress(ProcessingStatus.TRANSFORMANDO, progresso, `${i + 1}/${data.blocosCompletos.length} blocos transformados`);
      }

      const estatisticas = {
        totalBlocos: blocosTransformados.length,
        totalPartidos,
        totalMembros,
        blocosPorLegislatura
      };

      this.context.logger.info(`✅ Transformação concluída: ${blocosTransformados.length} blocos transformados`);
      this.context.logger.info(`📊 Estatísticas: ${totalPartidos} partidos, ${totalMembros} membros`);

      return {
        blocos: blocosTransformados,
        estatisticas
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na transformação: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transforma bloco individual
   */
  private transformBloco(bloco: BlocoCompleto): BlocoCompleto {
    // Por enquanto, retorna o bloco como está
    // Aqui poderia haver transformações específicas dos dados
    return {
      ...bloco,
      dataExtracao: new Date().toISOString()
    };
  }

  /**
   * Carregamento dos dados transformados
   */
  async load(data: TransformedData): Promise<ETLResult> {
    this.emitProgress(ProcessingStatus.CARREGANDO, 5, 'Iniciando carregamento dos dados de blocos');
    const startTime = Date.now();
    const legislaturaAtual = this.context.options.legislatura!;
    const destinos = Array.isArray(this.context.options.destino)
      ? this.context.options.destino
      : [this.context.options.destino];

    let totalSucessos = 0;
    let totalFalhas = 0;

    const fs = await import('fs.js');
    const path = await import('path.js');
    const { getPCSaveDirectory } = await import('../utils/storage/firestore.js');

    // Lógica de salvamento para PC
    if (destinos.includes('pc')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 10, 'Salvando dados de blocos no PC');
      const rootSaveDir = getPCSaveDirectory() || './output_pc_blocos';
      // Base para 'blocos/legislaturas/{legislatura}'
      const legislaturaBaseDir = path.join(rootSaveDir, 'bancoDados_local', 'congressoNacional', 'camaraDeputados', 'blocos', 'legislaturas', `${legislaturaAtual}`);
      // Caminho para a subcoleção 'metadata' e o documento 'geral.json'
      const metadataDir = path.join(legislaturaBaseDir, 'metadata');
      const metadataSavePath = path.join(metadataDir, 'geral.json');

      try {
        fs.mkdirSync(legislaturaBaseDir, { recursive: true }); // Diretório para os itens individuais
        fs.mkdirSync(metadataDir, { recursive: true }); // Diretório para metadados

        // 1. Salvar cada bloco na coleção 'items' da legislatura
        for (const bloco of data.blocos) {
          const filePath = path.join(legislaturaBaseDir, `${bloco.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify(bloco, null, 2));
          totalSucessos++;
        }
        this.emitProgress(ProcessingStatus.CARREGANDO, 40, `Blocos da legislatura ${legislaturaAtual} salvos no PC`);
        
        // 2. Salvar metadados da legislatura
        const metadataPC = {
          legislatura: legislaturaAtual,
          totalBlocosProcessados: data.blocos.length,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '2.0',
            opcoes: this.context.options,
          }
        };
        fs.writeFileSync(metadataSavePath, JSON.stringify(metadataPC, null, 2));
        totalSucessos++;
        this.emitProgress(ProcessingStatus.CARREGANDO, 50, `Metadados dos blocos da legislatura ${legislaturaAtual} salvos no PC`);
        this.context.logger.info(`✅ Dados de blocos salvos no PC em: ${rootSaveDir}`);

      } catch (error: any) {
        this.context.logger.error(`❌ Erro ao salvar dados de blocos no PC: ${error.message}`);
        totalFalhas += data.blocos.length + 2; // Estimativa
      }
    }

    // Lógica de salvamento para Firestore
    if (destinos.includes('firestore') || destinos.includes('emulator')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 60, 'Iniciando salvamento de blocos no Firestore');
      const batchManager = await createBatchManager();
      let firestoreDocumentosSalvos = 0;
      let firestoreFalhas = 0;

      try {
        // 1. Salvar blocos individuais
        this.emitProgress(ProcessingStatus.CARREGANDO, 70, 'Salvando blocos individuais no Firestore');
        for (const bloco of data.blocos) {
          // O novo caminho para o documento do bloco, corrigido para ter um número par de segmentos.
          const firestorePath = `congressoNacional/camaraDeputados/legislatura/${legislaturaAtual}/blocos/${bloco.id}`;
          await batchManager.set(firestorePath, bloco);
        }
        
        // 2. Salvar metadados gerais de blocos (para esta legislatura)
        this.emitProgress(ProcessingStatus.CARREGANDO, 90, 'Salvando metadados de blocos no Firestore');
        const metadataFirestore = {
          legislatura: legislaturaAtual,
          totalBlocosProcessados: data.blocos.length,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '2.0',
            opcoes: this.context.options,
          }
        };
        // O novo caminho para os metadados, corrigido para ter um número par de segmentos e manter a consistência.
        const metadataPathFirestore = `congressoNacional/camaraDeputados/legislatura/${legislaturaAtual}/metadata/blocos`;
        await batchManager.set(metadataPathFirestore, metadataFirestore);

        this.emitProgress(ProcessingStatus.CARREGANDO, 95, 'Commit das operações de blocos no Firestore');
        const batchResult = await batchManager.commit();
        firestoreDocumentosSalvos = batchResult.sucessos;
        firestoreFalhas = batchResult.falhas;

        this.updateLoadStats(batchResult.total, firestoreDocumentosSalvos, firestoreFalhas);
        this.context.logger.info(`✅ Carregamento de blocos no Firestore concluído: ${firestoreDocumentosSalvos} documentos salvos.`);
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;

      } catch (error: any) {
        this.context.logger.error(`❌ Erro no carregamento de blocos para Firestore: ${error.message}`);
        if (error && typeof error === 'object' && 'sucessos' in error && 'falhas' in error) {
          const failedBatchResult = error as BatchResult;
          firestoreFalhas += failedBatchResult.falhas;
          firestoreDocumentosSalvos += failedBatchResult.sucessos;
        } else {
          firestoreFalhas += data.blocos.length + 2; // Estimativa
        }
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;
        this.updateLoadStats(data.blocos.length + 2, firestoreDocumentosSalvos, firestoreFalhas);
      }
    }
    
    const duration = Date.now() - startTime;
    this.emitProgress(ProcessingStatus.CARREGANDO, 100, 'Carregamento de blocos finalizado');

    return {
      sucessos: totalSucessos,
      falhas: totalFalhas,
        avisos: this.context.stats.avisos, // Usar avisos acumulados
        tempoProcessamento: duration / 1000,
        destino: destinos.join(', '),
        legislatura: this.context.options.legislatura,
        detalhes: {
          blocosProcessados: data.blocos.length,
          partidosProcessados: data.estatisticas.totalPartidos,
          membrosProcessados: data.estatisticas.totalMembros,
          metadadosSalvos: totalSucessos > 0 // Considerar metadados salvos se houve algum sucesso
        }
      };
    }
  }
// Última chave removida
