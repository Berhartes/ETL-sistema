/**
 * Processador de Fornecedores - Modernizado para seguir arquitetura v2
 * 
 * Processa fornecedores buscando dados de CNPJ via APIs externas
 * para enriquecer informações de UF e município.
 */

import { logger } from '../utils/logging/index.js';
import { getCnpjData } from '../utils/api/brasilapi.js';
import { db } from '../../../../../lib/firebase.js';
import { collection, query, where, limit as firestoreLimit, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { ETLOptions } from '../types/etl.types.js';
import type { IProcessor, BatchResult } from '../utils/etl/run-etl-processor.js';

interface FornecedorFirestore {
  cnpj: string;
  nome: string;
  uf?: string;
  municipio?: string;
  totalGasto?: number;
  quantidadeTransacoes?: number;
  ultimaAtualizacao?: string;
}

interface FornecedorBatchResultDetails {
  fornecedoresProcessados: number;
  fornecedoresComSucesso: number;
  fornecedoresComErro: number;
  tempoMedioPorFornecedor: number;
}

/**
 * Processador de Fornecedores seguindo arquitetura modular v2
 */
export class FornecedoresProcessor implements IProcessor {
  private options: ETLOptions;

  constructor(options: ETLOptions) {
    this.options = options;
  }

  /**
   * Processa fornecedores buscando dados de CNPJ
   */
  async process(): Promise<BatchResult> {
    const startTime = Date.now();
    let totalProcessados = 0;
    let sucessos = 0;
    let falhas = 0;

    try {
      logger.info(`🏢 [Fornecedores] Iniciando processamento com limite: ${this.options.limite || 50}`);

      // Buscar fornecedores sem dados de UF
      const fornecedores = await this.buscarFornecedoresSemUF();
      
      if (fornecedores.length === 0) {
        logger.info('✅ [Fornecedores] Nenhum fornecedor encontrado para processamento');
        return this.buildResult(startTime, 0, 0, 0, []);
      }

      logger.info(`📋 [Fornecedores] Encontrados ${fornecedores.length} fornecedores para processar`);

      // Processar cada fornecedor
      const temposProcessamento: number[] = [];
      
      for (let i = 0; i < fornecedores.length; i++) {
        const fornecedor = fornecedores[i];
        const inicioFornecedor = Date.now();
        
        try {
          logger.info(`🔍 [${i + 1}/${fornecedores.length}] Processando: ${fornecedor.nome} (${fornecedor.cnpj})`);

          // Buscar dados do CNPJ
          const dadosCnpj = await getCnpjData(fornecedor.cnpj);
          
          if (dadosCnpj && dadosCnpj.uf && dadosCnpj.municipio) {
            await this.atualizarFornecedor(fornecedor.cnpj, {
              ...fornecedor,
              uf: dadosCnpj.uf,
              municipio: dadosCnpj.municipio,
              ultimaAtualizacao: new Date().toISOString()
            });
            
            logger.info(`✅ [Fornecedores] Atualizado: ${fornecedor.nome} - ${dadosCnpj.uf}/${dadosCnpj.municipio}`);
            sucessos++;
          } else {
            logger.warn(`⚠️ [Fornecedores] Dados não encontrados para CNPJ: ${fornecedor.cnpj}`);
            falhas++;
          }

          totalProcessados++;
          temposProcessamento.push(Date.now() - inicioFornecedor);

          // Rate limiting: 20 segundos entre consultas (ReceitaWS: 3/min)
          if (i < fornecedores.length - 1) {
            if (this.options.verbose) {
              logger.info(`⏳ [Fornecedores] Aguardando 20s para próxima consulta...`);
            }
            await this.delay(20000);
          }

        } catch (error: any) {
          logger.error(`❌ [Fornecedores] Erro ao processar ${fornecedor.cnpj}: ${error.message}`);
          falhas++;
          totalProcessados++;
        }
      }

      return this.buildResult(startTime, totalProcessados, sucessos, falhas, temposProcessamento);

    } catch (error: any) {
      logger.error(`💥 [Fornecedores] Erro fatal no processamento: ${error.message}`);
      return this.buildResult(startTime, totalProcessados, sucessos, falhas + 1, []);
    }
  }

  /**
   * Busca fornecedores sem dados de UF
   */
  private async buscarFornecedoresSemUF(): Promise<FornecedorFirestore[]> {
    try {
      const fornecedoresRef = collection(db, 'fornecedores');
      const q = query(
        fornecedoresRef,
        where('uf', '==', null),
        firestoreLimit(this.options.limite || 50)
      );
      
      const snapshot = await getDocs(q);
      const fornecedores: FornecedorFirestore[] = [];
      
      snapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data() as FornecedorFirestore;
        if (data.cnpj && data.cnpj.length === 14) {
          fornecedores.push({
            cnpj: data.cnpj,
            nome: data.nome || 'Nome não informado',
            totalGasto: data.totalGasto,
            quantidadeTransacoes: data.quantidadeTransacoes
          });
        }
      });

      return fornecedores;

    } catch (error: any) {
      logger.error(`❌ [Fornecedores] Erro ao buscar fornecedores: ${error.message}`);
      return [];
    }
  }

  /**
   * Atualiza dados do fornecedor no Firestore
   */
  private async atualizarFornecedor(cnpj: string, dados: FornecedorFirestore): Promise<void> {
    try {
      const fornecedorRef = doc(db, 'fornecedores', cnpj);
      await updateDoc(fornecedorRef, {
        uf: dados.uf,
        municipio: dados.municipio,
        ultimaAtualizacao: dados.ultimaAtualizacao
      });
    } catch (error: any) {
      throw new Error(`Erro ao atualizar fornecedor ${cnpj}: ${error.message}`);
    }
  }

  /**
   * Utilitário para pausar execução
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Constrói resultado padronizado do processamento
   */
  private buildResult(
    startTime: number,
    totalProcessados: number,
    sucessos: number,
    falhas: number,
    temposProcessamento: number[]
  ): BatchResult {
    const tempoTotal = (Date.now() - startTime) / 1000;
    const tempoMedio = temposProcessamento.length > 0 
      ? temposProcessamento.reduce((a, b) => a + b, 0) / temposProcessamento.length / 1000
      : 0;

    const detalhes: FornecedorBatchResultDetails = {
      fornecedoresProcessados: totalProcessados,
      fornecedoresComSucesso: sucessos,
      fornecedoresComErro: falhas,
      tempoMedioPorFornecedor: tempoMedio
    };

    return {
      tempoProcessamento: tempoTotal,
      destino: this.options.destino?.includes('pc') ? 'PC' : 'Firestore',
      totalProcessados,
      sucessos,
      falhas,
      detalhes
    };
  }
}