/**
 * Processador ETL para Grupos Parlamentares da Câmara
 *
 * Implementa o fluxo ETL completo para extrair, transformar e carregar
 * grupos parlamentares incluindo seus detalhes, histórico e membros.
 */

import { ETLProcessor } from '../core/etl-processor.js';
import {
  ValidationResult,
  BatchResult,
  ETLOptions,
  ProcessingStatus,
  ETLResult,
  // ETLError // Comentado pois não é usado diretamente aqui, mas pode ser útil
} from '../types/etl.types.js';
// import { logger } from '../utils/logging/index.js'; // Será usado quando implementarmos os logs específicos
import { createBatchManager } from '../utils/storage/index.js';
import { etlConfig } from '../../../../../config/index.js';
import { apiClient, get, replacePath } from '../utils/api/index.js';
import { endpoints } from '../config/endpoints.js';
import { withRetry } from '../utils/logging/error-handler.js';

/**
 * Interface para Grupo Parlamentar básico (da lista)
 */
interface GrupoBasico {
  id: string;
  uri: string;
  nome: string;
  sigla: string; // A API de lista de grupos pode não ter sigla, verificar
  // idLegislatura: number; // Grupos não parecem ser diretamente ligados a uma legislatura na listagem principal
}

/**
 * Interface para o Último Status de um Grupo
 */
interface UltimoStatusGrupo {
  idLegislatura?: number;
  dataStatus?: string;
  presidenteNome?: string;
  presidenteUri?: string;
  oficioTitulo?: string;
  oficioUri?: string;
}

/**
 * Interface para Detalhes de um Grupo
 */
interface DetalhesGrupo {
  id: string;
  uri: string;
  nome: string;
  anoCriacao?: number;
  resolucaoTitulo?: string;
  resolucaoUri?: string;
  subvencionado?: number; // 0 ou 1
  grupoMisto?: number; // 0 ou 1
  ativo?: number; // 0 ou 1
  observacoes?: string;
  ultimoStatus?: UltimoStatusGrupo;
}

/**
 * Interface para um item do Histórico de um Grupo
 */
interface HistoricoItemGrupo {
  // Definir campos com base na API /grupos/{id}/historico
  // Exemplo: dataInicio, dataFim, status, etc.
  idLegislatura?: number;
  dataStatus?: string;
  presidenteNome?: string;
  presidenteUri?: string;
  // Adicionar outros campos conforme a API
}

/**
 * Interface para um Membro de um Grupo
 */
interface MembroGrupo {
  // Definir campos com base na API /grupos/{id}/membros
  // Exemplo: idDeputado, nome, siglaPartido, dataInicio, dataFim, etc.
  idDeputado: string;
  uriDeputado: string;
  nome: string;
  siglaPartido?: string;
  uf?: string;
  // Adicionar outros campos conforme a API
}

/**
 * Interface para Grupo Parlamentar completo
 */
interface GrupoCompleto {
  id: string;
  nome: string;
  // idLegislatura?: number; // Se aplicável
  detalhes: DetalhesGrupo;
  historico: HistoricoItemGrupo[];
  membros: MembroGrupo[];
  dataExtracao: string;
}

/**
 * Dados extraídos da API
 */
interface ExtractedData {
  grupos: GrupoBasico[];
  gruposCompletos: GrupoCompleto[];
  totalProcessados: number;
}

/**
 * Dados transformados
 */
interface TransformedData {
  grupos: GrupoCompleto[];
  estatisticas: {
    totalGrupos: number;
    totalHistoricoItems: number;
    totalMembros: number;
    // Adicionar outras estatísticas relevantes
  };
}

/**
 * Processador de Grupos Parlamentares
 */
export class GruposProcessor extends ETLProcessor<ExtractedData, TransformedData> {
  constructor(options: ETLOptions) {
    super(options);
  }

  /**
   * Nome do processador
   */
  protected getProcessName(): string {
    return 'Processador de Grupos Parlamentares';
  }

  /**
   * Validação específica do processador
   */
  async validate(): Promise<ValidationResult> {
    const baseValidation = this.validateCommonParams();
    const erros = [...baseValidation.erros];
    const avisos = [...baseValidation.avisos];

    // Validações específicas de grupos (se houver)
    // Ex: if (!this.context.options.algumParametroObrigatorioParaGrupos) {
    //   erros.push('Parâmetro X é obrigatório para extrair grupos');
    // }

    if (this.context.options.limite && this.context.options.limite > 100) { // Ajustar limite conforme necessidade
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
    const limite = this.context.options.limite || 0;

    this.emitProgress(ProcessingStatus.EXTRAINDO, 10, 'Iniciando extração de dados de grupos');

    try {
      // 1. Extrair lista de grupos
      this.context.logger.info('📋 Extraindo lista de grupos parlamentares');
      const gruposBasicos = await this.extractGruposLista();

      if (gruposBasicos.length === 0) {
        this.context.logger.warn('⚠️ Nenhum grupo encontrado');
        return {
          grupos: [],
          gruposCompletos: [],
          totalProcessados: 0
        };
      }

      // Aplicar limite se especificado
      let gruposParaProcessar = gruposBasicos;
      if (limite > 0 && gruposBasicos.length > limite) {
        this.context.logger.info(`🔢 Aplicando limite: ${limite} de ${gruposBasicos.length} grupos`);
        gruposParaProcessar = gruposBasicos.slice(0, limite);
      }

      this.emitProgress(ProcessingStatus.EXTRAINDO, 30, `Extraindo detalhes de ${gruposParaProcessar.length} grupos`);

      // 2. Extrair detalhes completos de cada grupo
      const gruposCompletos = await this.extractGruposCompletos(gruposParaProcessar);

      this.emitProgress(ProcessingStatus.EXTRAINDO, 90, 'Extração de grupos concluída');

      return {
        grupos: gruposBasicos,
        gruposCompletos,
        totalProcessados: gruposCompletos.length
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na extração de grupos: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai lista de grupos
   */
  private async extractGruposLista(): Promise<GrupoBasico[]> {
    try {
      const endpointConfig = endpoints.GRUPOS.LISTA;
      const params = {
        ...endpointConfig.PARAMS,
        // Adicionar outros parâmetros se necessário, ex: itens: this.context.options.itensPorPagina || 100
      };

      const todosGrupos = await apiClient.getAllPages(
        endpointConfig.PATH,
        params,
        {
          context: 'Lista de grupos parlamentares',
          maxPages: this.context.options.maxPagesApi || 50 // Definir um limite razoável de páginas
        }
      );

      if (!todosGrupos || !Array.isArray(todosGrupos)) {
        this.context.logger.warn('Nenhum grupo retornado pela API na lista.');
        return [];
      }

      const grupos: GrupoBasico[] = todosGrupos.map((grupo: any) => ({
        id: grupo.id?.toString() || '',
        uri: grupo.uri || '',
        nome: grupo.nome || '',
        sigla: grupo.sigla || '', // Verificar se 'sigla' existe neste endpoint
      }));

      this.context.logger.info(`✅ Encontrados ${grupos.length} grupos parlamentares`);
      return grupos;

    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair lista de grupos: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai detalhes completos dos grupos
   */
  private async extractGruposCompletos(grupos: GrupoBasico[]): Promise<GrupoCompleto[]> {
    const gruposCompletos: GrupoCompleto[] = [];
    const concorrencia = this.context.options.concorrencia || 2; // Padrão de concorrência

    this.context.logger.info(`🔄 Extraindo detalhes completos de grupos com concorrência: ${concorrencia}`);

    for (let i = 0; i < grupos.length; i += concorrencia) {
      const lote = grupos.slice(i, i + concorrencia);
      this.context.logger.info(`📦 Processando lote de grupos ${Math.floor(i / concorrencia) + 1}: ${lote.length} grupos`);

      const promessas = lote.map(async (grupoBasico) => {
        try {
          const grupoCompleto = await this.extractGrupoCompleto(grupoBasico);
          this.incrementSucessos();
          return grupoCompleto;
        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao extrair detalhes do grupo ${grupoBasico.id}: ${error.message}`);
          this.incrementFalhas();
          return null;
        }
      });

      const resultados = await Promise.allSettled(promessas);
      resultados.forEach((resultado) => {
        if (resultado.status === 'fulfilled' && resultado.value) {
          gruposCompletos.push(resultado.value);
        }
      });

      const progresso = Math.min(90, 30 + (gruposCompletos.length / grupos.length) * 60);
      this.emitProgress(ProcessingStatus.EXTRAINDO, progresso, `${gruposCompletos.length}/${grupos.length} grupos extraídos`);

      if (i + concorrencia < grupos.length) {
        await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests));
      }
    }

    this.context.logger.info(`✅ Extração de detalhes concluída: ${gruposCompletos.length} de ${grupos.length} grupos`);
    return gruposCompletos;
  }

  /**
   * Extrai detalhes completos de um grupo (detalhes, histórico, membros)
   */
  private async extractGrupoCompleto(grupoBasico: GrupoBasico): Promise<GrupoCompleto> {
    try {
      this.context.logger.debug(`🔎 Extraindo dados completos para o grupo ID: ${grupoBasico.id} (${grupoBasico.nome})`);
      // 1. Extrair detalhes do grupo
      const detalhes = await this.extractDetalhesGrupo(grupoBasico.id);

      // 2. Extrair histórico do grupo
      const historico = await this.extractHistoricoGrupo(grupoBasico.id);

      // 3. Extrair membros do grupo
      const membros = await this.extractMembrosGrupo(grupoBasico.id);

      return {
        id: grupoBasico.id,
        nome: detalhes.nome || grupoBasico.nome, // Prioriza nome dos detalhes
        detalhes,
        historico,
        membros,
        dataExtracao: new Date().toISOString()
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair dados completos do grupo ${grupoBasico.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrai detalhes de um grupo específico
   */
  private async extractDetalhesGrupo(grupoId: string): Promise<DetalhesGrupo> {
    const endpointConfig = endpoints.GRUPOS.DETALHES;
    const endpointPath = replacePath(endpointConfig.PATH, { id: grupoId });

    const response = await withRetry(
      () => get(endpointPath, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Detalhes do grupo ${grupoId}`
    );
    // A API retorna os dados diretamente no objeto 'dados'
    return (response?.dados || {}) as DetalhesGrupo;
  }

  /**
   * Extrai histórico de um grupo específico
   */
  private async extractHistoricoGrupo(grupoId: string): Promise<HistoricoItemGrupo[]> {
    const endpointConfig = endpoints.GRUPOS.HISTORICO;
    const endpointPath = replacePath(endpointConfig.PATH, { id: grupoId });
    
    // Este endpoint não suporta paginação, então usamos get() diretamente.
    // Os parâmetros em endpointConfig.PARAMS já devem estar vazios ou corretos.
    const response = await withRetry(
      () => get(endpointPath, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Histórico do grupo ${grupoId}`
    );
        
    return (response?.dados || []) as HistoricoItemGrupo[];
  }

  /**
   * Extrai membros de um grupo específico
   */
  private async extractMembrosGrupo(grupoId: string): Promise<MembroGrupo[]> {
    const endpointConfig = endpoints.GRUPOS.MEMBROS;
    const endpointPath = replacePath(endpointConfig.PATH, { id: grupoId });

    // Este endpoint não suporta paginação, então usamos get() diretamente.
    // Os parâmetros em endpointConfig.PARAMS já devem estar vazios ou corretos.
    const response = await withRetry(
      () => get(endpointPath, endpointConfig.PARAMS),
      etlConfig.camara.maxRetries,
      etlConfig.camara.pauseBetweenRequests,
      `Membros do grupo ${grupoId}`
    );
        
    // A API pode retornar os membros diretamente ou dentro de um sub-objeto "membros" no objeto "dados"
    // Exemplo de retorno: { dados: { id: 'X', nome: 'Y', membros: [...] } }
    // Ou diretamente: { dados: [...] }
    // Precisamos verificar a estrutura exata do retorno para este endpoint específico.
    // Pelo feedback, parece que os membros estão em response.dados.membros (uma lista de listas)
    // ou diretamente em response.dados se for uma lista simples.
    // O XML de exemplo mostra <dados><dados><membros><membros>...</membros></membros></dados></dados>
    // Isso sugere que response.dados (o primeiro <dados>) contém outro <dados> que por sua vez tem <membros> com uma lista de <membros>.
    // No entanto, a chamada get() já deve tratar o primeiro nível 'dados'.
    // Se o XML é <dados><membros><membros>...</membros></membros></dados>, então response.dados.membros será a lista.
    // Se o XML é <dados><dados><membros>...</membros></dados></dados>, então response.dados[0].membros ou similar.
    // O feedback do usuário mostra: <dados><dados><id>32</id><nome>Brasil/Equador</nome><membros><membros>...</membros></membros></dados></dados>
    // Isso significa que `response.dados` será um objeto com `id`, `nome` e `membros`.
    // E `response.dados.membros` será um objeto com uma propriedade `membros` que é a lista.
    // Portanto, `response.dados.membros.membros` deve ser a lista correta.
    // Ou, se a API for mais simples e retornar { dados: { membros: [...] } }, então response.dados.membros.

    // Com base no XML: <dados> <dados> <id>...</id> <membros> <membros>...</membros> </membros> </dados> </dados>
    // A função get() já extrai o conteúdo de <dados>.
    // Se o resultado de get() for o conteúdo do primeiro <dados>, então precisamos acessar o segundo <dados> (que é um array de 1 elemento)
    // e depois a propriedade 'membros' e sua subpropriedade 'membros'.
    // No entanto, o feedback do log de erro mostra que `extractMembrosGrupo` é chamado, e o erro 400 ocorre.
    // Isso significa que o problema ainda é com os parâmetros enviados, não com a extração dos dados da resposta.
    // A correção anterior no `endpoints.ts` para `GRUPOS.MEMBROS` já removeu os parâmetros de paginação.
    // A chamada `get(endpointPath, endpointConfig.PARAMS)` agora usará PARAMS vazios.

    // A API para /grupos/{id}/membros retorna os dados diretamente no array 'dados'.
    // Ex: { "dados": [ { "idLegislatura": 57, ... }, { ... } ], "links": [...] }
    return (response?.dados || []) as MembroGrupo[];
  }


  /**
   * Transformação dos dados extraídos
   */
  async transform(data: ExtractedData): Promise<TransformedData> {
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 10, 'Iniciando transformação dos dados de grupos');
    let totalHistoricoItems = 0;
    let totalMembros = 0;

    try {
      const gruposTransformados: GrupoCompleto[] = data.gruposCompletos.map((grupo, index) => {
        // Aqui podem ser aplicadas transformações mais complexas se necessário
        totalHistoricoItems += grupo.historico.length;
        totalMembros += grupo.membros.length;
        
        const progresso = Math.round(((index + 1) / data.gruposCompletos.length) * 100);
        this.emitProgress(ProcessingStatus.TRANSFORMANDO, progresso, `${index + 1}/${data.gruposCompletos.length} grupos transformados`);
        
        return {
          ...grupo,
          dataTransformacao: new Date().toISOString() // Exemplo de campo adicionado na transformação
        };
      });

      const estatisticas = {
        totalGrupos: gruposTransformados.length,
        totalHistoricoItems,
        totalMembros,
      };

      this.context.logger.info(`✅ Transformação de grupos concluída: ${gruposTransformados.length} grupos transformados`);
      this.context.logger.info(`📊 Estatísticas: ${totalHistoricoItems} itens de histórico, ${totalMembros} membros`);

      return {
        grupos: gruposTransformados,
        estatisticas
      };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na transformação de grupos: ${error.message}`);
      throw error;
    }
  }

  /**
   * Carregamento dos dados transformados
   */
  async load(data: TransformedData): Promise<ETLResult> {
    this.emitProgress(ProcessingStatus.CARREGANDO, 5, 'Iniciando carregamento dos dados de grupos');
    const startTime = Date.now();
    const destinos = Array.isArray(this.context.options.destino)
      ? this.context.options.destino
      : [this.context.options.destino];
    // A legislatura pode não ser diretamente aplicável a todos os grupos, mas pode ser usada para metadados se disponível.
    const legislaturaAtual = this.context.options.legislatura; 

    let totalSucessos = 0;
    let totalFalhas = 0;

    const fs = await import('fs.js');
    const path = await import('path.js');
    const { getPCSaveDirectory } = await import('../utils/storage/firestore.js');

    // Lógica de salvamento para PC
    if (destinos.includes('pc')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 10, 'Salvando dados de grupos no PC');
      const rootSaveDir = getPCSaveDirectory() || './output_pc_grupos';
      const baseSaveDir = path.join(rootSaveDir, 'bancoDados_local', 'congressoNacional', 'camaraDeputados', 'legislatura', 'semlegislatura', 'grupos');
      const metadataSavePath = path.join(baseSaveDir, 'informacoes.json');
      
      try {
        fs.mkdirSync(baseSaveDir, { recursive: true });

        // 1. Salvar grupos individuais
        for (const grupo of data.grupos) {
          const filePath = path.join(baseSaveDir, `${grupo.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify(grupo, null, 2));
          totalSucessos++;
        }
        this.emitProgress(ProcessingStatus.CARREGANDO, 40, 'Grupos individuais salvos no PC');
        
        // 2. Salvar metadados gerais de grupos
        const metadataPC = {
          totalGruposProcessados: data.grupos.length,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '1.0', 
            opcoes: this.context.options,
            ...(legislaturaAtual && { legislatura: legislaturaAtual }) // Adiciona legislatura se existir
          }
        };
        fs.writeFileSync(metadataSavePath, JSON.stringify(metadataPC, null, 2));
        totalSucessos++;
        this.emitProgress(ProcessingStatus.CARREGANDO, 50, 'Metadados de grupos salvos no PC');
        this.context.logger.info(`✅ Dados de grupos salvos no PC em: ${baseSaveDir}`);

      } catch (error: any) {
        this.context.logger.error(`❌ Erro ao salvar dados de grupos no PC: ${error.message}`);
        totalFalhas += data.grupos.length + 1; // Estimativa
      }
    }

    // Lógica de salvamento para Firestore
    if (destinos.includes('firestore') || destinos.includes('emulator')) {
      this.emitProgress(ProcessingStatus.CARREGANDO, 60, 'Iniciando salvamento de grupos no Firestore');
      const batchManager = await createBatchManager();
      let firestoreDocumentosSalvos = 0;
      let firestoreFalhas = 0;

      try {
        // 1. Salvar grupos individuais
        this.emitProgress(ProcessingStatus.CARREGANDO, 70, 'Salvando grupos individuais no Firestore');
        for (const grupo of data.grupos) {
          const firestorePath = `congressoNacional/camaraDeputados/legislatura/semlegislatura/grupos/${grupo.id}`;
          await batchManager.set(firestorePath, grupo);
        }
        
        // 2. Salvar metadados gerais de grupos
        this.emitProgress(ProcessingStatus.CARREGANDO, 85, 'Salvando metadados de grupos no Firestore');
        const metadataFirestore = {
          totalGruposProcessados: data.grupos.length,
          estatisticasGerais: data.estatisticas,
          ultimaAtualizacao: new Date().toISOString(),
          processamento: {
            dataExecucao: new Date().toISOString(),
            versaoETL: '1.0',
            opcoes: this.context.options,
            ...(legislaturaAtual && { legislatura: legislaturaAtual })
          }
        };
        const metadataPathFirestore = `congressoNacional/camaraDeputados/legislatura/semlegislatura/grupos/informacoes`;
        await batchManager.set(metadataPathFirestore, metadataFirestore);

        this.emitProgress(ProcessingStatus.CARREGANDO, 95, 'Commit das operações de grupos no Firestore');
        const batchResult = await batchManager.commit();
        firestoreDocumentosSalvos = batchResult.sucessos;
        firestoreFalhas = batchResult.falhas;

        this.updateLoadStats(batchResult.total, firestoreDocumentosSalvos, firestoreFalhas);
        this.context.logger.info(`✅ Carregamento de grupos no Firestore concluído: ${firestoreDocumentosSalvos} documentos salvos.`);
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;

      } catch (error: any) {
        this.context.logger.error(`❌ Erro no carregamento de grupos para Firestore: ${error.message}`);
        if (error && typeof error === 'object' && 'sucessos' in error && 'falhas' in error) {
          const failedBatchResult = error as BatchResult;
          firestoreFalhas += failedBatchResult.falhas;
          firestoreDocumentosSalvos += failedBatchResult.sucessos;
        } else {
          firestoreFalhas += data.grupos.length + 1; // Estimativa
        }
        totalSucessos += firestoreDocumentosSalvos;
        totalFalhas += firestoreFalhas;
        this.updateLoadStats(data.grupos.length + 1, firestoreDocumentosSalvos, firestoreFalhas);
      }
    }
    
    const duration = Date.now() - startTime;
    this.emitProgress(ProcessingStatus.CARREGANDO, 100, 'Carregamento de grupos finalizado');

    return {
      sucessos: totalSucessos,
      falhas: totalFalhas,
      avisos: this.context.stats.avisos,
      tempoProcessamento: duration / 1000,
      destino: destinos.join(', '),
      ...(legislaturaAtual && { legislatura: legislaturaAtual }),
      detalhes: {
        gruposProcessados: data.grupos.length,
        historicoItemsProcessados: data.estatisticas.totalHistoricoItems,
        membrosProcessados: data.estatisticas.totalMembros,
        metadadosSalvos: totalSucessos > 0 
      }
    };
  }
}
