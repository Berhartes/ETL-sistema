/**
 * Processador ETL para Frentes Parlamentares da Câmara dos Deputados
 *
 * Implementa o fluxo ETL completo para extrair, transformar e carregar
 * informações sobre frentes parlamentares e seus membros.
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
import { apiClient, get } from '../utils/api/index.js';
import { withRetry } from '../utils/logging/error-handler.js';

/**
 * Interface para Frente Parlamentar
 */
interface FrenteParlamentar {
  id: number;
  uri: string;
  titulo: string;
  idLegislatura: number;
  coordenador?: any;
  telefone?: string;
  email?: string;
  urlDocumento?: string;
  situacao?: string;
}

/**
 * Interface para Membro de Frente
 */
interface MembroFrente {
  id: number;
  uri: string;
  nome: string;
  siglaPartido: string;
  uriPartido: string;
  siglaUf: string;
  idLegislatura: number;
  urlFoto: string;
  email?: string;
  titulo?: string;
  codTitulo?: number;
  dataInicio?: string;
  dataFim?: string;
}

/**
 * Dados extraídos da API
 */
interface ExtractedData {
  frentes: FrenteParlamentar[];
  detalhesFrente: Map<number, any>;
  membrosPorFrente: Map<number, MembroFrente[]>;
  totalProcessados: number;
}

/**
 * Dados transformados
 */
interface TransformedData {
  frentes: Array<{
    id: number;
    titulo: string;
    idLegislatura: number;
    coordenador?: any;
    telefone?: string;
    email?: string;
    urlDocumento?: string;
    situacao?: string;
    totalMembros: number;
    membros?: MembroFrente[];
    dataExtracao: string;
  }>;
  estatisticas: {
    totalFrentes: number;
    totalMembros: number;
    frentesComCoordenador: number;
    frentesComMembros: number;
    membrosPorPartido: Record<string, number>;
    membrosPorUF: Record<string, number>;
  };
}

/**
 * Processador de Frentes Parlamentares
 */
export class FrentesProcessor extends ETLProcessor<ExtractedData, TransformedData> {
  constructor(options: ETLOptions) {
    super(options);
  }

  /**
   * Nome do processador
   */
  protected getProcessName(): string {
    return 'Processador de Frentes Parlamentares';
  }

  /**
   * Validação específica do processador
   */
  async validate(): Promise<ValidationResult> {
    const baseValidation = this.validateCommonParams();
    const erros = [...baseValidation.erros];
    const avisos = [...baseValidation.avisos];

    // Validações específicas de frentes
    if (!this.context.options.legislatura) {
      erros.push('Legislatura é obrigatória para extrair frentes');
    }

    // Avisos sobre opções
    if (!this.context.options.incluirMembros) {
      avisos.push('Membros das frentes não serão extraídos');
    }

    if (!this.context.options.incluirDetalhes) {
      avisos.push('Detalhes completos das frentes não serão extraídos');
    }

    // Avisos sobre volume de dados
    if (!this.context.options.limite) {
      avisos.push('Processamento sem limite pode ser demorado. Considere usar --limite.');
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
    const incluirDetalhes = this.context.options.incluirDetalhes !== false;
    const incluirMembros = this.context.options.incluirMembros !== false;

    this.emitProgress(ProcessingStatus.EXTRAINDO, 10, 'Iniciando extração de frentes parlamentares');

    try {
      // Extrair lista de frentes
      this.context.logger.info(`📋 Extraindo frentes da ${legislatura}ª Legislatura`);
      let frentesParaProcessar = await this.extractListaFrentes(legislatura);

      // Aplicar limite se especificado
      if (limite > 0 && frentesParaProcessar.length > limite) {
        this.context.logger.info(`🔢 Aplicando limite: ${limite} de ${frentesParaProcessar.length} frentes`);
        frentesParaProcessar = frentesParaProcessar.slice(0, limite);
      }

      if (frentesParaProcessar.length === 0) {
        this.context.logger.warn('⚠️ Nenhuma frente encontrada para a legislatura especificada');
        return {
          frentes: [],
          detalhesFrente: new Map(),
          membrosPorFrente: new Map(),
          totalProcessados: 0
        };
      }

      this.emitProgress(ProcessingStatus.EXTRAINDO, 30, `Extraindo dados de ${frentesParaProcessar.length} frentes`);

      // Extrair detalhes e membros de cada frente
      const detalhesFrente = new Map<number, any>();
      const membrosPorFrente = new Map<number, MembroFrente[]>();

      // Processar frentes com concorrência controlada
      const concorrencia = this.context.options.concorrencia || 3;
      for (let i = 0; i < frentesParaProcessar.length; i += concorrencia) {
        const lote = frentesParaProcessar.slice(i, i + concorrencia);

        this.context.logger.info(`📦 Processando lote ${Math.floor(i / concorrencia) + 1}: ${lote.length} frentes`);

        const promessas = lote.map(async (frente) => {
          try {
            // Extrair detalhes
            if (incluirDetalhes) {
              const detalhes = await this.extractDetalhesFrente(frente.id);
              detalhesFrente.set(frente.id, detalhes);
            }

            // Extrair membros
            if (incluirMembros) {
              const membros = await this.extractMembrosFrente(frente.id);
              membrosPorFrente.set(frente.id, membros);
            }

            this.incrementSucessos();
          } catch (error: any) {
            this.context.logger.error(`❌ Erro ao processar frente ${frente.id}: ${error.message}`);
            this.incrementFalhas();
          }
        });

        await Promise.allSettled(promessas);

        // Progresso
        const progresso = Math.min(90, 30 + (i / frentesParaProcessar.length) * 60);
        this.emitProgress(ProcessingStatus.EXTRAINDO, progresso, `${Math.min(i + concorrencia, frentesParaProcessar.length)}/${frentesParaProcessar.length} frentes processadas`);

        // Pausa entre lotes
        if (i + concorrencia < frentesParaProcessar.length) {
          await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests));
        }
      }

      this.emitProgress(ProcessingStatus.EXTRAINDO, 90, 'Extração concluída');

      return {
        frentes: frentesParaProcessar,
        detalhesFrente,
        membrosPorFrente,
        totalProcessados: frentesParaProcessar.length
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na extração: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai lista de frentes de uma legislatura
   */
  private async extractListaFrentes(legislatura: number): Promise<FrenteParlamentar[]> {
    try {
      // Configurar endpoint para frentes
      const endpointConfig = {
        PATH: '/frentes',
        PARAMS: {
          idLegislatura: legislatura.toString(),
          itens: String(etlConfig.camara.itemsPerPage || 100),
          pagina: '1'
        }
      };

      // Usar getAllPages para extrair todas as páginas automaticamente
      const todasFrentes = await apiClient.getAllPages(
        endpointConfig.PATH,
        endpointConfig.PARAMS,
        {
          context: `Lista de frentes da legislatura ${legislatura}`,
          maxPages: 50 // Limite de segurança
        }
      );

      const frentes: FrenteParlamentar[] = todasFrentes.map((frente: any) => ({
        id: frente.id,
        uri: frente.uri,
        titulo: frente.titulo,
        idLegislatura: frente.idLegislatura
      }));

      this.context.logger.info(`✅ Encontradas ${frentes.length} frentes na ${legislatura}ª Legislatura`);
      return frentes;

    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair lista de frentes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai detalhes de uma frente específica
   */
  private async extractDetalhesFrente(frenteId: number): Promise<any> {
    try {
      const endpoint = `/frentes/${frenteId}`;
      
      const response = await withRetry(
        () => get(endpoint, {}),
        etlConfig.camara.maxRetries,
        etlConfig.camara.pauseBetweenRequests,
        `Detalhes da frente ${frenteId}`
      );

      return response?.dados || null;

    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair detalhes da frente ${frenteId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extrai membros de uma frente
   */
  private async extractMembrosFrente(frenteId: number): Promise<MembroFrente[]> {
    try {
      const path = `/frentes/${frenteId}/membros`; // Caminho direto para o endpoint

      // Fazer uma chamada GET direta, sem parâmetros de paginação extras
      const response = await apiClient.get(
        path,
        {}, // Nenhum parâmetro adicional como 'pagina' ou 'itens'
        {
          context: `Membros da frente ${frenteId}`
        }
      );

      // A API da Câmara geralmente retorna os dados dentro de um campo "dados"
      // O XML de exemplo mostra <dados><papelParlamentarPeriodo>...</papelParlamentarPeriodo></dados>
      // Se a resposta JSON seguir essa estrutura, response.dados será um objeto contendo o array.
      // Se o endpoint /membros retorna diretamente um array em 'dados', então response.dados já é o array.
      // Pelo XML, parece que 'dados' contém múltiplos 'papelParlamentarPeriodo'.
      // O cliente Axios com 'Accept: application/json' deve receber um JSON onde 'dados' é um array de membros.
      const todosMembros = response?.dados || []; 

      if (!Array.isArray(todosMembros)) {
        this.context.logger.warn(`⚠️ Resposta de membros para frente ${frenteId} não é um array. Conteúdo:`, todosMembros);
        // Se 'dados' for um objeto com uma propriedade que é o array (ex: response.dados.papelParlamentarPeriodo),
        // seria necessário ajustar aqui.
        return [];
      }

      const membros: MembroFrente[] = todosMembros.map((membro: any) => ({
        id: membro.id,
        uri: membro.uri,
        nome: membro.nome,
        siglaPartido: membro.siglaPartido,
        uriPartido: membro.uriPartido,
        siglaUf: membro.siglaUf,
        idLegislatura: membro.idLegislatura,
        urlFoto: membro.urlFoto,
        email: membro.email,
        titulo: membro.titulo,
        codTitulo: membro.codTitulo,
        dataInicio: membro.dataInicio,
        dataFim: membro.dataFim
      }));

      this.context.logger.debug(`✅ Encontrados ${membros.length} membros na frente ${frenteId}`);
      return membros;

    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair membros da frente ${frenteId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Transformação dos dados extraídos
   */
  async transform(data: ExtractedData): Promise<TransformedData> {
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 10, 'Iniciando transformação dos dados');

    try {
      const frentesTransformadas: TransformedData['frentes'] = [];
      const membrosPorPartido: Record<string, number> = {};
      const membrosPorUF: Record<string, number> = {};
      let totalMembros = 0;
      let frentesComCoordenador = 0;
      let frentesComMembros = 0;

      for (const frente of data.frentes) {
        const detalhes = data.detalhesFrente.get(frente.id);
        const membros = data.membrosPorFrente.get(frente.id) || [];

        // Transformar dados da frente
        const frenteTransformada = {
          id: frente.id,
          titulo: frente.titulo,
          idLegislatura: frente.idLegislatura,
          coordenador: detalhes?.coordenador,
          telefone: detalhes?.telefone,
          email: detalhes?.email,
          urlDocumento: detalhes?.urlDocumento,
          situacao: detalhes?.situacao || 'Ativa',
          totalMembros: membros.length,
          membros: this.context.options.incluirMembros ? membros : undefined,
          dataExtracao: new Date().toISOString()
        };

        frentesTransformadas.push(frenteTransformada);

        // Estatísticas
        if (frenteTransformada.coordenador) {
          frentesComCoordenador++;
        }

        if (membros.length > 0) {
          frentesComMembros++;
          totalMembros += membros.length;

          // Contabilizar por partido e UF
          for (const membro of membros) {
            if (membro.siglaPartido) {
              membrosPorPartido[membro.siglaPartido] = (membrosPorPartido[membro.siglaPartido] || 0) + 1;
            }
            if (membro.siglaUf) {
              membrosPorUF[membro.siglaUf] = (membrosPorUF[membro.siglaUf] || 0) + 1;
            }
          }
        }

        // Progresso
        const progresso = Math.round((data.frentes.indexOf(frente) / data.frentes.length) * 100);
        this.emitProgress(ProcessingStatus.TRANSFORMANDO, progresso, `${data.frentes.indexOf(frente) + 1}/${data.frentes.length} frentes transformadas`);
      }

      const estatisticas = {
        totalFrentes: frentesTransformadas.length,
        totalMembros,
        frentesComCoordenador,
        frentesComMembros,
        membrosPorPartido,
        membrosPorUF
      };

      this.context.logger.info(`✅ Transformação concluída: ${frentesTransformadas.length} frentes`);
      this.context.logger.info(`👥 Total de membros: ${totalMembros}`);
      this.context.logger.info(`📊 Frentes com coordenador: ${frentesComCoordenador}`);
      this.context.logger.info(`📊 Frentes com membros: ${frentesComMembros}`);

      return {
        frentes: frentesTransformadas,
        estatisticas
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na transformação: ${error.message}`);
      throw error;
    }
  }

  /**
   * Carregamento dos dados transformados
   */
  async load(data: TransformedData): Promise<ETLResult> {
    this.emitProgress(ProcessingStatus.CARREGANDO, 5, 'Iniciando carregamento dos dados de frentes');
    const startTime = Date.now();
    const legislatura = this.context.options.legislatura!;
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
      this.emitProgress(ProcessingStatus.CARREGANDO, 10, 'Salvando dados de frentes no PC');
      const rootSaveDir = getPCSaveDirectory() || './output_pc_frentes';
      // Base para 'frentes/legislaturas/{legislatura}'
      const legislaturaBaseDir = path.join(rootSaveDir, 'bancoDados_local', 'congressoNacional', 'camaraDeputados', 'frentes', 'legislaturas', `${legislatura}`);
      // Caminho para a subcoleção 'metadata' e o documento 'geral.json'
      const metadataDir = path.join(legislaturaBaseDir, 'metadata');
      const metadataSavePath = path.join(metadataDir, 'geral.json');

      try {
        fs.mkdirSync(legislaturaBaseDir, { recursive: true }); // Diretório para os itens individuais
        fs.mkdirSync(metadataDir, { recursive: true }); // Diretório para metadados

        // 1. Salvar cada frente na coleção 'items' da legislatura
        for (const frente of data.frentes) {
          const filePath = path.join(legislaturaBaseDir, `${frente.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify(frente, null, 2));
          totalSucessos++;
        }
        this.emitProgress(ProcessingStatus.CARREGANDO, 40, `Frentes da legislatura ${legislatura} salvas no PC`);
        
        // 2. Salvar metadados da legislatura
        const metadataPC = {
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '2.0',
            legislatura: legislatura,
            opcoes: this.context.options,
            estatisticas: data.estatisticas
          },
          indices: {
            totalFrentes: data.estatisticas.totalFrentes,
            totalMembros: data.estatisticas.totalMembros,
            porPartido: data.estatisticas.membrosPorPartido,
            porUF: data.estatisticas.membrosPorUF
          }
        };
        fs.writeFileSync(metadataSavePath, JSON.stringify(metadataPC, null, 2));
        totalSucessos++;
        this.emitProgress(ProcessingStatus.CARREGANDO, 50, `Metadados das frentes da legislatura ${legislatura} salvos no PC`);
        this.context.logger.info(`✅ Dados de frentes salvos no PC em: ${rootSaveDir}`);

      } catch (error: any) {
        this.context.logger.error(`❌ Erro ao salvar dados de frentes no PC: ${error.message}`);
        totalFalhas += data.frentes.length * 2 + 1; // Estimativa
      }
    }

    // Lógica de salvamento para Firestore
    if (destinos.includes('firestore') || destinos.includes('emulator')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 60, 'Iniciando salvamento de frentes no Firestore');
      const batchManager = await createBatchManager();
      let firestoreDocumentosSalvos = 0;
      let firestoreFalhas = 0;

      try {
        // 1. Salvar cada frente
        this.emitProgress(ProcessingStatus.CARREGANDO, 70, 'Salvando frentes parlamentares no Firestore');
        for (const frente of data.frentes) {
          // Caminho para o documento da frente, ajustado para a nova estrutura.
          const frentePath = `congressoNacional/camaraDeputados/legislatura/${legislatura}/frentes/${frente.id}`;
          const dadosFrenteComMembros = { ...frente };
          await batchManager.set(frentePath, dadosFrenteComMembros);
        }

        // 2. Salvar metadados
        this.emitProgress(ProcessingStatus.CARREGANDO, 85, 'Salvando metadados de frentes no Firestore');
        // Caminho para os metadados, ajustado para a nova estrutura.
        const metadataPath = `congressoNacional/camaraDeputados/legislatura/${legislatura}/metadata/frentes`;
        const metadataFirestore = {
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '2.0',
            legislatura: legislatura,
            opcoes: this.context.options,
            estatisticas: data.estatisticas
          },
          indices: {
            totalFrentes: data.estatisticas.totalFrentes,
            totalMembros: data.estatisticas.totalMembros,
            porPartido: data.estatisticas.membrosPorPartido,
            porUF: data.estatisticas.membrosPorUF
          }
        };
        await batchManager.set(metadataPath, metadataFirestore);

        // 3. Executar batch
        this.emitProgress(ProcessingStatus.CARREGANDO, 95, 'Commit das operações de frentes no Firestore');
        const batchResult = await batchManager.commit();
        firestoreDocumentosSalvos = batchResult.sucessos;
        firestoreFalhas = batchResult.falhas;

        this.updateLoadStats(batchResult.total, firestoreDocumentosSalvos, firestoreFalhas);
        this.context.logger.info(`✅ Carregamento de frentes no Firestore concluído: ${firestoreDocumentosSalvos} documentos salvos.`);
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;

      } catch (error: any) {
        this.context.logger.error(`❌ Erro no carregamento de frentes para Firestore: ${error.message}`);
        if (error && typeof error === 'object' && 'sucessos' in error && 'falhas' in error) {
          const failedBatchResult = error as BatchResult;
          firestoreFalhas += failedBatchResult.falhas;
          firestoreDocumentosSalvos += failedBatchResult.sucessos;
        } else {
          firestoreFalhas += data.frentes.length * 2 + 1; // Estimativa
        }
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;
        this.updateLoadStats(data.frentes.length * 2 + 1, firestoreDocumentosSalvos, firestoreFalhas);
      }
    }

    const duration = Date.now() - startTime;
    this.emitProgress(ProcessingStatus.CARREGANDO, 100, 'Carregamento de frentes finalizado');

    // O retorno principal assume que o processo de load em si (a função) completou.
    // Sucessos e falhas parciais dentro dos destinos já foram contabilizados.
    return {
      sucessos: totalSucessos,
      falhas: totalFalhas,
      avisos: this.context.stats.avisos,
      tempoProcessamento: duration / 1000,
      destino: destinos.join(', '),
      legislatura: this.context.options.legislatura,
      detalhes: {
        frentesProcessadas: data.frentes.length,
        totalMembros: data.estatisticas.totalMembros, // Usar o valor correto das estatísticas
        metadadosSalvos: totalSucessos > 0, // Considerar salvo se houve algum sucesso
        // Não incluir 'erro: error.message' aqui, pois 'error' não está neste escopo
      },
      // O campo 'erros' no ETLResult é para erros mais globais do processamento.
      // Erros específicos de carregamento de destino já foram logados e contados em 'totalFalhas'.
      // Se quiséssemos agregar todos os erros, precisaríamos de uma estrutura para isso.
      // Por ora, manteremos simples e o log já captura os erros detalhados.
    };
  }
}
// A chave extra que causava "Declaration or statement expected" foi removida.
