/**
 * Sistema de Identificação Inteligente de Fornecedores
 * 
 * Implementa estratégia hierárquica de fallback para maximizar a linkagem
 * deputado-fornecedor, mesmo com dados de baixa qualidade.
 * 
 * @author Claude + Parliamentary Transparency Analyst
 * @version 1.0.0
 */

export interface IdentificadorFornecedor {
  /** ID único usado como chave de identificação */
  id: string;
  
  /** Tipo de estratégia utilizada */
  tipo: 'CNPJ' | 'NOME_LINKADO' | 'NOME_NOVO' | 'CATEGORIA';
  
  /** Nível de confiança na identificação (0-100) */
  confianca: number;
  
  /** CNPJ original da despesa (pode estar inválido) */
  cnpjOriginal?: string;
  
  /** Nome original do fornecedor */
  nomeOriginal: string;
  
  /** Nome normalizado para comparações */
  nomeNormalizado: string;
  
  /** Metadados para auditoria */
  metadados: {
    estrategiaUtilizada: string;
    timestampProcessamento: Date;
    observacoes?: string;
  };
}

export interface DespesaInput {
  cnpj?: string;
  nomeFornecedor?: string;
  tipoDespesa?: string;
  ufDeputado?: string;
  valorLiquido?: number;
}

export class FornecedorIdentifier {
  private fornecedoresProcessados = new Map<string, IdentificadorFornecedor>();
  private indiceNomes = new Map<string, string>(); // nome normalizado -> id
  private logger: any;
  
  // Configurações
  private readonly SIMILARIDADE_MINIMA = 0.85;
  private readonly CNPJ_MINIMO_DIGITOS = 8;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * ALGORITMO PRINCIPAL - Gera identificador inteligente para fornecedor
   */
  gerarIdentificadorInteligente(despesa: DespesaInput): IdentificadorFornecedor {
    // 1️⃣ ESTRATÉGIA: CNPJ Válido (Prioritária)
    const cnpjValido = this.validarCNPJ(despesa.cnpj);
    if (cnpjValido) {
      return this.criarIdentificadorCNPJ(cnpjValido, despesa);
    }

    // 2️⃣ ESTRATÉGIA: Buscar por Nome Similar nos Já Processados
    const nomeNormalizado = this.normalizarNome(despesa.nomeFornecedor || '');
    if (nomeNormalizado.length >= 3) {
      const fornecedorExistente = this.buscarPorNomeSimilar(nomeNormalizado);
      if (fornecedorExistente) {
        return this.criarIdentificadorNomeLinkado(fornecedorExistente, despesa, nomeNormalizado);
      }

      // 3️⃣ ESTRATÉGIA: Criar ID baseado no Nome (Novo)
      return this.criarIdentificadorNomeNovo(nomeNormalizado, despesa);
    }

    // 4️⃣ ESTRATÉGIA: Fallback Categoria (Último Recurso)
    return this.criarIdentificadorCategoria(despesa);
  }

  /**
   * Registra fornecedor processado para futuras linkagens
   */
  registrarFornecedorProcessado(identificador: IdentificadorFornecedor): void {
    this.fornecedoresProcessados.set(identificador.id, identificador);
    this.indiceNomes.set(identificador.nomeNormalizado, identificador.id);
    
    this.logger.info(`🔗 [FornecedorIdentifier] Registrado: ${identificador.tipo} - ${identificador.id} (${identificador.confianca}%)`);
  }

  /**
   * Obtém estatísticas do processamento
   */
  obterEstatisticas(): any {
    const tiposContador = new Map<string, number>();
    let somaConfianca = 0;

    for (const fornecedor of this.fornecedoresProcessados.values()) {
      const atual = tiposContador.get(fornecedor.tipo) || 0;
      tiposContador.set(fornecedor.tipo, atual + 1);
      somaConfianca += fornecedor.confianca;
    }

    return {
      totalFornecedores: this.fornecedoresProcessados.size,
      distribuicaoPorTipo: Object.fromEntries(tiposContador),
      confiancaMedia: this.fornecedoresProcessados.size > 0 ? 
        Math.round(somaConfianca / this.fornecedoresProcessados.size) : 0
    };
  }

  // ============================================================================
  // MÉTODOS PRIVADOS - Estratégias de Identificação
  // ============================================================================

  /**
   * 1️⃣ ESTRATÉGIA: CNPJ Válido
   */
  private criarIdentificadorCNPJ(cnpjLimpo: string, despesa: DespesaInput): IdentificadorFornecedor {
    const identificador: IdentificadorFornecedor = {
      id: cnpjLimpo,
      tipo: 'CNPJ',
      confianca: 100,
      cnpjOriginal: despesa.cnpj,
      nomeOriginal: despesa.nomeFornecedor || 'Nome não informado',
      nomeNormalizado: this.normalizarNome(despesa.nomeFornecedor || ''),
      metadados: {
        estrategiaUtilizada: 'CNPJ_VALIDO',
        timestampProcessamento: new Date(),
        observacoes: `CNPJ válido: ${cnpjLimpo}`
      }
    };

    this.registrarFornecedorProcessado(identificador);
    return identificador;
  }

  /**
   * 2️⃣ ESTRATÉGIA: Nome Linkado (Encontrou Similar)
   */
  private criarIdentificadorNomeLinkado(
    fornecedorExistente: IdentificadorFornecedor, 
    despesa: DespesaInput, 
    nomeNormalizado: string
  ): IdentificadorFornecedor {
    const identificador: IdentificadorFornecedor = {
      id: fornecedorExistente.id,
      tipo: 'NOME_LINKADO',
      confianca: 85,
      cnpjOriginal: despesa.cnpj,
      nomeOriginal: despesa.nomeFornecedor || 'Nome não informado',
      nomeNormalizado,
      metadados: {
        estrategiaUtilizada: 'NOME_LINKADO',
        timestampProcessamento: new Date(),
        observacoes: `Linkado com fornecedor existente: ${fornecedorExistente.id}`
      }
    };

    return identificador;
  }

  /**
   * 3️⃣ ESTRATÉGIA: Nome Novo (Criar ID baseado no Nome)
   */
  private criarIdentificadorNomeNovo(nomeNormalizado: string, despesa: DespesaInput): IdentificadorFornecedor {
    const idNome = this.gerarIdPorNome(nomeNormalizado);
    
    const identificador: IdentificadorFornecedor = {
      id: idNome,
      tipo: 'NOME_NOVO',
      confianca: 70,
      cnpjOriginal: despesa.cnpj,
      nomeOriginal: despesa.nomeFornecedor || 'Nome não informado',
      nomeNormalizado,
      metadados: {
        estrategiaUtilizada: 'NOME_NOVO',
        timestampProcessamento: new Date(),
        observacoes: `ID gerado por nome: ${nomeNormalizado}`
      }
    };

    this.registrarFornecedorProcessado(identificador);
    return identificador;
  }

  /**
   * 4️⃣ ESTRATÉGIA: Categoria (Último Recurso)
   */
  private criarIdentificadorCategoria(despesa: DespesaInput): IdentificadorFornecedor {
    const categoria = despesa.tipoDespesa || 'SERVICOS_GERAIS';
    const uf = despesa.ufDeputado || 'BR';
    const idCategoria = `CAT_${this.normalizarTexto(categoria)}_${uf}`;

    const identificador: IdentificadorFornecedor = {
      id: idCategoria,
      tipo: 'CATEGORIA',
      confianca: 50,
      cnpjOriginal: despesa.cnpj,
      nomeOriginal: despesa.nomeFornecedor || 'Fornecedor não identificado',
      nomeNormalizado: this.normalizarTexto(categoria),
      metadados: {
        estrategiaUtilizada: 'CATEGORIA_FALLBACK',
        timestampProcessamento: new Date(),
        observacoes: `Agrupado por categoria: ${categoria} - ${uf}`
      }
    };

    this.registrarFornecedorProcessado(identificador);
    return identificador;
  }

  // ============================================================================
  // MÉTODOS UTILITÁRIOS
  // ============================================================================

  /**
   * Valida CNPJ e retorna versão limpa se válido
   */
  private validarCNPJ(cnpj?: string): string | null {
    if (!cnpj || typeof cnpj !== 'string') return null;
    
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    
    // Validação básica: deve ter pelo menos 8 dígitos e não ser sequência
    if (cnpjLimpo.length < this.CNPJ_MINIMO_DIGITOS) return null;
    if (/^(.)\1*$/.test(cnpjLimpo)) return null; // Todos iguais (ex: 000000000000)
    
    return cnpjLimpo;
  }

  /**
   * Normaliza nome para comparações
   */
  private normalizarNome(nome: string): string {
    if (!nome) return '';
    
    return nome
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^\w\s]/g, '') // Remove caracteres especiais
      .replace(/\b(LTDA|EPP|EIRELI|SA|S\/A|ME|MEI)\b/g, '') // Remove sufixos empresariais
      .replace(/\s+/g, ' ') // Normaliza espaços
      .trim();
  }

  /**
   * Normaliza texto genérico
   */
  private normalizarTexto(texto: string): string {
    if (!texto) return '';
    
    return texto
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Busca fornecedor por nome similar
   */
  private buscarPorNomeSimilar(nomeNormalizado: string): IdentificadorFornecedor | null {
    // Busca exata primeiro
    const idExato = this.indiceNomes.get(nomeNormalizado);
    if (idExato) {
      return this.fornecedoresProcessados.get(idExato) || null;
    }

    // Busca por similaridade
    for (const [nomeExistente, id] of this.indiceNomes) {
      const similaridade = this.calcularSimilaridade(nomeNormalizado, nomeExistente);
      if (similaridade >= this.SIMILARIDADE_MINIMA) {
        return this.fornecedoresProcessados.get(id) || null;
      }
    }

    return null;
  }

  /**
   * Calcula similaridade entre duas strings (Jaccard)
   */
  private calcularSimilaridade(str1: string, str2: string): number {
    const set1 = new Set(str1.split(' ').filter(word => word.length > 2));
    const set2 = new Set(str2.split(' ').filter(word => word.length > 2));
    
    const intersecao = new Set([...set1].filter(x => set2.has(x)));
    const uniao = new Set([...set1, ...set2]);
    
    return uniao.size > 0 ? intersecao.size / uniao.size : 0;
  }

  /**
   * Gera ID único baseado no nome
   */
  private gerarIdPorNome(nomeNormalizado: string): string {
    const hash = this.calcularHashSimples(nomeNormalizado);
    return `NOME_${hash}`;
  }

  /**
   * Hash simples para gerar IDs
   */
  private calcularHashSimples(texto: string): string {
    let hash = 0;
    for (let i = 0; i < texto.length; i++) {
      const char = texto.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Converte para 32-bit
    }
    return Math.abs(hash).toString(36).toUpperCase();
  }
}