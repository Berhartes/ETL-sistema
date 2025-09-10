import { apiClient, replacePath } from '../api/index.js';
import { endpoints } from '../../config/endpoints.js';
import { logger } from '../logging/index.js';
// ✅ CONFIGURAÇÃO CENTRALIZADA: Importar da fonte única de verdade
import { etlConfig } from '../../../../../../../config/index.js';

export interface Periodo {
  dataInicio: string;
  dataFim: string;
}

/**
 * Busca os detalhes de uma legislatura específica para obter seu período (data de início e fim).
 * @param idLegislatura O ID da legislatura.
 * @returns Um objeto com dataInicio e dataFim da legislatura, ou null em caso de erro.
 */
export async function getLegislaturaPeriodo(idLegislatura: number): Promise<Periodo | null> {
  try {
    const endpointConfig = endpoints.LEGISLATURAS.DETALHES;
    if (!endpointConfig) {
      logger.error('[getLegislaturaPeriodo] Configuração do endpoint LEGISLATURAS.DETALHES não encontrada.');
      return null;
    }

    const path = replacePath(endpointConfig.PATH, { id: idLegislatura.toString() });
    
    logger.info(`[getLegislaturaPeriodo] Buscando período para legislatura ${idLegislatura}...`);

    // A função apiClient.get já tem retries embutidos através do withRetry no 'get' original.
    // Se for necessário um retry específico aqui, podemos envolvê-lo, mas geralmente o 'get' já cobre.
    const response = await apiClient.get(path, endpointConfig.PARAMS, {
      context: `Detalhes da legislatura ${idLegislatura}`,
      // Usar timeouts e retries globais ou específicos do endpoint se definidos
      timeout: endpointConfig.TIMEOUT || etlConfig.camara.timeout,
    });

    if (response && response.dados && response.dados.dataInicio && response.dados.dataFim) {
      logger.info(`[getLegislaturaPeriodo] Período para legislatura ${idLegislatura}: ${response.dados.dataInicio} a ${response.dados.dataFim}`);
      return {
        dataInicio: response.dados.dataInicio,
        dataFim: response.dados.dataFim,
      };
    } else {
      logger.error(`[getLegislaturaPeriodo] Não foi possível obter o período para a legislatura ${idLegislatura}. Resposta: ${JSON.stringify(response)}`);
      return null;
    }
  } catch (error: any) {
    logger.error(`[getLegislaturaPeriodo] Erro ao buscar período da legislatura ${idLegislatura}: ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      logger.error(`[getLegislaturaPeriodo] Stack trace: ${error.stack}`);
    }
    return null;
  }
}

/**
 * Gera uma lista de períodos anuais com base nas datas de início e fim de uma legislatura.
 * @param dataInicioLegislatura Data de início da legislatura (YYYY-MM-DD).
 * @param dataFimLegislatura Data de fim da legislatura (YYYY-MM-DD).
 * @returns Um array de objetos, cada um representando um período anual.
 */
export function gerarPeriodosAnuais(dataInicioLegislatura: string, dataFimLegislatura: string): Periodo[] {
  const periodos: Periodo[] = [];
  const startDate = new Date(dataInicioLegislatura + 'T00:00:00'); // Adiciona T00:00:00 para evitar problemas de fuso horário na conversão
  const endDate = new Date(dataFimLegislatura + 'T00:00:00');

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    logger.error('[gerarPeriodosAnuais] Datas de legislatura inválidas.');
    return [];
  }

  let currentYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  while (currentYear <= endYear) {
    let anoInicio: string;
    let anoFim: string;

    if (currentYear === startDate.getFullYear()) {
      // Primeiro ano da legislatura: usa a data de início da legislatura
      anoInicio = dataInicioLegislatura;
    } else {
      // Anos intermediários: começa em 01 de Janeiro
      anoInicio = `${currentYear}-01-01`;
    }

    if (currentYear === endDate.getFullYear()) {
      // Último ano da legislatura: usa a data de fim da legislatura
      anoFim = dataFimLegislatura;
    } else {
      // Anos intermediários: termina em 31 de Dezembro
      anoFim = `${currentYear}-12-31`;
    }
    
    // Garante que o período gerado não ultrapasse o fim da legislatura
    // (útil se a legislatura terminar antes de 31/12 do último ano)
    // e que o início do período não seja posterior ao fim.
    const dataInicioPeriodo = new Date(anoInicio + 'T00:00:00');
    const dataFimPeriodo = new Date(anoFim + 'T00:00:00');

    if (dataInicioPeriodo <= endDate && dataFimPeriodo >= startDate && dataInicioPeriodo <= dataFimPeriodo) {
       periodos.push({
        dataInicio: anoInicio,
        dataFim: anoFim,
      });
    }
    currentYear++;
  }
  logger.info(`[gerarPeriodosAnuais] Períodos anuais gerados: ${JSON.stringify(periodos)}`);
  return periodos;
}
