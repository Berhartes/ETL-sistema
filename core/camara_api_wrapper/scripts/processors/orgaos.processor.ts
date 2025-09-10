/**
 * Processador ETL para Órgãos da Câmara
 */

import { ETLProcessor } from '../core/etl-processor.js';
import {
  ValidationResult,
  BatchResult,
  ETLOptions,
  ProcessingStatus,
  ETLResult,
  OrgaoBasico,
  DetalhesOrgaoAPI,
  EventoOrgaoAPI,
  MembroOrgaoAPI,
  VotacaoOrgaoAPI,
  OrgaoCompleto,
  OrgaoExtractedData,
  OrgaoTransformedData,
  Periodo,
} from '../types/etl.types.js';
import { createBatchManager } from '../utils/storage/index.js';
import { etlConfig } from '../../../../../config/index.js';
import { apiClient, get, replacePath } from '../utils/api/index.js';
import { endpoints } from '../config/endpoints.js';
import { withRetry } from '../utils/logging/error-handler.js';

export class OrgaosProcessor extends ETLProcessor<OrgaoExtractedData, OrgaoTransformedData> {
  constructor(options: ETLOptions) {
    super(options);
  }

  protected getProcessName(): string {
    return 'Processador de Órgãos da Câmara';
  }

  async validate(): Promise<ValidationResult> {
    const baseValidation = this.validateCommonParams();
    const erros = [...baseValidation.erros];
    const avisos = [...baseValidation.avisos];

    if (this.context.options.limite && this.context.options.limite > 100) {
      avisos.push('Limite alto de órgãos para processamento detalhado pode ser demorado.');
    }

    return {
      valido: erros.length === 0,
      erros,
      avisos,
    };
  }

  async extract(): Promise<OrgaoExtractedData> {
    const limite = this.context.options.limite || 0;
    const dataInicioEventos_global = this.context.options.dataInicioEventos || '2025-02-02';
    const dataFimEventos_global = this.context.options.dataFimEventos || '2025-05-05';
    const dataInicioVotacoes_global = this.context.options.dataInicioVotacoes || '2025-01-01';
    const dataFimVotacoes_global = this.context.options.dataFimVotacoes || '2025-05-05';

    this.emitProgress(ProcessingStatus.EXTRAINDO, 5, 'Iniciando extração de órgãos');

    try {
      this.context.logger.info('📋 Extraindo lista de órgãos');
      const orgaosBasicos = await this.extractOrgaosLista();

      if (orgaosBasicos.length === 0) {
        this.context.logger.warn('⚠️ Nenhum órgão encontrado.');
        return {
          orgaosBasicos: [],
          orgaosCompletos: [],
          totalProcessados: 0,
        };
      }

      let orgaosParaProcessar = orgaosBasicos;
      if (limite > 0 && orgaosBasicos.length > limite) {
        this.context.logger.info(`🔢 Aplicando limite: ${limite} de ${orgaosBasicos.length} órgãos`);
        orgaosParaProcessar = orgaosBasicos.slice(0, limite);
      }

      this.emitProgress(ProcessingStatus.EXTRAINDO, 20, `Extraindo detalhes de ${orgaosParaProcessar.length} órgãos`);

      const orgaosCompletos = await this.extractOrgaosCompletos(
        orgaosParaProcessar,
        dataInicioEventos_global,
        dataFimEventos_global,
        dataInicioVotacoes_global,
        dataFimVotacoes_global
      );

      this.emitProgress(ProcessingStatus.EXTRAINDO, 90, 'Extração de órgãos concluída');

      return {
        orgaosBasicos,
        orgaosCompletos,
        totalProcessados: orgaosCompletos.length,
      };
    } catch (error: any) {
      this.context.logger.error(`❌ Erro na extração de órgãos: ${error.message}`);
      throw error;
    }
  }

  private async extractOrgaosLista(): Promise<OrgaoBasico[]> {
    try {
      const endpointConfig = endpoints.ORGAOS.LISTA;
      const params = { ...endpointConfig.PARAMS, itens: '100' };
      const todosOrgaosAPI = await apiClient.getAllPages(endpointConfig.PATH, params, { context: 'Lista de órgãos', maxPages: 50 });
      if (!todosOrgaosAPI || !Array.isArray(todosOrgaosAPI)) {
        this.context.logger.warn('Nenhum dado de órgão retornado pela API.');
        return [];
      }
      const orgaos: OrgaoBasico[] = todosOrgaosAPI.map((orgao: any) => ({
        id: orgao.id?.toString() || '',
        sigla: orgao.sigla || '',
        nome: orgao.nome || '',
        uri: orgao.uri || '',
      }));
      this.context.logger.info(`✅ Encontrados ${orgaos.length} órgãos`);
      return orgaos;
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair lista de órgãos: ${error.message}`);
      throw error;
    }
  }

  private async extractOrgaosCompletos(
    orgaos: OrgaoBasico[],
    dataInicioEventos_global: string,
    dataFimEventos_global: string,
    dataInicioVotacoes_global: string,
    dataFimVotacoes_global: string
  ): Promise<OrgaoCompleto[]> {
    const orgaosCompletos: OrgaoCompleto[] = [];
    const concorrencia = this.context.options.concorrencia || 3;
    const periodosAnuais: Periodo[] | undefined = this.context.options.periodosAnuaisParaVarredura;

    if (periodosAnuais && periodosAnuais.length > 0) {
      this.context.logger.info(`🔄 Extraindo detalhes, eventos (anuais), membros e votações (anuais) com concorrência: ${concorrencia}`);
    } else {
      this.context.logger.info(`🔄 Extraindo detalhes, eventos, membros e votações com concorrência: ${concorrencia} (período global)`);
    }

    for (let i = 0; i < orgaos.length; i += concorrencia) {
      const lote = orgaos.slice(i, i + concorrencia);
      this.context.logger.info(`📦 Processando lote de órgãos ${Math.floor(i / concorrencia) + 1}: ${lote.length} órgãos`);

      const promessas = lote.map(async (orgaoBasico) => {
        try {
          const detalhes = await this.extractDetalhesOrgao(orgaoBasico.id);
          const membros = await this.extractMembrosOrgao(orgaoBasico.id); 
          let todosEventosDoOrgao: EventoOrgaoAPI[] = [];
          let todasVotacoesDoOrgao: VotacaoOrgaoAPI[] = [];

          if (periodosAnuais && periodosAnuais.length > 0) {
            for (const periodo of periodosAnuais) {
              this.context.logger.debug(`   🔎 Buscando dados para órgão ${orgaoBasico.id} no período ${periodo.dataInicio} a ${periodo.dataFim}`);
              const eventosDoPeriodo = await this.extractEventosOrgao(orgaoBasico.id, periodo.dataInicio, periodo.dataFim);
              todosEventosDoOrgao.push(...eventosDoPeriodo);
              const votacoesDoPeriodo = await this.extractVotacoesOrgao(orgaoBasico.id, periodo.dataInicio, periodo.dataFim);
              todasVotacoesDoOrgao.push(...votacoesDoPeriodo);
            }
          } else {
            todosEventosDoOrgao = await this.extractEventosOrgao(orgaoBasico.id, dataInicioEventos_global, dataFimEventos_global);
            todasVotacoesDoOrgao = await this.extractVotacoesOrgao(orgaoBasico.id, dataInicioVotacoes_global, dataFimVotacoes_global);
          }

          this.incrementSucessos();
          return {
            ...orgaoBasico,
            detalhes,
            eventos: todosEventosDoOrgao,
            membros,
            votacoes: todasVotacoesDoOrgao,
            dataExtracao: new Date().toISOString(),
          };
        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao extrair dados completos do órgão ${orgaoBasico.id}: ${error.message}`);
          this.incrementFalhas();
          return null;
        }
      });

      const resultados = await Promise.allSettled(promessas);
      resultados.forEach((resultado) => {
        if (resultado.status === 'fulfilled' && resultado.value) {
          orgaosCompletos.push(resultado.value);
        }
      });

      const progresso = Math.min(90, 20 + ((i + lote.length) / orgaos.length) * 70);
      this.emitProgress(ProcessingStatus.EXTRAINDO, progresso, `${orgaosCompletos.length}/${orgaos.length} órgãos com detalhes`);

      if (i + concorrencia < orgaos.length) {
        await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests));
      }
    }
    this.context.logger.info(`✅ Extração de detalhes concluída: ${orgaosCompletos.length} de ${orgaos.length} órgãos`);
    return orgaosCompletos;
  }

  private async extractDetalhesOrgao(orgaoId: string): Promise<DetalhesOrgaoAPI | null> {
    const endpointConfig = endpoints.ORGAOS.DETALHES;
    const path = replacePath(endpointConfig.PATH, { id: orgaoId });
    try {
      const response = await withRetry(() => get(path, endpointConfig.PARAMS), etlConfig.camara.maxRetries, etlConfig.camara.pauseBetweenRequests, `Detalhes do órgão ${orgaoId}`);
      return response?.dados || null;
    } catch (error: any) {
      this.context.logger.warn(`⚠️ Erro ao buscar detalhes do órgão ${orgaoId}: ${error.message}. Detalhes não serão incluídos.`);
      return null;
    }
  }

  private async extractEventosOrgao(orgaoId: string, dataInicio: string, dataFim: string): Promise<EventoOrgaoAPI[]> {
    const endpointConfig = endpoints.ORGAOS.EVENTOS;
    const path = replacePath(endpointConfig.PATH, { id: orgaoId });
    const params = { ...endpointConfig.PARAMS, dataInicio, dataFim, itens: '100' };
    try {
      const response = await apiClient.getAllPages(path, params, { context: `Eventos do órgão ${orgaoId} (${dataInicio} a ${dataFim})`, maxPages: 20 });
      return response || [];
    } catch (error: any) {
      this.context.logger.warn(`⚠️ Erro ao buscar eventos do órgão ${orgaoId} (${dataInicio}-${dataFim}): ${error.message}. Eventos não serão incluídos.`);
      return [];
    }
  }

  private async extractMembrosOrgao(orgaoId: string): Promise<MembroOrgaoAPI[]> {
    const endpointConfig = endpoints.ORGAOS.MEMBROS;
    const path = replacePath(endpointConfig.PATH, { id: orgaoId });
    const params = { ...endpointConfig.PARAMS, itens: '100' };
    try {
      const response = await apiClient.getAllPages(path, params, { context: `Membros do órgão ${orgaoId}`, maxPages: 20 });
      return response || [];
    } catch (error: any) {
      this.context.logger.warn(`⚠️ Erro ao buscar membros do órgão ${orgaoId}: ${error.message}. Membros não serão incluídos.`);
      return [];
    }
  }

  private async extractVotacoesOrgao(orgaoId: string, dataInicio: string, dataFim: string): Promise<VotacaoOrgaoAPI[]> {
    const endpointConfig = endpoints.ORGAOS.VOTACOES;
    const path = replacePath(endpointConfig.PATH, { id: orgaoId });
    const params = { ...endpointConfig.PARAMS, dataInicio, dataFim, itens: '100', ordem: 'DESC', ordenarPor: 'dataHoraRegistro' };
    try {
      const response = await apiClient.getAllPages(path, params, { context: `Votações do órgão ${orgaoId} (${dataInicio} a ${dataFim})`, maxPages: 50 });
      return response || [];
    } catch (error: any) {
      this.context.logger.warn(`⚠️ Erro ao buscar votações do órgão ${orgaoId} (${dataInicio}-${dataFim}): ${error.message}. Votações não serão incluídas.`);
      return [];
    }
  }

  async transform(data: OrgaoExtractedData): Promise<OrgaoTransformedData> {
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 10, 'Iniciando transformação dos dados de órgãos');
    const orgaosTransformados: OrgaoCompleto[] = [];
    let totalEventosConsultados = 0;
    let totalMembrosConsultados = 0;
    let totalVotacoesConsultadas = 0;

    for (let i = 0; i < data.orgaosCompletos.length; i++) {
      const orgao = data.orgaosCompletos[i];
      orgaosTransformados.push(orgao);
      if (orgao.eventos?.length) totalEventosConsultados += orgao.eventos.length;
      if (orgao.membros?.length) totalMembrosConsultados += orgao.membros.length;
      if (orgao.votacoes?.length) totalVotacoesConsultadas += orgao.votacoes.length;
      const progresso = Math.round(((i + 1) / data.orgaosCompletos.length) * 100);
      this.emitProgress(ProcessingStatus.TRANSFORMANDO, progresso, `${i + 1}/${data.orgaosCompletos.length} órgãos transformados`);
    }

    this.context.logger.info(`✅ Transformação concluída: ${orgaosTransformados.length} órgãos transformados`);
    return {
      orgaos: orgaosTransformados,
      estatisticas: {
        totalOrgaos: orgaosTransformados.length,
        totalEventos: totalEventosConsultados,
        totalMembros: totalMembrosConsultados,
        totalVotacoes: totalVotacoesConsultadas,
      },
    };
  }

  async load(data: OrgaoTransformedData): Promise<ETLResult> {
    this.emitProgress(ProcessingStatus.CARREGANDO, 5, 'Iniciando carregamento dos dados de órgãos');
    const startTime = Date.now();
    const destinos = Array.isArray(this.context.options.destino) ? this.context.options.destino : [this.context.options.destino];
    const idLegislatura = this.context.options.idLegislatura as number;
    let totalSucessos = 0;
    let totalFalhas = 0;

    const fs = await import('fs.js');
    const path = await import('path.js');
    const { getPCSaveDirectory } = await import('../utils/storage/firestore.js');

    if (destinos.includes('pc')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 10, `Salvando dados de órgãos da legislatura ${idLegislatura} no PC`);
      const rootSaveDir = getPCSaveDirectory() || './output_pc';
      const legislaturaDir = idLegislatura.toString();
      const baseOrgaosSaveDir = path.join(rootSaveDir, 'bancoDados_local', 'congressoNacional', 'camaraDeputados', 'legislatura', legislaturaDir, 'orgaos');
      const metadataDir = path.join(rootSaveDir, 'bancoDados_local', 'congressoNacional', 'camaraDeputados', 'legislatura', legislaturaDir, 'orgaos_metadata');
      
      try {
        fs.mkdirSync(baseOrgaosSaveDir, { recursive: true });
        fs.mkdirSync(metadataDir, { recursive: true });

        for (const orgao of data.orgaos) {
          // Salvar dados principais do órgão
          const orgaoPrincipalData = {
            id: orgao.id,
            sigla: orgao.sigla,
            nome: orgao.nome,
            uri: orgao.uri,
            detalhes: orgao.detalhes,
            dataExtracao: orgao.dataExtracao,
          };
          const orgaoFilePath = path.join(baseOrgaosSaveDir, `${orgao.id}.json`);
          fs.writeFileSync(orgaoFilePath, JSON.stringify(orgaoPrincipalData, null, 2));
          totalSucessos++;

          // Salvar subcoleções
          const subcollectionsBasePath = path.join(baseOrgaosSaveDir, orgao.id);
          if (orgao.eventos && orgao.eventos.length > 0) {
            const eventosDir = path.join(subcollectionsBasePath, 'eventos_data');
            fs.mkdirSync(eventosDir, { recursive: true });
            orgao.eventos.forEach(evento => {
              fs.writeFileSync(path.join(eventosDir, `${evento.id}.json`), JSON.stringify(evento, null, 2));
              totalSucessos++;
            });
          }
          if (orgao.membros && orgao.membros.length > 0) {
            const membrosDir = path.join(subcollectionsBasePath, 'membros_data');
            fs.mkdirSync(membrosDir, { recursive: true });
            orgao.membros.forEach(membro => {
              fs.writeFileSync(path.join(membrosDir, `${membro.idDeputado}.json`), JSON.stringify(membro, null, 2));
              totalSucessos++;
            });
          }
          if (orgao.votacoes && orgao.votacoes.length > 0) {
            const votacoesDir = path.join(subcollectionsBasePath, 'votacoes_data');
            fs.mkdirSync(votacoesDir, { recursive: true });
            orgao.votacoes.forEach(votacao => {
              fs.writeFileSync(path.join(votacoesDir, `${votacao.id}.json`), JSON.stringify(votacao, null, 2));
              totalSucessos++;
            });
          }
        }
        this.emitProgress(ProcessingStatus.CARREGANDO, 40, `Dados de órgãos da legislatura ${idLegislatura} salvos no PC`);
        
        const metadataPC = {
          idLegislatura: idLegislatura,
          totalOrgaosProcessados: data.orgaos.length,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: { dataExecucao: new Date().toISOString(), versaoETL: '2.0', opcoes: this.context.options }
        };
        const metadataFilePath = path.join(metadataDir, 'geral.json');
        fs.writeFileSync(metadataFilePath, JSON.stringify(metadataPC, null, 2));
        totalSucessos++;
        this.emitProgress(ProcessingStatus.CARREGANDO, 50, `Metadados de órgãos da legislatura ${idLegislatura} salvos no PC`);
        this.context.logger.info(`✅ Dados de órgãos da legislatura ${idLegislatura} salvos no PC em: ${path.join(rootSaveDir, 'bancoDados_local', 'congressoNacional', 'camaraDeputados', 'legislatura', legislaturaDir)}`);
      } catch (error: any) {
        this.context.logger.error(`❌ Erro ao salvar dados de órgãos da legislatura ${idLegislatura} no PC: ${error.message}`);
        totalFalhas += data.orgaos.length + 1; // Estimativa de falha total para este destino
      }
    }

    if (destinos.includes('firestore') || destinos.includes('emulator')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 60, `Iniciando salvamento de órgãos da legislatura ${idLegislatura} no Firestore`);
      const batchManager = await createBatchManager();
      let firestoreDocumentosSalvos = 0;
      let firestoreFalhasNoDestino = 0;

      try {
        for (const orgao of data.orgaos) {
          const firestorePathPrincipal = `congressoNacional/camaraDeputados/legislatura/${idLegislatura}/orgaos/${orgao.id}`;
          const orgaoPrincipalData = {
            id: orgao.id,
            sigla: orgao.sigla,
            nome: orgao.nome,
            uri: orgao.uri,
            detalhes: orgao.detalhes,
            dataExtracao: orgao.dataExtracao,
          };
          await batchManager.set(firestorePathPrincipal, orgaoPrincipalData);

          if (orgao.eventos && orgao.eventos.length > 0) {
            for (const evento of orgao.eventos) {
              const eventoPath = `${firestorePathPrincipal}/eventos_data/${evento.id}`;
              await batchManager.set(eventoPath, evento);
            }
          }
          if (orgao.membros && orgao.membros.length > 0) {
            for (const membro of orgao.membros) {
              // Usando idDeputado como ID do documento na subcoleção de membros
              const membroPath = `${firestorePathPrincipal}/membros_data/${membro.idDeputado}`;
              await batchManager.set(membroPath, membro);
            }
          }
          if (orgao.votacoes && orgao.votacoes.length > 0) {
            for (const votacao of orgao.votacoes) {
              const votacaoPath = `${firestorePathPrincipal}/votacoes_data/${votacao.id}`;
              await batchManager.set(votacaoPath, votacao);
            }
          }
        }
        
        const metadataPathFirestore = `congressoNacional/camaraDeputados/legislatura/${idLegislatura}/orgaos_metadata/geral`;
        await batchManager.set(metadataPathFirestore, {
          idLegislatura: idLegislatura,
          totalOrgaosProcessados: data.orgaos.length,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: { dataExecucao: new Date().toISOString(), versaoETL: '2.0', opcoes: this.context.options },
        });

        this.emitProgress(ProcessingStatus.CARREGANDO, 95, `Commit das operações de órgãos da legislatura ${idLegislatura} no Firestore`);
        const batchResult = await batchManager.commit();
        // As estatísticas do batchManager são atualizadas internamente
        firestoreDocumentosSalvos = batchResult.sucessos;
        firestoreFalhasNoDestino = batchResult.falhas; // Renomeado para evitar conflito com totalFalhas
        
        // Atualizar estatísticas globais
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhasNoDestino;
        // this.updateLoadStats já não existe, o batchManager lida com isso internamente ou o resultado é usado diretamente.
        // Para fins de log, podemos usar os valores do batchResult.
        this.context.logger.info(`✅ Carregamento de órgãos da legislatura ${idLegislatura} no Firestore concluído: ${firestoreDocumentosSalvos} documentos salvos, ${firestoreFalhasNoDestino} falhas.`);

      } catch (error: any) { // Erro pode ser um BatchResult ou outro erro
        this.context.logger.error(`❌ Erro no carregamento de órgãos da legislatura ${idLegislatura} para Firestore: ${error.message || error}`);
        if (error && typeof error === 'object' && 'falhas' in error) {
          const failedBatchResult = error as BatchResult;
          totalFalhas += failedBatchResult.falhas; // Adiciona ao total global de falhas
          totalSucessos += failedBatchResult.sucessos; // Adiciona sucessos parciais se houver
        } else {
          // Se não for um BatchResult, estimar falha para todos os documentos de órgãos e suas subcoleções
          let estimativaFalhas = data.orgaos.length; // Pelo menos um doc por órgão
          data.orgaos.forEach(o => {
            if (o.eventos) estimativaFalhas += o.eventos.length;
            if (o.membros) estimativaFalhas += o.membros.length;
            if (o.votacoes) estimativaFalhas += o.votacoes.length;
          });
          estimativaFalhas++; // Para o metadado
          totalFalhas += estimativaFalhas;
        }
      }
    }
    
    const duration = Date.now() - startTime;
    this.emitProgress(ProcessingStatus.CARREGANDO, 100, 'Carregamento de órgãos finalizado');

    return {
      sucessos: totalSucessos,
      falhas: totalFalhas,
      avisos: this.context.stats.avisos,
      tempoProcessamento: duration / 1000,
      destino: destinos.join(', '),
      legislatura: idLegislatura,
      detalhes: { 
        orgaosProcessados: data.orgaos.length,
        eventosEncontrados: data.estatisticas.totalEventos,
        membrosEncontrados: data.estatisticas.totalMembros,
        votacoesEncontradas: data.estatisticas.totalVotacoes,
        metadadosSalvos: totalSucessos > 0 && totalFalhas === 0, // Considerar metadados salvos apenas se tudo der certo
      },
    };
  }
}
