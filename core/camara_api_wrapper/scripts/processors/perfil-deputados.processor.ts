/**
 * Processador ETL para Perfis de Deputados da Câmara
 *
 * Implementa o fluxo ETL completo para extrair, transformar e carregar
 * perfis completos de deputados incluindo mandatos, filiações e histórico.
 */

import { ETLProcessor } from '../core/etl-processor.js';
import {
  ValidationResult,
  BatchResult,
  PerfilDeputado,
  DeputadoBasico,
  ETLOptions,
  ProcessingStatus // Importar ProcessingStatus
} from '../types/etl.types.js';
import { createBatchManager } from '../utils/storage/index.js';
import { etlConfig } from '../../../../../config/index.js';
import * as api from '../utils/api/index.js';
import { endpoints } from '../config/endpoints.js';
import { withRetry } from '../utils/logging/error-handler.js';

/**
 * Dados extraídos da API
 */
interface ExtractedData {
  deputadosLegislatura: DeputadoBasico[];
  perfisCompletos: any[];
  totalProcessados: number;
}

/**
 * Dados transformados
 */
interface TransformedData {
  perfis: PerfilDeputado[];
  estatisticas: {
    totalPerfis: number;
    comMandatos: number;
    comFiliacoes: number;
    comFotos: number;
  };
}

/**
 * Processador de Perfis de Deputados
 */
export class PerfilDeputadosProcessor extends ETLProcessor<ExtractedData, TransformedData> {
  private rawPerfisCompletos: any[] = []; // Adicionar para armazenar perfis crus

  /**
   * Normaliza texto removendo acentos e caracteres especiais
   */
  private normalizarTextoCompleto(texto: string): string {
    if (!texto || typeof texto !== 'string') return '';
    
    return texto
      .normalize('NFD') // Decomposição Unicode
      .replace(/[\u0300-\u036f]/g, '') // Remove diacríticos
      .replace(/[çÇ]/g, 'c')
      .replace(/[ñÑ]/g, 'n')
      .replace(/[æÆ]/g, 'ae')
      .replace(/[œŒ]/g, 'oe')
      .replace(/[ßß]/g, 'ss')
      .trim();
  }

  constructor(options: ETLOptions) {
    super(options);
  }

  /**
   * Nome do processador
   */
  protected getProcessName(): string {
    return 'Processador de Perfis de Deputados';
  }

  /**
   * Validação específica do processador
   */
  async validate(): Promise<ValidationResult> {
    const baseValidation = this.validateCommonParams();
    const erros = [...baseValidation.erros];
    const avisos = [...baseValidation.avisos];

    // Validações específicas de perfis
    if (this.context.options.deputado) {
      const deputadoId = this.context.options.deputado;
      if (!/^\d+$/.test(deputadoId)) {
        erros.push(`Código de deputado inválido: ${deputadoId}. Deve conter apenas números.`);
      }
    }

    // Avisos sobre configurações
    if (this.context.options.limite && this.context.options.limite > 1000) {
      avisos.push('Limite muito alto pode causar lentidão. Considere processar em lotes menores.');
    }

    // Validar configurações de perfil
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
    const deputadoEspecifico = this.context.options.deputado;

    this.emitProgress(ProcessingStatus.EXTRAINDO, 10, 'Iniciando extração de dados');

    try {
      let deputadosParaProcessar: DeputadoBasico[];

      if (deputadoEspecifico) {
        // Extrair apenas deputado específico
        this.context.logger.info(`🎯 Extraindo perfil do deputado específico: ${deputadoEspecifico}`);
        deputadosParaProcessar = await this.extractDeputadoEspecifico(deputadoEspecifico, legislatura);
      } else {
        // Extrair lista de deputados da legislatura
        this.context.logger.info(`📋 Extraindo lista de deputados da ${legislatura}ª Legislatura`);
        const listaCompleta = await this.extractDeputadosLegislatura(legislatura);

        // Aplicar filtros
        deputadosParaProcessar = this.applyFilters(listaCompleta);

        // Aplicar limite
        if (limite > 0 && deputadosParaProcessar.length > limite) {
          this.context.logger.info(`🔢 Aplicando limite: ${limite} de ${deputadosParaProcessar.length} deputados`);
          deputadosParaProcessar = deputadosParaProcessar.slice(0, limite);
        }
      }

      if (deputadosParaProcessar.length === 0) {
        this.context.logger.warn('⚠️ Nenhum deputado encontrado com os filtros especificados');
        return {
          deputadosLegislatura: [],
          perfisCompletos: [],
          totalProcessados: 0
        };
      }

      this.emitProgress(ProcessingStatus.EXTRAINDO, 30, `Extraindo perfis de ${deputadosParaProcessar.length} deputados`);

      // Extrair perfis completos
      const perfisCompletos = await this.extractPerfisCompletos(deputadosParaProcessar);
      this.rawPerfisCompletos = perfisCompletos; // Armazenar perfis crus

      this.emitProgress(ProcessingStatus.EXTRAINDO, 90, 'Extração concluída');

      return {
        deputadosLegislatura: deputadosParaProcessar,
        perfisCompletos, // Manter para a interface ExtractedData, mas usaremos this.rawPerfisCompletos no load
        totalProcessados: perfisCompletos.length
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na extração: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai deputado específico
   */
  private async extractDeputadoEspecifico(deputadoId: string, legislatura: number): Promise<DeputadoBasico[]> {
    try {
      const endpointConfig = endpoints.DEPUTADOS.PERFIL;
      const endpoint = api.replacePath(endpointConfig.PATH, { codigo: deputadoId });

      const response = await withRetry(
        () => api.get(endpoint, endpointConfig.PARAMS),
        etlConfig.camara.maxRetries,
        etlConfig.camara.pauseBetweenRequests,
        `Perfil do deputado ${deputadoId}`
      );

      if (!response || !response.dados) {
        throw new Error(`Deputado ${deputadoId} não encontrado`);
      }

      const deputado = response.dados;

      // Verificar se pertence à legislatura especificada
      const pertenceLegislatura = deputado.ultimoStatus?.idLegislatura === legislatura ||
        (deputado.mandatos && deputado.mandatos.some((m: any) => m.idLegislatura === legislatura));

      if (!pertenceLegislatura) {
        this.context.logger.warn(`⚠️ Deputado ${deputadoId} não pertence à ${legislatura}ª Legislatura`);
        return [];
      }

      // Transformar para formato básico
      const deputadoBasico: DeputadoBasico = {
        id: deputado.id?.toString() || deputadoId,
        nome: this.normalizarTextoCompleto(deputado.nomeCivil || deputado.nome || ''),
        nomeCivil: this.normalizarTextoCompleto(deputado.nomeCivil || ''),
        siglaPartido: this.normalizarTextoCompleto(deputado.ultimoStatus?.siglaPartido || ''),
        siglaUf: this.normalizarTextoCompleto(deputado.ultimoStatus?.siglaUf || ''),
        idLegislatura: legislatura,
        urlFoto: deputado.ultimoStatus?.urlFoto
      };

      return [deputadoBasico];

    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair deputado ${deputadoId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai lista de deputados da legislatura
   */
  private async extractDeputadosLegislatura(legislatura: number): Promise<DeputadoBasico[]> {
    try {
      const endpointConfig = endpoints.DEPUTADOS.LISTA;
      let deputados: DeputadoBasico[] = [];
      let pagina = 1;
      let totalDeputados = 0;

      // Remove itens per page from base params and use REQUEST_CONFIG.DEFAULT_ITEMS_PER_PAGE
      const { ...baseParams } = endpointConfig.PARAMS; // Variável 'itens' removida pois não era utilizada

      do {
        const params = {
          ...baseParams,
          idLegislatura: legislatura.toString(),
          ordem: 'ASC',
          ordenarPor: 'nome',
          pagina: pagina.toString(),
          itens: String(etlConfig.camara.itemsPerPage || endpoints.REQUEST.DEFAULT_ITEMS_PER_PAGE)
        };

        const response = await withRetry(
          () => api.get(endpointConfig.PATH, params),
          etlConfig.camara.maxRetries,
          etlConfig.camara.pauseBetweenRequests,
          `Lista de deputados da legislatura ${legislatura}, página ${pagina}`
        );

        if (!response || !response.dados || !Array.isArray(response.dados)) {
          throw new Error(`Nenhum deputado encontrado para a legislatura ${legislatura}, página ${pagina}`);
        }

        const deputadosDaPagina: DeputadoBasico[] = response.dados.map((dep: any) => ({
          id: dep.id?.toString() || '',
          nome: this.normalizarTextoCompleto(dep.nome || ''),
          nomeCivil: this.normalizarTextoCompleto(dep.nomeCivil || ''),
          siglaPartido: this.normalizarTextoCompleto(dep.siglaPartido || ''),
          siglaUf: this.normalizarTextoCompleto(dep.siglaUf || ''),
          idLegislatura: legislatura,
          urlFoto: dep.urlFoto
        }));

        deputados = deputados.concat(deputadosDaPagina);
        totalDeputados += deputadosDaPagina.length;
        pagina++;

      } while (deputados.length % (etlConfig.camara.itemsPerPage || endpoints.REQUEST.DEFAULT_ITEMS_PER_PAGE) === 0 && deputados.length > 0);

      this.context.logger.info(`✅ Encontrados ${totalDeputados} deputados na ${legislatura}ª Legislatura`);
      return deputados;

    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair lista de deputados: ${error.message}`);
      throw error;
    }
  }

  /**
   * Aplica filtros aos deputados
   */
  private applyFilters(deputados: DeputadoBasico[]): DeputadoBasico[] {
    let filtrados = [...deputados];

    // 🔧 CORREÇÃO: Deduplicação de deputados duplicados da API
    const totalOriginal = filtrados.length;
    filtrados = this.deduplicateDeputados(filtrados);
    const totalAposDeduplicacao = filtrados.length;

    if (totalOriginal !== totalAposDeduplicacao) {
      this.context.logger.info(`🔄 Deduplicação: ${totalOriginal} → ${totalAposDeduplicacao} deputados (removidos ${totalOriginal - totalAposDeduplicacao} duplicados)`);
    }

    // Filtro por partido
    if (this.context.options.partido) {
      const partido = this.context.options.partido.toUpperCase();
      filtrados = filtrados.filter(dep => dep.siglaPartido === partido);
      this.context.logger.info(`🔍 Filtro por partido ${partido}: ${filtrados.length} deputados`);
    }

    // Filtro por UF
    if (this.context.options.uf) {
      const uf = this.context.options.uf.toUpperCase();
      filtrados = filtrados.filter(dep => dep.siglaUf === uf);
      this.context.logger.info(`🔍 Filtro por UF ${uf}: ${filtrados.length} deputados`);
    }

    return filtrados;
  }

  /**
   * Remove deputados duplicados baseado no ID
   *
   * A API da Câmara dos Deputados às vezes retorna o mesmo deputado múltiplas vezes
   * na mesma lista (geralmente devido a mudanças de partido). Esta função remove
   * as duplicatas mantendo apenas a primeira ocorrência de cada deputado.
   */
  private deduplicateDeputados(deputados: DeputadoBasico[]): DeputadoBasico[] {
    const deputadosUnicos = new Map<string, DeputadoBasico>();
    const duplicados: string[] = [];

    for (const deputado of deputados) {
      const id = deputado.id;

      if (deputadosUnicos.has(id)) {
        // Deputado duplicado encontrado
        duplicados.push(`${deputado.nome} (ID: ${id})`);

        // Manter o deputado com mais informações (priorizar o que tem nomeCivil)
        const existente = deputadosUnicos.get(id)!;
        if (deputado.nomeCivil && !existente.nomeCivil) {
          deputadosUnicos.set(id, deputado);
        }
      } else {
        // Primeiro registro deste deputado
        deputadosUnicos.set(id, deputado);
      }
    }

    // Log detalhado dos duplicados encontrados (apenas em modo verbose)
    if (duplicados.length > 0 && this.context.options.verbose) {
      this.context.logger.debug(`📋 Deputados duplicados removidos:`);
      duplicados.forEach(dup => this.context.logger.debug(`   - ${dup}`));
    }

    return Array.from(deputadosUnicos.values());
  }

  /**
   * Extrai perfis completos de deputados
   */
  private async extractPerfisCompletos(deputados: DeputadoBasico[]): Promise<any[]> {
    const perfis: any[] = [];
    const concorrencia = this.context.options.concorrencia || etlConfig.camara.concurrency;

    this.context.logger.info(`🔄 Extraindo perfis completos com concorrência: ${concorrencia}`);

    // Processar em lotes para controlar concorrência
    for (let i = 0; i < deputados.length; i += concorrencia) {
      const lote = deputados.slice(i, i + concorrencia);

      this.context.logger.info(`📦 Processando lote ${Math.floor(i / concorrencia) + 1}: ${lote.length} deputados`);

      // Processar lote em paralelo
      const promessas = lote.map(async (deputado) => {
        try {
          const perfil = await this.extractPerfilCompleto(deputado.id);
          this.incrementSucessos();
          return perfil;
        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao extrair perfil do deputado ${deputado.id}: ${error.message}`);
          this.incrementFalhas();
          return null;
        }
      });

      const resultados = await Promise.allSettled(promessas);

      // Coletar perfis válidos
      resultados.forEach((resultado) => {
        if (resultado.status === 'fulfilled' && resultado.value) {
          perfis.push(resultado.value);
        }
      });

      // Progresso
      const progresso = Math.min(90, 30 + (i / deputados.length) * 60);
      this.emitProgress(ProcessingStatus.EXTRAINDO, progresso, `${perfis.length}/${deputados.length} perfis extraídos`);

      // Pausa entre lotes
      if (i + concorrencia < deputados.length) {
        await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests));
      }
    }

    this.context.logger.info(`✅ Extração concluída: ${perfis.length} perfis de ${deputados.length} deputados`);
    return perfis;
  }

  /**
   * Extrai perfil completo de um deputado
   *
   * ⚠️ CORREÇÃO CRÍTICA: Na API da Câmara dos Deputados, os mandatos e filiações
   * vêm DENTRO do perfil básico, não em endpoints separados como no Senado!
   */
  private async extractPerfilCompleto(deputadoId: string): Promise<any> {
    const endpointConfig = endpoints.DEPUTADOS.PERFIL;
    const endpoint = api.replacePath(endpointConfig.PATH, { codigo: deputadoId });

    const response = await withRetry(
      () => api.get(endpoint, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Perfil completo do deputado ${deputadoId}`
    );

    if (!response || !response.dados) {
      throw new Error(`Perfil do deputado ${deputadoId} não encontrado`);
    }

    const perfilBase = response.dados;

    // ✅ CORREÇÃO: Na API da Câmara, mandatos e filiações já vêm no perfil básico!
    // Não precisamos fazer chamadas separadas que geram erro 405
    const perfilCompleto: any = { ...perfilBase };

    // ✅ Mandatos e filiações já estão incluídos no perfilBase!
    // perfilBase.mandatos (array com histórico de mandatos)
    // perfilBase.filiacoes (array com histórico de filiações partidárias)

    this.context.logger.info(`✅ Perfil básico extraído para deputado ${deputadoId} (mandatos e filiações incluídos)`);

    // 🔧 Extrair apenas dados complementares que existem na API da Câmara
    try {
      const [
        orgaos,
        frentes,
        ocupacoes,
        mandatosExternos,
        historico,
        profissoes
      ] = await Promise.allSettled([
        this.extractOrgaos(deputadoId),
        this.extractFrentes(deputadoId),
        this.extractOcupacoes(deputadoId),
        this.extractMandatosExternos(deputadoId),
        this.extractHistorico(deputadoId),
        this.extractProfissoes(deputadoId)
      ]);

      // Consolidar resultados dos dados complementares
      perfilCompleto.orgaos = orgaos.status === 'fulfilled' ? orgaos.value : [];
      perfilCompleto.frentes = frentes.status === 'fulfilled' ? frentes.value : [];
      perfilCompleto.ocupacoes = ocupacoes.status === 'fulfilled' ? ocupacoes.value : [];
      perfilCompleto.mandatosExternos = mandatosExternos.status === 'fulfilled' ? mandatosExternos.value : [];
      perfilCompleto.historico = historico.status === 'fulfilled' ? historico.value : [];
      perfilCompleto.profissoes = profissoes.status === 'fulfilled' ? profissoes.value : [];

      this.context.logger.info(`✅ Dados complementares extraídos para deputado ${deputadoId}`);

    } catch (error: any) { // Explicitly type error as any
      this.context.logger.warn(`⚠️ Erro ao extrair dados complementares do deputado ${deputadoId}: ${error.message}`);
      // Continue mesmo com erro nos dados complementares
    }

    return perfilCompleto;
  }

  /**
   * Extrai órgãos de um deputado
   */
  private async extractOrgaos(deputadoId: string): Promise<any[]> {
    const endpointConfig = endpoints.DEPUTADOS.ORGAOS;
    const endpoint = api.replacePath(endpointConfig.PATH, { codigo: deputadoId });

    const response = await withRetry(
      () => api.get(endpoint, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Órgãos do deputado ${deputadoId}`
    );

    return response?.dados || [];
  }

  /**
   * Extrai frentes parlamentares de um deputado
   */
  private async extractFrentes(deputadoId: string): Promise<any[]> {
    const endpointConfig = endpoints.DEPUTADOS.FRENTES;
    const endpoint = api.replacePath(endpointConfig.PATH, { codigo: deputadoId });

    const response = await withRetry(
      () => api.get(endpoint, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Frentes do deputado ${deputadoId}`
    );

    return response?.dados || [];
  }

  /**
   * Extrai ocupações de um deputado
   */
  private async extractOcupacoes(deputadoId: string): Promise<any[]> {
    const endpointConfig = endpoints.DEPUTADOS.OCUPACOES;
    const endpoint = api.replacePath(endpointConfig.PATH, { codigo: deputadoId });

    const response = await withRetry(
      () => api.get(endpoint, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Ocupações do deputado ${deputadoId}`
    );

    return response?.dados || [];
  }

  /**
   * Extrai mandatos externos de um deputado
   */
  private async extractMandatosExternos(deputadoId: string): Promise<any[]> {
    const endpointConfig = endpoints.DEPUTADOS.MANDATOS_EXTERNOS;
    const endpoint = api.replacePath(endpointConfig.PATH, { codigo: deputadoId });

    const response = await withRetry(
      () => api.get(endpoint, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Mandatos externos do deputado ${deputadoId}`
    );

    return response?.dados || [];
  }

  /**
   * Extrai histórico de um deputado
   */
  private async extractHistorico(deputadoId: string): Promise<any[]> {
    const endpointConfig = endpoints.DEPUTADOS.HISTORICO;
    const endpoint = api.replacePath(endpointConfig.PATH, { codigo: deputadoId });

    const response = await withRetry(
      () => api.get(endpoint, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Histórico do deputado ${deputadoId}`
    );

    return response?.dados || [];
  }

  /**
   * Extrai profissões de um deputado
   */
  private async extractProfissoes(deputadoId: string): Promise<any[]> {
    const endpointConfig = endpoints.DEPUTADOS.PROFISSOES;
    const endpoint = api.replacePath(endpointConfig.PATH, { codigo: deputadoId });

    const response = await withRetry(
      () => api.get(endpoint, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Profissões do deputado ${deputadoId}`
    );

    return response?.dados || [];
  }

  /**
   * Transformação dos dados extraídos
   */
  async transform(data: ExtractedData): Promise<TransformedData> {
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 10, 'Iniciando transformação dos dados');

    try {
      const perfisTransformados: PerfilDeputado[] = [];
      let comMandatos = 0;
      let comFiliacoes = 0;
      let comFotos = 0;

      for (let i = 0; i < data.perfisCompletos.length; i++) {
        const perfilBruto = data.perfisCompletos[i];

        try {
          const perfilTransformado = this.transformPerfil(perfilBruto);
          perfisTransformados.push(perfilTransformado);

          // Estatísticas
          if (perfilTransformado.mandatos && perfilTransformado.mandatos.length > 0) {
            comMandatos++;
          }
          if (perfilTransformado.filiacoes && perfilTransformado.filiacoes.length > 0) {
            comFiliacoes++;
          }
          if (perfilTransformado.urlFoto) {
            comFotos++;
          }

        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao transformar perfil: ${error.message}`);
          this.incrementFalhas();
        }

        // Progresso
        const progresso = Math.round((i / data.perfisCompletos.length) * 100);
        this.emitProgress(ProcessingStatus.TRANSFORMANDO, progresso, `${i + 1}/${data.perfisCompletos.length} perfis transformados`);
      }

      const estatisticas = {
        totalPerfis: perfisTransformados.length,
        comMandatos,
        comFiliacoes,
        comFotos
      };

      this.context.logger.info(`✅ Transformação concluída: ${perfisTransformados.length} perfis transformados`);
      this.context.logger.info(`📊 Estatísticas: ${comMandatos} com mandatos, ${comFiliacoes} com filiações, ${comFotos} com fotos`);

      return {
        perfis: perfisTransformados,
        estatisticas
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na transformação: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transforma perfil individual
   */
  private transformPerfil(perfilBruto: any): PerfilDeputado {
    const perfil: PerfilDeputado = {
      // Dados básicos
      id: perfilBruto.id?.toString() || '',
      uri: perfilBruto.uri,
      nome: this.normalizarTextoCompleto(perfilBruto.nomeCivil || perfilBruto.ultimoStatus?.nome || ''),
      nomeCivil: this.normalizarTextoCompleto(perfilBruto.nomeCivil || ''),
      nomeEleitoral: this.normalizarTextoCompleto(perfilBruto.ultimoStatus?.nomeEleitoral || ''),
      siglaPartido: this.normalizarTextoCompleto(perfilBruto.ultimoStatus?.siglaPartido || ''),
      siglaUf: this.normalizarTextoCompleto(perfilBruto.ultimoStatus?.siglaUf || ''),
      idLegislatura: this.context.options.legislatura!,
      urlFoto: perfilBruto.ultimoStatus?.urlFoto,

      // Dados pessoais
      cpf: perfilBruto.cpf,
      sexo: perfilBruto.sexo,
      dataNascimento: perfilBruto.dataNascimento,
      dataFalecimento: perfilBruto.dataFalecimento,
      municipioNascimento: perfilBruto.municipioNascimento,
      ufNascimento: perfilBruto.ufNascimento,

      // Contato e redes
      email: perfilBruto.ultimoStatus?.email,
      urlWebsite: perfilBruto.urlWebsite,
      redeSocial: Array.isArray(perfilBruto.redeSocial) ? perfilBruto.redeSocial : (perfilBruto.redeSocial ? [perfilBruto.redeSocial] : []),


      // Dados acadêmicos
      escolaridade: perfilBruto.escolaridade,

      // Status e gabinete
      situacao: perfilBruto.ultimoStatus?.situacao,
      condicaoEleitoral: perfilBruto.ultimoStatus?.condicaoEleitoral,
      gabinete: perfilBruto.ultimoStatus?.gabinete ? {
        nome: this.normalizarTextoCompleto(perfilBruto.ultimoStatus.gabinete.nome || ''),
        predio: perfilBruto.ultimoStatus.gabinete.predio,
        sala: perfilBruto.ultimoStatus.gabinete.sala,
        andar: perfilBruto.ultimoStatus.gabinete.andar,
        telefone: perfilBruto.ultimoStatus.gabinete.telefone,
        email: perfilBruto.ultimoStatus.gabinete.email,
      } : undefined,

      // Metadados
      dataUltimaAtualizacao: perfilBruto.ultimoStatus?.data,
      dataExtracao: new Date().toISOString()
    };

    // ✅ CORREÇÃO: Transformar mandatos que vêm diretamente do perfil básico da API da Câmara
    if (perfilBruto.mandatos && Array.isArray(perfilBruto.mandatos)) {
      perfil.mandatos = perfilBruto.mandatos.map((mandato: any) => ({
        idLegislatura: mandato.idLegislatura || 0,
        dataInicio: mandato.dataInicio === undefined ? null : mandato.dataInicio,
        dataFim: mandato.dataFim === undefined ? null : mandato.dataFim,
        siglaPartido: mandato.siglaPartido || '',
        siglaUf: mandato.siglaUf || '',
        condicaoEleitoral: mandato.condicaoEleitoral,
        situacao: mandato.situacao
      }));
      this.context.logger.debug(`✅ Transformados ${perfil.mandatos!.length} mandatos para deputado ${perfil.id}`);
    } else {
      // Se não há mandatos no perfil, tentar extrair do ultimoStatus
      if (perfilBruto.ultimoStatus) {
        perfil.mandatos = [{
          idLegislatura: this.context.options.legislatura!,
          dataInicio: perfilBruto.ultimoStatus.dataInicio,
          dataFim: perfilBruto.ultimoStatus.dataFim,
          siglaPartido: perfilBruto.ultimoStatus.siglaPartido || '',
          siglaUf: perfilBruto.ultimoStatus.siglaUf || '',
          condicaoEleitoral: perfilBruto.ultimoStatus.condicaoEleitoral,
          situacao: perfilBruto.ultimoStatus.situacao
        }];
        this.context.logger.debug(`✅ Criado mandato atual para deputado ${perfil.id} baseado em ultimoStatus`);
      }
    }

    // ✅ CORREÇÃO: Transformar filiações que vêm diretamente do perfil básico da API da Câmara
    if (perfilBruto.filiacoes && Array.isArray(perfilBruto.filiacoes)) {
      perfil.filiacoes = perfilBruto.filiacoes.map((filiacao: any) => ({
        siglaPartido: this.normalizarTextoCompleto(filiacao.siglaPartido || ''),
        nomePartido: this.normalizarTextoCompleto(filiacao.nomePartido || ''),
        dataInicio: filiacao.dataInicio === undefined ? null : filiacao.dataInicio,
        dataFim: filiacao.dataFim === undefined ? null : filiacao.dataFim
      }));
      this.context.logger.debug(`✅ Transformadas ${perfil.filiacoes!.length} filiações para deputado ${perfil.id}`);
    } else {
      // Se não há filiações no perfil, criar baseado no ultimoStatus
      if (perfilBruto.ultimoStatus && perfilBruto.ultimoStatus.siglaPartido) {
        perfil.filiacoes = [{
          siglaPartido: this.normalizarTextoCompleto(perfilBruto.ultimoStatus.siglaPartido || ''),
          nomePartido: this.normalizarTextoCompleto(perfilBruto.ultimoStatus.nomePartido || ''),
          dataInicio: perfilBruto.ultimoStatus.dataInicio,
          dataFim: perfilBruto.ultimoStatus.dataFim
        }];
        this.context.logger.debug(`✅ Criada filiação atual para deputado ${perfil.id} baseada em ultimoStatus`);
      }
    }

    return perfil;
  }

  /**
   * Carregamento dos dados transformados
   */
  async load(data: TransformedData): Promise<any> {
    this.emitProgress(ProcessingStatus.CARREGANDO, 5, 'Iniciando carregamento dos dados');
    const startTime = Date.now();
    const legislaturaAtual = this.context.options.legislatura!;
    // Garantir que this.context.options.destino seja sempre um array
    const destinos = Array.isArray(this.context.options.destino)
      ? this.context.options.destino
      : [this.context.options.destino];

    let totalSucessos = 0;
    let totalFalhas = 0;

    // Importar fs e path para salvamento em PC
    const fs = await import('fs.js');
    const path = await import('path.js');
    const { getPCSaveDirectory } = await import('../utils/storage/firestore.js'); // Para obter o diretório base

    // Lógica de salvamento para PC
    if (destinos.includes('pc')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 10, 'Salvando dados no PC');
      const rootSaveDir = getPCSaveDirectory() || './output_pc_perfis'; // Diretório raiz configurado ou padrão
      const baseSaveDir = path.join(rootSaveDir, 'bancoDados_local'); // Adiciona bancoDados_local

      // Caminhos espelhando a estrutura do Firestore
      const pcSavePathPerfisRaw = path.join(baseSaveDir, 'congressoNacional', 'camaraDeputados', 'perfil');
      const pcSavePathPerfisLeg = path.join(baseSaveDir, 'congressoNacional', 'camaraDeputados', 'legislatura', `${legislaturaAtual}`, 'deputados');
      const pcSavePathMetadataLegislatura = path.join(baseSaveDir, 'congressoNacional', 'camaraDeputados', 'legislatura');

      try {
        // Criar diretórios se não existirem
        fs.mkdirSync(pcSavePathPerfisRaw, { recursive: true });
        fs.mkdirSync(pcSavePathPerfisLeg, { recursive: true });
        fs.mkdirSync(pcSavePathMetadataLegislatura, { recursive: true });

        // 1. Salvar dados brutos da API (raw response) no caminho de "perfil"
        if (this.rawPerfisCompletos && this.rawPerfisCompletos.length > 0) {
          for (const rawPerfil of this.rawPerfisCompletos) {
            if (rawPerfil && rawPerfil.id) {
              const filePath = path.join(pcSavePathPerfisRaw, `${rawPerfil.id}.json`);
              fs.writeFileSync(filePath, JSON.stringify(rawPerfil, null, 2));
              totalSucessos++;
            }
          }
        }
        this.emitProgress(ProcessingStatus.CARREGANDO, 25, 'Dados brutos salvos no PC');

        // 2. Salvar perfis completos transformados no caminho de "legislatura/.../deputados"
        for (const perfil of data.perfis) {
          const idLegislaturaParaSalvar = perfil.idLegislatura || legislaturaAtual; // Garante que temos a legislatura
          // Recriar o caminho para cada perfil para o caso de múltiplas legislaturas (embora este processador foque em uma)
          const perfilLegPath = path.join(baseSaveDir, 'congressoNacional', 'camaraDeputados', 'legislatura', `${idLegislaturaParaSalvar}`, 'deputados');
          fs.mkdirSync(perfilLegPath, { recursive: true }); // Garantir que o diretório da legislatura específica exista
          const filePath = path.join(perfilLegPath, `${perfil.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify(perfil, null, 2));
          totalSucessos++;
        }
        this.emitProgress(ProcessingStatus.CARREGANDO, 40, 'Perfis transformados salvos no PC');
        
        // 3. Salvar metadados da legislatura
        const listaDeputadosParaMetadataPC = data.perfis.map(p => ({
          id: p.id,
          nome: this.normalizarTextoCompleto(p.nome),
          siglaPartido: this.normalizarTextoCompleto(p.siglaPartido),
          siglaUf: this.normalizarTextoCompleto(p.siglaUf),
          urlFoto: p.urlFoto
        }));
        const metadataPC = {
          legislatura: legislaturaAtual,
          totalDeputadosProcessados: data.perfis.length,
          deputados: listaDeputadosParaMetadataPC,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '2.0', // Ajustar conforme necessário
            opcoes: this.context.options,
          },
          indices: {
            porPartido: this.createIndexByParty(data.perfis),
            porUF: this.createIndexByUF(data.perfis),
            porSituacao: this.createIndexBySituation(data.perfis)
          }
        };
        // Salva os metadados da legislatura no caminho correto
        const metadataFilePath = path.join(pcSavePathMetadataLegislatura, `metadata_legislatura_${legislaturaAtual}.json`);
        fs.writeFileSync(metadataFilePath, JSON.stringify(metadataPC, null, 2));
        totalSucessos++;
        this.emitProgress(ProcessingStatus.CARREGANDO, 50, 'Metadados salvos no PC');
        this.context.logger.info(`✅ Dados salvos no PC em: ${rootSaveDir}`); // Logar o diretório raiz

      } catch (error: any) {
        this.context.logger.error(`❌ Erro ao salvar dados no PC: ${error.message}`);
        totalFalhas += (this.rawPerfisCompletos?.length || 0) + data.perfis.length + 1; // Estimativa de falhas
      }
    }

    // Lógica de salvamento para Firestore (Real ou Emulador)
    if (destinos.includes('firestore') || destinos.includes('emulator')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 60, 'Iniciando salvamento no Firestore');
      const batchManager = await createBatchManager(); // createBatchManager decidirá se é real ou emulador
      let firestoreDocumentosSalvos = 0;
      let firestoreFalhas = 0;

      try {
        // 1. Salvar dados básicos da API (raw response)
        this.emitProgress(ProcessingStatus.CARREGANDO, 70, 'Salvando dados brutos do perfil (API detalhes) no Firestore');
        if (this.rawPerfisCompletos && this.rawPerfisCompletos.length > 0) {
          for (const rawPerfil of this.rawPerfisCompletos) {
            if (rawPerfil && rawPerfil.id) {
              const firestorePath = `congressoNacional/camaraDeputados/perfil/${rawPerfil.id}`;
              await batchManager.set(firestorePath, rawPerfil);
            }
          }
        }

        // 2. Salvar perfis completos transformados
        this.emitProgress(ProcessingStatus.CARREGANDO, 80, 'Salvando perfis transformados da legislatura no Firestore');
        for (const perfil of data.perfis) {
          const idLegislaturaParaSalvar = perfil.idLegislatura || legislaturaAtual;
          const firestorePath = `congressoNacional/camaraDeputados/legislatura/${idLegislaturaParaSalvar}/deputados/${perfil.id}`;
          await batchManager.set(firestorePath, perfil);
        }
        
        // 3. Salvar metadados da legislatura
        this.emitProgress(ProcessingStatus.CARREGANDO, 90, 'Salvando metadados da legislatura no Firestore');
        const listaDeputadosParaMetadata = data.perfis.map(p => ({
          id: p.id,
          nome: this.normalizarTextoCompleto(p.nome),
          siglaPartido: this.normalizarTextoCompleto(p.siglaPartido),
          siglaUf: this.normalizarTextoCompleto(p.siglaUf),
          urlFoto: p.urlFoto
        }));

        const metadataFirestore = {
          legislatura: legislaturaAtual,
          totalDeputadosProcessados: data.perfis.length,
          deputados: listaDeputadosParaMetadata,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '2.0', // Ajustar conforme necessário
            opcoes: this.context.options,
          },
          indices: {
            porPartido: this.createIndexByParty(data.perfis),
            porUF: this.createIndexByUF(data.perfis),
            porSituacao: this.createIndexBySituation(data.perfis)
          }
        };
        const metadataPathFirestore = `congressoNacional/camaraDeputados/legislatura/metadata_legislatura_${legislaturaAtual}`;
        await batchManager.set(metadataPathFirestore, metadataFirestore);
        
        this.emitProgress(ProcessingStatus.CARREGANDO, 95, 'Commit das operações no Firestore');
        const batchResult = await batchManager.commit();
        firestoreDocumentosSalvos = batchResult.sucessos;
        firestoreFalhas = batchResult.falhas;
        
        this.updateLoadStats(batchResult.total, firestoreDocumentosSalvos, firestoreFalhas); // Atualiza estatísticas globais
        this.context.logger.info(`✅ Carregamento no Firestore concluído: ${firestoreDocumentosSalvos} documentos salvos.`);
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;

      } catch (error: any) {
        this.context.logger.error(`❌ Erro no carregamento para Firestore: ${error.message}`);
        // Se o erro for um BatchResult, usar suas estatísticas
        if (error && typeof error === 'object' && 'sucessos' in error && 'falhas' in error) {
          const failedBatchResult: BatchResult = error;
          firestoreFalhas += failedBatchResult.falhas; // Adicionar falhas do batch
          firestoreDocumentosSalvos += failedBatchResult.sucessos; // Adicionar sucessos parciais se houver
        } else {
          // Para outros erros, assumir que todas as operações pendentes no batch atual falharam
          // O número exato de itens no batch é difícil de determinar aqui sem rastreá-lo.
          // Vamos estimar com base no que foi tentado.
          firestoreFalhas += (this.rawPerfisCompletos?.length || 0) + data.perfis.length + 1;
        }
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;
        this.updateLoadStats((this.rawPerfisCompletos?.length || 0) + data.perfis.length + 1, firestoreDocumentosSalvos, firestoreFalhas);
      }
    }

    const duration = Date.now() - startTime;
    this.emitProgress(ProcessingStatus.CARREGANDO, 100, 'Carregamento finalizado');
    
    // O resultado retornado deve refletir o sucesso/falha geral de todos os destinos
    return {
      sucessos: totalSucessos,
      falhas: totalFalhas,
      tempoOperacao: duration,
      // O campo 'destino' em ETLResult é uma string. Precisamos decidir como representá-lo.
      // Por enquanto, vamos concatenar os destinos.
      destino: destinos.join(', ') 
    };
  }

  /**
   * Cria índice por partido
   */
  private createIndexByParty(perfis: PerfilDeputado[]): Record<string, number> {
    const index: Record<string, number> = {};

    perfis.forEach(perfil => {
      const partido = perfil.siglaPartido || 'SEM_PARTIDO';
      index[partido] = (index[partido] || 0) + 1;
    });

    return index;
  }

  /**
   * Cria índice por UF
   */
  private createIndexByUF(perfis: PerfilDeputado[]): Record<string, number> {
    const index: Record<string, number> = {};

    perfis.forEach(perfil => {
      const uf = perfil.siglaUf || 'SEM_UF';
      index[uf] = (index[uf] || 0) + 1;
    });

    return index;
  }

  /**
   * Cria índice por situação
   */
  private createIndexBySituation(perfis: PerfilDeputado[]): Record<string, number> {
    const index: Record<string, number> = {};

    perfis.forEach(perfil => {
      // Determinar situação baseada na presença de data de falecimento
      const situacao = perfil.dataFalecimento ? 'FALECIDO' : 'ATIVO';
      index[situacao] = (index[situacao] || 0) + 1;
    });

    return index;
  }
}
