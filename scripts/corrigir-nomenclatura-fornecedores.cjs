/**
 * Script para corrigir nomenclatura de fornecedores no Firestore
 * - Corrige nomeFornecedor -> nome original
 * - Corrige cnpjCpfFornecedor -> cnpjCpf original
 * - Adiciona categoriaPrincipal baseada na maior frequência de tipoDespesa
 */

// Configuração do Firebase Admin (igual ao script processarFornecedoresOrganizado.cjs)
const admin = require('firebase-admin');

// Usar serviceAccountKey.json
const serviceAccount = require('./config/serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

const db = admin.firestore();
console.log('🔥 Firebase inicializado com serviceAccountKey.json');

// Função para mapear tipo de despesa para categoria
function mapTipoDespesaToCategoria(tipoDespesa) {
  if (!tipoDespesa) return 'OUTROS';
  
  const tipo = tipoDespesa.toLowerCase();
  
  if (tipo.includes('passagem') || tipo.includes('transporte') || tipo.includes('combustí') || tipo.includes('locação veíc')) {
    return 'TRANSPORTE';
  } else if (tipo.includes('hotel') || tipo.includes('hospedage') || tipo.includes('pousada')) {
    return 'HOSPEDAGEM';
  } else if (tipo.includes('aliment') || tipo.includes('refeição') || tipo.includes('restaurante')) {
    return 'ALIMENTAÇÃO';
  } else if (tipo.includes('consult') || tipo.includes('assessor') || tipo.includes('serviços')) {
    return 'CONSULTORIA';
  } else if (tipo.includes('material') || tipo.includes('equipamento') || tipo.includes('suprimento')) {
    return 'MATERIAL';
  } else if (tipo.includes('divulgação') || tipo.includes('publicidad') || tipo.includes('propaganda')) {
    return 'DIVULGAÇÃO';
  } else if (tipo.includes('telefon') || tipo.includes('comunicação') || tipo.includes('internet')) {
    return 'COMUNICAÇÃO';
  } else if (tipo.includes('postal') || tipo.includes('correio')) {
    return 'POSTAL';
  } else if (tipo.includes('combustível') || tipo.includes('gasolina') || tipo.includes('etanol')) {
    return 'COMBUSTÍVEL';
  } else if (tipo.includes('segurança') || tipo.includes('vigilância')) {
    return 'SEGURANÇA';
  }
  
  return 'OUTROS';
}

// Função para calcular categoria principal baseada na frequência
function calcularCategoriaPrincipal(transacoes) {
  if (!transacoes || transacoes.length === 0) return 'OUTROS';
  
  const contadorCategorias = {};
  const contadorValores = {};
  
  // Contar frequência e somar valores por categoria
  transacoes.forEach(transacao => {
    const categoria = mapTipoDespesaToCategoria(transacao.tipoDespesa);
    contadorCategorias[categoria] = (contadorCategorias[categoria] || 0) + 1;
    contadorValores[categoria] = (contadorValores[categoria] || 0) + (transacao.valorLiquido || 0);
  });
  
  // Determinar categoria principal (pode usar frequência OU valor total)
  // Vamos usar frequência como critério principal
  let categoriaPrincipal = 'OUTROS';
  let maiorFrequencia = 0;
  
  for (const [categoria, frequencia] of Object.entries(contadorCategorias)) {
    if (frequencia > maiorFrequencia) {
      maiorFrequencia = frequencia;
      categoriaPrincipal = categoria;
    }
  }
  
  return categoriaPrincipal;
}

// Função principal para corrigir fornecedor específico
async function corrigirFornecedor(cnpj) {
  console.log(`\n🔍 Analisando fornecedor: ${cnpj}`);
  
  try {
    // 1. Buscar documento do fornecedor
    const fornecedorRef = db.collection('monitorgastos/fornecedores/lista').doc(cnpj);
    const fornecedorDoc = await fornecedorRef.get();
    
    if (!fornecedorDoc.exists) {
      console.log(`❌ Fornecedor ${cnpj} não encontrado`);
      return false;
    }
    
    const fornecedorData = fornecedorDoc.data();
    
    // Os dados estão dentro do subcampo "dados"
    const dados = fornecedorData.dados || {};
    
    console.log('📋 Estrutura atual:', {
      temDados: !!fornecedorData.dados,
      temNome: !!dados.nome,
      temNomeFornecedor: !!dados.nomeFornecedor,
      temId: !!dados.id,
      temCnpjCpf: !!dados.cnpjCpf,
      temCategoriaPrincipal: !!dados.categoriaPrincipal,
      nomeAtual: dados.nome || 'N/A',
      idAtual: dados.id || 'N/A',
      totalTransacoes: dados.numeroTransacoes || 0
    });
    
    // 2. Buscar transações para calcular categoria principal
    console.log('🔄 Buscando transações para análise...');
    let todasTransacoes = [];
    
    // Buscar em despesas consolidadas por ano
    const anos = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];
    
    for (const ano of anos) {
      try {
        const despesasQuery = db.collection('monitorgastos/despesas-consolidadas/consolidado')
          .where('cpfCnpj', '==', cnpj)
          .limit(1000); // Limite para evitar timeout
          
        const despesasSnapshot = await despesasQuery.get();
        
        despesasSnapshot.docs.forEach(doc => {
          const despesa = doc.data();
          todasTransacoes.push({
            tipoDespesa: despesa.tipoDespesa,
            valorLiquido: despesa.valorLiquido || despesa.valor || 0,
            ano: despesa.ano || ano,
            mes: despesa.mes
          });
        });
        
        if (despesasSnapshot.docs.length > 0) {
          console.log(`  📊 Encontradas ${despesasSnapshot.docs.length} transações em ${ano}`);
        }
      } catch (error) {
        console.log(`  ⚠️ Erro ao buscar transações em ${ano}:`, error.message);
      }
    }
    
    console.log(`📊 Total de transações encontradas: ${todasTransacoes.length}`);
    
    // 3. Calcular categoria principal
    const categoriaPrincipal = calcularCategoriaPrincipal(todasTransacoes);
    console.log(`🎯 Categoria principal calculada: ${categoriaPrincipal}`);
    
    // 4. Preparar dados corrigidos
    const dadosCorrigidos = {
      // Manter dados existentes
      ...fornecedorData,
      
      // Corrigir nomenclatura
      nome: fornecedorData.nomeFornecedor || fornecedorData.nome,
      cnpjCpf: fornecedorData.cnpjCpfFornecedor || fornecedorData.cnpjCpf || cnpj,
      
      // Adicionar categoria principal
      categoriaPrincipal: categoriaPrincipal,
      
      // Metadados da correção
      ultimaCorrecao: new Date().toISOString(),
      totalTransacoesAnalisadas: todasTransacoes.length,
      
      // Remover campos com nomenclatura incorreta (opcional)
      nomeFornecedor: undefined,
      cnpjCpfFornecedor: undefined
    };
    
    // Limpar campos undefined
    Object.keys(dadosCorrigidos).forEach(key => {
      if (dadosCorrigidos[key] === undefined) {
        delete dadosCorrigidos[key];
      }
    });
    
    console.log('✅ Dados corrigidos preparados:', {
      nome: dadosCorrigidos.nome,
      cnpjCpf: dadosCorrigidos.cnpjCpf,
      categoriaPrincipal: dadosCorrigidos.categoriaPrincipal,
      totalTransacoesAnalisadas: dadosCorrigidos.totalTransacoesAnalisadas
    });
    
    // 5. Atualizar no Firestore
    const confirmar = process.argv.includes('--executar');
    if (confirmar) {
      console.log('💾 Salvando correções no Firestore...');
      await fornecedorRef.update(dadosCorrigidos);
      console.log('✅ Fornecedor corrigido com sucesso!');
    } else {
      console.log('📝 Execução simulada. Use --executar para aplicar as correções.');
    }
    
    return true;
    
  } catch (error) {
    console.error(`❌ Erro ao corrigir fornecedor ${cnpj}:`, error);
    return false;
  }
}

// Função para listar e corrigir vários fornecedores
async function corrigirMultiplosFornecedores(limite = 10) {
  console.log(`🚀 Iniciando correção de fornecedores (limite: ${limite})`);
  
  try {
    // Buscar fornecedores com problemas de nomenclatura
    const fornecedoresQuery = db.collection('monitorgastos/fornecedores/lista')
      .limit(limite);
    
    const snapshot = await fornecedoresQuery.get();
    
    if (snapshot.empty) {
      console.log('❌ Nenhum fornecedor encontrado');
      return;
    }
    
    console.log(`📋 Encontrados ${snapshot.docs.length} fornecedores para análise`);
    
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
      
      // Pequena pausa entre processamentos
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n📊 Relatório final:`);
    console.log(`✅ Sucessos: ${sucessos}`);
    console.log(`❌ Erros: ${erros}`);
    console.log(`📝 Total processados: ${sucessos + erros}`);
    
  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Script principal
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🛠️  Script de Correção de Fornecedores
    
Uso:
  node corrigir-nomenclatura-fornecedores.cjs [opções]
  
Opções:
  --cnpj CNPJ           Corrigir fornecedor específico
  --limite N            Número de fornecedores para processar (padrão: 10)
  --executar            Executar as correções (sem essa flag, apenas simula)
  --help, -h            Mostrar esta ajuda
  
Exemplos:
  # Simular correção de fornecedor específico
  node corrigir-nomenclatura-fornecedores.cjs --cnpj 00082535000159
  
  # Executar correção de fornecedor específico
  node corrigir-nomenclatura-fornecedores.cjs --cnpj 00082535000159 --executar
  
  # Simular correção de 20 fornecedores
  node corrigir-nomenclatura-fornecedores.cjs --limite 20
  
  # Executar correção de 5 fornecedores
  node corrigir-nomenclatura-fornecedores.cjs --limite 5 --executar
`);
    return;
  }
  
  const cnpjIndex = args.indexOf('--cnpj');
  const limiteIndex = args.indexOf('--limite');
  
  if (cnpjIndex !== -1 && cnpjIndex + 1 < args.length) {
    // Corrigir fornecedor específico
    const cnpj = args[cnpjIndex + 1];
    await corrigirFornecedor(cnpj);
  } else {
    // Corrigir múltiplos fornecedores
    const limite = limiteIndex !== -1 && limiteIndex + 1 < args.length 
      ? parseInt(args[limiteIndex + 1]) 
      : 10;
    
    await corrigirMultiplosFornecedores(limite);
  }
}

// Executar script
if (require.main === module) {
  main().catch(console.error);
}