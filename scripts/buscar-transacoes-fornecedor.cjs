/**
 * Script para buscar transações do fornecedor específico
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

async function buscarTransacoesFornecedor() {
  const cnpj = '00082535000159'; // HOTEL GIRASSOL PLAZA
  console.log(`🔍 Buscando transações para fornecedor ${cnpj}...\n`);
  
  // Possíveis coleções de despesas
  const possiveisColecoes = [
    'monitorgastos/despesas-consolidadas/consolidado',
    'despesas',
    'monitorgastos/despesas',
    'despesas-deputados',
    'monitorgastos/despesas-deputados'
  ];
  
  let totalTransacoesEncontradas = 0;
  const tiposDespesaEncontrados = [];
  
  for (const colecao of possiveisColecoes) {
    console.log(`📂 Verificando: ${colecao}`);
    
    try {
      // Tentar diferentes campos de CNPJ
      const camposCnpj = ['cpfCnpj', 'cnpjCpf', 'cnpj', 'fornecedorCnpj'];
      
      for (const campo of camposCnpj) {
        try {
          console.log(`   🔎 Buscando por campo: ${campo}`);
          const query = db.collection(colecao).where(campo, '==', cnpj).limit(10);
          const snapshot = await query.get();
          
          if (!snapshot.empty) {
            console.log(`   ✅ Encontradas ${snapshot.docs.length} transações por ${campo}`);
            
            snapshot.docs.forEach((doc, index) => {
              const data = doc.data();
              console.log(`   [${index + 1}] ${doc.id}:`);
              console.log(`       Nome fornecedor: ${data.nomeFornecedor || data.nomeDoFornecedor || data.nome || 'N/A'}`);
              console.log(`       Tipo Despesa: ${data.tipoDespesa || 'N/A'}`);
              console.log(`       Valor: ${data.valorLiquido || data.valor || 'N/A'}`);
              console.log(`       Ano: ${data.ano || 'N/A'}, Mês: ${data.mes || 'N/A'}`);
              
              if (data.tipoDespesa) {
                tiposDespesaEncontrados.push(data.tipoDespesa);
              }
              
              totalTransacoesEncontradas++;
            });
          } else {
            console.log(`   ❌ Nenhuma transação encontrada por ${campo}`);
          }
        } catch (error) {
          console.log(`   ⚠️ Erro ao buscar por ${campo}: ${error.message}`);
        }
      }
      
    } catch (error) {
      console.log(`   ❌ Erro geral na coleção: ${error.message}`);
    }
    
    console.log();
  }
  
  console.log(`📊 Resumo:`);
  console.log(`   Total transações: ${totalTransacoesEncontradas}`);
  console.log(`   Tipos de despesa encontrados:`, [...new Set(tiposDespesaEncontrados)]);
  
  if (tiposDespesaEncontrados.length > 0) {
    // Mapear para categorias
    const categorias = tiposDespesaEncontrados.map(tipo => mapTipoDespesaToCategoria(tipo));
    const contadorCategorias = {};
    
    categorias.forEach(categoria => {
      contadorCategorias[categoria] = (contadorCategorias[categoria] || 0) + 1;
    });
    
    console.log(`   Categorias calculadas:`, contadorCategorias);
    
    // Categoria mais frequente
    let categoriaMaisFrequente = 'OUTROS';
    let maiorFrequencia = 0;
    
    Object.entries(contadorCategorias).forEach(([categoria, freq]) => {
      if (freq > maiorFrequencia) {
        maiorFrequencia = freq;
        categoriaMaisFrequente = categoria;
      }
    });
    
    console.log(`   🎯 Categoria principal: ${categoriaMaisFrequente} (${maiorFrequencia} ocorrências)`);
  }
}

// Função para mapear tipo de despesa para categoria (copiada do script principal)
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

// Executar busca
buscarTransacoesFornecedor().catch(console.error);