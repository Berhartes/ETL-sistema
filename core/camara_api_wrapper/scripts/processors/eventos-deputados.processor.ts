/**
 * Processador ETL para Eventos de Deputados da Câmara
 *
 * Implementa o fluxo ETL completo para extrair, transformar e carregar
 * eventos de deputados com suporte a paginação e modo incremental.
 */

import { ETLProcessor } from '../core/etl-processor.js';
import {
  ValidationResult,
  BatchResult,
  EventoDeputado,
  DeputadoBasico,
  ETLOptions,
  EventosBatchResultDetails,
  EventosExtractedData,
  EventosTransformedData,
} from '../types/etl.types.js';
import { createBatchManager } from '../utils/storage/index.js';
import { etlConfig } from '../../../../../config/index.js';
import { ProcessingStatus } from '../types/etl.types.js';
import { firebaseAdmin } from '../utils/storage/firestore/index.js';
import { apiClient, get, replacePath } from '../utils/api/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { endpoints } from '../config/endpoints.js';
import { withRetry } from '../utils/logging/error-handler.js';

/**
 * Processador de Eventos de Deputados
 */
export class EventosDeputadosProcessor extends ETLProcessor<EventosExtractedData, EventosTransformedData> {

  constructor(options: ETLOptions) {
    super(options);
  }

  /**
   * Nome do processador
   */
  protected getProcessName(): string {
    return 'Processador de Eventos de Deputados';
  }

  /**
   * Validação específica do processador
   */
  async validate(): Promise<ValidationResult> {
    const baseValidation = this.validateCommonParams();
    const erros = [...baseValidation.erros];
    const avisos = [...baseValidation.avisos];

    // Se a flag --data for usada, a legislatura é obrigatória para buscar o período.
    // Se --data não for usada, e como o endpoint de eventos não aceita idLegislatura,
    // o usuário DEVE fornecer dataInicio e dataFim ou usar --atualizar.
    if (this.context.options.data) { // 'data' é o nome da flag que definimos no initiator
      if (!this.context.options.legislatura) {
        erros.push('Legislatura é obrigatória quando a flag --data é utilizada para buscar o período da legislatura.');
      }
    } else if (!this.context.options.atualizar && (!this.context.options.dataInicio || !this.context.options.dataFim)) {
      erros.push('Para buscar eventos, forneça --data-inicio e --data-fim, ou use a flag --data (com --legislatura), ou a flag --atualizar.');
    }

    if (this.context.options.dataInicio) {
      if (!this.isValidDate(this.context.options.dataInicio)) {
        erros.push(`Data início inválida: ${this.context.options.dataInicio}. Use formato YYYY-MM-DD.`);
      }
    }

    if (this.context.options.dataFim) {
      if (!this.isValidDate(this.context.options.dataFim)) {
        erros.push(`Data fim inválida: ${this.context.options.dataFim}. Use formato YYYY-MM-DD.`);
      }
    }

    if (this.context.options.dataInicio && this.context.options.dataFim) {
      const inicio = new Date(this.context.options.dataInicio);
      const fim = new Date(this.context.options.dataFim);

      if (inicio > fim) {
        erros.push('Data início deve ser anterior à data fim');
      }

      const diffDays = (fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 365 * 2) { // Aumentado o aviso para 2 anos para eventos
        avisos.push('Período muito longo (> 2 anos) pode resultar em muitos dados. Considere períodos menores.');
      }
    }

    if (!this.context.options.limite && !this.context.options.deputado && !this.context.options.dataInicio) {
      avisos.push('Processamento sem limite ou filtro de período pode ser muito demorado');
    }

    if (this.context.options.atualizar) {
      avisos.push('Modo atualização processará apenas eventos dos últimos 60 dias');
    }

    return {
      valido: erros.length === 0,
      erros,
      avisos
    };
  }

  private isValidDate(dateString: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Extração de dados da API da Câmara
   */
  async extract(): Promise<EventosExtractedData> {
    const legislatura = this.context.options.legislatura; // Pode ser undefined se não for modo --data
    const limite = this.context.options.limite || 0;
    const deputadoEspecifico = this.context.options.deputado;
    let modoAtualizacao = this.context.options.atualizar || false;

    // Novas opções para varredura anual
    const periodosAnuaisParaVarredura = this.context.options.periodosAnuaisParaVarredura;
    const listaDeputadosPreBuscada = this.context.options.listaDeputadosPreBuscada;

    if (periodosAnuaisParaVarredura && periodosAnuaisParaVarredura.length > 0) {
      this.context.logger.info('🗓️ Modo de varredura anual de eventos ativado. O modo de atualização incremental será ignorado.');
      modoAtualizacao = false; // Varredura anual tem precedência
    }

    this.emitProgress(ProcessingStatus.EXTRAINDO, 10, 'Iniciando extração de dados de eventos');

    try {
      let deputadosParaProcessar: DeputadoBasico[];

      if (listaDeputadosPreBuscada && listaDeputadosPreBuscada.length > 0) {
        this.context.logger.info(`👥 Utilizando lista de ${listaDeputadosPreBuscada.length} deputados pré-buscada para eventos.`);
        const deputadosDeduplicados = this.deduplicateDeputados(listaDeputadosPreBuscada);
        if (listaDeputadosPreBuscada.length !== deputadosDeduplicados.length) {
          this.context.logger.info(`🔄 Deduplicação na lista pré-buscada de eventos: ${listaDeputadosPreBuscada.length} → ${deputadosDeduplicados.length} deputados (removidos ${listaDeputadosPreBuscada.length - deputadosDeduplicados.length} duplicados)`);
        }
        deputadosParaProcessar = deputadosDeduplicados;
        deputadosParaProcessar = this.applyFilters(deputadosParaProcessar);
        if (limite > 0 && deputadosParaProcessar.length > limite) {
          this.context.logger.info(`🔢 Aplicando limite: ${limite} de ${deputadosParaProcessar.length} deputados`);
          deputadosParaProcessar = deputadosParaProcessar.slice(0, limite);
        }
      } else if (deputadoEspecifico) {
        this.context.logger.info(`🎯 Extraindo eventos do deputado específico: ${deputadoEspecifico}`);
        deputadosParaProcessar = await this.extractDeputadoEspecifico(deputadoEspecifico, legislatura || 0); // Passar 0 se undefined
      } else {
        if (!legislatura) {
            this.context.logger.error('Legislatura não definida e não há lista de deputados pré-buscada. Não é possível buscar deputados.');
            throw new Error('Legislatura não definida para buscar lista de deputados.');
        }
        this.context.logger.info(`📋 Extraindo lista de deputados da ${legislatura}ª Legislatura para eventos`);
        const listaCompleta = await this.extractDeputadosLegislatura(legislatura);
        deputadosParaProcessar = this.applyFilters(listaCompleta);
        if (limite > 0 && deputadosParaProcessar.length > limite) {
          this.context.logger.info(`🔢 Aplicando limite: ${limite} de ${deputadosParaProcessar.length} deputados`);
          deputadosParaProcessar = deputadosParaProcessar.slice(0, limite);
        }
      }

      if (deputadosParaProcessar.length === 0) {
        this.context.logger.warn('⚠️ Nenhum deputado encontrado com os filtros especificados ou na lista pré-buscada para eventos');
        return { deputados: [], eventosPorDeputado: [], totalProcessados: 0 };
      }

      this.emitProgress(ProcessingStatus.EXTRAINDO, 30, `Extraindo eventos de ${deputadosParaProcessar.length} deputados`);
      const eventosPorDeputado = await this.extractEventosDeputados(
        deputadosParaProcessar,
        modoAtualizacao,
        periodosAnuaisParaVarredura // Passar os períodos anuais
      );
      this.emitProgress(ProcessingStatus.EXTRAINDO, 90, 'Extração de eventos concluída');

      return {
        deputados: deputadosParaProcessar,
        eventosPorDeputado,
        totalProcessados: eventosPorDeputado.length
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na extração de eventos: ${error.message}`);
      throw error;
    }
  }

  private async extractDeputadoEspecifico(deputadoId: string, legislatura: number): Promise<DeputadoBasico[]> {
    try {
      const endpointConfig = endpoints.DEPUTADOS.PERFIL;
      const endpoint = replacePath(endpointConfig.PATH, { codigo: deputadoId });
      const response = await withRetry(
        () => get(endpoint, endpointConfig.PARAMS),
        etlConfig.camara.maxRetries,
        etlConfig.camara.pauseBetweenRequests,
        `Perfil do deputado ${deputadoId}`
      );

      if (!response || !response.dados) throw new Error(`Deputado ${deputadoId} não encontrado`);
      const dep = response.dados;
      return [{
        id: dep.id?.toString() || deputadoId,
        nome: dep.nomeCivil || dep.nome || '',
        nomeCivil: dep.nomeCivil,
        siglaPartido: dep.ultimoStatus?.siglaPartido || '',
        siglaUf: dep.ultimoStatus?.siglaUf || '',
        idLegislatura: legislatura, // Mantém a legislatura original, mesmo que não usada na API de eventos
        urlFoto: dep.ultimoStatus?.urlFoto
      }];
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair deputado ${deputadoId}: ${error.message}`);
      throw error;
    }
  }

  private async extractDeputadosLegislatura(legislatura: number): Promise<DeputadoBasico[]> {
    try {
      const endpointConfig = endpoints.DEPUTADOS.LISTA;
      const params = { ...endpointConfig.PARAMS, idLegislatura: legislatura.toString(), ordem: 'ASC', ordenarPor: 'nome' };
      const todosDeputados = await apiClient.getAllPages(endpointConfig.PATH, params, { context: `Lista de deputados da legislatura ${legislatura}`, maxPages: 10 });
      if (!todosDeputados || !Array.isArray(todosDeputados)) throw new Error(`Nenhum deputado encontrado para a legislatura ${legislatura}`);
      
      const deputados: DeputadoBasico[] = todosDeputados.map((dep: any) => ({
        id: dep.id?.toString() || '',
        nome: dep.nome || '',
        nomeCivil: dep.nomeCivil,
        siglaPartido: dep.siglaPartido || '',
        siglaUf: dep.siglaUf || '',
        idLegislatura: legislatura,
        urlFoto: dep.urlFoto
      }));
      const deputadosDeduplicados = this.deduplicateDeputados(deputados);
      this.context.logger.info(`✅ Encontrados ${deputadosDeduplicados.length} deputados na ${legislatura}ª Legislatura (original: ${deputados.length})`);
      return deputadosDeduplicados;
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair lista de deputados: ${error.message}`);
      throw error;
    }
  }

  private deduplicateDeputados(deputados: DeputadoBasico[]): DeputadoBasico[] {
    const unicos = new Map<string, DeputadoBasico>();
    deputados.forEach(dep => { if (dep.id && !unicos.has(dep.id)) unicos.set(dep.id, dep); });
    return Array.from(unicos.values());
  }

  private applyFilters(deputados: DeputadoBasico[]): DeputadoBasico[] {
    let filtrados = [...deputados];
    if (this.context.options.partido) {
      const partido = this.context.options.partido.toUpperCase();
      filtrados = filtrados.filter(dep => dep.siglaPartido === partido);
      this.context.logger.info(`🔍 Filtro por partido ${partido}: ${filtrados.length} deputados`);
    }
    if (this.context.options.uf) {
      const uf = this.context.options.uf.toUpperCase();
      filtrados = filtrados.filter(dep => dep.siglaUf === uf);
      this.context.logger.info(`🔍 Filtro por UF ${uf}: ${filtrados.length} deputados`);
    }
    return filtrados;
  }

  private async extractEventosDeputados(
    deputados: DeputadoBasico[],
    modoAtualizacao = false,
    periodosAnuaisParaVarredura?: ETLOptions['periodosAnuaisParaVarredura']
  ): Promise<EventosExtractedData['eventosPorDeputado']> {
    const resultados: EventosExtractedData['eventosPorDeputado'] = [];
    const concorrencia = this.context.options.concorrencia || etlConfig.camara.concorrenciaEventos || 2;

    this.context.logger.info(`🔄 Extraindo eventos com concorrência: ${concorrencia}`);
    this.context.logger.info(`📋 Modo: ${modoAtualizacao ? 'ATUALIZAÇÃO INCREMENTAL (60 dias)' : 'COMPLETO'}`);

    for (let i = 0; i < deputados.length; i += concorrencia) {
      const lote = deputados.slice(i, i + concorrencia);
      this.context.logger.info(`📦 Processando lote de eventos ${Math.floor(i / concorrencia) + 1}: ${lote.length} deputados`);

      const promessas = lote.map(async (deputado) => {
        try {
          let eventosData;
          if (periodosAnuaisParaVarredura && periodosAnuaisParaVarredura.length > 0) {
            this.context.logger.info(`🗓️ Varrendo ${periodosAnuaisParaVarredura.length} períodos anuais de eventos para o deputado ${deputado.id}`);
            eventosData = await this.extractEventosCompletos(deputado.id, periodosAnuaisParaVarredura);
          } else if (modoAtualizacao) {
            eventosData = await this.extractEventosIncremental(deputado.id);
          } else {
            eventosData = await this.extractEventosCompletos(deputado.id);
          }
          this.incrementSucessos();
          return eventosData;
        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao extrair eventos do deputado ${deputado.id}: ${error.message}`);
          this.incrementFalhas();
          return { deputadoId: deputado.id, eventos: [], totalEventos: 0, totalPaginas: 0, erro: error.message };
        }
      });

      const resultadosLote = await Promise.allSettled(promessas);
      resultadosLote.forEach(res => { if (res.status === 'fulfilled') resultados.push(res.value); });

      const progresso = Math.min(90, 30 + (i / deputados.length) * 60);
      const totalEventos = resultados.reduce((sum, r) => sum + r.totalEventos, 0);
      this.emitProgress(ProcessingStatus.EXTRAINDO, progresso, `${resultados.length}/${deputados.length} deputados processados (${totalEventos} eventos)`);

      if (i + concorrencia < deputados.length) {
        await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests * 2));
      }
    }
    const totalEventos = resultados.reduce((sum, r) => sum + r.totalEventos, 0);
    this.context.logger.info(`✅ Extração de eventos concluída: ${totalEventos} eventos de ${resultados.length} deputados`);
    return resultados;
  }

  private async extractEventosCompletos(
    deputadoId: string,
    periodosAnuais?: ETLOptions['periodosAnuaisParaVarredura']
  ): Promise<EventosExtractedData['eventosPorDeputado'][0]> {
    const endpointConfig = endpoints.DEPUTADOS.EVENTOS;
    const endpoint = replacePath(endpointConfig.PATH, { codigo: deputadoId });
    let todosOsEventosDoDeputado: any[] = [];
    let totalPaginasAcumulado = 0;
    const itensPorPagina = parseInt(etlConfig.camara.itemsPerPageEventos?.toString() || etlConfig.camara.itemsPerPage?.toString() || '100');

    try {
      if (periodosAnuais && periodosAnuais.length > 0) {
        for (const periodo of periodosAnuais) {
          this.context.logger.debug(`Buscando eventos para deputado ${deputadoId} no período: ${periodo.dataInicio} a ${periodo.dataFim}`);
          const paramsPeriodo: Record<string, any> = {
            ...endpointConfig.PARAMS,
            dataInicio: periodo.dataInicio,
            dataFim: periodo.dataFim,
            itens: itensPorPagina.toString(),
          };

          const eventosDoPeriodo = await apiClient.getAllPages(
            endpoint,
            paramsPeriodo,
            {
              context: `Eventos do deputado ${deputadoId} (período ${periodo.dataInicio}-${periodo.dataFim})`,
              maxPages: 100 // Limite por período
            }
          );
          todosOsEventosDoDeputado.push(...eventosDoPeriodo);
          totalPaginasAcumulado += Math.ceil(eventosDoPeriodo.length / itensPorPagina);
        }
      } else {
        const baseParams: Record<string, any> = {
          ...endpointConfig.PARAMS,
          itens: itensPorPagina.toString(),
        };
        if (this.context.options.dataInicio) baseParams.dataInicio = this.context.options.dataInicio;
        if (this.context.options.dataFim) baseParams.dataFim = this.context.options.dataFim;

        todosOsEventosDoDeputado = await apiClient.getAllPages(
          endpoint,
          baseParams,
          {
            context: `Eventos do deputado ${deputadoId} (período global)`,
            maxPages: 100
          }
        );
        totalPaginasAcumulado = Math.ceil(todosOsEventosDoDeputado.length / itensPorPagina);
      }

      return {
        deputadoId,
        eventos: todosOsEventosDoDeputado,
        totalEventos: todosOsEventosDoDeputado.length,
        totalPaginas: totalPaginasAcumulado
      };
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair eventos completos do deputado ${deputadoId}: ${error.message}`);
      throw error;
    }
  }

  private async extractEventosIncremental(deputadoId: string): Promise<EventosExtractedData['eventosPorDeputado'][0]> {
    const agora = new Date();
    const dataLimite = new Date();
    dataLimite.setDate(agora.getDate() - (etlConfig.camara.diasAtualizacaoIncrementalEventos || 60));

    try {
      const endpointConfig = endpoints.DEPUTADOS.EVENTOS;
      const endpoint = replacePath(endpointConfig.PATH, { codigo: deputadoId });
      const params = {
        ...endpointConfig.PARAMS, 
        dataInicio: dataLimite.toISOString().split('T')[0],
        dataFim: agora.toISOString().split('T')[0],
        itens: etlConfig.camara.itemsPerPageEventos?.toString() || etlConfig.camara.itemsPerPage?.toString() || '100'
      };

      const eventosRecentes = await apiClient.getAllPages(endpoint, params, { context: `Eventos recentes do deputado ${deputadoId}`, maxPages: 20 });
      return { deputadoId, eventos: eventosRecentes, totalEventos: eventosRecentes.length, totalPaginas: Math.ceil(eventosRecentes.length / (parseInt(params.itens))) };
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair eventos incrementais do deputado ${deputadoId}: ${error.message}`);
      throw error;
    }
  }

  async transform(data: EventosExtractedData): Promise<EventosTransformedData> {
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 10, 'Iniciando transformação dos dados de eventos');
    try {
      const eventosTransformados: EventoDeputado[] = [];
      const eventosPorAno: Record<number, number> = {};
      const eventosPorTipo: Record<string, number> = {};
      const eventosPorSituacao: Record<string, number> = {};
      let deputadosComEventos = 0;

      for (const dadosDeputado of data.eventosPorDeputado) {
        if (dadosDeputado.erro || dadosDeputado.eventos.length === 0) continue;
        deputadosComEventos++;

        for (const eventoBruto of dadosDeputado.eventos) {
          try {
            const eventoTransformado = this.transformEvento(eventoBruto, dadosDeputado.deputadoId);
            eventosTransformados.push(eventoTransformado);

            eventosPorAno[eventoTransformado.anoEvento] = (eventosPorAno[eventoTransformado.anoEvento] || 0) + 1;
            const tipo = eventoTransformado.tipoEvento?.nome || 'NÃO ESPECIFICADO';
            eventosPorTipo[tipo] = (eventosPorTipo[tipo] || 0) + 1;
            eventosPorSituacao[eventoTransformado.situacao] = (eventosPorSituacao[eventoTransformado.situacao] || 0) + 1;

          } catch (error: any) {
            this.context.logger.error(`❌ Erro ao transformar evento ID ${eventoBruto.id}: ${error.message}`);
            this.incrementFalhas();
          }
        }
        const progresso = Math.round((data.eventosPorDeputado.indexOf(dadosDeputado) / data.eventosPorDeputado.length) * 100);
        this.emitProgress(ProcessingStatus.TRANSFORMANDO, progresso, `${eventosTransformados.length} eventos transformados`);
      }

      const estatisticas = { totalEventos: eventosTransformados.length, deputadosComEventos, eventosPorAno, eventosPorTipo, eventosPorSituacao };
      this.context.logger.info(`✅ Transformação de eventos concluída: ${eventosTransformados.length} eventos`);
      this.context.logger.info(`👥 Deputados com eventos: ${deputadosComEventos}`);
      return { eventos: eventosTransformados, estatisticas };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na transformação de eventos: ${error.message}`);
      throw error;
    }
  }

  private transformEvento(eventoBruto: any, deputadoId: string): EventoDeputado {
    const dataEvento = new Date(eventoBruto.dataHoraInicio || '');
    const anoEvento = dataEvento.getFullYear() || 0;
    const mesEvento = dataEvento.getMonth() + 1 || 0;

    return {
      id: eventoBruto.id?.toString() || '',
      uri: eventoBruto.uri || '',
      dataHoraInicio: eventoBruto.dataHoraInicio || '',
      dataHoraFim: eventoBruto.dataHoraFim || null,
      situacao: eventoBruto.situacao || 'NÃO INFORMADA',
      descricao: eventoBruto.descricao || '',
      localExterno: eventoBruto.localExterno || undefined,
      localCamara: eventoBruto.localCamara ? {
        andar: eventoBruto.localCamara.andar,
        nome: eventoBruto.localCamara.nome,
        predio: eventoBruto.localCamara.predio,
        sala: eventoBruto.localCamara.sala,
      } : undefined,
      orgaos: eventoBruto.orgaos || [],
      tipoEvento: eventoBruto.tipoEvento ? {
         id: eventoBruto.tipoEvento.id?.toString(),
         uri: eventoBruto.tipoEvento.uri,
         nome: eventoBruto.tipoEvento.nome
      } : undefined,
      idDeputado: deputadoId,
      dataExtracao: new Date().toISOString(),
      anoEvento,
      mesEvento
    };
  }

  private async carregarEventosExistentesPorAno(deputadoId: string): Promise<Record<number, EventoDeputado[]>> {
    const eventosExistentesPorAno: Record<number, EventoDeputado[]> = {};
    // NOVO CAMINHO: congressoNacional/camaraDeputados/perfilComplementar/{deputadoId}/eventos/{ano}
    const eventosCollectionRef = firebaseAdmin().firestore()
      .collection(`congressoNacional/camaraDeputados/perfilComplementar/${deputadoId}/eventos`);
    try {
      const snapshot = await eventosCollectionRef.get();
      snapshot.docs.forEach((doc: any) => {
        if (doc.id === 'stats') return; // Ignora o documento de estatísticas
        const ano = parseInt(doc.id);
        const data = doc.data();
        if (!isNaN(ano) && data && Array.isArray(data.items)) {
          eventosExistentesPorAno[ano] = data.items as EventoDeputado[];
        }
      });
      this.context.logger.info(`Carregados ${Object.keys(eventosExistentesPorAno).length} docs anuais de eventos existentes para dep ${deputadoId} da nova estrutura.`);
    } catch (error: any) {
      this.context.logger.warn(`Erro ao carregar eventos existentes para dep ${deputadoId} da nova estrutura: ${error.message}`);
    }
    return eventosExistentesPorAno;
  }

  private async limparDocumentosAnuaisExistentes(deputadoId: string): Promise<void> {
    // NOVO CAMINHO: congressoNacional/camaraDeputados/perfilComplementar/{deputadoId}/eventos/{ano}
    const eventosCollectionRef = firebaseAdmin().firestore()
      .collection(`congressoNacional/camaraDeputados/perfilComplementar/${deputadoId}/eventos`);
    try {
      const snapshot = await eventosCollectionRef.get();
      const batch = firebaseAdmin().firestore().batch();
      snapshot.docs.forEach((doc: any) => {
        if (doc.id !== 'stats') { // Não apaga o documento 'stats'
            batch.delete(doc.ref);
        }
      });
      await batch.commit();
      this.context.logger.info(`Docs anuais de eventos existentes (exceto 'stats') limpos para dep ${deputadoId} na nova estrutura.`);
    } catch (error: any) {
      this.context.logger.warn(`Aviso na limpeza de docs anuais de eventos para dep ${deputadoId} na nova estrutura: ${error.message}`);
    }
  }

  async load(data: EventosTransformedData): Promise<BatchResult> {
    this.emitProgress(ProcessingStatus.CARREGANDO, 10, 'Iniciando carregamento dos dados de eventos');
    const isUpdateMode = this.context.options.atualizar;
    const saveToPc = this.context.options.pc || false;
    const saveToFirestore = this.context.options.firestore !== undefined ? this.context.options.firestore : true; // Default to true if undefined
    const basePathLocal = path.resolve(process.cwd(), 'src/core/BancoDadosLocal');
    
    let operacoesSucesso = 0;
    let operacoesFalha = 0;
    let batchResultsFirestore: BatchResult | undefined = undefined;
    let eventosPorDeputado: Record<string, EventoDeputado[]> = {};

    if (!saveToPc && !saveToFirestore) {
      this.context.logger.warn('⚠️ Nenhum destino de salvamento habilitado (--pc ou --firestore). Os dados não serão salvos.');
      return { total: 0, processados: 0, sucessos: 0, falhas: 0, tempoOperacao: 0, detalhes: {} as EventosBatchResultDetails };
    }

    try {
      if (saveToPc) this.context.logger.info('💻 Modo PC: Salvando dados localmente...');
      if (saveToFirestore) this.context.logger.info('☁️ Modo Firestore: Salvando dados na nuvem...');
      
      const batchManager = saveToFirestore ? await createBatchManager() : null;
      eventosPorDeputado = this.groupEventosByDeputado(data.eventos);

      this.emitProgress(ProcessingStatus.CARREGANDO, 30, 'Salvando eventos por deputado');
      for (const [deputadoId, novosEventos] of Object.entries(eventosPorDeputado)) {
        const firestorePathDeputadoEventos = `congressoNacional/camaraDeputados/perfilComplementar/${deputadoId}/eventos`;
        const localPathDeputadoEventos = path.join(basePathLocal, ...firestorePathDeputadoEventos.split('/'));
        let eventosFinaisPorAno: Record<number, EventoDeputado[]> = {};

        if (isUpdateMode) {
          this.context.logger.info(`Modo atualização: mesclando novos eventos para dep ${deputadoId}`);
          let eventosExistentesPorAno: Record<number, EventoDeputado[]> = {};
          if (saveToPc) {
            try {
              const anosSalvos = await fs.readdir(localPathDeputadoEventos).catch(() => []);
              for (const anoStr of anosSalvos) {
                if (anoStr.endsWith('.json') && anoStr !== 'stats.json') {
                  const ano = parseInt(anoStr.replace('.json', ''));
                  if (!isNaN(ano)) {
                    const filePath = path.join(localPathDeputadoEventos, anoStr);
                    const fileContent = await fs.readFile(filePath, 'utf-8').catch(() => null);
                    if (fileContent) {
                      const docData = JSON.parse(fileContent);
                      if (docData && Array.isArray(docData.items)) eventosExistentesPorAno[ano] = docData.items as EventoDeputado[];
                    }
                  }
                }
              }
            } catch (e: any) {
              if (e.code !== 'ENOENT') this.context.logger.warn(`[Load PC - Atualização] Erro ao listar/ler arquivos de eventos para Dep. ${deputadoId}: ${e.message}`);
            }
          }
          if (saveToFirestore) {
             // No modo de atualização, se ambos PC e Firestore estiverem ativos, priorizamos os dados do Firestore como base se o PC falhar ao ler.
             // Ou podemos mesclar de ambos, mas isso adiciona complexidade. Por simplicidade, se PC leu algo, usamos isso.
             // Se PC não leu (ou não está ativo) e Firestore está, lemos do Firestore.
            if (Object.keys(eventosExistentesPorAno).length === 0 || !saveToPc) {
                 const firestoreExistentes = await this.carregarEventosExistentesPorAno(deputadoId);
                 // Mesclar com o que já pode ter sido lido do PC (se saveToPc também for true)
                 for (const ano in firestoreExistentes) {
                    if (!eventosExistentesPorAno[ano]) eventosExistentesPorAno[ano] = [];
                    firestoreExistentes[ano].forEach(evFS => {
                        if (!eventosExistentesPorAno[ano].some(evPC => evPC.id === evFS.id)) {
                            eventosExistentesPorAno[ano].push(evFS);
                        }
                    });
                 }
            }
          }
          
          eventosFinaisPorAno = { ...eventosExistentesPorAno };
          novosEventos.forEach(novoEvento => {
            const ano = novoEvento.anoEvento;
            if (!eventosFinaisPorAno[ano]) eventosFinaisPorAno[ano] = [];
            if (!eventosFinaisPorAno[ano].some(e => e.id === novoEvento.id)) {
              eventosFinaisPorAno[ano].push(novoEvento);
            }
          });
        } else { // Modo completo
          this.context.logger.info(`Modo completo: substituindo eventos para dep ${deputadoId}`);
          if (saveToPc) {
            try {
              await fs.rm(localPathDeputadoEventos, { recursive: true, force: true });
            } catch (e: any) {
              if (e.code !== 'ENOENT') this.context.logger.warn(`[Load PC - Completo] Aviso ao limpar diretório ${localPathDeputadoEventos}: ${e.message}`);
            }
          }
          if (saveToFirestore && batchManager) { // batchManager só existe se saveToFirestore for true
            await this.limparDocumentosAnuaisExistentes(deputadoId); // Firestore
          }
          eventosFinaisPorAno = novosEventos.reduce((acc: Record<number, EventoDeputado[]>, evento) => {
            const ano = evento.anoEvento;
            if (!acc[ano]) acc[ano] = [];
            acc[ano].push(evento);
            return acc;
          }, {});
        }

        const dadosEstatisticasEventos = {
          idDeputado: deputadoId,
          totalEventos: Object.values(eventosFinaisPorAno).flat().length,
          ultimaAtualizacao: new Date().toISOString(),
          estatisticas: this.calculateDeputadoStats(Object.values(eventosFinaisPorAno).flat())
        };
        const firestorePathStats = `${firestorePathDeputadoEventos}/stats`;
        const localFilePathStats = path.join(localPathDeputadoEventos, 'stats.json');

        if (saveToPc) {
          try {
            await fs.mkdir(path.dirname(localFilePathStats), { recursive: true });
            await fs.writeFile(localFilePathStats, JSON.stringify(dadosEstatisticasEventos, null, 2));
            operacoesSucesso++;
          } catch (e: any) {
            this.context.logger.error(`[Load PC] Erro ao salvar arquivo de estatísticas ${localFilePathStats}: ${e.message}`);
            operacoesFalha++;
          }
        }
        if (saveToFirestore && batchManager) {
          await batchManager.set(firestorePathStats, dadosEstatisticasEventos);
        }

        for (const [ano, eventosDoAno] of Object.entries(eventosFinaisPorAno)) {
          const firestoreDocPathAno = `${firestorePathDeputadoEventos}/${ano}`;
          const localFilePathAno = path.join(localPathDeputadoEventos, `${ano}.json`);
          const dataToSave = {
            ano: parseInt(ano),
            totalEventos: eventosDoAno.length,
            ultimaAtualizacao: new Date().toISOString(),
            items: eventosDoAno
          };
          if (saveToPc) {
            try {
              await fs.mkdir(path.dirname(localFilePathAno), { recursive: true });
              await fs.writeFile(localFilePathAno, JSON.stringify(dataToSave, null, 2));
              operacoesSucesso++;
            } catch (e: any) {
              this.context.logger.error(`[Load PC] Erro ao salvar arquivo ${localFilePathAno}: ${e.message}`);
              operacoesFalha++;
            }
          }
          if (saveToFirestore && batchManager) {
            await batchManager.set(firestoreDocPathAno, dataToSave);
          }
        }
      }

      this.emitProgress(ProcessingStatus.CARREGANDO, 70, 'Salvando metadados de eventos');
      const firestoreMetadataPath = `congressoNacional/camaraDeputados/perfilComplementar/estatisticasGerais/eventos/legislatura_${this.context.options.legislatura}`;
      const localMetadataFilePath = path.join(basePathLocal, ...firestoreMetadataPath.split('/')) + '.json';
      const metadata = {
        processamento: {
          dataExecucao: new Date().toISOString(),
          versaoETL: '2.0', 
          legislatura: this.context.options.legislatura,
          opcoes: this.context.options,
          estatisticas: data.estatisticas
        },
        indices: {
          porDeputado: Object.keys(eventosPorDeputado).length,
          porAno: data.estatisticas.eventosPorAno,
          porTipo: data.estatisticas.eventosPorTipo,
          porSituacao: data.estatisticas.eventosPorSituacao,
        }
      };
      
      if (saveToPc) {
        try {
          await fs.mkdir(path.dirname(localMetadataFilePath), { recursive: true });
          await fs.writeFile(localMetadataFilePath, JSON.stringify(metadata, null, 2));
          operacoesSucesso++;
        } catch (e: any) {
          this.context.logger.error(`[Load PC] Erro ao salvar arquivo de metadados ${localMetadataFilePath}: ${e.message}`);
          operacoesFalha++;
        }
      }
      if (saveToFirestore && batchManager) {
        await batchManager.set(firestoreMetadataPath, metadata);
      }
      
      if (saveToFirestore && batchManager) {
        this.emitProgress(ProcessingStatus.CARREGANDO, 90, 'Executando commit dos batches de eventos');
        batchResultsFirestore = await batchManager.commit();
        // Se salvando em ambos, as contagens de sucesso/falha do PC já foram feitas.
        // As do Firestore sobrescreverão se saveToPc for false.
        if (!saveToPc) {
            operacoesSucesso = batchResultsFirestore?.sucessos || 0;
            operacoesFalha = batchResultsFirestore?.falhas || 0;
        } else { // Adicionar aos contadores do PC
            operacoesSucesso += batchResultsFirestore?.sucessos || 0;
            operacoesFalha += batchResultsFirestore?.falhas || 0;
        }
      }

      const finalResult: BatchResult = {
        total: operacoesSucesso + operacoesFalha,
        processados: operacoesSucesso + operacoesFalha,
        sucessos: operacoesSucesso,
        falhas: operacoesFalha,
        tempoOperacao: batchResultsFirestore?.tempoOperacao || 0,
        detalhes: {
          eventosSalvos: data.eventos.length,
          deputadosProcessados: Object.keys(eventosPorDeputado).length,
          metadadosSalvos: true,
          batchResults: batchResultsFirestore ? [batchResultsFirestore] : []
        } as EventosBatchResultDetails
      };
      this.context.logger.info(`✅ Carregamento de eventos concluído: ${finalResult.sucessos} sucessos, ${finalResult.falhas} falhas`);
      return finalResult;

    } catch (error: any) {
      this.context.logger.error(`❌ Erro no carregamento de eventos: ${error.message}`);
      if (saveToFirestore && error && typeof error === 'object' && 'falhas' in error) {
         operacoesFalha += (error as BatchResult).falhas; 
      } else if (saveToFirestore) {
         const numDeputados = Object.keys(eventosPorDeputado || {}).length;
         operacoesFalha += data.eventos.length + numDeputados + 1;
      }
      // Se saveToPc for true, operacoesFalha já inclui falhas do PC.

      return {
        total: operacoesSucesso + operacoesFalha,
        processados: operacoesSucesso + operacoesFalha,
        sucessos: operacoesSucesso,
        falhas: operacoesFalha,
        tempoOperacao: 0,
        detalhes: {
          eventosSalvos: 0,
          deputadosProcessados: 0,
          metadadosSalvos: false,
          batchResults: []
        } as EventosBatchResultDetails
      };
    }
  }

  private groupEventosByDeputado(eventos: EventoDeputado[]): Record<string, EventoDeputado[]> {
    return eventos.reduce((groups, evento) => {
      const deputadoId = evento.idDeputado;
      if (!groups[deputadoId]) groups[deputadoId] = [];
      groups[deputadoId].push(evento);
      return groups;
    }, {} as Record<string, EventoDeputado[]>);
  }

  private calculateDeputadoStats(eventos: EventoDeputado[]): any {
    return {
      eventosPorAno: eventos.reduce((acc, e) => {
        acc[e.anoEvento] = (acc[e.anoEvento] || 0) + 1;
        return acc;
      }, {} as Record<number, number>),
      eventosPorTipo: eventos.reduce((acc, e) => {
        const tipo = e.tipoEvento?.nome || 'NÃO ESPECIFICADO';
        acc[tipo] = (acc[tipo] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      eventosPorSituacao: eventos.reduce((acc, e) => {
        acc[e.situacao] = (acc[e.situacao] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
  }
}
