// Firestore Service - Versão Modular com Compatibilidade Total
// Este arquivo mantém 100% de compatibilidade com o código existente
// redirecionando para os novos serviços modulares.

// Re-exportar tudo do facade para manter compatibilidade total
export { 
  FirestoreService,
  firestoreService
} from './firestore/firestore-facade.js';

// Tipos importados dos serviços modulares

// Manter também as interfaces originais por compatibilidade
export interface DespesaFirestore {
  dataDocumento?: string;
  tipoDespesa?: string;
  tipoDocumento?: string;
  nomeFornecedor?: string;
  cnpjCpfFornecedor?: string;
  valorDocumento?: number | string;
  valorGlosa?: number | string;
  valorLiquido?: number | string;
  urlDocumento?: string;
  numDocumento?: string;
  numParcela?: number;
  [key: string]: any;
}

export interface DeputadoFirestore {
  id: string;
  nome?: string;
  nomeCivil?: string;
  siglaPartido?: string;
  siglaUf?: string;
  urlFoto?: string;
  cpf?: string;
  nomeEleitoral?: string;
  situacao?: string;
  condicaoEleitoral?: string;
  gabinete?: {
    nome?: string;
    predio?: string;
    sala?: string;
    andar?: string;
    telefone?: string;
    email?: string;
  };
  redeSocial?: string[];
  dataNascimento?: string;
  dataFalecimento?: string;
  sexo?: string;
  escolaridade?: string;
  ufNascimento?: string;
  municipioNascimento?: string;
  urlWebsite?: string;
  email?: string;
  totalGastos?: number;
  scoreInvestigativo?: number;
  indicadorConformidade?: string;
  numeroTransacoes?: number;
  numeroFornecedores?: number;
  ultimaAtualizacao?: any;
  ideCadastro?: string;
  nuCarteiraParlamentar?: string;
  nuLegislatura?: number;
  [key: string]: any;
}

export interface FornecedorCompleto {
  id: string;
  cnpj: string;
  nome: string;
  totalRecebido: number;
  numTransacoes: number;
  deputadosAtendidos: string[];
  categorias: string[];
  mediaTransacao: number;
  indiceSuspeicao: number;
  categoriaRisco?: 'NORMAL' | 'SUSPEITO' | 'ALTO_RISCO' | 'ORGANIZACAO_CRIMINOSA';
  alertasInvestigativos?: string[];
}

export interface FornecedorDetalhado extends FornecedorCompleto {
  transacoes: (DespesaFirestore & { nomeDeputado?: string })[];
}

// Log de migração (apenas em desenvolvimento)
if (process.env.NODE_ENV === 'development') {
  console.log('🔄 [MIGRAÇÃO] FirestoreService agora usa arquitetura modular');
  console.log('📖 [INFO] Para melhor performance, use os serviços especializados:');
  console.log('   - deputadosService para operações com deputados');
  console.log('   - fornecedoresService para operações com fornecedores');
  console.log('   - transacoesService para operações com transações');
  console.log('✅ [COMPATIBILIDADE] API original mantida 100% funcional');
}