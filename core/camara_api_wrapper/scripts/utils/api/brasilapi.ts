import { logger } from '../logging/index.js';
import { withRetry } from '../logging/error-handler.js';

interface CNPJData {
  uf: string;
  municipio: string;
}

interface ReceitaWSResponse {
  uf?: string;
  municipio?: string;
  status?: string;
  message?: string;
}

/**
 * Busca dados de um CNPJ na API ReceitaWS (gratuita).
 * @param cnpj O CNPJ a ser consultado (apenas números).
 * @returns Dados do CNPJ, incluindo UF e município, ou null se não encontrado/erro.
 */
export async function getCnpjData(cnpj: string): Promise<CNPJData | null> {
  const cleanedCnpj = cnpj.replace(/\D/g, '');
  if (cleanedCnpj.length !== 14) {
    logger.warn(`CNPJ inválido para consulta na ReceitaWS: ${cnpj}`);
    return null;
  }

  const url = `https://www.receitaws.com.br/v1/cnpj/${cleanedCnpj}`;

  try {
    const response = await withRetry(
      async () => {
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; CNPJConsulta/1.0)'
          }
        });

        if (!res.ok) {
          if (res.status === 404) {
            logger.warn(`CNPJ ${cleanedCnpj} não encontrado na ReceitaWS.`);
            return null;
          }
          if (res.status === 429) {
            throw new Error(`Rate limit excedido na ReceitaWS: ${res.statusText}`);
          }
          throw new Error(`Erro ao consultar ReceitaWS para CNPJ ${cleanedCnpj}: ${res.statusText}`);
        }
        return res.json();
      },
      3,
      2000, // 2 segundos entre tentativas para respeitar rate limits
      `Consulta CNPJ ${cleanedCnpj} na ReceitaWS`
    );

    if (response && typeof response === 'object') {
      const data = response as ReceitaWSResponse;
      
      // Verificar se a resposta contém erro
      if (data.status === 'ERROR') {
        logger.warn(`Erro na consulta CNPJ ${cleanedCnpj}: ${data.message}`);
        return null;
      }
      
      // Verificar se temos os dados necessários
      if (data.uf && data.municipio) {
        return {
          uf: data.uf,
          municipio: data.municipio,
        };
      }
    }
    return null;

  } catch (error: any) {
    logger.error(`Erro fatal ao consultar ReceitaWS para CNPJ ${cleanedCnpj}: ${error.message}`);
    return null;
  }
}
