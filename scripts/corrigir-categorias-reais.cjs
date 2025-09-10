/**
 * Script para corrigir fornecedores com tipoDespesa REAL das transações do ETL
 * - categoriaPrincipal: tipoDespesa mais frequente (normalizado)
 * - categoriasSecundarias: outros tipos de despesa (normalizados)
 */

const admin = require('firebase-admin');
const serviceAccount = require('./config/serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

const db = admin.firestore();

// Função para normalizar texto (remover acentos e caracteres especiais)
function normalizarTexto(texto) {
  if (!texto || typeof texto !== 'string') return '';
  
  return texto
    .normalize('NFD') // Decompor caracteres acentuados
    .replace(/[\u0300-\u036f]/g, '') // Remove marcas diacríticas (acentos)
    .replace(/[çÇ]/g, 'c') // Substituir ç por c
    .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove caracteres especiais exceto espaços e hífens
    .replace(/\s+/g, ' ') // Normalizar espaços múltiplos
    .trim() // Remove espaços do início/fim
    .toUpperCase(); // Converter para maiúsculas
}

// Função para calcular categorias baseada nos tipos de despesa reais
function calcularCategorias(transacoes) {
  if (!transacoes || transacoes.length === 0) {
    return {
      categoriaPrincipal: 'Não especificado',
      categoriasSecundarias: [],
      detalhamento: {
        totalTransacoes: 0,
        tiposEncontrados: {}
      }
    };
  }
  
  // Contar frequência de cada tipo de despesa (usando STRING ORIGINAL exata)
  const contadorTipos = {};
  
  transacoes.forEach(transacao => {
    const tipoOriginal = transacao.tipoDespesa || transacao.tipoGasto || transacao.categoria;
    
    if (tipoOriginal && typeof tipoOriginal === 'string' && tipoOriginal.trim().length > 0) {
      // Usar o texto original EXATO como chave
      const tipoLimpo = tipoOriginal.trim();
      contadorTipos[tipoLimpo] = (contadorTipos[tipoLimpo] || 0) + 1;
    }
  });
  
  // Ordenar por frequência (maior para menor)
  const tiposOrdenados = Object.entries(contadorTipos)
    .sort(([,a], [,b]) => b - a)
    .map(([tipo, freq]) => ({ tipo, frequencia: freq }));
  
  // Categoria principal = tipoDespesa mais frequente (STRING ORIGINAL)
  const categoriaPrincipal = tiposOrdenados.length > 0 ? tiposOrdenados[0].tipo : 'Não especificado';
  
  // Categorias secundárias = outros tipos de despesa (STRINGS ORIGINAIS)
  const categoriasSecundarias = tiposOrdenados.slice(1).map(item => item.tipo);
  
  return {
    categoriaPrincipal,
    categoriasSecundarias,
    detalhamento: {
      totalTransacoes: transacoes.length,
      tiposEncontrados: contadorTipos,
      distribuicao: tiposOrdenados
    }
  };
}

// Função para buscar transações de um fornecedor usando diferentes estratégias
async function buscarTransacoesFornecedor(cnpj, nome) {
  console.log(`🔍 Buscando transações para ${cnpj} (${nome})`);
  
  let todasTransacoes = [];
  
  // Estratégias de busca (baseadas no ETL)
  const estrategias = [
    // Estratégia 1: Buscar em despesas consolidadas por CNPJ
    {
      nome: 'despesas-consolidadas/consolidado por cpfCnpj',
      colecao: 'monitorgastos/despesas-consolidadas/consolidado',
      campo: 'cpfCnpj',
      valor: cnpj
    },
    
    // Estratégia 2: Buscar por nome do fornecedor
    {
      nome: 'despesas-consolidadas/consolidado por nomeFornecedor',
      colecao: 'monitorgastos/despesas-consolidadas/consolidado',
      campo: 'nomeFornecedor',
      valor: nome
    },
    
    // Estratégia 3: Outras possíveis estruturas
    {
      nome: 'despesas por cnpj',
      colecao: 'despesas',
      campo: 'cpfCnpj',
      valor: cnpj
    }
  ];
  
  for (const estrategia of estrategias) {
    try {
      console.log(`   Tentando: ${estrategia.nome}`);
      
      const query = db.collection(estrategia.colecao)
        .where(estrategia.campo, '==', estrategia.valor)
        .limit(1000); // Limite para evitar timeout
      
      const snapshot = await query.get();
      
      if (!snapshot.empty) {
        console.log(`   ✅ Encontradas ${snapshot.docs.length} transações`);
        
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          todasTransacoes.push({
            id: doc.id,
            tipoDespesa: data.tipoDespesa,
            tipoGasto: data.tipoGasto,
            categoria: data.categoria,
            valorLiquido: data.valorLiquido || data.valor || 0,
            ano: data.ano,
            mes: data.mes
          });
        });
        
        // Se encontrou dados nesta estratégia, parar (para evitar duplicação)
        break;
      } else {
        console.log(`   ❌ Nenhuma transação encontrada`);
      }
      
    } catch (error) {
      console.log(`   ⚠️ Erro na estratégia ${estrategia.nome}: ${error.message}`);
    }
  }
  
  console.log(`📊 Total de transações encontradas: ${todasTransacoes.length}`);
  return todasTransacoes;
}

// Função para corrigir fornecedor específico
async function corrigirFornecedor(cnpj) {
  console.log(`\n🔍 Corrigindo fornecedor: ${cnpj}`);
  
  try {
    // 1. Buscar dados atuais do fornecedor
    const fornecedorRef = db.collection('monitorgastos/fornecedores/lista').doc(cnpj);
    const fornecedorDoc = await fornecedorRef.get();
    
    if (!fornecedorDoc.exists) {
      console.log('❌ Fornecedor não encontrado');
      return false;
    }
    
    const fornecedorData = fornecedorDoc.data();
    const dados = fornecedorData.dados || {};
    
    console.log('📋 Dados atuais:');
    console.log(`   Nome: ${dados.nome || 'N/A'}`);
    console.log(`   Transações registradas: ${dados.numeroTransacoes || 0}`);
    
    // 2. Buscar transações reais para este fornecedor
    const transacoes = await buscarTransacoesFornecedor(cnpj, dados.nome);
    
    // 3. Calcular categorias baseadas nos tipos de despesa reais
    const categorias = calcularCategorias(transacoes);
    
    console.log('🎯 Categorias calculadas:');
    console.log(`   Principal: ${categorias.categoriaPrincipal}`);
    console.log(`   Secundárias: [${categorias.categoriasSecundarias.join(', ')}]`);
    console.log(`   Detalhes:`, categorias.detalhamento.distribuicao);
    
    // 4. Preparar dados corrigidos
    const dadosCorrigidos = {
      ...dados,
      
      // REVERTER nomenclatura conforme solicitado
      nomeFornecedor: dados.nomeFornecedor || dados.nome,
      cnpjCpfFornecedor: dados.cnpjCpfFornecedor || dados.cnpjCpf || cnpj,
      
      // Categorias baseadas em dados reais (tipoDespesa original)
      categoriaPrincipal: categorias.categoriaPrincipal,
      categoriasSecundarias: categorias.categoriasSecundarias,
      
      // Metadados detalhados
      categorizacao: {
        baseadaEm: 'tipoDespesa_transacoes_reais',
        totalTransacoesAnalisadas: categorias.detalhamento.totalTransacoes,
        distribuicaoTipos: categorias.detalhamento.distribuicao,
        ultimaAtualizacao: new Date().toISOString()
      },
      
      // REMOVER campos desnecessários
      nome: undefined,      // Remover 'nome' 
      cnpjCpf: undefined,   // Remover 'cnpjCpf'
      id: undefined,        // Remover 'id' conforme solicitado
      
      // Atualizar metadados gerais
      ultimaCorrecao: new Date().toISOString()
    };
    
    // Limpar campos undefined
    Object.keys(dadosCorrigidos).forEach(key => {
      if (dadosCorrigidos[key] === undefined) {
        delete dadosCorrigidos[key];
      }
    });
    
    console.log('✅ Estrutura final:');
    console.log(`   Nome: ${dadosCorrigidos.nome}`);
    console.log(`   CNPJ/CPF: ${dadosCorrigidos.cnpjCpf}`);
    console.log(`   Categoria Principal: ${dadosCorrigidos.categoriaPrincipal}`);
    console.log(`   Categorias Secundárias: [${dadosCorrigidos.categoriasSecundarias.join(', ')}]`);
    
    // 5. Salvar se solicitado
    const executar = process.argv.includes('--executar');
    
    if (executar) {
      console.log('💾 Salvando no Firestore...');
      await fornecedorRef.update({ dados: dadosCorrigidos });
      console.log('✅ Fornecedor corrigido!');
      
      // Verificação
      const verificacao = await fornecedorRef.get();
      const dadosVerificacao = verificacao.data().dados;
      console.log('🔍 Verificação:');
      console.log(`   Categoria Principal: ${dadosVerificacao.categoriaPrincipal}`);
      console.log(`   Categorias Secundárias: ${dadosVerificacao.categoriasSecundarias?.length || 0} tipos`);
      
    } else {
      console.log('📝 Simulação. Use --executar para salvar.');
    }
    
    return true;
    
  } catch (error) {
    console.error(`❌ Erro ao corrigir ${cnpj}:`, error.message);
    return false;
  }
}

// Função para corrigir múltiplos fornecedores
async function corrigirMultiplosFornecedores(limite = 5) {
  console.log(`🚀 Corrigindo ${limite} fornecedores...\n`);
  
  try {
    const fornecedoresQuery = db.collection('monitorgastos/fornecedores/lista').limit(limite);
    const snapshot = await fornecedoresQuery.get();
    
    if (snapshot.empty) {
      console.log('❌ Nenhum fornecedor encontrado');
      return;
    }
    
    let sucessos = 0;
    let erros = 0;
    
    for (const doc of snapshot.docs) {
      const cnpj = doc.id;
      const sucesso = await corrigirFornecedor(cnpj);
      
      if (sucesso) {
        sucessos++;
      } else {
        erros++;
      }
      
      // Pausa entre processamentos
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`\n📊 Relatório Final:`);
    console.log(`✅ Sucessos: ${sucessos}`);
    console.log(`❌ Erros: ${erros}`);
    
  } catch (error) {
    console.error('❌ Erro geral:', error.message);
  }
}

// Script principal
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help')) {
    console.log(`
🛠️  Correção de Categorias com Dados Reais do ETL

Uso:
  node corrigir-categorias-reais.cjs [opções]
  
Opções:
  --cnpj CNPJ           Corrigir fornecedor específico
  --limite N            Número de fornecedores (padrão: 5)
  --executar            Executar correções reais
  --help                Esta ajuda
  
Exemplos:
  # Simular correção do HOTEL GIRASSOL PLAZA
  node corrigir-categorias-reais.cjs --cnpj 00082535000159
  
  # Executar correção real
  node corrigir-categorias-reais.cjs --cnpj 00082535000159 --executar
  
  # Corrigir 10 fornecedores
  node corrigir-categorias-reais.cjs --limite 10 --executar
`);
    return;
  }
  
  const cnpjIndex = args.indexOf('--cnpj');
  const limiteIndex = args.indexOf('--limite');
  
  if (cnpjIndex !== -1 && cnpjIndex + 1 < args.length) {
    const cnpj = args[cnpjIndex + 1];
    await corrigirFornecedor(cnpj);
  } else {
    const limite = limiteIndex !== -1 && limiteIndex + 1 < args.length 
      ? parseInt(args[limiteIndex + 1]) 
      : 5;
    await corrigirMultiplosFornecedores(limite);
  }
}

main().catch(console.error);